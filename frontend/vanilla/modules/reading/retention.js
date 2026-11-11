import {el,listen} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {readingRetentionDTO} from '../../js/adapters/reading-v44.js';
import {api} from '../../js/api-client.js';
import {formatDateTime} from '../../js/generated/time.js';
import {clickableText} from '../vocabulary/clickable-text.js';
import {RegionFailureNotice} from '../shared/presentation.js';
/** Original src/app/app/(shell)/reading/retention/page.tsx + RetentionWorkspace + RetentionSession + RetentionHistory.
 * The server owns every deadline: the countdown is the server's timestamps plus the measured clock skew. The source
 * text leaves state the moment the reading window closes (the awaiting phase keeps only ids and deadlines). The
 * recall draft autosaves; submit is confirmed by the server before the result shows. Every POST is sent once. */
const LEVELS=['A2','B1','B2','C1','C2'],TARGET={A2:110,B1:175,B2:260,C1:300,C2:415},READ_SECONDS=120;
const clock=s=>{const safe=Math.max(0,s);return `${Math.floor(safe/60)}:${String(Math.floor(safe%60)).padStart(2,'0')}`;};
const remaining=(iso,skew)=>iso?Math.ceil((Date.parse(iso)-(Date.now()+skew))/1000):0;
export function mountRetention(context){
 const {root,url,signal,dict,locale}=context,t=dict.retentionMemory,host=el('div',{class:'mx-auto flex max-w-6xl flex-col gap-6','data-retention-page':true,'data-route-usable':'retention','data-native-view':'retention'});
 root.append(host);let busy=false;
 document.documentElement.dataset.focus='off';delete document.documentElement.dataset.retentionFocus;
 context={...context,retentionActive:()=>{}};
 // The summary and history nodes shown beside the session. A finished attempt re-reads only these two (the original router.refresh()),
 // so the learner keeps the result on screen and the overview is current.
 const overview={summary:null,history:null};
 async function refreshOverview(){
  try{
   const raw=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
   const data=readingRetentionDTO(raw);
   if(overview.summary?.isConnected){const next=summaryPanel(context,data);overview.summary.replaceWith(next);overview.summary=next;}
   if(overview.history?.isConnected){const next=historySection(context,data.history);overview.history.replaceWith(next);overview.history=next;}
  }catch{
   if(signal.aborted)return;
   if(overview.summary?.isConnected){const next=RegionFailureNotice({region:'retention-summary',message:dict.retentionMemory.errors.retention_unavailable,retryLabel:dict.errorPage.retry,refresh:refreshOverview});overview.summary.replaceWith(next);overview.summary=next;}
  }
 }
 async function load(){
  if(busy||signal.aborted)return;busy=true;
  host.replaceChildren(el('p',{class:'panel meta-text',role:'status','aria-busy':'true'},dict.common.loading));
  try{
   const raw=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
   const data=readingRetentionDTO(raw);
   if(isActive(data.initial)){
    if(!url.searchParams.has('overview')){void context.navigate('/app/reading/retention/session',{replace:true});return;}
    const continueButton=el('a',{href:'/app/reading/retention/session',class:'btn-primary w-fit','data-retention-resume':''},'Mashqni davom ettirish →');
    host.replaceChildren(el('section',{class:'panel flex flex-col gap-4','data-retention-active-overview':''},
     el('h2',{class:'section-title'},t.readingTitle),continueButton),
     summaryPanel(context,data),historySection(context,data.history));
    return;
   }
   host.replaceChildren(session(context,data,{overview,refreshOverview}));
  }catch(e){
   if(signal.aborted)return;
   host.replaceChildren(RegionFailureNotice({region:'retention',message:dict.auth.errorServer,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }finally{busy=false;}
 }
 void load();
 void locale;
}
/** Retention test uses its own route and Back control, not the catalogue panel. */
export function mountRetentionSession(context){
 const {root,signal,dict,navigate}=context;
 const host=el('div',{class:'mx-auto flex max-w-6xl flex-col gap-4','data-retention-page':'session','data-route-usable':'retention-session'});
 root.append(host);
 async function load(){
  if(signal.aborted)return;
  host.replaceChildren(el('p',{class:'panel meta-text',role:'status','aria-busy':'true'},dict.common.loading));
  try{
   const response=await api.request('/api/retention/attempts',{signal,fresh:true});
   if(signal.aborted)return;
   const active=response?.active??null;
   if(!isActive(active)){void navigate('/app/reading/retention',{replace:true});return;}
   const back=el('a',{href:'/app/reading/retention?overview=1',class:'btn-ghost inline-flex min-h-11 w-fit items-center gap-1','data-back-link':''},'← ',dict.common.back);
   back.setAttribute('data-retention-session-back','');
   host.replaceChildren(back,el('section',{class:'panel','data-retention-session-region':''},
    retentionSession(context,active,()=>{})));
  }catch{
   if(!signal.aborted)host.replaceChildren(RegionFailureNotice({region:'retention-session',message:dict.retentionMemory.errors.retention_unavailable,retryLabel:dict.errorPage.retry,refresh:load}));
  }
 }
 void load();
}

const isActive=p=>!!p&&p.phase!=='completed'&&p.phase!=='timed_out';
function session(context,data,slots){
 const {dict}=context,t=dict.retentionMemory;
 const active=isActive(data.initial);
 const sessionRegion=el('section',{class:'panel','data-retention-session-region':true},data.sessionFailed?RegionFailureNotice({region:'retention-session',message:t.errors.retention_unavailable,retryLabel:dict.errorPage.retry,refresh:()=>context.refresh()}):retentionSession(context,data.initial,slots.refreshOverview));
 const summary=summaryPanel(context,data);
 slots.overview.summary=active?null:summary;
 const overview=el('aside',{class:'flex flex-col gap-4'},summary,
  el('section',{class:'panel flex flex-col gap-3','data-retention-instructions':true},el('h2',{class:'section-title'},t.howTitle),el('ol',{class:'list-decimal space-y-3 pl-5 body-text'},el('li',{},t.readingHint),el('li',{},t.recallHint),el('li',{},t.resultHint))));
 const history=historySection(context,data.history);
 slots.overview.history=active?null:history;
 return el('div',{class:'flex flex-col gap-6','data-retention-workspace':active?'active':'entry'},
  el('div',{class:active?'min-w-0':'retention-hub-grid'},sessionRegion,active?null:overview),
  active?null:history);
}
function summaryPanel(context,data){
 const t=context.dict.retentionMemory;
 if(!data.summary)return RegionFailureNotice({region:'retention-summary',message:t.errors.retention_unavailable,retryLabel:context.dict.errorPage.retry,refresh:()=>context.refresh()});
 const s=data.summary;
 return el('section',{class:'panel flex flex-col gap-4','data-retention-summary':true,'data-async-content':'retention-summary'},el('h2',{class:'section-title'},t.summaryTitle),
  el('dl',{class:'retention-summary-grid'},
   el('div',{},el('dd',{'data-retention-summary-best':true},String(s.bestScore??'—')),el('dt',{},t.summaryBestLabel)),
   el('div',{},el('dd',{'data-retention-summary-completed':true},String(s.completedCount)),el('dt',{},t.summaryCompletedLabel)),
   el('div',{},el('dd',{'data-retention-summary-average':true},String(s.lastTenAverage??'—')),el('dt',{},t.summaryAverageLabel))),
  s.lastTenCount===0?el('p',{class:'meta-text'},t.summaryNoResults):null);
}
function historySection(context,history){
 const {dict}=context,t=dict.retentionMemory;
 return el('section',{class:'flex flex-col gap-3','data-retention-history-section':true},el('h2',{class:'section-title'},t.historyTitle),history?historyList(context,history):RegionFailureNotice({region:'retention-history',message:t.errors.retention_unavailable,retryLabel:dict.errorPage.retry,refresh:()=>context.refresh()}));
}
/** Original RetentionHistory: bounded, owner-scoped pages; "load more" appends by attempt id. */
function historyList(context,initial){
 const {dict,signal}=context,t=dict.retentionMemory,locale=context.locale;
 const wrap=el('div',{class:'flex flex-col gap-3',id:'retention-history','data-retention-history':true});
 let data={rows:[...initial.rows],page:initial.page,pageCount:initial.pageCount,total:initial.total},busyMore=false,failed=false,requests=0;
 const draw=()=>{
  const rows=data.rows.length===0?el('p',{class:'body-text','data-retention-history-empty':true},t.historyEmpty):el('ul',{class:'flex flex-col gap-2'},data.rows.map(row=>el('li',{class:'panel flex flex-wrap items-center justify-between gap-3','data-retention-history-row':row.attemptId},
   el('span',{class:'flex flex-col gap-1'},el('span',{class:'body-text'},`${row.level}${row.label?` · ${row.label}`:''} · ${row.status==='timed_out'?t.historyTimedOut:t.historyCompleted}`),
    el('span',{class:'meta-text'},el('time',{datetime:row.completedAt??row.createdAt,'data-retention-history-when':true},formatDateTime(row.completedAt??row.createdAt,locale)),typeof row.recallWordCount==='number'?` · ${t.historyWords.replace('{n}',String(row.recallWordCount))}`:'')),
   el('span',{class:'flex items-center gap-3'},el('span',{class:'meta-text','data-retention-history-score':row.score??'unavailable'},`${row.score??'—'} / 100`),el('a',{class:'btn-secondary',href:`/app/reading/retention/results/${row.attemptId}`,'data-retention-history-open':row.attemptId},t.historyOpen)))));
  wrap.replaceChildren(...[rows,failed?el('p',{role:'alert',class:'text-sm text-band-bad'},t.errors.retention_unavailable):null,
   data.page<data.pageCount?(()=>{const b=el('button',{type:'button',class:'btn-secondary w-fit','data-retention-history-more':true,disabled:busyMore?true:null},busyMore?dict.common.loading:failed?dict.errorPage.retry:t.historyLoadMore);b.addEventListener('click',()=>void more());return b;})():null,
   el('span',{class:'meta-text','data-retention-history-page':true},t.historyPage.replace('{page}',String(data.page)).replace('{pages}',String(data.pageCount)))].filter(Boolean));
 };
 async function more(){
  if(busyMore||data.page>=data.pageCount)return;busyMore=true;failed=false;draw();
  const ctl=new AbortController();const stop=()=>ctl.abort();signal.addEventListener('abort',stop,{once:true});const deadline=setTimeout(stop,10000);
  try{
   const next=await api.request(`/api/retention/history?page=${data.page+1}`,{signal:ctl.signal});
   if(!Array.isArray(next?.rows)||next.page!==data.page+1)throw new Error('history_invalid');
   const merged=new Map([...data.rows,...next.rows].map(r=>[r.attemptId,r]));
   data={rows:[...merged.values()],page:next.page,pageCount:next.pageCount,total:next.total};
  }catch{if(!signal.aborted)failed=true;}
  finally{clearTimeout(deadline);signal.removeEventListener('abort',stop);busyMore=false;if(!signal.aborted)draw();}
 }
 draw();requests++;void requests;
 return wrap;
}
/** Original RetentionSession. Entry (levels) → reading → awaiting_recall → recall → result. */
function retentionSession(context,initial,onTerminal){
 const {dict,signal,navigate,refresh}=context,t=dict.retentionMemory;
 const terminalSeen=new Set();
 const host=el('div',{'data-retention-session':true});
 const state={payload:initial,selected:'A2',busy:false,error:null,unknown:false,rechecking:false,refreshFailed:false,skew:initial?Date.parse(initial.serverNow)-Date.now():0};
 let ticker=null,poll=null,inFlight=null;
 const alive=()=>!signal.aborted;
 signal.addEventListener('abort',()=>{clearInterval(ticker);clearInterval(poll);},{once:true});
 const errorText=code=>(code&&t.errors[code])||t.errors.retention_unavailable;
 const banner=msg=>el('p',{class:'panel border-signal-300 text-sm text-signal-700',role:'alert','data-retention-error':true},msg);
 function setPayload(next){state.payload=next;if(next?.serverNow)state.skew=Date.parse(next.serverNow)-Date.now();draw();
  if((next?.phase==='completed'||next?.phase==='timed_out')&&!terminalSeen.has(next.attemptId)){terminalSeen.add(next.attemptId);void onTerminal?.();}}
 async function start(level){
  if(state.busy||state.unknown)return;state.busy=true;state.error=null;draw();
  const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),12000);
  try{const body=await api.request('/api/retention/attempts',{method:'POST',body:{level},signal:ctl.signal});if(!alive())return;
   if(body?.attemptId&&body?.phase){void navigate('/app/reading/retention/session');return;}
   state.error=t.startUnknownOutcome;}
  catch(e){if(!alive())return;if(e?.code&&e.status&&e.status<500){state.error=errorText(e.code);}else{state.unknown=true;state.error=t.startUnknownOutcome;void recheck();}}
  finally{clearTimeout(timer);state.busy=false;if(alive())draw();}
 }
 async function recheck(){
  if(state.rechecking||!alive())return;state.rechecking=true;draw();
  try{const body=await api.request('/api/retention/attempts',{signal});if(!alive())return;state.unknown=false;state.error=null;if(body.active)void navigate('/app/reading/retention/session');}
  catch{if(alive())state.error=t.startUnknownOutcome;}
  finally{state.rechecking=false;if(alive())draw();}
 }
 async function refreshPhase(){
  if(!state.payload||inFlight)return;const id=state.payload.attemptId;
  inFlight=api.request(`/api/retention/attempts/${id}`,{signal}).then(body=>{if(!alive())return;state.refreshFailed=false;
    const cur=state.payload;if(!cur||cur.attemptId!==id)return;
    // A reading payload never comes back once the source has left the screen (a poll that started earlier can arrive late).
    if(body.phase==='reading'&&cur.phase!=='reading')return;
    setPayload(body);},()=>{if(alive()){state.refreshFailed=true;draw();}}).finally(()=>{inFlight=null;});
 }
 async function finishReading(){
  if(!state.payload||state.payload.phase!=='reading')return;
  if(!window.confirm(t.finishReadingConfirm))return;
  const id=state.payload.attemptId;
  setPayload(toSourceFree(state.payload));
  try{const body=await api.request(`/api/retention/attempts/${id}/finish-reading`,{method:'POST',signal});if(!alive())return;
   const cur=state.payload;if(cur&&cur.attemptId===id&&body.phase!=='reading')setPayload(body);}
  catch{if(alive()){state.refreshFailed=true;draw();}}
 }
 function toSourceFree(p){return {attemptId:p.attemptId,level:p.level,label:p.label,readStartedAt:p.readStartedAt,readEndsAt:p.readEndsAt,writeStartedAt:p.writeStartedAt,writeEndsAt:p.writeEndsAt,serverNow:p.serverNow,phase:'awaiting_recall'};}
 function onExpired(){const cur=state.payload;if(cur&&cur.phase==='reading')setPayload(toSourceFree(cur));}
 // Clock: every quarter second only the countdown text changes; phase changes redraw.
 ticker=setInterval(()=>{if(!alive())return;const p=state.payload;if(p&&p.phase==='reading'){const s=remaining(p.readEndsAt,state.skew);const node=host.querySelector('[data-retention-reading-timer]');if(node){node.textContent=`${t.readingTimeLeft} ${clock(s)}`;node.dataset.retentionReadingTimer=String(s);}if(s<=0)onExpired();}
  else if(p&&p.phase==='recall'){const s=remaining(p.writeEndsAt,state.skew);const node=host.querySelector('[data-retention-write-timer]');if(node){node.textContent=`${t.recallTimeLeft} ${clock(s)}`;node.dataset.retentionWriteTimer=String(s);}if(s<=0)recallExpired();}},250);
 poll=setInterval(()=>{if(alive()&&state.payload?.phase==='awaiting_recall')void refreshPhase();},2000);
 let recallExpiredFired=false;
 function recallExpired(){if(recallExpiredFired)return;recallExpiredFired=true;submitRecall();}
 let draftText='',lastSaved='',saveState='idle',submitting=false,draftTimer=null;
 async function saveDraft(value){
  saveState='saving';draw({keep:true});
  try{const r=await fetch(`/api/retention/attempts/${state.payload.attemptId}/draft`,{method:'PATCH',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({recallText:value}),signal});
   if(!r.ok){saveState='failed';}else{lastSaved=value;saveState='saved';}}
  catch{if(alive())saveState='failed';}
  if(alive())draw({keep:true});
 }
 async function submitRecall(){
  if(submitting||!state.payload||state.payload.phase!=='recall')return;submitting=true;clearTimeout(draftTimer);draw();
  try{const r=await fetch(`/api/retention/attempts/${state.payload.attemptId}/submit`,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({recallText:draftText}),signal});
   if(!r.ok){saveState='failed';submitting=false;draw();return;}
   const result=await r.json();
   if(result.phase!=='completed'&&result.phase!=='timed_out'){saveState='failed';submitting=false;draw();return;}
   submitting=false;setPayload(result);
  }catch{if(alive()){saveState='failed';submitting=false;draw();}}
 }
 function draw({keep=false}={}){
  if(!alive())return;
  const active=host.contains(document.activeElement)?document.activeElement:null;const focusId=active?.id??null;
  const caret=active&&typeof active.selectionStart==='number'?{start:active.selectionStart,end:active.selectionEnd}:null;
  const p=state.payload;context.retentionActive?.(isActive(p));let node;
  if(!p){node=entry();}
  else if(p.phase==='reading')node=readingPhase(p);
  else if(p.phase==='awaiting_recall')node=awaitingPhase(p);
  else if(p.phase==='recall')node=recallPhase(p);
  else node=resultPhase(p);
  for(const old of host.querySelectorAll('[data-highlight-host]'))old.stop?.();
  host.replaceChildren(node);
  const source=host.querySelector('[data-retention-source]');if(source)source.dataset.highlightHost='';
  if(focusId){const n=document.getElementById(focusId);n?.focus?.({preventScroll:true});if(caret&&n&&typeof n.setSelectionRange==='function')try{n.setSelectionRange(caret.start,caret.end);}catch{}}
 }
 function entry(){
  const wrap=el('div',{class:'flex flex-col gap-4','data-retention-levels':true},el('div',{class:'flex flex-col gap-1'},el('h2',{class:'section-title'},t.levelsTitle),el('p',{class:'body-text'},t.levelHint)),
   state.error?banner(state.error):null,
   state.unknown?(()=>{const b=el('button',{type:'button',class:'btn-secondary','data-retention-recover-start':true,disabled:state.rechecking?true:null},t.checkActiveAttempt);b.addEventListener('click',()=>void recheck());return b;})():null);
  const list=el('div',{class:'retention-level-options',role:'group','aria-label':t.levelsTitle,'data-retention-level-list':true},LEVELS.map(level=>{
   const b=el('button',{type:'button',class:'retention-level-option','aria-pressed':state.selected===level?'true':'false',disabled:state.busy?true:null,'data-retention-level':level},el('strong',{},level),el('span',{class:'meta-text'},t.words.replace('{n}',String(TARGET[level]))),el('span',{class:'meta-text'},clock(READ_SECONDS)));
   b.addEventListener('click',()=>{state.selected=level;draw();});return b;}));
  const go=el('button',{type:'button',class:'btn-primary w-fit','data-retention-start':state.selected,disabled:state.busy||state.unknown?true:null},`${state.busy?dict.common.loading:t.start} →`);
  go.addEventListener('click',()=>void start(state.selected));
  wrap.append(list,go);
  return wrap;
 }
 function readingPhase(p){
  const s=remaining(p.readEndsAt,state.skew);
  const timer=el('span',{class:'tab',role:'timer','aria-live':'off','data-retention-reading-timer':String(s)},`${t.readingTimeLeft} ${clock(s)}`);
  const finish=el('button',{type:'button',class:'btn-primary','data-retention-finish-reading':true,disabled:s<=0?true:null},t.finishReading);
  finish.addEventListener('click',()=>void finishReading());
  const reading=el('div',{class:'flex flex-col gap-4','data-retention-phase':'reading','data-retention-attempt':p.attemptId},
   el('div',{class:'flex flex-wrap items-center justify-between gap-3'},el('h2',{class:'section-title'},t.readingTitle),timer),
   el('p',{class:'body-text'},t.readingHint),
   s>0?el('article',{class:'academic-text retention-source whitespace-pre-line text-[1.05rem] leading-8 text-ink-800','data-retention-source':true},retentionText(context,{text:p.bodyText,sourceType:'retention',sourceId:p.attemptId,occurrences:p.occurrences??[],phraseAware:true,doubleClickLookup:true}).node):el('p',{class:'panel',role:'status','data-retention-phase-pending':true},dict.common.loading),
   el('div',{class:'flex items-center justify-between gap-3'},el('span',{class:'meta-text'},t.readingWords.replace('{n}',String(p.wordCount))),el('div',{class:'flex flex-wrap gap-2'},finish)));
  const article=reading.querySelector('[data-retention-source]');
  if(article){for(const event of ['copy','cut','dragstart','contextmenu'])listen(article,event,e=>e.preventDefault(),signal);}
  return reading;
 }
 function awaitingPhase(p){
  if(!poll_started){poll_started=true;void refreshPhase();}
  const retry=el('button',{type:'button',class:'btn-secondary','data-retention-phase-retry':true},dict.errorPage.retry);retry.addEventListener('click',()=>void refreshPhase());
  const leave=el('button',{type:'button',class:'btn-secondary w-fit','data-retention-leave':true},t.resultBack);leave.addEventListener('click',()=>{state.payload=null;draw();});
  return el('div',{class:'flex flex-col gap-4','data-retention-phase':'awaiting_recall','data-retention-attempt':p.attemptId},el('h2',{class:'section-title'},t.readingTitle),el('p',{class:'panel',role:'status','data-retention-phase-pending':true},dict.common.loading),
   state.refreshFailed?el('div',{class:'flex flex-wrap items-center gap-3',role:'alert','data-retention-phase-refresh-failed':true},el('p',{class:'body-text'},t.errors.retention_unavailable),retry):null,leave);
 }
 let poll_started=false;
 function recallPhase(p){
  const s=remaining(p.writeEndsAt,state.skew);
  if(!draftLoaded){draftLoaded=true;draftText=p.recallDraft??'';lastSaved=draftText;}
  const expired=s<=0;
  const area=el('textarea',{id:'retention-recall-answer',class:'input w-full',style:{display:'block',boxSizing:'border-box',width:'100%',maxWidth:'100%',height:'clamp(10rem, 24vh, 15rem)',minHeight:'10rem',maxHeight:'20rem',resize:'vertical'},readonly:(submitting||expired)?true:null,placeholder:t.recallPlaceholder,'aria-label':t.recallTitle,'data-retention-answer':true});
  area.value=draftText;
  area.addEventListener('input',()=>{if(submitting||expired)return;draftText=area.value;clearTimeout(draftTimer);if(draftText!==lastSaved){draftTimer=setTimeout(()=>void saveDraft(draftText),1200);}draftCounter();submit.disabled=draftText.trim().length===0;});
  const count=el('span',{class:'meta-text','aria-live':'polite','data-retention-save-state':saveState},
   saveState==='saving'?t.recallSaving:saveState==='saved'?t.recallSaved:saveState==='failed'?t.recallSaveFailed:t.recallWordCount.replace('{n}',String(words(draftText))));
  countNode=count;
  const submit=el('button',{type:'button',class:'btn-primary','data-retention-submit':true,disabled:submitting||draftText.trim().length===0?true:null},submitting?t.recallSubmitting:t.recallSubmit);
  submit.addEventListener('click',()=>void submitRecall());
  if(expired&&!recallExpiredFired)recallExpired();
  return el('div',{class:'flex flex-col gap-4','data-retention-phase':'recall','data-retention-attempt':p.attemptId},
   el('div',{class:'flex flex-wrap items-center justify-between gap-3'},el('h2',{class:'section-title'},t.recallTitle),el('span',{class:'tab',role:'timer','data-retention-write-timer':String(s)},`${t.recallTimeLeft} ${clock(s)}`)),
   el('p',{class:'body-text'},t.recallHint),area,
   el('div',{class:'flex flex-wrap items-center justify-between gap-3'},count,submit));
 }
 let draftLoaded=false,countNode=null;
 function draftCounter(){if(countNode&&countNode.isConnected&&saveState!=='saving')countNode.textContent=t.recallWordCount.replace('{n}',String(words(draftText)));}
 function resultPhase(p){return resultView(context,p,()=>void refresh());}
 function words(text){const m=String(text).trim().match(/\S+/g);return m?m.length:0;}
 draw();
 void navigate;
 return host;
}

