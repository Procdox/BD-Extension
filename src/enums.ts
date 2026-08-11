import * as vscode from 'vscode';
import { dm, Maybe } from "./helpers";

export enum TokenType {
  // values
  Name = 0, String, Number, True, False, Null,
  // keywords
  If, Elif, Else, Return, For, While, Break, Continue, Import, Func, Var, As, In, Not,
  // punctuation
  Invert, Dot, Tern, Colon, Comma, Comment, 
  // groups
  OpenRound, CloseRound, OpenSquare, CloseSquare, OpenCurly, CloseCurly,
  // assignment
  Assign, Increment, Decrement, 
  // binary ops (in presedence order)
  Mult, Divide, Mod, Add, Sub, BitOr, BitAnd, BitXor, LShift, RShift,
  LT, LTE, GT, GTE, Equal, NotEqual, And, Or, 
};

export const TokenNames:string[] = [
  // values
  "name", "string", "number", "true", "false", "null",
  // keywords
  "if", "elif", "else", "return", "for", "while", "break", "continue", "import", "func", "var", "as", "in", "not",
  // punctuation
  "~", ".", "?", ":", ",", "#", 
  // groups
  "(", ")", "[", "]", "{", "}", 
    // assignment
  "=", "+=", "-=",
  // binary ops (in presedence order)
  "*", "/", "%", "+", "-", "|", "&", "^", "<<", ">>",  
  "<", "<=", ">", ">=", "==", "!=", "and", "or", 
];

export enum BDType {
  Number = 0,
  Bool,
  String,
  Object,
  List,
  FuncRef,
  Null,
  Unknown,
};
export const BDTypeNames:string[] = ["Number", "Boolean", "String", "Object", "List", "FuncRef", "Null", "Unknown"]

export type VarInfo = BDType.Number|BDType.Bool|BDType.String|BDType.Null|BDType.Unknown;
export interface ArgInfo {
  name:string,
  wants:BDType|BDType[],
  description?:string,
  opt?:boolean
};
export interface FuncInfo {
  t:BDType.FuncRef,
  name:string;
  description:string;
  args:ArgInfo[];
  ret:AnyInfo;
};
export interface ListInfo {
  t:BDType.List,
  elem:AnyInfo
}
export type PropInfos = Map<string,AnyInfo>;
export interface ObjInfo {
  t:BDType.Object;
  props:PropInfos;
  bi?:ObjInfo;
};
export type AnyInfo = VarInfo|ListInfo|FuncInfo|ObjInfo;


