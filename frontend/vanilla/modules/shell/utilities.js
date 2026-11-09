import {el,listen} from '../../js/dom.js';import {render} from '../../js/generated/ShellUtilities.js';import {reportProblem} from '../shared/report.js';
import {studyFocus} from './study-focus.js';
import {navigationList} from './navigation-list.js';
export function shellUtilities(context){
 const {signal,dict}=context,host=el('div',{'data-shell-utilities':''});let pathname=null,open=false,report=null;
 const focus=studyFocus(context,()=>{if(pathname!==null)draw();});
 function draw(){if(signal.aborted)return;const active=host.contains(document.activeElement)?document.activeElement:null,restore=active?.hasAttribute('data-utilities-launcher')?'[data-utilities-launcher]':active?.hasAttribute('data-focus-toggle')?'[data-focus-toggle]':null;host.replaceChildren(render({NavigationList:()=>navigationList({...context,url:new URL(pathname,context.url.origin)}),dict,on:focus.on,open,setOpen:next=>{open=typeof next==='function'?next(open):next;draw();},applyFocus:()=>{open=false;focus.toggle();},useful:focus.useful,pathname,ReportProblem:()=>report??(report=reportProblem({...context,url:new URL(pathname,context.url.origin)},{floating:true}))}));if(restore)(host.querySelector(restore)??host.querySelector('[data-utilities-launcher]'))?.focus({preventScroll:true});}
 function update(url){const next=url.pathname+url.search;if(pathname===next)return;pathname=next;open=false;report?.dispose?.();report=null;focus.update(url);draw();}
 listen(document,'keydown',e=>{if(e.key==='Escape'&&open){open=false;draw();}},signal);
 listen(document,'pointerdown',e=>{if(open&&!host.contains(e.target)){open=false;draw();}},signal);
 signal.addEventListener('abort',()=>{report?.dispose?.();host.replaceChildren();},{once:true});update(context.url);return {node:host,update};
}
