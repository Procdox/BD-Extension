import * as vscode from 'vscode';
import { dm, Maybe } from './helpers';
import { Token } from "./parse_tokens"
import { AnyInfo, ArgInfo, BDType, BDTypeNames, FuncInfo, ListInfo, ObjInfo, PropInfos, TokenType, TypeData, TypeInst, UnionInfo, VarInfo } from "./enums";
import { BUILTINS, DICT_PROPS, LIST_PROPS, STRING_PROPS } from './builtins';

export class TokenReader {
  tokens:Token[];
  pos:number;
  end:number;
  cur:Maybe<Token>;
  constructor(tokens:Token[], start:number, end:number){
    this.tokens = tokens;
    this.pos = start;
    this.end = end;
    if(this.pos >= this.end){
      throw new Error("Tried to read empty expression token sequence");
    }
    this.cur = this.tokens[this.pos];
  }
  isNext(t:TokenType|TokenType[]){
    return this.cur ? this.cur.isType(t) : false;
  }
  takeNext() : Token {
    const val = this.cur;
    if(val === undefined) throw new Error("Tried to take undefined token");
    this.pos += 1;
    this.cur = (this.pos < this.end) ? this.tokens[this.pos] : undefined;
    return val;
  }
  takeNextIf(t:TokenType|TokenType[]) : Maybe<Token> {
    if(this.isNext(t)) return this.takeNext();
    return undefined;
  }
  addError(msg:string){
    const best_pos = Math.min(this.pos, this.tokens.length-1);
    this.tokens[best_pos].issues.push(msg);
  }
  expectNext(t:TokenType|TokenType[], msg:string) : Maybe<Token> {
    if(this.isNext(t)) return this.takeNext();
    this.addError(msg);
    return undefined;
  }
};

export interface ExprIssue {
  start:number;
  end:number;
  txt:string;
}

