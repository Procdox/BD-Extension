import * as vscode from 'vscode';
import { dm, Maybe } from './helpers';
import { AnyInfo, ArgInfo, BDType, ParseToken, TokenNames, TokenType } from "./lang_types";
import { ExprReader, IndexNode, NameNode, PropertyNode, } from './parse_expr';
import { BUILTINS } from './builtins';

const LINT_OPER = /((?:if|elif|else|return|for|while|break|continue|import|func|var|as|in|or|and|not|true|false|null)\b|<<|>>|[+\-<>!=]=?|[*\/%?^.~,&|:(){}\[\]])/gy;
const LINT_NAME = /([a-zA-Z_][a-zA-Z0-9_]*)/gy
const LINT_STRING = /('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*")/gy
const LINT_NUMBER = /([0-9]+(?:\.[0-9]+)?)/gy

export interface Tokenized {
  text:string;
  indent:number;
  tokens:ParseToken[];
};

interface LintResult {pos:number,size:number,value:string};


export function parseTokens(text:string) : Tokenized {
  const indent = /^ */.exec(text)![0].length;
  const tokens:ParseToken[] = [];
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
      tokens.push(new ParseToken(r.pos, r.size, group, r.value));
    }
    else if( (r = tryLint(LINT_NUMBER)) ){
      tokens.push(new ParseToken(r.pos, r.size, TokenType.Number, r.value));
    }
    else if( (r = tryLint(LINT_STRING)) ){
      tokens.push(new ParseToken(r.pos, r.size, TokenType.String, r.value));
    }
    else if( (r = tryLint(LINT_NAME)) ){
      tokens.push(new ParseToken(r.pos, r.size, TokenType.Name, r.value));
    }
    else {
      break;
    }
  }
  return {text:text, indent:indent, tokens:tokens};
}
