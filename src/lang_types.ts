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
  Anything,
};
export const BDTypeNames:string[] = ["Number", "Boolean", "String", "Object", "List", "FuncRef", "Null", "Anything"]

export type VarInfo = BDType.Number|BDType.Bool|BDType.String|BDType.Null|BDType.Anything;
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
  elem?:AnyInfo
}
export type PropInfos = Map<string,AnyInfo>;
export interface ObjInfo {
  t:BDType.Object;
  props:PropInfos;
  bi?:ObjInfo;
};
export type AnyInfo = VarInfo|ListInfo|FuncInfo|ObjInfo;

export class ParseToken {
  readonly group:TokenType;
  readonly value:string;
  readonly pos:number;
  readonly size:number;
  node:Maybe<ExprNode> = undefined;
  private _infos:AnyInfo[] = [BDType.Anything];
  private _ref:Maybe<ParseToken> = undefined;
  private _referencers:ParseToken[] = []
  private _prop_mods:boolean = false;
  issues:string[] = [] // issues internal to the line, that cannot be fixed by modifying other lines
  temp_issues:string[] = []; // issues determined during AST eval
  private _removeRef(other:ParseToken){
    const idx = this._referencers.indexOf(other);
    if(idx >= 0) this._referencers.splice(idx,1);
  }
  private _addRef(other:ParseToken){
    if(other == this) return;
    if(!this._referencers.includes(other)) this._referencers.push(other);
  }
  private _alertRefs(){
    this._referencers.forEach(r=>{
      if(r._infos !== this._infos){
        r._infos = this._infos;
        r._alertRefs();
      }
    });
    if(this.node !== undefined){
      this.node.markDirty();
    }
  }
  addProp(prop_name:string, prop_val:AnyInfo){
    const decl = this.getDecl();
    let changed = false;
    for(let idx = 0; idx < decl._infos.length; idx++){
      let info = decl._infos[idx];
      if(typeof info === "number" || info.t !== BDType.Object){
        continue;
      }
      if(info.props.get(prop_name) !== undefined) continue;
      if(info.bi === undefined) {
        info = {t:BDType.Object, props:new Map<string,AnyInfo>(info.props), bi:info};
      }
      info.props.set(prop_name, prop_val);
      decl._infos[idx] = info;
      changed = true;
      this._prop_mods = true;
    }
    if(changed){
      decl._alertRefs();
    }
  }
  private _clearRef(){
    const prop_modded = this._prop_mods;
    this._prop_mods = false;
    if(this._ref === undefined) return;
    
    const old = this._ref;
    this._ref = undefined;
    old._removeRef(this);
    
    if(!prop_modded) return;
    const decl = old.getDecl();
    let changed = false;
    for(let idx = 0; idx < decl._infos.length; idx++){
      let info = decl._infos[idx];
      if(typeof info === "number" || info.t !== BDType.Object){
        continue;
      }
      if(info.bi === undefined) continue;
      decl._infos[idx] = info.bi;
    }
    if(changed){
      decl._alertRefs();
    }
  }
  setRef(token:ParseToken){
    this._clearRef();
    this._ref = token;
    this._ref._addRef(this)
    this._infos = this._ref._infos;
    this._alertRefs();
  }
  setInfo(info:AnyInfo){
    if(this._ref === undefined && this._infos.length == 1 && info === this._infos[0] || (typeof this._infos[0] !== "number" && this._infos[0].t == BDType.Object && info === this._infos[0].bi) ) return;
    this._clearRef();
    this._infos = [info];
    this._alertRefs();
  }
  setInfos(infos:AnyInfo[]){
    if(infos.includes(BDType.Anything)){
      infos = [BDType.Anything];
    }
    if(this._ref === undefined && this._infos.length == infos.length){
      let diff = infos.some(ni => {
        return !this._infos.some(oi => ni === oi || (typeof oi !== "number" && oi.t == BDType.Object && oi.bi === ni))
      });
      if(!diff) return;
    }
    this._clearRef();
    this._infos = infos;
    this._alertRefs();
  }
  addInfo(info:AnyInfo){
    if(this._ref !== undefined){
      return this.setInfo(info);
    }
    if(this._infos.includes(BDType.Anything) || info === BDType.Anything) return;
    if(this._infos.some(old => info === old || (typeof old !== "number" && old.t == BDType.Object && old.bi === info)) ) return;
    this._infos.push(info);
    this._alertRefs();
  }
  getDecl(){
    let focus:ParseToken = this;
    while(focus._ref !== undefined){
      focus = focus._ref;
    }
    return focus;
  }
  getInfo(){
    return this._infos;
  }
  canBe(t:BDType){
    return this._infos.some(i=>(typeof i === "number") ? (i===t || i===BDType.Anything) : i.t === t);
  }
  teardown(){
    this._referencers.forEach(r=>r.setInfo(BDType.Anything));
    this._referencers = []
  }

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

export abstract class ExprNode {
  readonly token:ParseToken;
  parent:Maybe<ExprNode> = undefined;
  children:ExprNode[] = [];
  eval_dirty:boolean = true;
  addChild(child:ExprNode){
    child.parent = this;
    this.children.push(child);
  }
  constructor(token:ParseToken){ 
    this.token = token; 
  }
  dbg(depth:number){
    const pad = "  ".repeat(depth);
    dm(pad + this.token.dbg());
  }
  recDbg(depth:number) {
    this.dbg(depth);
    this.children.forEach(c=>c.recDbg(depth+1));
  }
  doEval(){
    if(!this.eval_dirty) return;
    this.token.temp_issues = [];
    this.eval_dirty = false;
    this.children.forEach(c=>c.doEval());
    this.eval();
  }
  markDirty(){
    let focus:Maybe<ExprNode> = this;
    while(focus != undefined && !focus.eval_dirty){
      focus.eval_dirty = true;
      focus = focus.parent;
    }
  }
  teardown(){
    this.token.teardown();
    this.children.forEach(c=>c.teardown());
  }
  abstract eval() : void;
  
};

export class ErrNode extends ExprNode {
  constructor(token:ParseToken){
    super(token);
  }
  eval() {
    this.token.temp_issues = [];
  }
  recDbg(depth:number){
    const pad = "  ".repeat(depth);
    dm(pad + "<MISSING>");
  }
};

export const NULL_TOKEN = new ParseToken(0,0,TokenType.Null,"");
export const NULL_NODE = new ErrNode(NULL_TOKEN);