export class ExprReader extends TokenReader {
  references:NameNode[] = [];
  ast:ExprNode;
  constructor(tokens:Token[], start:number, end:number){
    super(tokens, start, end);
    this.ast = this.parseExpression();
    if(this.pos < this.end){
      this.addError("Unexpected token after expression")
    }
  }
  parseList(result:ExprNode[], end_token:TokenType, end_err:string){
    while(!this.isNext(end_token)){
      result.push(this.parseExpression());
      if(!this.takeNextIf(TokenType.Comma)) break;
    }
    this.expectNext(end_token, end_err);
  }
  parseSubExpr() : ExprNode {
    this.takeNext();
    const node = this.parseExpression();
    this.expectNext(TokenType.CloseRound, "Expected a ) at the end of a sub-expression");
    return node;
  }
  parseLiteral() : ExprNode {
    // parse value
    if(this.isNext([TokenType.Name])){
      const name_node = new NameNode(this.takeNext());
      //dm("Ref: " + name_node.token.content())
      this.references.push(name_node)
      return name_node;
    }
    else if(this.isNext([TokenType.True, TokenType.False, TokenType.Null, TokenType.Number, TokenType.String])){
      return new RawNode(this.takeNext());
    }
    else if(this.isNext(TokenType.OpenCurly)){
      return new DictNode(this);
    }
    else if(this.isNext(TokenType.OpenRound)){
      return this.parseSubExpr();
    }
    else if(this.isNext(TokenType.OpenSquare)){
      return new ListNode(this);
    }
    this.addError("Unexpected token, expected value")
    return NULL_NODE;
  }
  parseValue() : ExprNode {
    let top:Maybe<ExprNode> = undefined;
    let prefix_node:Maybe<UnaryNode> = undefined;

    // parse unary prefixes
    while(true){
      if(this.isNext([TokenType.Not, TokenType.Sub, TokenType.Invert])){
        prefix_node = new UnaryNode(this.takeNext(), prefix_node);
        top ??= prefix_node;
      }
      else {
        break;
      }
    }

    let value_node = this.parseLiteral();

    while(true){
      if(this.isNext(TokenType.OpenRound)){
        value_node = new CallNode(value_node, this);
      }
      else if(this.isNext(TokenType.OpenSquare)){
        value_node = new IndexNode(value_node, this);
      }
      else if(this.isNext(TokenType.Dot)){
        value_node = new PropertyNode(value_node, this);
      }
      else {
        break;
      }
    }

    if( prefix_node ) {
      prefix_node.right = value_node;
      prefix_node.addChild(value_node);
    }
    top ??= value_node;
    return top;
  }
  parseExpression() : ExprNode {
    const stack:BinaryNode[] = []
    const initial_value_node = this.parseValue();

    if(this.cur && this.cur.group == TokenType.Tern){
      return new TernaryNode(initial_value_node, this);
    }
    else if(this.cur && this.cur.group >= TokenType.Mult && this.cur.group <= TokenType.Or){
      const bin_node =  new BinaryNode(this.takeNext());
      bin_node.left = initial_value_node;
      
      bin_node.right = this.parseValue();
      stack.push(bin_node);
    }
    else {
      return initial_value_node;
    }

    while(this.cur){
      if(this.isNext(TokenType.Tern)){
        return new TernaryNode(stack[0], this);
      }
      else if(this.cur.group >= TokenType.Mult && this.cur.group <= TokenType.Or){
        const bin_node = new BinaryNode(this.takeNext());
        bin_node.right = this.parseValue();
        while(true) {
          const other_node = stack[stack.length-1];
          if(other_node.token.group > bin_node.token.group){
            bin_node.left = other_node.right;
            other_node.right = bin_node;
            stack.push(bin_node);
            break;
          }
          if(stack.length == 1){
            bin_node.left = other_node;
            stack.pop();
            stack.push(bin_node);
            break;
          }
          stack.pop();
        }
      }
      else {
        break;
      }
    }
    stack[0].finalize();
    return stack[0];
  }
  resolveRefs(tracker:{get:(name:string)=> Maybe<ExprNode>}, issues:{t:Token, m:string}[]){
    for(let cur_ref of this.references){
      const ref_name = cur_ref.token.content();
      const decl = tracker.get(ref_name);
      if(decl === undefined) {
        const bi_info = BUILTINS.get(ref_name);
        if(bi_info !== undefined){
          cur_ref.type_data.setSrc(bi_info,false,true);
        }
        else {
          cur_ref.type_data.setSrc({t:BDType.Unknown},false,true);
          issues.push({t:cur_ref.token, m:"Reference to undeclared variable"});
        }
      }
      else {
        cur_ref.type_data.setRef(decl);
      }
    }
  }
  evalRvalTarget(expr_info:TypeInst|AnyInfo){
    let focus:ExprNode = this.ast;
    let prop_name:Maybe<string> = undefined;
    let src_node:Maybe<ExprNode> = undefined;
    if(focus instanceof PropertyNode){
      if(focus.property instanceof ErrNode) return;
      prop_name = focus.property.content();
      src_node = focus.src;
    }
    else if(focus instanceof IndexNode){
      if(focus.index instanceof RawNode){
        prop_name = focus.index.token.content();
        src_node = focus.src;
      }
    }
    else if(focus instanceof NameNode){
      src_node = focus;
    }
    if(src_node === undefined) return;

    if(prop_name !== undefined) {
      const src_dict = src_node.type_data.used.ease(BDType.Object);
      if(src_dict){
        if(src_dict.addProp(prop_name, expr_info)){
          src_node.type_data.modifies = true;
          (src_dict.ctx as NodeTypeData).markDirty(false,true);
        }
      }
    }
    else {
      if(expr_info instanceof TypeInst ? expr_info.isUnknown() : expr_info.t == BDType.Unknown ) return;
      if(src_node.type_data.used.union(expr_info)){
        src_node.type_data.modifies = true;
        (src_node.type_data.used.ctx as NodeTypeData).markDirty(false,true);
      }
    }
  }
  eval() : TypeInst {
    this.ast.doEval();
    return this.ast.type_data.used;
  }
  populateCallArgTypes(){
    for(let cur_ref of this.references){
      // is this a call statement?
      const call_node = cur_ref.parent;
      if(!(call_node instanceof CallNode)) continue;
      // is this a function reference (check via nref to ensure it has a symbol => is a user function)
      const decl = cur_ref.type_data.nref;
      if(decl === undefined) continue;
      const decl_fn = decl.type_data.ease(BDType.FuncRef);
      if(decl_fn === undefined) continue;
      const fn_info = decl_fn.func()!;

      dm(`Call to ${fn_info.name}`);
      for(let idx=0;idx<call_node.args.length;idx++){
        if(idx >= fn_info.args.length) break;
        const arg = call_node.args[idx];
        if(arg.type_data.isUnknown()) continue;
        const param = fn_info.args[idx];
        if(param.inst === undefined) continue;
        param.inst.union(arg.type_data.used)
        if(!(param.wants instanceof Array)){
          param.wants = (param.wants === BDType.Unknown) ? [] : [param.wants];
        }
        for(let arg_t of arg.type_data.used.getTypeOptions()){
          if(!param.wants.includes(arg_t)){
            dm(`Push type guess ${BDTypeNames[arg_t]} to arg ${param.name} of ${fn_info.name}`);
            param.wants.push(arg_t);
          }
        }
      }
    }
  }
  teardown() {
    this.ast.teardown();
  }
}

