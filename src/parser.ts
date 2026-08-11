import * as vscode from 'vscode';
import { dm, Maybe } from './helpers';
import { AnyInfo, ArgInfo, BDType, ParseToken, TokenNames, TokenType } from "./lang_types";
import { ExprReader, IndexNode, NameNode, PropertyNode, } from './parse_expr';
import { BUILTINS } from './builtins';
import { parseStatement, Statement } from './parse_stmt';
import { parseTokens, Tokenized } from './parse_tokens';
import { FlowStmts, LineData, Scope, ScopeType } from './parse_scopes';

function parseLine(text:string) : LineData {
  const token_data = parseTokens(text);
  const stmt_data = parseStatement(token_data.tokens);
  return {...token_data, linenum:0, stmt:stmt_data};
}

export class Parser {
  version:number;
  lines:LineData[];
  top_scope:Maybe<Scope> = undefined;
  constructor(doc:vscode.TextDocument){
    this.version = doc.version;
    const raw_lines = doc.getText().split(/\r\n|\r|\n/);
    this.lines = raw_lines.map((line_text)=>parseLine(line_text));
    this.rebuildScopes();
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
      const new_lines = raw_lines.map((line_text)=>parseLine(line_text));
      this.lines.splice(delta.range.start.line, line_count, ...new_lines);
    });
    this.rebuildScopes();
  }
  rebuildScopes() {
    this.top_scope = new Scope(ScopeType.Flow, 0);
    let cur_scope = this.top_scope;
    let expected_scope:ScopeType = ScopeType.None;
    for(let idx = 0; idx < this.lines.length; idx++){
      const cur_line = this.lines[idx];
      cur_line.linenum = idx;
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
    this.top_scope.doSolve();
  }
  rebuildIssues(){
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
  getToken(line:number, char:number) : Maybe<ParseToken> {
    const line_data = this.lines[line];
    for(let idx=0;idx<line_data.tokens.length;idx++){
      const focus = line_data.tokens[idx];
      if(focus.pos > char) break;
      if(focus.pos + focus.size >= char) return focus;
    }
    return undefined;
  }
};
