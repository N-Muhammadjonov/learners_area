import {el,button,card,navBack,link,viewRegion,post,state,safeArray,txt,label,words,uuid,missing,errMessage} from './shared.js';
import {resourceBlocks} from '../live-classes/resources.js';
function practiceMaterials(ctx,p){const nodes=[],blocks=resourceBlocks(ctx,p.materials);if(blocks)nodes.push(blocks);if(p.practice?.title)nodes.push(el('section',{class:'card flex flex-col gap-3 p-5','data-writing-practice-guide':''},el('h2',{class:'font-display text-lg'},p.practice.title),el('ul',{class:'flex flex-col gap-2'},safeArray(p.practice.instructions).map(text=>el('li',{class:'whitespace-pre-line break-words'},text)))));return nodes;}
/** Original history, prompt, submission editor and teacher feedback pages. */
export function mount(ctx){const host=el('main',{'data-writing-native':'',class:'mx-auto max-w-3xl flex flex-col gap-4'});ctx.root.append(host);const parts=ctx.url.pathname.split('/'),mode=parts[3],id=parts[4];if(mode!=='history'&&!uuid(id)){host.append(missing(ctx));return;}
 viewRegion(ctx,host,'writing-'+mode,async data=>{
  if(mode==='history')return renderHistory(ctx,host,data);
  if(mode==='prompts')return renderPrompt(ctx,host,data,id);
  if(mode==='submissions')return renderSubmission(ctx,host,data,id);
 });}
function renderHistory(ctx,host,data){
 const t=ctx.dict.writing,rows=safeArray(data.rows??data.submissions);
 const head=[navBack(ctx),el('h1',{class:'font-display text-2xl'},t.historyTitle)];
 if(!rows.length)head.push(card(el('p',{},ctx.dict.dashboard.noAttemptsYet),link('/app/writing',ctx.dict.dashboard.startWriting,'btn-primary')));
 const links=rows.map(x=>{
  const sub=x.submission??x,p=x.prompt??{},ev=x.evaluation;
  const description=`${p.taskType==='task1'?t.task1:t.task2} · ${t.status?.[sub.status]??sub.status} · ${sub.wordCount??0} ${ctx.dict.common.words}`;
  const details=el('div',{class:'card p-4 flex flex-wrap items-center justify-between gap-3'},
   el('div',{},el('p',{class:'text-sm font-medium'},p.category??''),el('p',{class:'text-xs text-ink-500'},description)),
   ev?el('span',{class:'badge'},ctx.dict.coach.checkedBy+' RIWI'):null);
  return link(`/app/writing/submissions/${sub.id}`,details,'block');
 });
 host.replaceChildren(...head,...links);
}
function renderPrompt(ctx,host,data,id){const p=data.prompt??data.detail?.prompt??data;if(!p||p.id!==id){host.replaceChildren(missing(ctx));return;}
 const start=button(ctx.dict.writing.practiceTitle,async()=>{start.disabled=true;error.textContent='';try{const x=await post(ctx,'/api/writing/submissions',{promptId:id});if(!uuid(x.id))throw Error('Missing id');void ctx.navigate(`/app/writing/submissions/${x.id}`);}catch(e){error.textContent=errMessage(ctx,e);start.disabled=false;}},{signal:ctx.signal,cls:'btn-secondary'}),error=el('p',{role:'alert',class:'writing-error'});
 host.replaceChildren(navBack(ctx,'/app/writing?tab=exam'),card(el('p',{},p.taskType==='task1'?ctx.dict.writing.task1:ctx.dict.writing.task2, ' · ',p.category??''),el('h1',{class:'font-display text-xl'},p.prompt),el('p',{},ctx.dict.writing.target,': ',String(p.targetWordCount),' ',ctx.dict.common.words)),...practiceMaterials(ctx,p),start,error);}
function renderSubmission(ctx,host,data,id){const d=data.detail??data,s=d.submission,p=d.prompt,f=d.feedback,ev=d.evaluation;if(!s||s.id!==id||!p){host.replaceChildren(missing(ctx));return;}
 host.replaceChildren(navBack(ctx,'/app/writing/history'),el('header',{},el('span',{class:'badge'},p.taskType==='task1'?ctx.dict.writing.task1:ctx.dict.writing.task2),el('h1',{class:'font-display text-xl'},p.prompt)));
 host.append(...practiceMaterials(ctx,p));
 if(s.status==='draft'){editor(ctx,host,s,p);return;}
 if(ev){const overview=el('section',{class:'card p-5 flex flex-col gap-3','data-writing-evaluation':''},el('h2',{class:'font-display text-lg'},ctx.dict.coach.checkedBy+' RIWI'));if(ev.overallEstimate!=null)overview.append(el('strong',{class:'text-4xl'},Number(ev.overallEstimate).toFixed(1)));for(const c of safeArray(ev.criteria))overview.append(el('p',{},c.label??c.key,': ',c.limited?ctx.dict.coach.limited:String(c.band??'—')));host.append(overview);}else host.append(card(el('p',{},ctx.dict.coach.noEvaluationNoProvider)));
 if(f?.source==='teacher')host.append(card(el('h2',{class:'font-semibold'},ctx.dict.writing?.feedback??'Feedback'),el('p',{class:'whitespace-pre-line'},f.content??f.body??'')));
}
function editor(ctx,host,submission,prompt){const dict=ctx.dict;let content=submission.content??'',saveTimer=null,revision=0,queue=Promise.resolve(),busy=false,saveState='idle';const field=el('textarea',{class:'input writing-editor',spellcheck:'true','aria-label':dict.writing.wordCount});field.value=content;
 const count=el('span',{class:'text-sm'},''),status=el('span',{role:'status',class:'text-sm text-ink-500'}),error=el('p',{class:'writing-error',role:'alert'});
 function update(){count.textContent=`${dict.writing.wordCount}: ${words(content)} / ${prompt.targetWordCount}`;status.textContent=saveState==='saving'?dict.common.saving:saveState==='saved'?dict.common.saved:'';submit.disabled=busy||words(content)<20;}
 function save(value){saveState='saving';update();const next=queue.then(()=>post(ctx,`/api/writing/submissions/${submission.id}`,{content:value},'PATCH'));queue=next.catch(()=>{});return next.then(()=>{if(content===value){saveState='saved';error.textContent='';}update();},e=>{saveState='idle';error.textContent=errMessage(ctx,e);update();throw e;});}
 field.addEventListener('input',()=>{content=field.value;revision++;saveState='idle';clearTimeout(saveTimer);saveTimer=setTimeout(()=>{void save(content).catch(()=>{});},900);update();},{signal:ctx.signal});
 const submit=button(dict.writing.submit,async()=>{if(busy||words(content)<20)return;if(!window.confirm(dict.writing.submitConfirm))return;busy=true;submit.disabled=true;error.textContent='';clearTimeout(saveTimer);try{await queue;await save(content);await post(ctx,`/api/writing/submissions/${submission.id}/submit`,{},'POST',60000);void ctx.refresh();}catch(e){error.textContent=e.code==='too_short'?dict.writing.tooShortSubmit:errMessage(ctx,e);}finally{busy=false;update();}},{signal:ctx.signal});
 ctx.signal.addEventListener('abort',()=>clearTimeout(saveTimer),{once:true});host.append(field,el('div',{class:'flex flex-wrap items-center justify-between gap-2'},count,status),error,submit);update();}
