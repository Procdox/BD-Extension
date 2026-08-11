import * as vscode from 'vscode';
import { dm, Maybe } from './helpers';
import { ArgInfo, BDType, BDTypeNames, FuncInfo, ListInfo, ObjInfo, TokenType } from './enums';
import { Parser } from './parser';

const SELECTOR:vscode.DocumentSelector = { language: "bdscript", scheme: 'file' };

class DocumentContext {
  focus:Maybe<vscode.Uri> = undefined;
  issues = vscode.languages.createDiagnosticCollection('bd_issues');
  parsers:Map<string, Parser>;
  constructor(){
    this.parsers = new Map<string, Parser>;
  }
  create(doc:vscode.TextDocument) : Maybe<Parser> {
    const uri_str = doc.uri.toString();
    try {
      dm(`Starting Create: ${uri_str}`);
      const parser = new Parser(doc);
      dm(`Finished Create: ${uri_str}`);
      this.parsers.set(uri_str, parser);
      return parser;
    } 
    catch (error) {
      dm(`Error Creating: ${uri_str}`);
      if(error instanceof Error) {
        dm(error.stack ?? "<no stack>");
        dm(error.name);
        dm(error.message);
      }
      else {
        dm("???");
      }
      this.parsers.delete(uri_str);
      return undefined;
    }
  }
  get(doc:vscode.TextDocument) : Maybe<Parser> {
    return this.parsers.get(doc.uri.toString());
  }
  setActive(doc:vscode.TextDocument){
    if(vscode.languages.match(SELECTOR, doc) <= 0) return;
    dm(`setActive: ${doc.uri.toString()} ${doc.uri.scheme}`);

    let parser:Maybe<Parser> = this.get(doc);
    let stale:boolean = (this.focus != doc.uri);
    this.focus = doc.uri;
    if(parser === undefined || parser.version != doc.version){
      dm("... parsing");
      parser = this.create(doc);
      if(parser === undefined) return;
      stale = true;
    }
    if(stale){
      dm("... posting issues");
      this.issues.clear();
      this.issues.set(doc.uri, parser.rebuildIssues());
    }
  }
  changed(change_event:vscode.TextDocumentChangeEvent){
    const doc = change_event.document;
    if(vscode.languages.match(SELECTOR, doc) <= 0) return;
    let parser:Maybe<Parser> = this.get(doc);
    if(parser === undefined){
      parser = this.create(doc);
      if(parser === undefined) return;
    }
    else {
      try {
        parser.modify(change_event.contentChanges);
      }
      catch (error) {
        const uri_str = doc.uri.toString();
        dm(`Error Modifying: ${uri_str}`);
        if(error instanceof Error) {
          dm(error.stack ?? "<no stack>");
          dm(error.name);
          dm(error.message);
        }
        else {
          dm("???");
        }
        this.parsers.delete(uri_str);
        return;
      }
    }
    if(this.focus == doc.uri){
      dm("... posting issues");
      this.issues.clear();
      this.issues.set(doc.uri, parser.rebuildIssues());
    }
  }
};

function fmtObjectInfo(info:ObjInfo){
  var content:string[] = [];
  info.props.forEach((info,name) => {
    content.push(`\n- ${name}: ${BDTypeNames[typeof info === "number" ? info : info.t]}`);
  });
  return content.join("\n");
}
function fmtFuncInfo(info:FuncInfo){
  function fmtArg(arg:ArgInfo){
    const type_str = (arg.wants instanceof Array) ? arg.wants.map(api_t=>BDTypeNames[api_t]).join("/") : BDTypeNames[arg.wants];
    const body = arg.wants == BDType.Unknown ? arg.name : `${arg.name}:${type_str}`;
    return arg.opt === true ? `[${body}]` : body;
  }
  var arg_names = info.args.map(fmtArg).join(", ");
  var content = `### ${info.name}(${arg_names})\n${info.description}`;
  info.args.forEach(arg => {
    if (arg.description !== undefined) {
      content += `\n- ${arg.name}: ${arg.description}`;
    }
  });
  return content;
}
function fmtListInfo(info:ListInfo){
  var content = `### List`;
  if(info.elem !== BDType.Unknown){
    content += `[${BDTypeNames[typeof info.elem === "number" ? info.elem : info.elem.t]}]`
  }
  if(typeof info.elem !== "number" && info.elem.t === BDType.Object){
    content += "\n" + fmtObjectInfo(info.elem);
  }
  return content
}

class ProvBD_Hover implements vscode.HoverProvider {
  ctx:DocumentContext;
  constructor(ctx:DocumentContext){
    this.ctx = ctx;
  }
  provideHover(doc:vscode.TextDocument, pos:vscode.Position, cancel:vscode.CancellationToken) : vscode.ProviderResult<vscode.Hover>{
    const tokenizer = this.ctx.get(doc);
    if(tokenizer === undefined) return undefined;
    const token = tokenizer.getToken(pos.line,pos.character);
    if(token === undefined || token.group !== TokenType.Name) return undefined;
    let content:string[] = []
    const token_info = token.hover_info;
    if(typeof token_info !== "number"){
      if(token_info.t == BDType.Object){
        content.push("### Object\n"+fmtObjectInfo(token_info));
      }
      else if(token_info.t == BDType.FuncRef){
        content.push(fmtFuncInfo(token_info));
      }
      else{
        content.push(fmtListInfo(token_info));
      }
    }
    else{
      content.push(`### ${BDTypeNames[token_info]}`);
    }
    return new vscode.Hover(new vscode.MarkdownString(content.join("\n")))
  }
};

export function activate(vsc_ctx:vscode.ExtensionContext) {
  dm("Extension Activated");
  const doc_ctx = new DocumentContext();
  const hover_provider = new ProvBD_Hover(doc_ctx);

  if (vscode.window.activeTextEditor) {
    doc_ctx.setActive(vscode.window.activeTextEditor.document);
	}

  vsc_ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor:Maybe<vscode.TextEditor>) => {
		if(editor === undefined) return;
    doc_ctx.setActive(editor.document);
	}));

  vsc_ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument((change_event:vscode.TextDocumentChangeEvent)=>{
    if(vscode.languages.match(SELECTOR, change_event.document) == 0) return;
    doc_ctx.changed(change_event);
  }));
  vsc_ctx.subscriptions.push(vscode.languages.registerHoverProvider(SELECTOR, hover_provider));

}