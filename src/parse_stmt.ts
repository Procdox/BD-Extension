import * as vscode from 'vscode';
import { dm, Maybe } from './helpers';
import { AnyInfo, ArgInfo, BDType, TokenNames, TokenType } from "./enums";
import { ExprReader, IndexNode, NameNode, PropertyNode, TokenReader, } from './parse_expr';
import { BUILTINS } from './builtins';
import { Token } from './parse_tokens';

type StmtType = TokenType.If | TokenType.Elif | TokenType.Else | TokenType.Return | TokenType.For | TokenType.While 
  | TokenType.Break | TokenType.Continue | TokenType.Import | TokenType.Func | TokenType.Var;

type StmtFn = (tokens:Token[])=>Statement;

export class Statement {
  t:StmtType;
  tokens:Token[];
  outer_declares:NameNode[] = [];
  inner_declares:NameNode[] = [];
  lval_expr:Maybe<ExprReader> = undefined;
  rval_expr:Maybe<ExprReader> = undefined;
  constructor(tokens:Token[], t:StmtType){ 
    this.tokens = tokens; 
    this.t = t;
  }
  checkIs(pos:number, qual:{t?:TokenType, ot?:TokenType|TokenType[], v?:string}, err_msg:string){
    const focus = pos < this.tokens.length ? this.tokens[pos] : this.tokens[this.tokens.length - 1];
    let passing = pos < this.tokens.length;
    passing = passing && (qual["t"] === undefined || focus.isType(qual["t"]));
    passing = passing && (qual["ot"] === undefined || focus.isType(qual["ot"]));
    passing = passing && (qual["v"] === undefined || focus.value === qual["v"]);
    if(!passing){
      focus.issues.push(err_msg);
      return undefined;
    }
    return focus;
  }
  private _addDecl(pos:number, err_msg:string, arr:Token[]){
    const focus = this.checkIs(pos, {t:TokenType.Name}, err_msg);
    if(focus === undefined) return;
    arr.push(focus);
  }
  setLval(start_pos:number, end_pos:number){
    if(end_pos > this.tokens.length) end_pos = this.tokens.length;
    if(end_pos > start_pos && this.lval_expr === undefined){
      this.lval_expr = new ExprReader(this.tokens, 0, end_pos);
    }
    return this.lval_expr;
  }
  setRval(start_pos:number, end_pos:number){
    if(end_pos > this.tokens.length) end_pos = this.tokens.length;
    if(end_pos > start_pos && this.rval_expr === undefined){
      this.rval_expr = new ExprReader(this.tokens, start_pos, end_pos);
    }
    return this.rval_expr;
  }
  checkSize(expected:number){
    if(this.tokens.length > expected){
      this.tokens[expected].issues.push(`Unexpected symbol after ${TokenNames[this.t]} statement`);
    }
  }
};

//  ==================================================
//    Statement Type specific builders
//  ==================================================

function bldSimpleStmtParser(name:StmtType, has_colon:boolean) : StmtFn {
  const colon_err = `Expected colon at the end of a ${name} statement`;
  return (tokens:Token[]) => {
    const stmt = new Statement(tokens, name); 
    if(has_colon) stmt.checkIs(1, {ot:TokenType.Colon}, colon_err);
    stmt.checkSize(has_colon ? 2 : 1);
    return stmt;
  };
}
function bldExprStmtParser(name:StmtType, has_colon:boolean) : StmtFn { 
  const colon_err = `Expected colon at the end of a ${name} statement`;
  return (tokens:Token[]) => {
    const stmt = new Statement(tokens, name); 
    if(has_colon){
      stmt.checkIs(tokens.length - 1, {ot:TokenType.Colon}, colon_err);
    }
    stmt.setRval(1, tokens.length - (has_colon ? 1 : 0));
    return stmt;
  };
}

