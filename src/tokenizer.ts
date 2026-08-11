import * as vscode from 'vscode';
import { dm, Maybe } from './helpers';
import { AnyInfo, ArgInfo, BDType, ParseToken, TokenNames, TokenType } from "./lang_types";
import { ExprReader, IndexNode, NameNode, PropertyNode, } from './expression';
import { BUILTINS } from './builtins';

const LINT_OPER = /((?:if|elif|else|return|for|while|break|continue|import|func|var|as|in|or|and|not|true|false|null)\b|<<|>>|[+\-<>!=]=?|[*\/%?^.~,&|:(){}\[\]])/gy;
const LINT_NAME = /([a-zA-Z_][a-zA-Z0-9_]*)/gy
const LINT_STRING = /('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*")/gy
const LINT_NUMBER = /([0-9]+(?:\.[0-9]+)?)/gy

// +(a,b) u * => 
type StmtType = TokenType.If | TokenType.Elif | TokenType.Else | TokenType.Return | TokenType.For | TokenType.While 
  | TokenType.Break | TokenType.Continue | TokenType.Import | TokenType.Func | TokenType.Var;

class Statement {
  t:StmtType;
  line:TokenLine;
  outer_declares:ParseToken[] = [];
  inner_declares:ParseToken[] = [];
  assign_ref:Maybe<ParseToken> = undefined;
  lval_expr:Maybe<ExprReader> = undefined;
  rval_expr:Maybe<ExprReader> = undefined;
  constructor(line:TokenLine, t:StmtType){ 
    this.line = line; 
    this.t = t;
  }
  checkIs(pos:number, qual:{t?:TokenType, ot?:TokenType|TokenType[], v?:string}, err_msg:string){
    const tokens = this.line.tokens;
    const focus = pos < tokens.length ? tokens[pos] : tokens[tokens.length - 1];
    let passing = pos < tokens.length;
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
      this.lval_expr = new ExprReader(this.line.tokens, 0, end_pos);
    }
    return this.lval_expr;
  }
  addRval(start_pos:number, end_pos:number){
    if(end_pos > start_pos && this.rval_expr === undefined){
      this.rval_expr = new ExprReader(this.line.tokens, start_pos, end_pos);
    }
    return this.rval_expr;
  }
  checkSize(expected:number){
    if(this.line.tokens.length > expected){
      this.line.tokens[expected].issues.push(`Unexpected symbol after ${TokenNames[this.t]} statement`);
    }
  }
};

type StmtFn = (line:TokenLine)=>Statement;

function bldFlowStmt(name:StmtType, has_expr:boolean, has_colon:boolean) : StmtFn { 
  const colon_err = `Expected colon at the end of a ${name} statement`;
  if(has_expr){
    return (line:TokenLine) => {
      const stmt = new Statement(line, name); 
      if(has_colon){
        stmt.checkIs(line.tokens.length - 1, {ot:TokenType.Colon}, colon_err);
      }
      stmt.addRval(1, line.tokens.length - (has_colon ? 1 : 0));
      return stmt;
    };
  }
  else {
    return (line:TokenLine) => {
      const stmt = new Statement(line, name); 
      if(has_colon) stmt.checkIs(1, {ot:TokenType.Colon}, colon_err);
      stmt.checkSize(has_colon ? 2 : 1);
      return stmt;
    }; 
  }
}

