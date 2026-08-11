import * as vscode from 'vscode';

var DBG_OUT:vscode.OutputChannel|undefined = undefined;
if(true){
  DBG_OUT = vscode.window.createOutputChannel("Orange");
}
export function dm(msg:string){
  if(DBG_OUT) {
    DBG_OUT.appendLine(msg);
  }    
}

export type Maybe<T> = T | undefined;