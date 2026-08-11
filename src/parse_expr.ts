import * as vscode from 'vscode';
import { dm, Maybe } from './helpers';
import { AnyInfo, BDType, BDTypeNames, ErrNode, ExprNode, NULL_NODE, NULL_TOKEN, ObjInfo, ParseToken, PropInfos, TokenType } from "./lang_types";
import { BUILTINS, DICT_PROPS, LIST_PROPS, STRING_PROPS } from './builtins';

export class ExprReader {
  tokens:ParseToken[];
  pos:number;
  end:number;
  cur:Maybe<ParseToken> = undefined;
  errors:{pos:number, msg:string}[] = [];
  references:NameNode[] = [];
  ast:ExprNode;
  constructor(tokens:ParseToken[], start:number, end:number){
    this.tokens = tokens;
    this.pos = start;
    this.end = end;
    if(this.pos >= this.end){
      throw new Error("Tried to read empty expression token sequence");
    }
    //dm(`ExprReader(...,${start},${end}):` + this.tokens.slice(this.pos,this.end).map(e=>e.dbg()).join(" "));
    this.cur = this.tokens[this.pos];
    this.ast = this.parseExpression();
    if(this.pos < this.end){
      this.addError("Unexpected token after expression")
    }
  }
  isNext(t:TokenType|TokenType[]){
    return this.cur ? this.cur.isType(t) : false;
  }
  takeNext() : ParseToken {
    const val = this.cur;
    if(val === undefined) throw new Error("Tried to take undefined token");
    this.pos += 1;
    this.cur = (this.pos < this.end) ? this.tokens[this.pos] : undefined;
    return val;
  }
  takeNextIf(t:TokenType|TokenType[]) : Maybe<ParseToken> {
    if(this.isNext(t)) return this.takeNext();
    return undefined;
  }
  addError(msg:string){
    const best_pos = Math.min(this.pos, this.tokens.length-1);
    this.tokens[best_pos].issues.push(msg);
    this.errors.push({pos:this.pos, msg:msg});
  }
  dbgPeek(){
    if(this.cur){
      dm("PEEK: " + this.cur.dbg())
    }
    else {
      dm("PEEK: <EOL>")
    }
  }
  expectNext(t:TokenType|TokenType[], msg:string) : Maybe<ParseToken> {
    if(this.isNext(t)) return this.takeNext();
    this.addError(msg);
    return undefined;
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
  resolveRefs(tracker:{get:(name:string)=> Maybe<ParseToken>}, actual_line:number, issues:{l:number, t:ParseToken, m:string}[]){
    for(let ref_idx = 0; ref_idx < this.references.length; ref_idx++){
      const cur_ref = this.references[ref_idx];
      const ref_name = cur_ref.token.content();
      const decl = tracker.get(ref_name);
      if(decl === undefined) {
        const bi_info = BUILTINS.get(ref_name);
        if(bi_info !== undefined){
          cur_ref.token.setInfo(bi_info);
        }
        else {
          cur_ref.token.setInfo(BDType.Anything);
          issues.push({l:actual_line, t:cur_ref.token, m:"Reference to undeclared variable"});
        }
      }
      else {
        cur_ref.token.setRef(decl);
      }
    }
  }
  evalRvalTarget(expr_info:AnyInfo){
    let focus:ExprNode = this.ast;
    let prop_name:Maybe<string> = undefined;
    let src_token:Maybe<ParseToken> = undefined;
    if(focus instanceof PropertyNode){
      if(focus.property instanceof ErrNode) return;
      prop_name = focus.property.content();
      src_token = focus.src.token;
    }
    else if(focus instanceof IndexNode){
      if(focus.index instanceof RawNode){
        prop_name = focus.index.token.content();
        src_token = focus.src.token;
      }
    }
    else if(focus instanceof NameNode){
      src_token = focus.token;
    }
    if(src_token === undefined) return;

    if(prop_name !== undefined) {
      src_token.addProp(prop_name, expr_info);
    }
    else {
      src_token.addInfo(expr_info);
    }
  }
  eval() : AnyInfo[] {
    this.ast.doEval();
    return this.ast.token.getInfo();
  }
  teardown() {
    this.ast.teardown();
  }
}




class RawNode extends ExprNode {
  constructor(token:ParseToken){
    super(token);
    token.errorIfNot([TokenType.True, TokenType.False, TokenType.Null, TokenType.Number, TokenType.String, TokenType.Name]);
    if(this.token.group == TokenType.True || this.token.group == TokenType.False){
      this.token.setInfo(BDType.Bool);
    }
    else if(this.token.group == TokenType.Null){
      this.token.setInfo(BDType.Null);
    }
    else if(this.token.group == TokenType.Number){
      this.token.setInfo(BDType.Number);
    }
    else if(this.token.group == TokenType.String){
      this.token.setInfo(BDType.String);
    }
  }
  eval() {}
};
export class NameNode extends ExprNode {
  constructor(token:ParseToken){
    super(token);
    token.errorIfNot([TokenType.Name]);
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
    this.token.setInfo({t:BDType.List});
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
      props.set(prop.key.token.content(), prop.value.token.getInfo()[0]);
    });
    this.token.setInfo({t:BDType.Object, props:props});
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
    this.token.setInfo(BDType.Anything);
    if(this.src instanceof NameNode){
      const func_infos = this.src.token.getInfo();
      if(func_infos.length != 1){
        this.token.temp_issues.push(`${this.src.token.content()} is ambiguously typed`);
      }
      const func_info = func_infos[0];
      if(typeof func_info === "number" || func_info.t !== BDType.FuncRef) {
        this.token.temp_issues.push(`${this.src.token.content()} is not a function`);
        return;
      }
      this.token.setInfo(func_info.ret);
      
      for(let idx = 0; idx < func_info.args.length; idx++){
        const api = func_info.args[idx];
        if(idx >= this.args.length){
          if(api.opt !== true) this.token.temp_issues.push("Incorrect number of args");
          break;
        }
        if(api.wants == BDType.Anything) continue;
        const used = this.args[idx];
        const used_info = used.token.getInfo();
        if(api.wants instanceof Array){
          if(!api.wants.some(api_t => used.token.canBe(api_t))){
            const expect_str = api.wants.map(api_t=>BDTypeNames[api_t]).join("/");
            used.token.temp_issues.push(`Incorrect arg type. Expected ${expect_str}}`);
          }
        }
        else {
          if(!used.token.canBe(api.wants)){
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
    const src_infos = this.src.token.getInfo();
    let last_err:string = "No valid types found for target";
    let last_info:AnyInfo = BDType.Anything;
    const num_index = this.index.token.canBe(BDType.Number);
    const str_index = this.index.token.canBe(BDType.String);
    const valid = src_infos.some(src_info=>{
      if(typeof src_info !== "number" && src_info.t === BDType.List){
        if(!num_index){
          last_err = "Indexes must be numbers for lists";
        }
      }
      else if(src_info === BDType.String){
        if(!num_index){
          last_err = "Indexes must be numbers for strings";
        }
        last_info = BDType.String;
        return true;
      }
      else if(typeof src_info !== "number" && src_info.t === BDType.Object){
        if(!str_index){
          last_err = "Indexes must be strings for objects";
        }
        else if(this.index instanceof RawNode) {
          const prop_name = this.index.token.content();
          const prop_info = src_info.props.get(prop_name)
          if(prop_info === undefined){
            last_err = `Object property ${prop_name} wasn't found`;
          }
          else {
            last_info = prop_info;
            return true;
          }
        }
      }
      else {
        if(!str_index && !num_index){
          last_err = "Indexes must be either strings for objects, or numbers for lists/strings";
        }
        if(src_info !== BDType.Anything){
          last_err = "Indexes are only valid for lists, objects, and strings";
        }
      }
      return false;
    });
    if(valid){
      this.token.setInfo(last_info);
    }
    else{
      this.token.setInfo(BDType.Anything);
      this.index.token.temp_issues.push(last_err)
    }
  }
}; 
export class PropertyNode extends ExprNode {
  src:ExprNode;
  property:ParseToken;
  constructor(left:ExprNode, reader:ExprReader){
    super(reader.takeNext());
    this.token.errorIfNot([TokenType.Dot]);
    this.src = left;
    this.property = reader.expectNext(TokenType.Name, "Expected a property name") ?? NULL_TOKEN;
    this.addChild(left);
  }
  dbg(depth:number){
    const pad = "  ".repeat(depth+1);
    dm(pad + this.token.dbg() + "("+this.property.dbg()+")");
  }
  eval() {
    this.property.temp_issues = [];
    if(this.src.token.canBe(BDType.Anything)) {
      this.token.setInfo(BDType.Anything);
      return;
    }

    
    const maybe_list = this.src.token.canBe(BDType.List);
    const maybe_dict = this.src.token.canBe(BDType.Object);
    const maybe_string = this.src.token.canBe(BDType.String);
    if(!maybe_dict && !maybe_list && !maybe_string) {
      this.property.temp_issues.push("Properties can only be taken from lists, objects, and strings");
      this.token.setInfo(BDType.Anything);
      return;
    }

    const prop_name = this.property.content();
    
    if(maybe_list){
      const bi_info = LIST_PROPS.get(prop_name);
      if(bi_info !== undefined){
        this.token.setInfo(bi_info);
        return;
      }
    }
    if(maybe_dict){
      const bi_info = DICT_PROPS.get(prop_name);
      if(bi_info !== undefined){
        this.token.setInfo(bi_info);
        return;
      }
    }
    if(maybe_string){
      const bi_info = STRING_PROPS.get(prop_name);
      if(bi_info !== undefined){
        this.token.setInfo(bi_info);
        return;
      }
    }
    

    const src_info = this.src.token.getInfo();
    for(let idx = 0; idx < src_info.length;idx++){
      const info = src_info[idx];
      if(typeof info !== "number" && info.t === BDType.Object){
        const user_info = info.props.get(prop_name);
        if(user_info !== undefined){
          this.token.setInfo(user_info);
          return;
        }
      }
    }
    this.property.temp_issues.push(`Property ${prop_name} wasn't found`);
    this.token.setInfo(BDType.Anything);
  }
}; 

class UnaryNode extends ExprNode {
  right:ExprNode = NULL_NODE;
  constructor(token:ParseToken, parent?:UnaryNode){
    super(token);
    token.errorIfNot([TokenType.Not, TokenType.Sub, TokenType.Invert]);
    if(parent) {
      parent.right = this;
      parent.addChild(this)
    }
  }
  eval() {
    const child_t = this.right.token.getInfo();
    if(this.token.group == TokenType.Not){
      // TODO: implicit truth casting?
      if(!this.right.token.canBe(BDType.Number)){
        this.right.token.temp_issues.push("Expected Boolean");
      }
      this.token.setInfo(BDType.Bool);
    }
    else {
      if(!this.right.token.canBe(BDType.Number)){
        this.right.token.temp_issues.push("Expected Number");
      }
      this.token.setInfo(BDType.Number);
    }
  }
};
class BinaryNode extends ExprNode {
  left:ExprNode = NULL_NODE;
  right:ExprNode = NULL_NODE;
  constructor(token:ParseToken){
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
      if(this.left.token.canBe(BDType.String) || this.left.token.canBe(BDType.String)){
        this.token.setInfo(BDType.String);
        return;
      }
    }
    if(this.token.group <= TokenType.RShift){
      if(!this.left.token.canBe(BDType.Number)){
        this.left.token.temp_issues.push("Expected Number");
      }
      if(!this.right.token.canBe(BDType.Number)){
        this.right.token.temp_issues.push("Expected Number");
      }
      this.token.setInfo(BDType.Number);
    }
    else{
      this.token.setInfo(BDType.Bool);
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
    if(this.condition.token.canBe(BDType.Bool)){
      this.condition.token.temp_issues.push("Expected Boolean");
    }
    if(this.true_clause.token.getInfo() == this.false_clause.token.getInfo()){
      this.token.setRef(this.true_clause.token);
    }
    else {
      this.token.setInfo(BDType.Anything);
    }
  }
}; 