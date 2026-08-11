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
  Union, // Type Deduction Helper 
  Unknown, // Type Deduction Helper
};
export const BDTypeNames:string[] = ["Number", "Boolean", "String", "Object", "List", "FuncRef", "Null", "Union", "Unknown"]

export interface ArgInfo {
  name:string,
  wants:BDType|BDType[],
  description?:string,
  opt?:boolean;
};
export type VarInfo = {
  t:BDType.Number|BDType.Bool|BDType.String|BDType.Null|BDType.Unknown;
};
export interface FuncInfo {
  t:BDType.FuncRef,
  name:string;
  description:string;
  args:ArgInfo[];
  ret:AnyInfo|TypeInst;
};
export interface ListInfo {
  t:BDType.List,
  elem:AnyInfo|TypeInst;
}
export type PropInfos = Map<string,AnyInfo|TypeInst>;
export interface ObjInfo {
  t:BDType.Object;
  props:PropInfos;
};
export interface UnionInfo {
  t:BDType.Union;
  alts:(AnyInfo|TypeInst)[];
};
export type AnyInfo = VarInfo|ListInfo|FuncInfo|ObjInfo|UnionInfo;

interface FuncInstDat {
  name:string;
  description:string;
  args:ArgInfo[];
  ret:TypeInst
}
export class TypeInst {
  readonly ctx:TypeData;
  private t:BDType;
  private data:Map<string,TypeInst>|TypeInst|FuncInstDat|TypeInst[]|undefined;
  constructor(ctx:TypeData, src:AnyInfo|TypeInst, force_clone:boolean){
    this.ctx = ctx;
    if(src instanceof TypeInst){
      this.t = src.t;
      if(src.t == BDType.Object){
        if(force_clone){
          const props = new Map<string,TypeInst>();
          (src.data as Map<string,TypeInst>).forEach((val,key)=>{
            props.set(key, new TypeInst(ctx, val, force_clone));
          });
          this.data = props;
        }
        else{
          this.data = new Map<string,TypeInst>((src.data as Map<string,TypeInst>));
        }
      }
      else if(src.t == BDType.List){
        this.data = force_clone ? new TypeInst(ctx, (src.data as TypeInst), force_clone) : (src.data as TypeInst);
      }
      else if(src.t == BDType.FuncRef){
        const src_fn = (src.data as FuncInstDat)
        const my_fn:FuncInstDat = {...src_fn};
        if(force_clone){
          my_fn.ret = new TypeInst(ctx, src_fn.ret, force_clone);
        }
        this.data = my_fn;
      }
      else if(src.t == BDType.Union){
        if(force_clone){
          this.data = (src.data as TypeInst[]).map((alt)=>{
            return new TypeInst(ctx, alt, force_clone);
          });
        }
        else {
          this.data = (src.data as TypeInst[]).map((alt)=>alt);
        }
      }
    }
    else {
      const src_info = src; // why is this needed
      this.t = src.t;
      if(src_info.t == BDType.Object){
        const props = new Map<string,TypeInst>();
        src_info.props.forEach((val,key)=>{
          props.set(key, (force_clone || !(val instanceof TypeInst)) ? new TypeInst(ctx, val, force_clone) : val);
        });
        this.data = props;
      }
      else if(src_info.t == BDType.List){
        this.data = (force_clone || !(src_info.elem instanceof TypeInst)) ? new TypeInst(ctx, src_info.elem, force_clone) : src_info.elem;
      }
      else if(src_info.t == BDType.FuncRef){
        const ret_val = (force_clone || !(src_info.ret instanceof TypeInst)) ? new TypeInst(ctx, src_info.ret, force_clone) : src_info.ret;
        const my_fn:FuncInstDat = {...src_info, ret:ret_val}
        this.data = my_fn;
      }
      else if(src_info.t == BDType.Union){
        this.data = src_info.alts.map((alt)=>{
          return (force_clone || !(alt instanceof TypeInst)) ? new TypeInst(ctx, alt, force_clone) : alt;
        });
      }
    }
  }
  flattenUnion(try_for?:BDType) : TypeInst {
    if(this.t == BDType.Union){
      const alts = (this.data as TypeInst[]);
      if(alts.length == 1) {
        return alts[0].flattenUnion(try_for);
      }
      else if(alts.length > 0 && try_for !== undefined){
        let matches = alts.map(alt => alt.flattenUnion(try_for)).filter(alt=>alt.t == try_for);
        if(matches.length == 1) return matches[0];
      }
    }
    return this;
  }
  ease(t:BDType){
    const f = this.flattenUnion(t);
    if(f.t == t) return f;
  }
  isUnknown(){
    const f = this.flattenUnion(BDType.Unknown);
    return f.t === BDType.Unknown || (f.t === BDType.Union && (f.data as TypeInst[]).length == 0);
  }
  getT() { 
    return this.flattenUnion().t;
  }
  props() {
    return this.t === BDType.Object ? (this.data as Map<string,TypeInst>) : undefined;
  }
  elem() {
    return this.t === BDType.List ? (this.data as TypeInst) : undefined;
  }
  func() {
    return this.t === BDType.FuncRef ? (this.data as FuncInstDat) : undefined;
  }
  alts() {
    return this.t === BDType.Union ? (this.data as TypeInst[]) : undefined;
  }
  private cmpInst(other:TypeInst) : boolean {
    if(this === other) return true;
    else if(this.t !== other.t) return false;
    else if(this.t == BDType.Object){
      const t_props = (this.data as Map<string,TypeInst>);
      const o_props = (other.data as Map<string,TypeInst>);
      if(t_props.size != o_props.size) return false;
      for(let [key, t_val] of t_props){
        const o_val = t_props.get(key);
        if(o_val === undefined || !t_val.cmpInst(o_val)) return false;
      }
      return true;
    }
    else if(this.t == BDType.List){
      return (this.data as TypeInst).cmpInst((other.data as TypeInst));
    }
    else if(this.t == BDType.FuncRef){
      return (this.data as FuncInstDat).ret.cmpInst((other.data as FuncInstDat).ret);
    }
    else if(this.t == BDType.Union){
      const t_alts = (this.data as TypeInst[]);
      const o_alts = (other.data as TypeInst[]);
      if(t_alts.length != o_alts.length) return false;
      for(let t_alt of t_alts){
        if(!o_alts.some((o_alt)=>t_alt.cmpInst(o_alt))) return false;
      }
      return true;
    }
    return true;
  }
  private cmpInfo(other:AnyInfo) : boolean {
    if(this.t !== other.t) return false;
    else if(this.t == BDType.Object){
      const t_props = (this.data as Map<string,TypeInst>);
      const o_props = (other as ObjInfo).props;
      if(t_props.size != o_props.size) return false;
      for(let [key, t_val] of t_props){
        const o_val = t_props.get(key);
        if(o_val === undefined || !t_val.cmp(o_val)) return false;
      }
      return true;
    }
    else if(this.t == BDType.List){
      return (this.data as TypeInst).cmp((other as ListInfo).elem);
    }
    else if(this.t == BDType.FuncRef){
      return (this.data as FuncInstDat).ret.cmp((other as FuncInfo).ret);
    }
    else if(this.t == BDType.Union){
      const t_alts = (this.data as TypeInst[]);
      const o_alts = (other as UnionInfo).alts;
      if(t_alts.length != o_alts.length) return false;
      for(let t_alt of t_alts){
        if(!o_alts.some((o_alt)=>t_alt.cmp(o_alt))) return false;
      }
      return true;
    }
    return true;
  }
  cmp(other:AnyInfo|TypeInst){
    return (other instanceof TypeInst) ? this.cmpInst(other) : this.cmpInfo(other);
  }
  private unionInst(other:TypeInst) : boolean {
    if(this.t === BDType.Unknown) {
      return false;
    }
    if(other.t === BDType.Unknown){
      this.t = BDType.Unknown;
      this.data = undefined;
      return true;
    }
    if(this.cmpInst(other)) return false;

    let altered = false;
    if(this.t !== BDType.Union){
      const clone = new TypeInst(this.ctx, {t:BDType.Unknown}, false);
      clone.t = this.t;
      clone.data = this.data;
      this.t = BDType.Union;
      this.data = [clone];
      altered = true;
    }

    const t_alts = (this.data as TypeInst[]);
    if( other.t === BDType.Union) {
      const old_length = t_alts.length;
      (other.data as TypeInst[]).forEach((o_alt)=>this.unionInst(o_alt));
      altered = altered || (old_length != t_alts.length);
    }
    else if(!t_alts.some((t_alt)=>t_alt.cmpInst(other))){
      t_alts.push(other);
      altered = true;
    }
    return altered;
  }
  private unionInfo(other:AnyInfo) : boolean {
    if(this.t === BDType.Unknown) {
      return false;
    }
    if(other.t === BDType.Unknown){
      this.t = BDType.Unknown;
      this.data = undefined;
      return true;
    }
    if(this.cmpInfo(other)) return false;

    let altered = false;
    if(this.t !== BDType.Union){
      const clone = new TypeInst(this.ctx, {t:BDType.Unknown}, false);
      clone.t = this.t;
      clone.data = this.data;
      this.t = BDType.Union;
      this.data = [clone];
      altered = true;
    }

    const t_alts = (this.data as TypeInst[]);
    if( other.t === BDType.Union) {
      const old_length = t_alts.length;
      other.alts.forEach((o_alt)=>this.union(o_alt));
      altered = altered || (old_length != t_alts.length);
    }
    else if(!t_alts.some((t_alt)=>t_alt.cmpInfo(other))){
      t_alts.push(new TypeInst(this.ctx,other, false));
      altered = true;
    }
    return altered;
  }
  union(other:TypeInst|AnyInfo) : boolean {
    return (other instanceof TypeInst) ? this.unionInst(other) : this.unionInfo(other);
  }
  addProp(prop_name:string, prop_expr:TypeInst|AnyInfo){
    const props = this.props();
    if(props === undefined) return false;
    if(props.get(prop_name)) return false;
    if(!(prop_expr instanceof TypeInst)){
      prop_expr = new TypeInst(this.ctx, prop_expr, false);
    }
    props.set(prop_name, prop_expr);
    return true;
  }
};

export class TypeData {
  protected src:AnyInfo|TypeInst; // the original declaration type, used to restore when a modder leaves
  used:TypeInst;
  constructor(){
    this.src = {t:BDType.Unknown};
    this.used = new TypeInst(this, this.src, false);
  }
  ease(t:BDType){ return this.used.ease(t); }
  isUnknown(){ return this.used.isUnknown(); }
};
