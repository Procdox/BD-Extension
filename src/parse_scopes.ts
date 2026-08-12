import * as vscode from 'vscode';
import { dm, Maybe } from './helpers';
import { AnyInfo, ArgInfo, BDType, TokenNames, TokenType, TypeInst } from "./enums";
import { ExprIssue, ExprReader, IndexNode, NameNode, NodeTypeData, PropertyNode, } from './parse_expr';
import { BUILTINS } from './builtins';
import { Token, Tokenized } from './parse_tokens';
import { Statement } from './parse_stmt';

export interface LineData extends Tokenized {
  linenum:number;
  stmt:Maybe<Statement>;
};

export const FlowStmts = [TokenType.If, TokenType.Elif, TokenType.Else, TokenType.For, TokenType.While];
export enum ScopeType {
  None,
  Flow,
  Func
};

class DeclTracker {
  scopes:string[][] = []
  decls:Map<string,NameNode[]> = new Map<string,NameNode[]>();
  enterScope(){
    this.scopes.push([]);
  }
  exitScope(){
    const left = this.scopes.pop()!;
    for(let idx=0;idx<left.length;idx++){
      this.decls.get(left[idx])!.pop();
    }
  }
  set(name:string, value:NameNode){
    const old = this.decls.get(name);
    if(old !== undefined){
      old.push(value);
    }
    else{
      this.decls.set(name,[value]);
    }
    this.scopes[this.scopes.length-1].push(name);
  }
  get(name:string) : Maybe<NameNode> {
    const old = this.decls.get(name);
    if(old !== undefined && old.length > 0){
      return old[0];
    }
    return undefined;
  }
}

export class Scope {
  t:ScopeType;
  parent:Maybe<Scope>;
  children:(Scope|LineData)[] = [];
  indent:number;
  unknown_refs:NameNode[] = [];
  issues:{l:number, t:Token, m:string}[] = [];
  return_type:Maybe<TypeInst> = undefined;
  
