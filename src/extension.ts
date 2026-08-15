import * as vscode from 'vscode';
import { dm, Maybe } from './helpers';
import { ArgInfo, BDType, BDTypeNames, FuncInfo, ListInfo, ObjInfo, TokenType, TypeInst, UnionInfo } from './enums';
import { Parser } from './parser';
import { NodeTypeData } from './parse_expr';

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
    this.setActive(change_event.document);
    /*const doc = change_event.document;
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
    }*/
  }
};

function fmtObjectDetails(info:TypeInst){
  let content:string[] = [];
  info.props()!.forEach((info,name) => {
    content.push(`\n- ${name}: ${BDTypeNames[info.getT()]}`);
  });
  return content.join("\n");
}
function fmtFuncInfo(info:TypeInst){
  const fn = info.func()!;
  function fmtArg(arg:ArgInfo){
    const type_str = (arg.wants instanceof Array) ? arg.wants.map(api_t=>BDTypeNames[api_t]).join("/") : BDTypeNames[arg.wants];
    const body = arg.wants == BDType.Unknown ? arg.name : `${arg.name}:${type_str}`;
    return arg.opt === true ? `[${body}]` : body;
  }
  let arg_names = fn.args.map(fmtArg).join(", ");
  let content = `### ${fn.name}(${arg_names}) : ${BDTypeNames[fn.ret.getT()]}\n${fn.description}`;
  fn.args.forEach(arg => {
    if (arg.description !== undefined) {
      content += `\n- ${arg.name}: ${arg.description}`;
    }
  });
  return content;
}
function fmtListInfo(info:TypeInst){
  const elem = info.elem()!;
  let content:string = "";
  if(elem.getT() === BDType.Union){
    content += `[${fmtUnionInfo(elem)}]`;
  }
  else if(elem.getT() === BDType.Object){
    content += "[Object]\n" + fmtObjectDetails(elem);
  }
  else if(elem.getT() !== BDType.Unknown){
    content += `[${BDTypeNames[elem.getT()]}]`;
  }
  return content
}
function fmtUnionInfo(info:TypeInst){
  return "Union["+info.alts()!.map(alt=>BDTypeNames[alt.getT()]).join(", ")+"]"
}

function buildTypeName(info:TypeInst, depth:number, initial:boolean=false) : string {
  const f = info.flattenUnion();
  const t = f.getT();
  if(depth > 0) {
    if(t === BDType.Union){
      if(f.alts()!.length == 0) return "(/)";
      return ""+f.alts()!.map(alt=>buildTypeName(alt, depth-1)).join("/")
    }
    else if(t === BDType.FuncRef){
      var content = "(" + f.func()!.args.map(arg=>arg.name).join(", ") + ") -> " + buildTypeName(f.func()!.ret, depth-1);
      if(initial){
        content = `### ${f.func()!.name}${content}\n${f.func()!.description}`
      }
      return content
    }
    else if(t === BDType.List){
      const e = f.elem()!.flattenUnion();
      if(e.getT() == BDType.Union){
        return "["+e.alts()!.map(alt=>buildTypeName(alt, depth-1)).join("/")+"]"
      }
      else{
        return "["+buildTypeName(e, depth-1)+"]"
      }
    }
    else if(t === BDType.Object){
      return "{"+Array.from(f.props()!.entries(), ([key,val])=>key+":"+buildTypeName(val,depth-1)).join(", ")+"}"
    }
  }
  return BDTypeNames[t];
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
    if(token === undefined) return undefined;
    if(token.group !== TokenType.Name && token.group !== TokenType.Dot) return undefined;
    
    const token_info = token.hover_info;
    if(token_info === undefined) return undefined;
    let content:string[] = [];
    const t = token_info.getT();
    return new vscode.Hover(buildTypeName(token_info,3,true));
    /*if(t == BDType.Object){
      content.push("### Object\n"+fmtObjectDetails(token_info));
    }
    else if(t == BDType.FuncRef){
      content.push(fmtFuncInfo(token_info));
    }
    else if(t == BDType.List){
      content.push("### List"+fmtListInfo(token_info));
    }
    else if(t == BDType.Union){
      content.push("### "+fmtUnionInfo(token_info));
    }
    else {
      content.push(`### ${BDTypeNames[t]}`);
    }
    return new vscode.Hover(new vscode.MarkdownString(content.join("\n")))*/
  }
};

class ProvBD_Define implements vscode.DefinitionProvider {
  ctx:DocumentContext;
  constructor(ctx:DocumentContext){
    this.ctx = ctx;
  }
  provideDefinition(doc:vscode.TextDocument, pos:vscode.Position, cancel:vscode.CancellationToken) : vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]>{
    const tokenizer = this.ctx.get(doc);
    if(tokenizer === undefined) return undefined;
    const token = tokenizer.getToken(pos.line,pos.character);
    if(token === undefined) return undefined;
    const linked = token.decl_token;
    if(linked === undefined) return undefined;
    return new vscode.Location(doc.uri, linked.makeRange());
  }
};

export function activate(vsc_ctx:vscode.ExtensionContext) {
  dm("Extension Activated");
  const doc_ctx = new DocumentContext();
  const hover_provider = new ProvBD_Hover(doc_ctx);
  const define_provider = new ProvBD_Define(doc_ctx);

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

  vsc_ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(SELECTOR, define_provider));

}