function parseForStatement(tokens:Token[]) : Statement {
  const stmt = new Statement(tokens, TokenType.For);
  const for_name_token = stmt.checkIs(1, {t:TokenType.Name}, "Expected iterator variable");
  if(for_name_token !== undefined){
    stmt.inner_declares.push(new NameNode(for_name_token));
  }
  stmt.checkIs(2, {v:"in"}, "Expected keyword in");
  const rval_expr = stmt.setRval(3, tokens.length - 1);
  stmt.checkIs(tokens.length - 1, {ot:TokenType.Colon}, "Expected colon at the end of a for statement");
  return stmt;
}
function parseFuncStmt(tokens:Token[]) : Statement {
  const stmt = new Statement(tokens, TokenType.Func);
  const arg_reader = new TokenReader(tokens, 1, tokens.length);
  const func_name_token = arg_reader.expectNext(TokenType.Name, "Expected function name");
  if(func_name_token === undefined) return stmt;
  stmt.outer_declares.push(new NameNode(func_name_token));
  if(arg_reader.expectNext(TokenType.OpenRound, "Expected open paren") === undefined) return stmt;
  
  while(!arg_reader.isNext(TokenType.CloseRound)){
    const arg_name_token = arg_reader.expectNext(TokenType.Name, "Expected function argument name");
    if(arg_name_token === undefined) return stmt;
    stmt.inner_declares.push(new NameNode(arg_name_token));
    if(!arg_reader.takeNextIf(TokenType.Comma)) break;
  }
  if(arg_reader.expectNext(TokenType.CloseRound, "Expected close paren") === undefined) return stmt;
  if(arg_reader.expectNext(TokenType.Colon, "Expected a colon at the end of a func statement") === undefined) return stmt;
  stmt.checkSize(arg_reader.pos);
  return stmt;
}
function parseImportStmt(tokens:Token[]) : Statement {
  const stmt = new Statement(tokens, TokenType.Import);
  const name = stmt.checkIs(1, {t:TokenType.String}, "Expected an import path string literal")
  if(tokens.length > 2){
    stmt.checkIs(2, {v:"as"}, "Expected keyword as");
    const alias_name_token = stmt.checkIs(3, {t:TokenType.Name}, "Expected import alias");
    if(alias_name_token != undefined){
      stmt.outer_declares.push(new NameNode(alias_name_token));
    }
    stmt.checkSize(4);
  }
  else if(name !== undefined){
    stmt.outer_declares.push(new NameNode(name));
  }
  return stmt;
}
function parseVarStmt(tokens:Token[]) : Statement {
  const stmt = new Statement(tokens, TokenType.Var);
  const var_name_token = stmt.checkIs(1, {t:TokenType.Name}, "Expected variable name");
  if(var_name_token != undefined){
    stmt.outer_declares.push(new NameNode(var_name_token));
  }
  stmt.checkIs(2, {ot:TokenType.Assign}, "Expected an assignment operator (=)");
  stmt.setRval(3, tokens.length);
  return stmt;
}
function parseExpression(tokens:Token[]) : Statement {
  const stmt = new Statement(tokens, TokenType.Var);
  const assign_idx = tokens.findIndex(t=>t.group >= TokenType.Assign && t.group <= TokenType.Decrement);
  if(assign_idx >= 0){
    const lval_expr = stmt.setLval(0, assign_idx);
    if(lval_expr === undefined){
      tokens[0].issues.push("Unexpected or missing assignment target");
    }
    else if(!(lval_expr.ast instanceof NameNode || lval_expr.ast instanceof PropertyNode || lval_expr.ast instanceof IndexNode)){
      tokens[0].issues.push("Invalid assignment target");
    }
  }
  stmt.setRval(assign_idx+1, tokens.length)
  return stmt;
}

const StmtFactory:Map<TokenType,StmtFn> = new Map<TokenType,StmtFn>([
  [TokenType.If, bldExprStmtParser(TokenType.If, true)],
  [TokenType.Elif, bldExprStmtParser(TokenType.Elif, true)],
  [TokenType.While, bldExprStmtParser(TokenType.While, true)],
  [TokenType.Return, bldExprStmtParser(TokenType.Return, false)],
  [TokenType.Else, bldSimpleStmtParser(TokenType.Else, true)],
  [TokenType.Break, bldSimpleStmtParser(TokenType.Break, false)],
  [TokenType.Continue, bldSimpleStmtParser(TokenType.Continue, false)],
  [TokenType.For, parseForStatement],
  [TokenType.Func, parseFuncStmt],
  [TokenType.Import, parseImportStmt],
  [TokenType.Var, parseVarStmt],
]);

export function parseStatement(tokens:Token[]) : Maybe<Statement> {
  if(tokens.length == 0) return undefined;
  const builder = StmtFactory.get(tokens[0].group);
  if(builder !== undefined){
    return builder(tokens);
  }
  return parseExpression(tokens);
}