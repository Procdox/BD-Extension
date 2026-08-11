import * as vscode from 'vscode';
import { dm, Maybe } from './helpers';
import { AnyInfo, ArgInfo, BDType, ParseToken, TokenNames, TokenType } from "./lang_types";
import { ExprReader, IndexNode, NameNode, PropertyNode, } from './parse_expr';
import { BUILTINS } from './builtins';

type StmtType = TokenType.If | TokenType.Elif | TokenType.Else | TokenType.Return | TokenType.For | TokenType.While 
  | TokenType.Break | TokenType.Continue | TokenType.Import | TokenType.Func | TokenType.Var;

export class Statement {
  t:StmtType;
  tokens:ParseToken[];
  outer_declares:ParseToken[] = [];
  inner_declares:ParseToken[] = [];
  assign_ref:Maybe<ParseToken> = undefined;
  lval_expr:Maybe<ExprReader> = undefined;
  rval_expr:Maybe<ExprReader> = undefined;
  constructor(tokens:ParseToken[], t:StmtType){ 
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
  private _addDecl(pos:number, err_msg:string, arr:ParseToken[]){
    const focus = this.checkIs(pos, {t:TokenType.Name}, err_msg);
    if(focus === undefined) return;
    arr.push(focus);
  }
  addInnerDecl(pos:number, err_msg:string){
    this._addDecl(pos, err_msg, this.inner_declares);
  }
  addOuterDecl(pos:number, err_msg:string){
    this._addDecl(pos, err_msg, this.outer_declares);
  }
  addLval(end_pos:number){
    if(end_pos > 0 && this.lval_expr === undefined){
      this.lval_expr = new ExprReader(this.tokens, 0, end_pos);
    }
    return this.lval_expr;
  }
  addRval(start_pos:number, end_pos:number){
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

type StmtFn = (tokens:ParseToken[])=>Statement;

function bldFlowStmt(name:StmtType, has_expr:boolean, has_colon:boolean) : StmtFn { 
  const colon_err = `Expected colon at the end of a ${name} statement`;
  if(has_expr){
    return (tokens:ParseToken[]) => {
      const stmt = new Statement(tokens, name); 
      if(has_colon){
        stmt.checkIs(tokens.length - 1, {ot:TokenType.Colon}, colon_err);
      }
      stmt.addRval(1, tokens.length - (has_colon ? 1 : 0));
      return stmt;
    };
  }
  else {
    return (tokens:ParseToken[]) => {
      const stmt = new Statement(tokens, name); 
      if(has_colon) stmt.checkIs(1, {ot:TokenType.Colon}, colon_err);
      stmt.checkSize(has_colon ? 2 : 1);
      return stmt;
    }; 
  }
}

function bldForStmt(tokens:ParseToken[]) : Statement {
  const stmt = new Statement(tokens, TokenType.For);
  stmt.addInnerDecl(1, "Expected iterator variable");
  stmt.checkIs(2, {v:"in"}, "Expected keyword in");
  stmt.addRval(3, tokens.length - 1);
  stmt.checkIs(tokens.length - 1, {ot:TokenType.Colon}, "Expected colon at the end of a for statement");
  return stmt;
}
function bldFuncStmt(tokens:ParseToken[]) : Statement {
  const stmt = new Statement(tokens, TokenType.Func);
  stmt.addOuterDecl(1, "Expected function name");
  stmt.checkIs(2, {ot:TokenType.OpenRound}, "Expected open paren");
  let cur_idx = 3;
  let last = "(";
  while(cur_idx < tokens.length){
    const focus = tokens[cur_idx];
    if(focus.isType(TokenType.CloseRound)){
      if(last == ","){
        focus.issues.push("Expected another function argument");
      }
      last = ")";
      break;
    }
    else if(focus.isType(TokenType.Name)){
      if(last != "(" && last != ","){
        focus.issues.push("Expected a comma seperating function arguments");
      }
      stmt.addInnerDecl(cur_idx, "NOT REACHABLE");
      last = "n"
    }
    else if(focus.isType(TokenType.Comma)){
      if(last != "n"){
        focus.issues.push("Unexpected comma, no preceding function argument?");
      }
      last = ",";
    }
    else {
      focus.issues.push("Expected name in function arguments");
    }
    cur_idx += 1;
  }
  if(last != ")"){
    stmt.checkIs(cur_idx, {ot:TokenType.OpenRound}, "Expected close paren");
  }
  stmt.checkIs(cur_idx+1, {ot:TokenType.Colon}, "Expected colon at the end of a func statement");
  stmt.checkSize(cur_idx+2);
  return stmt;
}
function bldImportStmt(tokens:ParseToken[]) : Statement {
  const stmt = new Statement(tokens, TokenType.Import);
  const name = stmt.checkIs(1, {t:TokenType.String}, "Expected an import path string literal")
  if(tokens.length > 2){
    stmt.checkIs(2, {v:"as"}, "Expected keyword as");
    stmt.addOuterDecl(3, "Expected import alias");
    stmt.checkSize(4);
  }
  else if(name !== undefined){
    stmt.outer_declares.push(name);
  }
  return stmt;
}
function bldVarStmt(tokens:ParseToken[]) : Statement {
  const stmt = new Statement(tokens, TokenType.Var);
  stmt.addOuterDecl(1, "Expected variable name");
  stmt.checkIs(2, {ot:TokenType.Assign}, "Expected an assignment operator (=)")
  stmt.addRval(3, tokens.length);
  return stmt;
}
function bldExpression(tokens:ParseToken[]) : Statement {
  const stmt = new Statement(tokens, TokenType.Var);
  const assign_idx = tokens.findIndex(t=>t.group >= TokenType.Assign && t.group <= TokenType.Decrement);
  if(assign_idx >= 0){
    const lval_expr = stmt.addLval(assign_idx);
    if(lval_expr === undefined){
      tokens[0].issues.push("Unexpected or missing assignment target");
    }
    else if(!(lval_expr.ast instanceof NameNode || lval_expr.ast instanceof PropertyNode || lval_expr.ast instanceof IndexNode)){
      tokens[0].issues.push("Invalid assignment target");
    }
  }
  stmt.addRval(assign_idx+1, tokens.length)
  return stmt;
}

const StmtFactory:Map<TokenType,StmtFn> = new Map<TokenType,StmtFn>([
  [TokenType.If, bldFlowStmt(TokenType.If, true, true)],
  [TokenType.Elif, bldFlowStmt(TokenType.Elif, true, true)],
  [TokenType.Else, bldFlowStmt(TokenType.Else, false, true)],
  [TokenType.Return, bldFlowStmt(TokenType.Return, true, false)],
  [TokenType.While, bldFlowStmt(TokenType.While, true, true)],
  [TokenType.Break, bldFlowStmt(TokenType.Break, false, false)],
  [TokenType.Continue, bldFlowStmt(TokenType.Continue, false, false)],
  [TokenType.For, bldForStmt],
  [TokenType.Func, bldFuncStmt],
  [TokenType.Import, bldImportStmt],
  [TokenType.Var, bldVarStmt],
]);

export function parseStatement(tokens:ParseToken[]) : Maybe<Statement> {
  if(tokens.length == 0) return undefined;
  const builder = StmtFactory.get(tokens[0].group);
  if(builder !== undefined){
    return builder(tokens);
  }
  return bldExpression(tokens);
}