export class NodeTypeData extends TypeData {
  node:ExprNode;
  tokens:Token[];
  modifies:boolean = false;
  tref:Maybe<NodeTypeData> = undefined;
  nref:Maybe<ExprNode> = undefined;
  refers:NodeTypeData[] = [];
  constructor(node:ExprNode, token:Token){
    super();
    this.node = node;
    this.tokens = [token];
  }
  markDirty(self:boolean, refers:boolean){
    if(self) this.node.markDirty();
    if(refers) this.refers.forEach((r)=>{
      r.node.markDirty();
    });
  }
  clearEffects(){
    if(this.tref !== undefined){
      this.tref.refers.splice(this.tref.refers.indexOf(this), 1);
      if(this.modifies){
        this.tref.markDirty(true, false);
      }
    }
    this.modifies = false;
    this.tref = undefined;
    this.nref = undefined;
    this.tokens.forEach(t=>t.decl_token = undefined);
  }
  setSrc(info:AnyInfo|TypeInst, force_clone:boolean=false, mark_self:boolean=false){
    if(!force_clone && info instanceof TypeInst){
      const t = info.getT();
      if(t == BDType.Object || t == BDType.List || t == BDType.Union || t == BDType.FuncRef){
        return this.copySrc(info, mark_self);
      }
    }
    
    this.clearEffects();
    if(info instanceof TypeInst) {
      this.tref = info.ctx as NodeTypeData;
      this.tref.refers.push(this);
    }

    this.src = info
    this.used = new TypeInst(this, this.src, force_clone);
    this.tokens.forEach((t)=>{ 
      t.hover_info = this.used;
    });
    this.markDirty(mark_self, !mark_self);
    return true;
  }
  copySrc(info:TypeInst, mark_self:boolean=false){
    if(info === this.used) return false;

    this.clearEffects();
    this.tref = info.ctx as NodeTypeData;
    this.tref.refers.push(this);
    
    this.src = info
    this.used = info;
    this.tokens.forEach((t)=>{ 
      t.hover_info = this.used;
    });
    this.markDirty(mark_self, !mark_self);
    return true;
  }
  setRef(node:ExprNode){
    this.copySrc(node.type_data.used, true);
    this.nref = node;
    this.tokens.forEach(t=>t.decl_token = node.token);
  }
}

