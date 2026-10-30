/** Current-main (b62b78f) per-student LearningSummary + ResultHistory.
 * Independent from mock overview: a failure here cannot erase completed mocks. */
import {el,listen,centreDateTime,put} from './kit.js';
import {RESULT_MODULES,learningHistory} from '../../js/adapters/staff-final30/statistics.js';
import {moduleCards,statText} from './statistics.js';
function historyHref(base,module,page){const q=new URLSearchParams();if(module)q.set('module',module);q.set('page',String(page));return `${base}?${q}#result-history`;}
export function renderHistory(ctx,history,base){
 const t=statText(ctx),dict=ctx.dict,studentId=base.split('/').filter(Boolean).at(-1);
 const detailHref=r=>['reading','listening','speaking','mocks'].includes(r.module)?`/app/teacher/assessments/${studentId}/${r.module}/${r.id}`:r.module==='writing'?`/app/teacher/students/${studentId}?submission=${r.id}#submission-${r.id}`:null;
 const nav=el('nav',{class:'flex flex-wrap gap-2'},el('a',{href:historyHref(base,null,1),class:'chip'},t.all),RESULT_MODULES.map(m=>el('a',{href:historyHref(base,m,1),class:history.module===m?'chip chip-active':'chip'},t.modules[m])));
 const table=el('table',{class:'w-full text-left text-sm'},
  el('thead',{},el('tr',{},[t.date,t.source,t.result,t.state].map(s=>el('th',{scope:'col'},s)))),
  el('tbody',{},history.rows.map(r=>el('tr',{class:'border-b border-ink-100'},
   el('td',{class:'py-3 pr-3 whitespace-nowrap'},r.at?centreDateTime(new Date(r.at),ctx.locale):'—'),
   el('td',{class:'pr-3'},detailHref(r)?el('a',{href:detailHref(r),class:'underline'},`${t.modules[r.module]} · ${t.activities[r.activity]??t.source}`):`${t.modules[r.module]} · ${t.activities[r.activity]??t.source}`,r.title?el('span',{class:'block text-xs text-ink-500'},r.title):null),
   el('td',{class:'pr-3 whitespace-nowrap'},r.completed&&r.score!=null&&r.maximum?`${r.score.toFixed(1)} / ${r.maximum}${r.unit==='band'?' band':` · ${(r.score/r.maximum*100).toFixed(1)}%`}`:t.notGraded),
   el('td',{},r.completed?t.completed:t.ongoing)))));
 const pages=history.pages>1?el('nav',{class:'flex items-center justify-between gap-3'},el('span',{},`${history.page} / ${history.pages}`),el('div',{class:'flex gap-2'},
  history.page>1?el('a',{href:historyHref(base,history.module,history.page-1),class:'btn-secondary'},dict.people.previousPage):null,
  history.page<history.pages?el('a',{href:historyHref(base,history.module,history.page+1),class:'btn-secondary'},dict.people.nextPage):null)):null;
 return el('section',{id:'result-history',class:'card min-w-0 space-y-4 p-4','data-result-history':''},el('h2',{class:'font-display text-2xl'},`${t.history} · ${history.total}`),nav,
  history.rows.length?el('div',{class:'overflow-x-auto'},table):el('p',{},t.empty),pages);
}
export function studentLearningPanel(ctx,id,baseHref){
 const {signal,dict}=ctx,t=statText(ctx),host=el('div',{class:'min-w-0 space-y-6','data-student-learning':''});
 let seq=0,request;
 function cancel(){seq++;request?.abort();}
 async function load(){
  cancel();const seqNow=seq;request=new AbortController();
  const linked=()=>request?.abort();signal.addEventListener('abort',linked,{once:true});
  const module=RESULT_MODULES.includes(ctx.url.searchParams.get('module'))?ctx.url.searchParams.get('module'):null;
  const number=Number(ctx.url.searchParams.get('page'));
  const page=Number.isSafeInteger(number)&&number>0?number:1;
  host.replaceChildren(el('div',{class:'h-40 animate-pulse rounded-xl bg-ink-50',role:'status','aria-label':dict.common.loading},dict.common.loading));
  try{
   const data=await learningHistory(id,module,page,request.signal);
   if(signal.aborted||request.signal.aborted||seqNow!==seq||!host.isConnected)return;
   host.replaceChildren(moduleCards(t,data.summary,data.history.module,baseHref),renderHistory(ctx,data.history,baseHref));
  }catch{
   if(signal.aborted||request.signal.aborted||seqNow!==seq||!host.isConnected)return;
   const button=el('button',{type:'button',class:'btn-secondary'},dict.common.retry);
   listen(button,'click',()=>void load(),signal);
   host.replaceChildren(el('div',{class:'panel space-y-3','data-student-learning-unavailable':'',role:'alert'},el('p',{},dict.auth.errorServer),button));
  }finally{signal.removeEventListener('abort',linked);}
 }
 signal.addEventListener('abort',()=>{cancel();host.remove();},{once:true});
 queueMicrotask(()=>{if(host.isConnected&&!signal.aborted)void load();});
 return host;
}
