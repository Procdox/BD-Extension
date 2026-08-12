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
  readonly group:TokenType;
  readonly value:string;
  readonly pos:number;
  readonly size:number;
  hover_info:Maybe<TypeInst> = undefined;
  issues:string[] = [] // token parsing issues internal to the line, that cannot be fixed by modifying other lines

  constructor(pos:number, size:number, group:TokenType, value:string){
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
  makeRange(line_idx:number){
    const s = new vscode.Position(line_idx, this.pos);
    const r = new vscode.Range(s, s.translate(0,this.size))
    return r;
  }
};

export interface Tokenized {
  text:string;
  indent:number;
  tokens:Token[];
};

interface LintResult {pos:number,size:number,value:string};


export function parseTokens(text:string) : Tokenized {
  const indent = /^ */.exec(text)![0].length;
  const tokens:Token[] = [];
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
      tokens.push(new Token(r.pos, r.size, group, r.value));
    }
    else if( (r = tryLint(LINT_NUMBER)) ){
      tokens.push(new Token(r.pos, r.size, TokenType.Number, r.value));
    }
    else if( (r = tryLint(LINT_STRING)) ){
      tokens.push(new Token(r.pos, r.size, TokenType.String, r.value));
    }
    else if( (r = tryLint(LINT_NAME)) ){
      tokens.push(new Token(r.pos, r.size, TokenType.Name, r.value));
    }
    else {
      if( (r = tryLint(LINT_BAD)) ){
        tokens.push(new Token(r.pos, r.size, TokenType.Name, r.value));
      }
      break;
    }
  }
  return {text:text, indent:indent, tokens:tokens};
}
