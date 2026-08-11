import * as vscode from 'vscode';
import { dm, Maybe } from './helpers';
import { AnyInfo, ArgInfo, BDType, TokenNames, TokenType, TypeInst } from "./enums";
import { ExprReader, IndexNode, NameNode, PropertyNode, } from './parse_expr';
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
  
  constructor(t:ScopeType, indent:number, parent?:Scope){
    this.t = t;
    this.indent = indent;
    this.parent = parent;
    if(this.parent) this.parent.children.push(this);
  }
  private solve(tracker:DeclTracker){
    tracker.enterScope();
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
        //dm(`VarType: ${BDTypeNames[typeof expr_result === "number" ? expr_result : expr_result.t]} ... ${focus.text}`)
      }
      if(stmt.lval_expr){
        stmt.lval_expr.resolveRefs(tracker, focus.linenum, this.issues);
        stmt.lval_expr.evalRvalTarget(expr_result);
        stmt.lval_expr.eval();
        //dm(`VarType: ${BDTypeNames[typeof expr_result === "number" ? expr_result : expr_result.t]} ... ${focus.text}`)
      }
      if(stmt.t == TokenType.For){
        if(expr_result instanceof TypeInst && expr_result.getT() == BDType.List){
          const elem = expr_result.elem()! 
          stmt.inner_declares.forEach((decl)=>decl.type_data.setSrc(elem));
        }
      }
      else if(stmt.t == TokenType.Func){
        if(stmt.outer_declares.length > 0) {
          const func_name = stmt.outer_declares[0].token.content();
          const func_args:ArgInfo[] = [];
          stmt.inner_declares.forEach((arg)=>{
            func_args.push({name:arg.token.content(), wants:BDType.Unknown});
          })
          expr_result = {t:BDType.FuncRef, name:func_name, description:"", args:func_args, ret:{t:BDType.Unknown}};
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
          flow_scope.solve(tracker);
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
              tracker.set(decl.token.content(), decl);
            });
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
  doSolve(){
    const tracker = new DeclTracker();
    this.solve(tracker);
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