/** The result view, shared by the session and the owner-scoped permalink page. */
 export function resultView(context,p,onAnother){
  const {dict}=context,t=dict.retentionMemory;
  const d=p.breakdown.totals;
  const readAllocated=Date.parse(p.readEndsAt)-Date.parse(p.readStartedAt);
  const writeStart=Date.parse(p.writeStartedAt),writeEnd=Date.parse(p.writeEndsAt);
  const writeUsed=p.phase==='timed_out'?writeEnd-writeStart:p.submittedAt?Math.min(Math.max(0,Date.parse(p.submittedAt)-writeStart),writeEnd-writeStart):null;
  const finished=p.completedAt??p.submittedAt;
  const another=el('button',{type:'button',class:'btn-primary w-fit','data-retention-another':true},t.resultAnother);another.addEventListener('click',onAnother);
  const back=el('button',{type:'button',class:'btn-secondary w-fit','data-retention-levels-back':true},t.resultBack);back.addEventListener('click',onAnother);
  return el('div',{class:'flex flex-col gap-5','data-retention-phase':p.phase,'data-retention-result':true},
   el('div',{class:'panel flex flex-col gap-2'},el('h2',{class:'section-title'},p.phase==='completed'?t.resultCompleted:t.resultTimedOut),p.phase==='timed_out'?el('p',{class:'body-text'},t.resultTimedOutBody):null,
    el('p',{class:'font-display text-4xl text-ink-900','data-retention-score':p.score},t.resultScore.replace('{score}',String(p.score))),el('p',{class:'meta-text'},t.resultHint)),
   el('dl',{class:'panel grid grid-cols-1 gap-2 sm:grid-cols-2','data-retention-result-meta':true},
    el('div',{},el('dt',{class:'meta-text'},t.resultMetaLevel),el('dd',{class:'body-text','data-retention-result-level':true},p.level)),
    p.label?el('div',{},el('dt',{class:'meta-text'},t.resultMetaText),el('dd',{class:'body-text','data-retention-result-label':true},p.label)):null,
    finished?el('div',{},el('dt',{class:'meta-text'},t.resultMetaFinished),el('dd',{class:'body-text','data-retention-result-finished':finished},el('time',{datetime:finished},formatDateTime(finished,context.locale)))):null,
    el('div',{},el('dt',{class:'meta-text'},t.resultMetaReadAllocated),el('dd',{class:'body-text'},clock(readAllocated/1000))),
    el('div',{},el('dt',{class:'meta-text'},writeUsed===null?t.resultMetaWriteUnknown:t.resultMetaWriteUsed),writeUsed!==null?el('dd',{class:'body-text','data-retention-result-write-used':Math.round(writeUsed/1000)},clock(writeUsed/1000)):null),
    el('div',{},el('dt',{class:'meta-text'},t.resultMetaRecallWords),el('dd',{class:'body-text','data-retention-result-words':p.recallWordCount},t.resultMetaWords.replace('{n}',String(p.recallWordCount))))),
   el('ul',{class:'panel flex flex-col gap-2','data-retention-totals':true},
    el('li',{class:'body-text'},t.resultMainIdeas.replace('{kept}',String(d.mainIdeasRemembered)).replace('{total}',String(d.mainIdeasPossible))),
    el('li',{class:'body-text'},t.resultDetails.replace('{kept}',String(d.matchedGroups)).replace('{total}',String(d.totalGroups))),
    el('li',{class:'body-text'},t.resultContradictions.replace('{n}',String(d.contradicted)))),
   el('ul',{class:'flex flex-col gap-2','data-retention-claims':true},p.breakdown.claims.map(claim=>el('li',{class:'panel flex items-center justify-between gap-3','data-retention-claim':claim.claimId},el('span',{class:'body-text'},claim.claimLabel),el('span',{class:'meta-text text-right'},t[{captured:'resultClaimCaptured',partial:'resultClaimPartial',missed:'resultClaimMissed',contradicted:'resultClaimContradicted'}[claim.status]],el('br'),t.resultClaimPoints.replace('{awarded}',String(claim.awardedPoints)).replace('{possible}',String(claim.possiblePoints)))))),
   el('div',{class:'flex flex-wrap gap-3'},another,back,
    el('a',{class:'btn-secondary w-fit',href:'/app/reading/retention#retention-history','data-retention-result-history':true},t.resultHistory),
    el('a',{class:'btn-secondary w-fit',href:'/app/reading','data-retention-result-reading':true},t.resultBackToReading),
    el('a',{class:'link-inline self-center',href:`/app/reading/retention/results/${p.attemptId}`,'data-retention-result-permalink':true},t.resultPermalink)));
 }