function bldForStmt(line:TokenLine) : Statement {
  const stmt = new Statement(line, TokenType.For);
  stmt.addInnerDecl(1, "Expected iterator variable");
  stmt.checkIs(2, {v:"in"}, "Expected keyword in");
  stmt.addRval(3, line.tokens.length - 1);
  stmt.checkIs(line.tokens.length - 1, {ot:TokenType.Colon}, "Expected colon at the end of a for statement");
  return stmt;
}
function bldFuncStmt(line:TokenLine) : Statement {
  const stmt = new Statement(line, TokenType.Func);
  stmt.addOuterDecl(1, "Expected function name");
  stmt.checkIs(2, {ot:TokenType.OpenRound}, "Expected open paren");
  let cur_idx = 3;
  let last = "(";
  while(cur_idx < line.tokens.length){
    const focus = line.tokens[cur_idx];
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
function bldImportStmt(line:TokenLine) : Statement {
  const stmt = new Statement(line, TokenType.Import);
  const name = stmt.checkIs(1, {t:TokenType.String}, "Expected an import path string literal")
  if(line.tokens.length > 2){
    stmt.checkIs(2, {v:"as"}, "Expected keyword as");
    stmt.addOuterDecl(3, "Expected import alias");
    stmt.checkSize(4);
  }
  else if(name !== undefined){
    stmt.outer_declares.push(name);
  }
  return stmt;
}
function bldVarStmt(line:TokenLine) : Statement {
  const stmt = new Statement(line, TokenType.Var);
  stmt.addOuterDecl(1, "Expected variable name");
  stmt.checkIs(2, {ot:TokenType.Assign}, "Expected an assignment operator (=)")
  stmt.addRval(3, line.tokens.length);
  return stmt;
}
function bldExpression(line:TokenLine) : Statement {
  const stmt = new Statement(line, TokenType.Var);
  const assign_idx = line.tokens.findIndex(t=>t.group >= TokenType.Assign && t.group <= TokenType.Decrement);
  if(assign_idx >= 0){
    const lval_expr = stmt.addLval(assign_idx);
    if(lval_expr === undefined){
      line.tokens[0].issues.push("Unexpected or missing assignment target");
    }
    else if(!(lval_expr.ast instanceof NameNode || lval_expr.ast instanceof PropertyNode || lval_expr.ast instanceof IndexNode)){
      line.tokens[0].issues.push("Invalid assignment target");
    }
  }
  stmt.addRval(assign_idx+1, line.tokens.length)
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

class TokenLine {
  actual_line:number = 0;
  text:string;
  indent:number = 0;
  tokens:ParseToken[] = [];
  stmt:Maybe<Statement> = undefined;
  private cur_pos:number = 0;
  constructor(text:string){
    this.text = text;
    this.build();
  }
  build(){
    this.indent = /^ */.exec(this.text)![0].length;
    this.tokens = [];

    this._buildTokens();
    this._buildStmt();

    /*dm(`Parse: ${this.text}`);
    if(this.stmt !== undefined){
      dm(`Stmt: ${TokenNames[this.stmt.t]}`);
    }*/
  }
  private tryLint(re:RegExp) : Maybe<{pos:number,size:number,value:string}> {
    re.lastIndex = this.cur_pos;
    if( !re.test(this.text) ) return undefined;
    const end_pos = re.lastIndex;
    if(end_pos < this.cur_pos) return undefined;
    const result = {pos:this.cur_pos, size:end_pos-this.cur_pos, value:this.text.substring(this.cur_pos, end_pos)};
    this.cur_pos = end_pos;
    return result;
  }
  private _buildTokens() {
    this.cur_pos = 0;
    while(this.cur_pos < this.text.length){
      if(this.text[this.cur_pos] == " "){
        this.cur_pos += 1;
        continue;
      }
      if(this.text[this.cur_pos] == "#"){
        break;
      }

      let r:Maybe<{pos:number,size:number,value:string}> = undefined;
      if( (r = this.tryLint(LINT_OPER)) != undefined ){
        const group = TokenNames.indexOf(r.value);
        this.tokens.push(new ParseToken(r.pos, r.size, group, r.value));
      }
      else if( (r = this.tryLint(LINT_NUMBER)) ){
        this.tokens.push(new ParseToken(r.pos, r.size, TokenType.Number, r.value));
      }
      else if( (r = this.tryLint(LINT_STRING)) ){
        this.tokens.push(new ParseToken(r.pos, r.size, TokenType.String, r.value));
      }
      else if( (r = this.tryLint(LINT_NAME)) ){
        this.tokens.push(new ParseToken(r.pos, r.size, TokenType.Name, r.value));
      }
      else {
        break;
      }
    }
  }
  private _buildStmt() {
    this.stmt = undefined;
    if(this.tokens.length == 0) return;
    const builder = StmtFactory.get(this.tokens[0].group);
    if(builder !== undefined){
      this.stmt = builder(this);
      return;
    }
    this.stmt = bldExpression(this);
  }
  at(pos:number) : Maybe<ParseToken> {
    for(let idx=0;idx<this.tokens.length;idx++){
      const focus = this.tokens[idx];
      if(focus.pos > pos) break;
      if(focus.pos + focus.size >= pos) return focus;
    }
    return undefined;
  }
}

enum ScopeType {
  None,
  Flow,
  Func
};

class DeclTracker {
  scopes:string[][] = []
  decls:Map<string,ParseToken[]> = new Map<string,ParseToken[]>();
  enterScope(){
    this.scopes.push([]);
  }
  exitScope(){
    const left = this.scopes.pop()!;
    for(let idx=0;idx<left.length;idx++){
      this.decls.get(left[idx])!.pop();
    }
  }
  set(name:string, value:ParseToken){
    const old = this.decls.get(name);
    if(old !== undefined){
      old.push(value);
    }
    else{
      this.decls.set(name,[value]);
    }
    this.scopes[this.scopes.length-1].push(name);
  }
  get(name:string) : Maybe<ParseToken> {
    const old = this.decls.get(name);
    if(old !== undefined && old.length > 0){
      return old[0];
    }
    return undefined;
  }
}

class Scope {
  t:ScopeType;
  parent:Maybe<Scope>;
  children:(Scope|TokenLine)[] = [];
  indent:number;
  unknown_refs:NameNode[] = [];
  issues:{l:number, t:ParseToken, m:string}[] = [];
  
  constructor(t:ScopeType, indent:number, parent?:Scope){
    this.t = t;
    this.indent = indent;
    this.parent = parent;
    if(this.parent) this.parent.children.push(this);
  }
  finalize(tracker:DeclTracker){
    tracker.enterScope();
    for(let child_idx = 0; child_idx < this.children.length; child_idx++){
      const focus = this.children[child_idx];
      if(focus instanceof Scope) {
        if(focus.t == ScopeType.None){
          const bad_child = focus.children[0];
          if(!(bad_child instanceof Scope)){
            focus.issues.push({l:bad_child.actual_line, t:bad_child.tokens[0],m:"Unexpected indent"});
          }
        }
        continue;
      }

      const stmt = focus.stmt!;
      let expr_result:AnyInfo[] = [BDType.Anything];

      if(stmt.rval_expr){
        stmt.rval_expr.resolveRefs(tracker, focus.actual_line, this.issues);
        expr_result = stmt.rval_expr.eval()
        //dm(`VarType: ${BDTypeNames[typeof expr_result === "number" ? expr_result : expr_result.t]} ... ${focus.text}`)
      }
      if(stmt.lval_expr){
        stmt.lval_expr.resolveRefs(tracker, focus.actual_line, this.issues);
        stmt.lval_expr.evalRvalTarget(expr_result[0]);
        stmt.lval_expr.eval();
        //dm(`VarType: ${BDTypeNames[typeof expr_result === "number" ? expr_result : expr_result.t]} ... ${focus.text}`)
      }

      if(stmt.t == TokenType.Func && stmt.outer_declares.length > 0) {
        const func_name = stmt.outer_declares[0].content();
        const func_args:ArgInfo[] = [];
        stmt.inner_declares.forEach((arg)=>{
          func_args.push({name:arg.content(), wants:BDType.Anything});
        })
        expr_result = [{t:BDType.FuncRef, name:func_name, description:"", args:func_args, ret:BDType.Anything}];
      }
      stmt.outer_declares.forEach((decl)=>{
        decl.setInfos(expr_result);
        tracker.set(decl.content(), decl);
      });
      

      if(FlowStmts.includes(stmt.t) && stmt.t !== TokenType.Func && child_idx < this.children.length - 1){
        const flow_scope = this.children[child_idx+1];
        if(flow_scope instanceof Scope){
          child_idx += 1;
          if(stmt.inner_declares.length > 0){
            tracker.enterScope();
            stmt.inner_declares.forEach((decl)=>{
              tracker.set(decl.content(), decl);
            });
          }
          flow_scope.finalize(tracker);
          if(stmt.inner_declares.length > 0){
            tracker.exitScope();
          }
        }
      }
    }

    for(let child_idx = 0; child_idx < this.children.length-1; child_idx++){
      const focus = this.children[child_idx];
      if(focus instanceof Scope) continue;
      const stmt = focus.stmt!;
      if(stmt.t === TokenType.Func){
        const func_scope = this.children[child_idx + 1]
        if((func_scope instanceof Scope) && func_scope.t == ScopeType.Func){
          child_idx += 1;
          if(stmt.inner_declares.length > 0){
            tracker.enterScope();
            stmt.inner_declares.forEach((decl)=>{
              tracker.set(decl.content(), decl);
            });
          }
          func_scope.finalize(tracker);
          if(stmt.inner_declares.length > 0){
            tracker.exitScope();
          }
        }
      }
    }
    tracker.exitScope();
  }
  buildIssues(all_issues:vscode.Diagnostic[]){
    this.issues.forEach(my_issue =>{
      const r = my_issue.t.makeRange(my_issue.l);
      all_issues.push(new vscode.Diagnostic(r, my_issue.m));
    });
    for(let child_idx = 0; child_idx < this.children.length; child_idx++){
      const focus = this.children[child_idx];
      if(focus instanceof Scope) focus.buildIssues(all_issues);
    }
  }
};

const FlowStmts = [TokenType.If, TokenType.Elif, TokenType.Else, TokenType.For, TokenType.While];

export class Tokenizer {
  version:number;
  lines:TokenLine[];
  top_scope:Maybe<Scope> = undefined;
  constructor(doc:vscode.TextDocument){
    this.version = doc.version;
    const raw_lines = doc.getText().split(/\r\n|\r|\n/);
    this.lines = raw_lines.map(l=>new TokenLine(l));
    this.buildScopes();
  }
  buildScopes() {
    this.top_scope = new Scope(ScopeType.Flow, 0);
    let cur_scope = this.top_scope;
    let expected_scope:ScopeType = ScopeType.None;
    for(let idx = 0; idx < this.lines.length; idx++){
      const cur_line = this.lines[idx];
      cur_line.actual_line = idx;
      if(cur_line.stmt === undefined) continue;
      if(cur_line.indent > cur_scope.indent){
        cur_scope = new Scope(expected_scope, cur_line.indent, cur_scope);
        cur_scope.children.push(cur_line);
      }
      else {
        while(cur_line.indent < cur_scope.indent){
          cur_scope = cur_scope.parent!;
        }
        cur_scope.children.push(cur_line);
      }
      if(cur_line.stmt.t == TokenType.Func){
        expected_scope = ScopeType.Func
      }
      else if(FlowStmts.includes(cur_line.stmt.t)){
        expected_scope = ScopeType.Flow;
      }
      else {
        expected_scope = ScopeType.None;
      }
    }
    const tracker = new DeclTracker();
    this.top_scope.finalize(tracker);
  }
  modify(changes:readonly vscode.TextDocumentContentChangeEvent[]) {
    changes.forEach(delta=>{
      const start = delta.range.start;
      const end = delta.range.end;
      const line_count = (end.line - start.line) + 1;
      const raw_text = [
        this.lines[start.line].text.substring(0, start.character),
        delta.text,
        this.lines[end.line].text.substring(end.character)
      ].join("");

      const raw_lines = raw_text.split(/\r\n|\r|\n/);
      const new_lines = raw_lines.map(l=>new TokenLine(l));
      this.lines.splice(delta.range.start.line, line_count, ...new_lines);
    });
    this.buildScopes();
  }
  buildIssues(){
    let issues:vscode.Diagnostic[] = [];
    this.lines.forEach((line,idx)=>{
      line.tokens.forEach((token)=>{
        const r = token.makeRange(idx);
        token.issues.forEach((issue)=>{
          issues.push(new vscode.Diagnostic(r, issue));
        });
        token.temp_issues.forEach((issue)=>{
          issues.push(new vscode.Diagnostic(r, issue));
        });
      });
    });
    if(this.top_scope) this.top_scope.buildIssues(issues);
    return issues;
  }
};
