import {el,listen} from '../../js/dom.js';

/** Native, keyboard-operable help. Never blocks the workflow or invents completion. */
export function pageGuide(ctx,{key,title,steps,example}){
 const uz=ctx.locale==='uz',body=el('div',{class:'space-y-3'}),progress=el('p',{role:'status','aria-live':'polite'});
 const previous=el('button',{type:'button',class:'btn-secondary'},uz?'Oldingi':'Previous');
 const next=el('button',{type:'button',class:'btn-secondary'},uz?'Keyingi':'Next');
 const close=el('button',{type:'button',class:'btn-secondary'},uz?'Yopish':'Close');
 const summary=el('summary',{class:'cursor-pointer font-semibold'},title);
 const node=el('details',{class:'card space-y-3 p-4','data-page-guide':key},summary,progress,body,
  el('div',{class:'flex flex-wrap gap-2'},previous,next,close),
  el('details',{},el('summary',{class:'cursor-pointer'},uz?'Amaliy misol':'Worked example'),el('p',{},example)));
 let step=0;
 function paint(){progress.textContent=`${step+1} / ${steps.length}`;body.replaceChildren(el('p',{},steps[step]));previous.disabled=step===0;next.disabled=step===steps.length-1;}
 listen(previous,'click',()=>{step--;paint();},ctx.signal);
 listen(next,'click',()=>{step++;paint();},ctx.signal);
 listen(close,'click',()=>{node.open=false;summary.focus();},ctx.signal);
 paint();return node;
}
