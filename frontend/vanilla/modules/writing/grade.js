import {formatDateTime} from '../../js/generated/time.js';
import {gradeForm} from './grade-form.js';
import {el,button,card,navBack,link,viewRegion,post,state,safeArray,txt,label,words,uuid,missing,errMessage,fill} from './shared.js';
/** Original Grade My Work: a draft-bound idempotency key and server-owned evaluation. */
export function mountTab(ctx,root){
 const host=el('section',{'data-writing-grade':'',class:'flex flex-col gap-4'});root.append(host);
 viewRegion(ctx,host,'writing-grade-home',data=>{
  const t=ctx.dict.writingWorkspace.grade,essays=ctx.url.searchParams.get('view')==='essays';
  const nav=el('nav',{class:'flex gap-4 border-b border-ink-100 text-sm','aria-label':t.eyebrow});
  for(const [key,text,href]of [['new',t.newSubmission,'/app/writing?tab=grade'],['essays',t.myEssays,'/app/writing?tab=grade&view=essays']]){const active=essays===(key==='essays');nav.append(el('a',{href,'aria-current':active?'page':null,...(key==='essays'?{'data-grade-my-essays':''}:{}),class:`min-h-11 border-b-2 px-1 py-2 ${active?'border-signal-600 font-semibold text-ink-900':'border-transparent text-ink-500'}`},text));}
  host.replaceChildren(el('header',{},el('p',{class:'text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400'},t.eyebrow),el('h2',{class:'font-display text-xl text-ink-900'},t.title),el('p',{class:'mt-1 text-base text-ink-500'},t.body)),nav);
  if(data.aiReady===false)host.append(el('p',{role:'status',class:'rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-ink-700 dark:bg-amber-950/30','data-grade-ai-unavailable':''},t.aiUnavailable));
  if(essays){const rows=safeArray(data.essays??data.rows);host.append(rows.length?el('ul',{'data-grade-essays':'',class:'flex flex-col gap-2'},rows.map(e=>el('li',{},el('a',{href:`/app/writing/grade/${e.id}`,class:'card flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-paper-sunken'},el('span',{class:'min-w-0 flex-1'},el('span',{class:'block text-xs text-ink-500'},`${e.taskType==='task1'?ctx.dict.writing.task1:ctx.dict.writing.task2} · ${formatDateTime(e.createdAt,ctx.locale)} · ${fill(t.words,{n:e.wordCount})}`),el('span',{class:'block truncate text-base text-ink-900'},e.questionText)),el('span',{class:'text-sm font-semibold text-ink-900'},typeof e.overall==='number'?e.overall.toFixed(1):t.status[e.status]??e.status))))):el('p',{class:'text-base text-ink-500'},t.noEssays));return;}
  const form=el('div',{class:'card p-5'}),help=el('aside',{class:'card h-fit p-5 text-sm text-ink-700','data-grade-how':''},el('p',{class:'mb-2 font-semibold text-ink-900'},t.howTitle),el('ul',{class:'list-disc space-y-1 pl-5'},t.how.map(text=>el('li',{},text))));
  host.append(el('div',{class:'grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]'},form,help));gradeForm(ctx,form,safeArray(data.task1Prompts??data.prompts));
 });
}
export function mount(ctx){const id=ctx.url.pathname.split('/')[4],host=el('main',{'data-writing-native':'','data-route-usable':'writing-grade-result',class:'mx-auto max-w-6xl flex flex-col gap-5'});ctx.root.append(host);if(!uuid(id)){host.append(missing(ctx));return;}viewRegion(ctx,host,'writing-grade-result',data=>{const v=data.view??data.grade??data,req=v.request,ev=v.evaluation,a=v.analysis;if(!req||req.id!==id){host.replaceChildren(missing(ctx));return;}const t=ctx.dict.writingWorkspace.grade,g=ctx.dict.writingWorkspace.gradeExtra;
 const fl=['uz','en'].includes(ctx.url.searchParams.get('fl'))?ctx.url.searchParams.get('fl'):(ctx.locale==='uz'?'uz':'en'),other=fl==='uz'?'en':'uz';
 host.replaceChildren(navBack(ctx,'/app/writing?tab=grade&view=essays'),el('header',{},el('p',{class:'text-xs uppercase text-signal-600'},req.taskType==='task1'?ctx.dict.writing.task1:ctx.dict.writing.task2),el('h1',{class:'font-display text-2xl'},t.examinerComment),el('p',{},fill(t.words,{n:req.wordCount}))),a?link(`/app/writing/grade/${id}?fl=${other}`,t.feedbackIn?.[other]??other,'btn-secondary'):null);
 if(!ev){const retry=button(t.retry,async()=>{retry.disabled=true;try{const response=await post(ctx,`/api/writing/grade/${id}`,{},'POST',60000);if(response.ok===false)alert.textContent=t.failedBody;void ctx.refresh();}catch(e){alert.textContent=errMessage(ctx,e);retry.disabled=false;}},{signal:ctx.signal}),alert=el('p',{role:'alert',class:'writing-error'});host.append(card(el('h2',{class:'font-semibold'},req.status==='pending'?t.pendingTitle:t.failedTitle),el('p',{},req.lastError==='external_required'?t.aiUnavailable:t.failedBody),req.lastError==='external_required'?null:retry,alert,el('details',{},el('summary',{},t.yourEssay),el('p',{class:'whitespace-pre-line'},req.essayText))));return;}
 const scores=el('section',{'data-grade-scores':'',class:'writing-groups'},[el('div',{class:'writing-criterion','data-grade-overall':''},el('strong',{class:'text-4xl'},ev.overallEstimate!=null?Number(ev.overallEstimate).toFixed(1):'—'),el('span',{},t.overall)),...safeArray(ev.criteria).map(c=>el('div',{class:'writing-criterion','data-grade-criterion':c.key},el('strong',{class:'text-3xl'},c.band==null?'—':Number(c.band).toFixed(1)),el('span',{},t.criterion?.[c.key]??c.label))) ]);host.append(scores,el('p',{class:'text-xs text-ink-500'},t.estimateLabel));
 if(a){host.append(card(el('h2',{class:'font-display text-lg'},t.examinerComment),el('p',{},a.examinerComment?.[fl]??'')));for(const n of safeArray(a.criterionNarratives))host.append(card(el('h3',{class:'font-semibold'},t.criterion?.[n.key]??n.key),el('p',{},n.narrative?.[fl]??''),el('ul',{class:'list-disc pl-4'},safeArray(n.evidence).map(e=>el('li',{},e)))));
  if(a.sentenceFeedback?.length){
   const rows=a.sentenceFeedback.map(s=>el('li',{id:`sf-${s.index}`,class:'rounded border p-3'},
    el('p',{},`#${s.index} ${s.original}`),el('p',{class:'text-band-good'},s.improved),el('p',{},s.note?.[fl]??'')));
   host.append(card(el('h2',{class:'font-display text-lg'},t.sentences),
    el('ol',{class:'flex flex-col gap-3','data-grade-sentences':''},rows)));
  }
  if(a.topFixes?.length)host.append(card(el('h2',{class:'font-display text-lg'},t.topFixes),...a.topFixes.map(f=>el('p',{},f.title?.[fl],': ',f.explanation?.[fl]))));}
 else host.append(el('p',{},t.noAnalysis));});}
