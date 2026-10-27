import {el,listen} from '../../js/dom.js';import {render} from '../../js/generated/ShellUtilities.js';import {reportProblem} from '../shared/report.js';
export function shellUtilities(context){
 const {signal,dict}=context,host=el('div',{'data-shell-utilities':''});let pathname=null,open=false,report=null;
 document.documentElement.dataset.focus='off';delete document.documentElement.dataset.retentionFocus;
 try{localStorage.removeItem('la_focus');}catch{}
 function draw(){if(signal.aborted)return;const restore=host.contains(document.activeElement)&&document.activeElement.hasAttribute('data-utilities-launcher');host.replaceChildren(render({dict,on:false,open,setOpen:next=>{open=typeof next==='function'?next(open):next;draw();},useful:false,pathname,ReportProblem:()=>report??(report=reportProblem({...context,url:new URL(pathname,context.url.origin)},{floating:true}))}));if(restore)host.querySelector('[data-utilities-launcher]')?.focus({preventScroll:true});}
 function update(url){if(pathname===url.pathname)return;pathname=url.pathname;open=false;report?.dispose?.();report=null;draw();}
 listen(document,'keydown',e=>{if(e.key==='Escape'&&open){open=false;draw();}},signal);
 listen(document,'pointerdown',e=>{if(open&&!host.contains(e.target)){open=false;draw();}},signal);
 signal.addEventListener('abort',()=>{report?.dispose?.();host.replaceChildren();},{once:true});update(context.url);return {node:host,update};
}
