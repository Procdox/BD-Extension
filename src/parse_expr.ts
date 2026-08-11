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
      dm("Ref: " + name_node.token.content())
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
  resolveRefs(tracker:{get:(name:string)=> Maybe<ExprNode>}, actual_line:number, issues:{l:number, t:Token, m:string}[]){
    for(let ref_idx = 0; ref_idx < this.references.length; ref_idx++){
      const cur_ref = this.references[ref_idx];
      const ref_name = cur_ref.token.content();
      const decl = tracker.get(ref_name);
      if(decl === undefined) {
        const bi_info = BUILTINS.get(ref_name);
        if(bi_info !== undefined){
          cur_ref.type_data.setSrc(bi_info);
        }
        else {
          cur_ref.type_data.setSrc({t:BDType.Unknown});
          issues.push({l:actual_line, t:cur_ref.token, m:"Reference to undeclared variable"});
        }
      }
      else {
        cur_ref.type_data.copySrc(decl.type_data.used);
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
      src_node.type_data.used.addProp(prop_name, expr_info);
      src_node.type_data.modifies = true
    }
    else {
      src_node.type_data.used.union(expr_info);
      src_node.type_data.modifies = true
    }
  }
  eval() : TypeInst {
    this.ast.doEval();
    return this.ast.type_data.used;
  }
  teardown() {
    this.ast.teardown();
  }
}

export class NodeTypeData extends TypeData {
  node:ExprNode;
  tokens:Token[];
  modifies:boolean = false;
  ref:Maybe<NodeTypeData> = undefined;
  refers:NodeTypeData[] = [];
  constructor(node:ExprNode, token:Token){
    super();
    this.node = node;
    this.tokens = [token];
  }
  clearEffects(){
    if(this.ref !== undefined){
      this.ref.refers.splice(this.ref.refers.indexOf(this), 1);
      if(this.modifies){
        this.ref.node.markDirty();
      }
    }
    this.modifies = false;
    this.ref = undefined;
  }
  setSrc(info:AnyInfo|TypeInst, force_clone:boolean=false){
    if(!force_clone && info instanceof TypeInst){
      const t = info.getT();
      if(t == BDType.Object || t == BDType.List || t == BDType.Union || t == BDType.FuncRef){
        return this.copySrc(info);
      }
    }
    
    this.clearEffects();
    if(info instanceof TypeInst) {
      this.ref = info.ctx as NodeTypeData;
      this.ref.refers.push(this);
    }

    this.src = info
    this.used = new TypeInst(this, this.src, force_clone);
    this.tokens.forEach((t)=>{ 
      t.hover_info = this.used;
    });
    this.refers.forEach((r)=>r.node.markDirty());
  }
  copySrc(info:TypeInst){
    if(info === this.used) return;

    this.clearEffects();
    this.ref = info.ctx as NodeTypeData;
    this.ref.refers.push(this);
    
    this.src = info
    this.used = info;
    this.tokens.forEach((t)=>{ 
      t.hover_info = this.used;
    });
    this.refers.forEach((r)=>r.node.markDirty());
  }
}

