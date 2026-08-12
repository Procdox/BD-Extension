import * as vscode from 'vscode';
import { dm, Maybe } from './helpers';
import { AnyInfo, ArgInfo, BDType, TokenType, TokenNames, TypeInst} from "./enums";
import { ExprReader, IndexNode, NameNode, PropertyNode, } from './parse_expr';
import { BUILTINS } from './builtins';

const LINT_OPER = /((?:if|elif|else|return|for|while|break|continue|import|func|var|as|in|or|and|not|true|false|null)\b|<<|>>|[+\-<>!=]=?|[*\/%?^.~,&|:(){}\[\]])/gy;
const LINT_NAME = /([a-zA-Z_][a-zA-Z0-9_]*)/gy
const LINT_STRING = /('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*")/gy
const LINT_NUMBER = /([0-9]+(?:\.[0-9]+)?)/gy
const LINT_BAD = /\S+/gy

export class Token {
  private line_ctx:Tokenized;
  readonly group:TokenType;
  readonly value:string;
  readonly pos:number;
  readonly size:number;
  hover_info:Maybe<TypeInst> = undefined;
  decl_token:Maybe<Token> = undefined;
  issues:string[] = [] // token parsing issues internal to the line, that cannot be fixed by modifying other lines

  constructor(line_ctx:Tokenized, pos:number, size:number, group:TokenType, value:string){
    this.line_ctx = line_ctx;
    this.group = group;
    this.value = value;
    this.pos = pos;
    this.size = size;
  }
  content() {
    return (this.group !== TokenType.String) ? this.value : this.value.substring(1,this.size-1);
  }

  isType(t:TokenType|TokenType[]){ return (t instanceof Array) ? t.includes(this.group) : this.group === t; }
  errorIfNot(t:TokenType|TokenType[]){
    if(!this.isType(t)){
      const expected = (t instanceof Array) ? t.map(e=>TokenNames[e]).join(", ") : TokenNames[t];
      throw new Error(`Token Type Mismatch! Actual: ${TokenNames[this.group]}, Expected: ${expected}`)
    }
  }
  dbg(){ 
    return `${TokenNames[this.group]}:${this.value}`; 
  }
  makeRange(){
    const s = new vscode.Position(this.line_ctx.linenum, this.pos);
    const r = new vscode.Range(s, s.translate(0,this.size))
    return r;
  }
};

export interface Tokenized {
  linenum:number;
  text:string;
  indent:number;
  tokens:Token[];
};

interface LintResult {pos:number,size:number,value:string};


export function parseTokens(data:Tokenized, text:string)  {
  data.indent = /^ */.exec(text)![0].length;
  var cur_pos = 0;

  function tryLint(re:RegExp) : Maybe<LintResult> {
    re.lastIndex = cur_pos;
    if( !re.test(text) ) return undefined;
    const end_pos = re.lastIndex;
    if(end_pos < cur_pos) return undefined;
    const result = {pos:cur_pos, size:end_pos-cur_pos, value:text.substring(cur_pos, end_pos)};
    cur_pos = end_pos;
    return result;
  }

  while(cur_pos < text.length){
    if(text[cur_pos] == " "){
      cur_pos += 1;
      continue;
    }
    if(text[cur_pos] == "#"){
      break;
    }

    let r:Maybe<{pos:number,size:number,value:string}> = undefined;
    if( (r = tryLint(LINT_OPER)) != undefined ){
      const group = TokenNames.indexOf(r.value);
      data.tokens.push(new Token(data, r.pos, r.size, group, r.value));
    }
    else if( (r = tryLint(LINT_NUMBER)) ){
      data.tokens.push(new Token(data, r.pos, r.size, TokenType.Number, r.value));
    }
    else if( (r = tryLint(LINT_STRING)) ){
      data.tokens.push(new Token(data, r.pos, r.size, TokenType.String, r.value));
    }
    else if( (r = tryLint(LINT_NAME)) ){
      data.tokens.push(new Token(data, r.pos, r.size, TokenType.Name, r.value));
    }
    else {
      if( (r = tryLint(LINT_BAD)) ){
        data.tokens.push(new Token(data, r.pos, r.size, TokenType.Name, r.value));
      }
      break;
    }
  }
}