  constructor(t:ScopeType, indent:number, parent?:Scope){
    this.t = t;
    this.indent = indent;
    this.parent = parent;
    if(this.parent) this.parent.children.push(this);
  }
  private solve(tracker:DeclTracker){
    tracker.enterScope();
    let last_stmt_type:TokenType = TokenType.Var;
    for(let child_idx = 0; child_idx < this.children.length; child_idx++){
      const focus = this.children[child_idx];
      if(focus instanceof Scope) {
        if(focus.t == ScopeType.None){
          const bad_child = focus.children[0];
          if(!(bad_child instanceof Scope)){
            focus.issues.push({l:bad_child.linenum, t:bad_child.tokens[0],m:"Unexpected indent"});
          }
        }
        continue;
      }

      const stmt = focus.stmt!;
      let expr_result:AnyInfo|TypeInst = {t:BDType.Unknown};

      if(stmt.rval_expr){
        stmt.rval_expr.resolveRefs(tracker, focus.linenum, this.issues);
        expr_result = stmt.rval_expr.eval()
        stmt.rval_expr.populateCallArgTypes();
        //dm(`VarType: ${BDTypeNames[typeof expr_result === "number" ? expr_result : expr_result.t]} ... ${focus.text}`)
      }
      if(stmt.lval_expr){
        stmt.lval_expr.resolveRefs(tracker, focus.linenum, this.issues);
        stmt.lval_expr.evalRvalTarget(expr_result);
        stmt.lval_expr.eval();
        //dm(`VarType: ${BDTypeNames[typeof expr_result === "number" ? expr_result : expr_result.t]} ... ${focus.text}`)
      }
      if(stmt.t == TokenType.For){
        let expr_list:Maybe<TypeInst>;
        if(expr_result instanceof TypeInst && (expr_list = expr_result.ease(BDType.List)) !== undefined){
          const elem = expr_list.elem()! 
          stmt.inner_declares.forEach((decl)=>decl.type_data.setSrc(elem));
        }
      }
      else if(stmt.t == TokenType.Elif || stmt.t == TokenType.Else){
        if(last_stmt_type != TokenType.If && last_stmt_type != TokenType.Elif){
          this.issues.push({l:focus.linenum, t:stmt.tokens[0], m:"Elif/Else statement must follow an If/Elif statment"})
        }
      }
      else if(stmt.t == TokenType.Return){
        if(this.return_type && expr_result instanceof TypeInst && !expr_result.isUnknown()){
          if(this.return_type.union(expr_result)){
            (this.return_type.ctx as NodeTypeData).markDirty(false,true);
          }
        }
      }
      else if(stmt.t == TokenType.Func){
        if(stmt.outer_declares.length > 0) {
          const func_name = stmt.outer_declares[0].token.content();
          const func_args:ArgInfo[] = [];
          stmt.inner_declares.forEach((arg)=>{
            arg.type_data.setSrc({t:BDType.Union,alts:[]})
            func_args.push({name:arg.token.content(), wants:BDType.Unknown, inst:arg.type_data.used});
          })
          expr_result = {t:BDType.FuncRef, name:func_name, description:"", args:func_args, ret:{t:BDType.Union, alts:[]}};
        }
      }
      stmt.outer_declares.forEach((decl)=>{
        decl.type_data.setSrc(expr_result);
        tracker.set(decl.token.content(), decl);
      });
      

      if(FlowStmts.includes(stmt.t) && stmt.t !== TokenType.Func && child_idx < this.children.length - 1){
        const flow_scope = this.children[child_idx+1];
        if(flow_scope instanceof Scope){
          child_idx += 1;
          if(stmt.inner_declares.length > 0){
            tracker.enterScope();
            stmt.inner_declares.forEach((decl)=>{
              tracker.set(decl.token.content(), decl);
            });
          }
          flow_scope.return_type = this.return_type;
          flow_scope.solve(tracker);
          if(stmt.inner_declares.length > 0){
            tracker.exitScope();
          }
        }
      }
      last_stmt_type = stmt.t;
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
              tracker.set(decl.token.content(), decl);
            });
          }
          func_scope.return_type = undefined;
          if(stmt.outer_declares.length > 0){
            func_scope.return_type = stmt.outer_declares[0].type_data.used.func()!.ret;
          }
          func_scope.solve(tracker);
          if(stmt.inner_declares.length > 0){
            tracker.exitScope();
          }
        }
      }
    }
    tracker.exitScope();
  }
  secondPass(){
    // doesn't resolve references, but lets updated / reassigned types resolve
    for(let child_idx = 0; child_idx < this.children.length; child_idx++){
      const focus = this.children[child_idx];
      if(focus instanceof Scope){
        focus.secondPass();
      }
      else if(focus.stmt){
        const stmt = focus.stmt;
        let expr_result:AnyInfo|TypeInst = {t:BDType.Unknown};
        if(stmt.rval_expr) {
          expr_result = stmt.rval_expr.eval();
        }
        if(stmt.lval_expr) {
          stmt.lval_expr.evalRvalTarget(expr_result);
          stmt.lval_expr.eval();
        }
        if(stmt.t == TokenType.Var){
          stmt.outer_declares.forEach((decl)=>{
            if(decl.type_data.isUnknown()){
              decl.type_data.setSrc(expr_result);
            }
          });
        }
        if(stmt.t == TokenType.Return){
          if(this.return_type && expr_result instanceof TypeInst && !expr_result.isUnknown()){
            if(this.return_type.union(expr_result)){
              (this.return_type.ctx as NodeTypeData).markDirty(false,true);
            }
          }
        }
      }
    }

  }
  doSolve(){
    const tracker = new DeclTracker();
    this.solve(tracker);
    this.secondPass()
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

export function buildLineIssues(line:LineData, issues:vscode.Diagnostic[]){
  let expr_issues:ExprIssue[] = [];
  line.tokens.forEach((token)=>{
    const r = token.makeRange(line.linenum);
    token.issues.forEach((issue)=>{
      issues.push(new vscode.Diagnostic(r, issue));
    });
  });
  if(line.stmt){
    if(line.stmt.rval_expr) line.stmt.rval_expr.ast.gatherIssues(expr_issues);
    if(line.stmt.lval_expr) line.stmt.lval_expr.ast.gatherIssues(expr_issues);
    for(let expr_issue of expr_issues){
      const s = new vscode.Position(line.linenum, expr_issue.start);
      const e = new vscode.Position(line.linenum, expr_issue.end);
      const r = new vscode.Range(s, e)
      issues.push(new vscode.Diagnostic(r, expr_issue.txt));
    }
  }
}