export abstract class ExprNode {
  readonly token:Token;
  parent:Maybe<ExprNode> = undefined;
  children:ExprNode[] = [];
  eval_dirty:boolean = true;
  type_data:NodeTypeData;
  list_injected:Maybe<NodeTypeData> = undefined;
  issues:ExprIssue[] = [];
  addChild(child:ExprNode){
    child.parent = this;
    this.children.push(child);
  }
  setHover(inst:TypeInst){
    this.type_data.tokens.forEach(t=>t.hover_info=inst);
  }
  constructor(token:Token){ 
    this.token = token; 
    this.type_data = new NodeTypeData(this, this.token);
  }
  dbg(depth:number){
    const pad = "  ".repeat(depth);
    dm(pad + this.token.dbg());
  }
  recDbg(depth:number) {
    this.dbg(depth);
    this.children.forEach(c=>c.recDbg(depth+1));
  }
  abstract spanLeft() : number;
  abstract spanRight() : number;
  addIssue(span:ExprNode|Token, txt:string) {
    let start:number = (span instanceof Token) ? span.pos : span.spanLeft();
    let end:number = (span instanceof Token) ? span.pos + span.size : span.spanRight();
    this.issues.push({start:start, end:end, txt:txt});
  }
  gatherIssues(result:ExprIssue[]){
    result.push(...this.issues);
    for(let child of this.children) child.gatherIssues(result);
  }
  doEval(){
    if(!this.eval_dirty) return;
    this.issues = [];
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
    this.type_data.clearEffects();
    this.children.forEach(c=>c.teardown());
    if(this.list_injected){
      this.list_injected.markDirty(true,false);
      this.list_injected = undefined;
    }
  }
  abstract eval() : void;
  
};
export class ErrNode extends ExprNode {
  constructor(token:Token){
    super(token);
  }
  spanLeft() : number { return 0; }
  spanRight() : number { return -1; }
  eval() {}
  recDbg(depth:number){
    const pad = "  ".repeat(depth);
    dm(pad + "<MISSING>");
  }
};

export class NameNode extends ExprNode {
  constructor(token:Token){
    super(token);
    token.errorIfNot([TokenType.Name, TokenType.String]);
  }
  spanLeft() : number { return this.token.pos; }
  spanRight() : number { return this.token.pos + this.token.size; }
  eval() {
    if(this.type_data.nref){
      this.type_data.setRef(this.type_data.nref);
    }
  }
};

export const NULL_TOKEN = new Token({linenum:-1,tokens:[],indent:0,text:""}, 0, 0, TokenType.Null, "");
export const NULL_NODE = new ErrNode(NULL_TOKEN);


class RawNode extends ExprNode {
  constructor(token:Token){
    super(token);
    token.errorIfNot([TokenType.True, TokenType.False, TokenType.Null, TokenType.Number, TokenType.String, TokenType.Name]);
    if(this.token.group == TokenType.True || this.token.group == TokenType.False){
      this.type_data.setSrc({t:BDType.Bool});
    }
    else if(this.token.group == TokenType.Null){
      this.type_data.setSrc({t:BDType.Null});
    }
    else if(this.token.group == TokenType.Number){
      this.type_data.setSrc({t:BDType.Number});
    }
    else if(this.token.group == TokenType.String){
      this.type_data.setSrc({t:BDType.String});
    }
  }
  spanLeft() : number { return this.token.pos; }
  spanRight() : number { return this.token.pos + this.token.size; }
  eval() {}
};
class ListNode extends ExprNode {
  readonly elements:ExprNode[] = [];
  constructor(reader:ExprReader){
    super(reader.takeNext());
    this.token.errorIfNot([TokenType.OpenSquare]);
    reader.parseList(this.elements, TokenType.CloseSquare, "Expected a ] at the end of a list literal");
    this.elements.forEach(elem=>this.addChild(elem));
  }
  spanLeft() : number { return this.token.pos; }
  spanRight() : number { 
    if(this.elements.length == 0){
      return this.token.pos + this.token.size; 
    }
    return this.elements[this.elements.length-1].spanRight();
  }
  eval() {
    let type_options:TypeInst[] = [];
    for(let idx = 0; idx < this.elements.length; idx++){
      const elem = this.elements[idx];
      if(elem.type_data.isUnknown()){
        type_options = [];
        break;
      }
      if(elem.type_data.ease(BDType.Union)){
        elem.type_data.used.alts()!.forEach((alt)=>{
          if(!type_options.some(old=>old.cmp(elem.type_data.used))){
            type_options.push(elem.type_data.used);
          }
        })
      }
      else {
        if(!type_options.some(old=>old.cmp(elem.type_data.used))){
          type_options.push(elem.type_data.used);
        }
      }
    }
    
    this.type_data.setSrc({t:BDType.List, elem:{t:BDType.Union, alts:type_options}});
  }
};
class DictNode extends ExprNode {
  readonly elements:{key:RawNode, value:ExprNode}[] = [];
  constructor(reader:ExprReader){
    super(reader.takeNext());
    this.token.errorIfNot([TokenType.OpenCurly]);
    while(!reader.isNext(TokenType.CloseCurly)){
      const name_token = reader.expectNext([TokenType.String, TokenType.Name], "Expected a key-name in a dict literal")
      if(name_token === undefined) break;
      reader.expectNext(TokenType.Colon, "Expected a colon in a dict literal");
      const value_node = reader.parseExpression();
      this.elements.push({key:new RawNode(name_token), value:value_node});
      if(!reader.takeNextIf(TokenType.Comma)) break;
    }
    reader.expectNext(TokenType.CloseCurly, "Expected a } at the end of a dict literal");
    this.elements.forEach(elem=>this.addChild(elem.value));
  }
  spanLeft() : number { return this.token.pos; }
  spanRight() : number { 
    if(this.elements.length == 0){
      return this.token.pos + this.token.size; 
    }
    return this.elements[this.elements.length-1].value.spanRight();
  }
  eval() {
    const props:PropInfos = new Map<string,AnyInfo>();
    this.elements.forEach((prop)=>{
      props.set(prop.key.token.content(), prop.value.type_data.used);
    });
    this.type_data.setSrc({t:BDType.Object, props:props});
  }
};