export abstract class ExprNode {
  readonly token:Token;
  parent:Maybe<ExprNode> = undefined;
  children:ExprNode[] = [];
  eval_dirty:boolean = true;
  type_data:NodeTypeData;
  addChild(child:ExprNode){
    child.parent = this;
    this.children.push(child);
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
    this.type_data.clearEffects();
    this.children.forEach(c=>c.teardown());
  }
  abstract eval() : void;
  
};
export class ErrNode extends ExprNode {
  constructor(token:Token){
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

export class NameNode extends ExprNode {
  constructor(token:Token){
    super(token);
    token.errorIfNot([TokenType.Name]);
  }
  eval() {}
};

export const NULL_TOKEN = new Token(0,0,TokenType.Null,"");
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
  eval() {
    let type_options:TypeInst[] = [];
    for(let idx = 0; idx < this.elements.length; idx++){
      const elem = this.elements[idx];
      if(elem.type_data.is(BDType.Unknown)){
        type_options = [];
        break;
      }
      if(!type_options.some(old=>old.cmp(elem.type_data.used))){
        type_options.push(elem.type_data.used);
      }
    }
    let elem_type:AnyInfo|TypeInst;
    if(type_options.length == 0){
      elem_type = {t:BDType.Unknown};
    }
    else if(type_options.length == 1){
      elem_type = type_options[0];
    }
    else {
      elem_type = {t:BDType.Union, alts:type_options};
    }
    
    this.type_data.setSrc({t:BDType.List, elem:elem_type});
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
  eval() {
    this.type_data.setSrc({t:BDType.Unknown});
    if(this.src instanceof NameNode){
      if(this.src.type_data.is(BDType.Unknown)){
        this.type_data.setSrc({t:BDType.Unknown});
        return;
      }
      const func_info = this.src.type_data.used.func();
      if(func_info === undefined) {
        this.type_data.setSrc({t:BDType.Unknown});
        this.token.temp_issues.push(`${this.src.token.content()} is not a function`);
        return;
      }
      this.type_data.setSrc(func_info.ret, true);
      
      for(let idx = 0; idx < func_info.args.length; idx++){
        const api = func_info.args[idx];
        if(idx >= this.args.length){
          if(api.opt !== true) this.token.temp_issues.push("Incorrect number of args");
          break;
        }
        if(api.wants == BDType.Unknown) continue;
        const used = this.args[idx];
        if(api.wants instanceof Array){
          if(!api.wants.some(api_t => used.type_data.canBe(api_t))){
            const expect_str = api.wants.map(api_t=>BDTypeNames[api_t]).join("/");
            used.token.temp_issues.push(`Incorrect arg type. Expected ${expect_str}}`);
          }
        }
        else {
          if(!used.type_data.canBe(api.wants)){
            used.token.temp_issues.push(`Incorrect arg type. Expected ${BDTypeNames[api.wants]}`);
          }
        }
      }
    }
  }
}; 
export class IndexNode extends ExprNode {
  src:ExprNode;
  index:ExprNode;
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
    let best_info:AnyInfo|TypeInst = {t:BDType.Unknown};
    const src_info = this.src.type_data;
    const num_index = this.index.type_data.canBe(BDType.Number);
    const str_index = this.index.type_data.canBe(BDType.String);
    if(src_info.is(BDType.List)){
      if(!num_index){
        this.index.token.temp_issues.push("Indexes must be numbers for lists");
      }
      best_info = src_info.used.elem()!;
    }
    else if(src_info.is(BDType.String)){
      if(!num_index){
        this.index.token.temp_issues.push("Indexes must be numbers for strings");
      }
      best_info = {t:BDType.String};
    }
    else if(src_info.is(BDType.Object)){
      if(!str_index){
        this.index.token.temp_issues.push("Indexes must be strings for objects");
      }
      else if(this.index instanceof RawNode) {
        const prop_name = this.index.token.content();
        const prop_info = src_info.used.props()!.get(prop_name)
        if(prop_info === undefined){
          this.index.token.temp_issues.push(`Object property ${prop_name} wasn't found`);
        }
        else {
          best_info = prop_info;
        }
      }
    }
    else {
      if(!str_index && !num_index){
        this.index.token.temp_issues.push("Indexes must be either strings for objects, or numbers for lists/strings");
      }
      if(!src_info.is(BDType.Unknown)){
        this.index.token.temp_issues.push("Indexes are only valid for lists, objects, and strings");
      }
    }
    this.type_data.setSrc(best_info);
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
  dbg(depth:number){
    const pad = "  ".repeat(depth+1);
    dm(pad + this.token.dbg() + "("+this.property.dbg()+")");
  }
  eval() {
    this.property.temp_issues = [];
    if(this.src.type_data.canBe(BDType.Unknown)) {
      this.type_data.setSrc({t:BDType.Unknown});
      return;
    }
    
    const maybe_list = this.src.type_data.canBe(BDType.List);
    const maybe_dict = this.src.type_data.canBe(BDType.Object);
    const maybe_string = this.src.type_data.canBe(BDType.String);
    if(!maybe_dict && !maybe_list && !maybe_string) {
      this.property.temp_issues.push("Properties can only be taken from lists, objects, and strings");
      this.type_data.setSrc({t:BDType.Unknown});
      return;
    }

    const prop_name = this.property.content();
    
    if(maybe_list){
      const bi_info = LIST_PROPS.get(prop_name);
      if(bi_info !== undefined){
        if(prop_name == "pop" && this.src.type_data.is(BDType.List)){
          const elem = this.src.type_data.used.elem()!;
          this.type_data.setSrc({...bi_info, ret:elem})
        }
        else {
          this.type_data.setSrc(bi_info);
        }
        return;
      }
    }
    if(maybe_dict){
      const bi_info = DICT_PROPS.get(prop_name);
      if(bi_info !== undefined){
        this.type_data.setSrc(bi_info);
        return;
      }
    }
    if(maybe_string){
      const bi_info = STRING_PROPS.get(prop_name);
      if(bi_info !== undefined){
        this.type_data.setSrc(bi_info);
        return;
      }
    }
    

    const src_info = this.src.type_data;
    if(src_info.is(BDType.Object)){
      const user_info = src_info.used.props()!.get(prop_name);
      if(user_info !== undefined){
        this.type_data.setSrc(user_info);
        return;
      }
    }
    this.property.temp_issues.push(`Property ${prop_name} wasn't found`);
    this.type_data.setSrc({t:BDType.Unknown});
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
  eval() {
    if(this.token.group == TokenType.Not){
      // TODO: implicit truth casting?
      if(!this.right.type_data.canBe(BDType.Number)){
        this.right.token.temp_issues.push("Expected Boolean");
      }
      this.type_data.setSrc({t:BDType.Bool});
    }
    else {
      if(!this.right.type_data.canBe(BDType.Number)){
        this.right.token.temp_issues.push("Expected Number");
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
    if(this.token.group == TokenType.Add){
      if(this.left.type_data.canBe(BDType.String) || this.left.type_data.canBe(BDType.String)){
        this.type_data.setSrc({t:BDType.String});
        return;
      }
    }
    if(this.token.group <= TokenType.RShift){
      if(!this.left.type_data.canBe(BDType.Number)){
        this.left.token.temp_issues.push("Expected Number");
      }
      if(!this.right.type_data.canBe(BDType.Number)){
        this.right.token.temp_issues.push("Expected Number");
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
  eval() {
    if(!this.condition.type_data.canBe(BDType.Bool)){
      this.condition.token.temp_issues.push("Expected Boolean");
    }
    if(this.true_clause.type_data.used == this.false_clause.type_data.used){
      this.type_data.setSrc(this.true_clause.type_data.used);
    }
    else {
      this.type_data.setSrc({t:BDType.Unknown});
    }
  }
}; 