/** Original /app/reading/retention/results/:attemptId: one owner-scoped finished result, refresh-safe. A live attempt
 * goes back to the session; an unknown or foreign id is unavailable. */
export function mountRetentionResult(context){
 const {root,url,signal,dict}=context,t=dict.retentionMemory,id=url.pathname.split('/')[5],host=el('div',{class:'mx-auto flex max-w-4xl flex-col gap-6','data-retention-result-page':true,'data-route-usable':'retention-result'});
 root.append(host);let busy=false;
 const rootElement=document.documentElement;let previousFocus,ownsFocus=false;
 const retentionActive=active=>{
  if(active){if(!ownsFocus){previousFocus=rootElement.dataset.focus;ownsFocus=true;}rootElement.dataset.retentionFocus='on';rootElement.dataset.focus='on';}
  else if(ownsFocus){delete rootElement.dataset.retentionFocus;if(previousFocus===undefined)delete rootElement.dataset.focus;else rootElement.dataset.focus=previousFocus;ownsFocus=false;}
 };
 context={...context,retentionActive};
 signal.addEventListener('abort',()=>retentionActive(false),{once:true});
 async function load(){
  if(busy||signal.aborted)return;busy=true;host.replaceChildren(el('p',{role:'status'},dict.common.loading));
  try{
   const raw=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
   if(raw?.kind==='live'){void context.navigate('/app/reading/retention',{replace:true});return;}
   const ok=raw?.kind==='result'&&raw.payload&&raw.payload.attemptId===id&&(raw.payload.phase==='completed'||raw.payload.phase==='timed_out');
   host.replaceChildren(
    BackLinkLocal(dict.common.back,'/app/reading/retention'),
    el('header',{class:'flex flex-wrap items-center justify-between gap-2'},el('h1',{class:'page-title'},t.resultTitle),el('a',{class:'btn-secondary',href:'/app/reading/retention'},t.title)),
    ok?resultView(context,raw.payload,()=>void context.navigate('/app/reading/retention')):el('p',{class:'panel body-text',role:'alert','data-retention-result-unavailable':true},t.resultUnavailable));
  }catch(e){
   if(signal.aborted)return;
   host.replaceChildren(RegionFailureNotice({region:'retention-result',message:dict.auth.errorServer,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }finally{busy=false;}
 }
 void load();
}
function BackLinkLocal(label,href){return el('a',{class:'btn-ghost inline-flex min-h-11 w-fit items-center gap-1',href,'data-back-link':true},el('span',{'aria-hidden':'true'},'←'),label);}

function retentionText(context,props){
 const value=clickableText(context,props);value.node.setAttribute('data-highlight-host','');value.node.stop=value.stop;return value;
}