class CallNode extends ExprNode {
  src:ExprNode;
  args:ExprNode[] = [];
  constructor(left:ExprNode, reader:ExprReader){
    super(reader.takeNext());
    this.token.errorIfNot([TokenType.OpenRound]);
    this.src = left;
    reader.parseList(this.args, TokenType.CloseRound, "Expected a ) at the end of a function call");
    this.addChild(this.src);
    this.args.forEach(arg=>this.addChild(arg));
  }
  spanLeft() : number { return this.src.spanLeft(); }
  spanRight() : number { 
    if(this.args.length == 0){
      return this.token.pos + this.token.size; 
    }
    return this.args[this.args.length-1].spanRight();
  }
  eval() {
    if(this.list_injected){
      this.list_injected.markDirty(true, false);
      this.list_injected = undefined;
    }
    if(this.src.type_data.isUnknown()){
      this.type_data.setSrc({t:BDType.Unknown});
      return;
    }
    const src_fns = this.src.type_data.easeOptions(BDType.FuncRef);
    if(src_fns.length == 0){
      this.type_data.setSrc({t:BDType.Unknown});
      this.addIssue(this.src, `${this.src.token.content()} is not a function`);
      return;
    }
    if(src_fns.length > 1){
      this.type_data.setSrc({t:BDType.Unknown});
      this.addIssue(this.src, `${this.src.token.content()} is ambiguous`);
      return;
    }
    const func_info = src_fns[0].func()!;
    this.type_data.setSrc(func_info.ret, true);
    
    for(let idx = 0; idx < func_info.args.length; idx++){
      const api = func_info.args[idx];
      if(idx >= this.args.length){
        if(api.opt !== true) {
          this.addIssue(this, `Missing arg: ${api.name}`);
        }
        break;
      }
      if(api.wants == BDType.Unknown) continue;
      const used = this.args[idx];
      if(used.type_data.isUnknown()) continue;
      let arg_ease:Maybe<TypeInst>;
      if(api.wants instanceof Array){
        if(!api.wants.some(api_t => {
          if((arg_ease = used.type_data.ease(api_t)) !== undefined){
            used.setHover(arg_ease);
            return true;
          }
          return false;
        })){
          const expect_str = api.wants.map(api_t=>BDTypeNames[api_t]).join("/");
          this.addIssue(used, `Incorrect arg type. Expected ${expect_str}`);
        }
      }
      else {
        if((arg_ease = used.type_data.ease(api.wants)) !== undefined){
          used.setHover(arg_ease);
        }
        else {
          if(!used.type_data.ease(api.wants)){
            this.addIssue(used, `Incorrect arg type. Expected ${BDTypeNames[api.wants]}`);
          }
        }
      }
    }
    if(this.args.length > func_info.args.length){
      const arg_node = this.args[func_info.args.length];
      this.addIssue(arg_node, `Too many args`);
    }

    // Special Case - Inject Type Data for list.append and list.insert
    if(this.src instanceof PropertyNode){
      const src_list = this.src.src.type_data.ease(BDType.List);
      if(src_list){
        const prop_name = this.src.property.content();
        if(prop_name == "append"){
          if(this.args.length > 0 && !this.args[0].type_data.isUnknown()){
            this.list_injected = src_list.ctx as NodeTypeData;
            src_list.elem()!.union(this.args[0].type_data.used);
          }
        }
        else if(prop_name == "insert"){
          if(this.args.length > 1 && !this.args[1].type_data.isUnknown()){
            this.list_injected = src_list.ctx as NodeTypeData;
            src_list.elem()!.union(this.args[1].type_data.used);
          }
        }
      }
    }
  }
}; 
export class IndexNode extends ExprNode {
  src:ExprNode;
  index:ExprNode;
  spanLeft() : number { return this.src.spanLeft(); }
  spanRight() : number { return this.index.spanRight(); }
  constructor(left:ExprNode, reader:ExprReader){
    super(reader.takeNext());
    this.token.errorIfNot([TokenType.OpenSquare]);
    this.src = left;
    this.index = reader.parseExpression();
    reader.expectNext(TokenType.CloseSquare, "Expected a ] at the end of a index");
    this.addChild(this.src);
    this.addChild(this.index);
  }
  eval() {
    const src_info = this.src.type_data;
    const src_lists = src_info.easeOptions(BDType.List);
    const src_dicts = src_info.easeOptions(BDType.Object);
    const src_str = src_info.ease(BDType.String);
    const num_idx_allow = (src_lists.length > 0 || src_str !== undefined);
    const str_idx_allow = src_dicts.length > 0;

    if(!(num_idx_allow || str_idx_allow)){
      this.type_data.setSrc({t:BDType.Unknown});
      if(!src_info.isUnknown()){
        this.addIssue(this.index, "Indexes are only valid for lists, objects, and strings");
      }
      return;
    }
    if(this.index.type_data.isUnknown()){
      // special case to help with Record types
      if(src_dicts.length == 1 && src_str === undefined && src_lists.length == 0){
        let dict_field_union:(TypeInst|AnyInfo)[] = [];
        for(let prop_info of src_dicts[0].props()!.values()){
          dict_field_union.push(prop_info);
        }
        if(dict_field_union.length == 0){
          this.type_data.setSrc({t:BDType.Unknown});
        }
        else if(dict_field_union.length == 1){
          this.type_data.setSrc(dict_field_union[0]);
        }
        else {
          this.type_data.setSrc({t:BDType.Union, alts:dict_field_union});
        }
        return;
      }
      this.type_data.setSrc({t:BDType.Unknown});
      return;
    }
    const idx_num = this.index.type_data.ease(BDType.Number);
    const idx_str = this.index.type_data.ease(BDType.String);
    if(!(idx_num !== undefined || idx_str !== undefined)){
      this.type_data.setSrc({t:BDType.Unknown});
      this.addIssue(this.index, "Indexes must be strings or numbers");
      return;
    }
    if(idx_num === undefined && !str_idx_allow){
      this.type_data.setSrc({t:BDType.Unknown});
      this.addIssue(this.index, "Indexes must be numbers for lists and strings");
      return;
    }
    if(idx_str === undefined && !num_idx_allow){
      this.type_data.setSrc({t:BDType.Unknown});
      this.addIssue(this.index, "Indexes must be strings for objects");
      return;
    }

    // find possible return types
    const can_be_string = (idx_num !== undefined && src_str !== undefined);
    const list_ret_types:TypeInst[] = (idx_num !== undefined) ? src_lists.map(l=>l.elem()!) : [];
    let dict_ret_types:(TypeInst|AnyInfo)[] = [];
    if(idx_str !== undefined){
      if(this.index instanceof RawNode){
        const prop_name = this.index.token.content();
        for(let d of src_dicts){
          const prop_info = d.props()!.get(prop_name);
          if(prop_info !== undefined){
            dict_ret_types.push(prop_info);
          }
        }
        if(dict_ret_types.length == 0){
          this.type_data.setSrc({t:BDType.Unknown});
          this.addIssue(this.index, `Object property ${this.index.token.content()} wasn't found`);
          return;
        }
      }
      else{
        // special case to help with Record types
        if(src_dicts.length == 1 && src_str === undefined && src_lists.length == 0){
          let dict_field_union:(TypeInst|AnyInfo)[] = [];
          for(let prop_info of src_dicts[0].props()!.values()){
            dict_field_union.push(prop_info);
          }
          if(dict_field_union.length == 0){
            this.type_data.setSrc({t:BDType.Unknown});
          }
          else if(dict_field_union.length == 1){
            this.type_data.setSrc(dict_field_union[0]);
          }
          else {
            this.type_data.setSrc({t:BDType.Union, alts:dict_field_union});
          }
          return;
        }
      }
    }

    // build the return type
    const possible_types:(TypeInst|AnyInfo)[] = dict_ret_types.concat(list_ret_types);
    if(can_be_string) possible_types.push({t:BDType.String});
    if(possible_types.length == 0){
      this.type_data.setSrc({t:BDType.Unknown});
    }
    else if(possible_types.length == 1){
      this.type_data.setSrc(possible_types[0]);
    }
    else {
      this.type_data.setSrc({t:BDType.Union, alts:possible_types});
    }
  }
}; 
export class PropertyNode extends ExprNode {
  src:ExprNode;
  property:Token;
  constructor(left:ExprNode, reader:ExprReader){
    super(reader.takeNext());
    this.token.errorIfNot([TokenType.Dot]);
    this.src = left;
    this.property = reader.expectNext(TokenType.Name, "Expected a property name") ?? NULL_TOKEN;
    this.addChild(left);
    this.type_data.tokens.push(this.property);
  }
  spanLeft() : number { return this.src.spanLeft(); }
  spanRight() : number { return this.property.pos + this.property.size; }
  dbg(depth:number){
    const pad = "  ".repeat(depth+1);
    dm(pad + this.token.dbg() + "("+this.property.dbg()+")");
  }
  eval() {
    if(this.src.type_data.isUnknown()) {
      this.type_data.setSrc({t:BDType.Unknown});
      return;
    }
    
    const src_lists = this.src.type_data.easeOptions(BDType.List);
    const src_dicts = this.src.type_data.easeOptions(BDType.Object);
    const src_string = this.src.type_data.ease(BDType.String);
    if(src_lists.length == 0 && src_dicts.length == 0 && !src_string) {
      if(!this.src.type_data.isUnknown()){
        this.addIssue(this.property, "Properties can only be taken from lists, objects, and strings");
      }
      this.type_data.setSrc({t:BDType.Unknown});
      return;
    }

    const prop_name = this.property.content();
    let type_options:(AnyInfo|TypeInst)[] = [];
    
    if(src_lists.length > 0){
      const bi_info = LIST_PROPS.get(prop_name);
      if(bi_info !== undefined){
        if(prop_name == "pop"){
          for(let l of src_lists){
            const elem = l.elem()!;
            type_options.push({...bi_info, ret:elem});
          }
        }
        else {
          type_options.push(bi_info);
        }
      }
    }
    if(src_string){
      const bi_info = STRING_PROPS.get(prop_name);
      if(bi_info !== undefined){
        this.src.setHover(src_string);
        type_options.push(bi_info);
      }
    }
    if(src_dicts.length > 0){
      const bi_info = DICT_PROPS.get(prop_name);
      if(bi_info !== undefined){
        type_options.push(bi_info);
      }
      else {
        for(let d of src_dicts){
          const user_info = d.props()!.get(prop_name);
          if(user_info !== undefined){
            type_options.push(user_info);
          }
        }
      }
    }
    if(type_options.length == 0){
      this.addIssue(this.property, `Property ${prop_name} wasn't found`);
      this.type_data.setSrc({t:BDType.Unknown});
    }
    else if(type_options.length == 1){
      this.type_data.setSrc(type_options[0]);
    }
    else {
      this.type_data.setSrc({t:BDType.Union, alts:type_options});
    }
    //this.src.setHover(src_dict);
  }
}; 

