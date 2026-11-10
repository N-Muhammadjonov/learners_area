/** Weak, code-only help metadata. Never executes a handler or captures closure values. */
const actions=new WeakMap();
export function rememberControlAction(node,event,handler){
 if(!['click','submit','change'].includes(event)||typeof handler!=='function')return;
 let row=actions.get(node);if(!row){row={};actions.set(node,row);}row[event]=handler;
}
export function controlAction(node){
 const own=actions.get(node),form=node.form??node.closest?.('form'),handler=own?.click??own?.change??(node.type==='submit'?actions.get(form)?.submit:null);
 if(!handler)return null;
 return Function.prototype.toString.call(handler).replace(/\s+/g,' ').slice(0,800);
}