class UnaryNode extends ExprNode {
  right:ExprNode = NULL_NODE;
  constructor(token:Token, parent?:UnaryNode){
    super(token);
    token.errorIfNot([TokenType.Not, TokenType.Sub, TokenType.Invert]);
    if(parent) {
      parent.right = this;
      parent.addChild(this)
    }
  }
  spanLeft() : number { return this.token.pos; }
  spanRight() : number { return this.right.spanRight(); }
  eval() {
    const rt = this.right.type_data;
    if(this.token.group == TokenType.Not){
      // TODO: implicit truth casting?
      if(!rt.ease(BDType.Bool) && !rt.isUnknown()){
        this.addIssue(this.right, "Expected Boolean");
      }
      this.type_data.setSrc({t:BDType.Bool});
    }
    else {
      if(!rt.ease(BDType.Number) && !rt.isUnknown()){
        this.addIssue(this.right, "Expected Number");
      }
      this.type_data.setSrc({t:BDType.Number});
    }
  }
};
class BinaryNode extends ExprNode {
  left:ExprNode = NULL_NODE;
  right:ExprNode = NULL_NODE;
  constructor(token:Token){
    super(token);
  }
  spanLeft() : number { return this.left.spanLeft(); }
  spanRight() : number { return this.right.spanRight(); }
  finalize(){
    this.addChild(this.left);
    this.addChild(this.right);
    if(this.left instanceof BinaryNode){
      this.left.finalize();
    }
    if(this.right instanceof BinaryNode){
      this.right.finalize();
    }
  }
  eval() {
    const lt = this.left.type_data;
    const rt = this.right.type_data;
    if(this.token.group == TokenType.Add){
      if(lt.ease(BDType.String) || rt.ease(BDType.String)){
        this.type_data.setSrc({t:BDType.String});
        return;
      }
    }
    if(this.token.group <= TokenType.RShift){
      if(!lt.ease(BDType.Number) && !lt.isUnknown()){
        this.addIssue(this.left, "Expected Number");
      }
      if(!rt.ease(BDType.Number) && !rt.isUnknown()){
        this.addIssue(this.right, "Expected Number");
      }
      this.type_data.setSrc({t:BDType.Number});
    }
    else{
      this.type_data.setSrc({t:BDType.Bool});
    }
  }
};
class TernaryNode extends ExprNode {
  condition:ExprNode;
  true_clause:ExprNode;
  false_clause:ExprNode;
  constructor(condition:ExprNode, reader:ExprReader){
    super(reader.takeNext());
    this.token.errorIfNot([TokenType.Tern]);
    this.condition = condition;
    this.true_clause = reader.parseExpression();
    reader.expectNext(TokenType.Colon, "Expected a : as part of a ternary expression");
    this.false_clause = reader.parseExpression();
    this.addChild(this.condition);
    this.addChild(this.true_clause);
    this.addChild(this.false_clause);
  }
  spanLeft() : number { return this.condition.spanLeft(); }
  spanRight() : number { return this.false_clause.spanRight(); }
  eval() {
    const ct = this.condition.type_data;
    const tt = this.true_clause.type_data;
    const ft = this.false_clause.type_data;
    if(!ct.ease(BDType.Bool) && !ct.isUnknown()){
      this.addIssue(this.condition, "Expected Boolean");
    }
    if(tt.isUnknown() || ft.isUnknown()){
      this.type_data.setSrc({t:BDType.Unknown});
    }
    else if(tt.used.cmp(ft.used)){
      this.type_data.setSrc(tt.used);
    }
    else {
      this.type_data.setSrc({t:BDType.Union, alts:[tt.used,ft.used]});
    }
  }
}; 