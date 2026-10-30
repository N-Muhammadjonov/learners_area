import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {announceFocusEntry} from '../../js/focus-entry.js';
import {IconCheck} from '../../js/generated/icons.js';
import {readingDurationSeconds,readingRemainingSeconds} from '../../js/generated/reading-lib/timer.js';
import {readingHighlighted} from './lesson-text.js';
import {groupHeading,groupQuestions,questionCard} from './questions.js';
import {Button} from '../shared/presentation.js';
import {academicWorkspace} from './academic-workspace.js';
const SAVE_DEBOUNCE_MS=900;
const formatDuration=ms=>{const total=Math.max(0,Math.floor(ms/1000)),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60,pad=n=>String(n).padStart(2,'0');return h>0?`${h}:${pad(m)}:${pad(s)}`:`${pad(m)}:${pad(s)}`;};
/** Original ReadingExam.tsx + ReadingWorkspace.tsx as one native controller. Nothing here grades: the server does
 * that once, on submit. Autosave: one PATCH in flight, a change during a save is saved right after, a 409 locks the
 * screen, a 410 freezes it as expired, and the last change is sent with keepalive when the page is hidden. */
export function mountExam(context,p){
 const {root,signal,dict}=context,t=dict.readingPractice,host=el('div',{'data-native-view':'reading-attempt',class:'flex flex-col gap-4','data-reading-practice':true,'data-attempt':p.attemptId});
 root.append(host);
 const durationSeconds=readingDurationSeconds(p.suggestedMinutes);
 const startedMs=Date.parse(p.startedAt);
 const state={activePart:0,pending:null,answers:{...p.savedAnswers},pane:'passage',saveState:Object.keys(p.savedAnswers).length?'saved':'idle',savedAt:null,submitting:false,error:null,now:Date.now(),expiredByServer:false,fontSize:16,split:58,locked:false};
 let inFlight=false,dirty=false,timer=null,alive=true,expiredShown=false;
 const remaining=()=>readingRemainingSeconds(p.startedAt,durationSeconds,state.now);
 const timeExpired=()=>state.expiredByServer||remaining()===0;
 announceFocusEntry(p.attemptId);
 const parts=p.parts.length?p.parts:[];
 const visibleQuestions=()=>{const part=parts[state.activePart];return part?p.questions.filter(q=>part.questionIds.includes(q.id)):p.questions;};
 const visibleGroups=()=>{const part=parts[state.activePart];return part?p.groups.filter(g=>part.groupIds.includes(g.id)):p.groups;};
 const groupById=new Map(p.groups.map(g=>[g.id,g]));
 function orderedBlocks(){
  const byGroup=new Map(),orphan=[];
  for(const q of visibleQuestions()){if(q.groupId&&groupById.has(q.groupId)){const list=byGroup.get(q.groupId)??[];list.push(q);byGroup.set(q.groupId,list);}else orphan.push(q);}
  return {blocks:[...visibleGroups()].sort((a,b)=>a.position-b.position).map(group=>({group,questions:(byGroup.get(group.id)??[]).sort((a,b)=>a.order-b.order)})),orphan:orphan.sort((a,b)=>a.order-b.order)};
 }
 // The timer is the only thing updated every second; the screen is not rebuilt for it.
 const timerNode=el('span',{class:'font-mono tabular-nums','data-time-remaining':''});
 const clock=setInterval(()=>{if(!alive||signal.aborted)return;state.now=Date.now();if(timerNode.isConnected){timerNode.textContent=formatDuration(remaining()*1000);timerNode.dataset.timeRemaining=String(remaining());}if(timeExpired()&&!expiredShown){expiredShown=true;draw();}},1000);
 signal.addEventListener('abort',()=>{alive=false;clearTimeout(timer);clearInterval(clock);},{once:true});

 function saveBody(){return JSON.stringify({answers:Object.entries(state.answers).map(([questionId,answer])=>({questionId,answer}))});}
 async function save(){
  if(inFlight){dirty=true;return;}
  if(!dirty)return;
  inFlight=true;dirty=false;setSave('saving');
  try{
   const response=await fetch(`/api/reading/attempts/${p.attemptId}`,{method:'PATCH',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json'},body:saveBody(),signal});
   if(!alive||signal.aborted)return;
   if(response.status===409){state.locked=true;setSave('locked');return;}
   if(response.status===410){dirty=false;state.expiredByServer=true;setSave('idle');return;}
   if(!response.ok)throw new Error('save failed');
   setSave('saved');state.savedAt=new Date().toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});draw();
  }catch{
   if(signal.aborted)return;
   dirty=true;setSave('error');
  }finally{
   inFlight=false;
   if(alive&&dirty&&!state.locked){clearTimeout(timer);timer=setTimeout(()=>void save(),SAVE_DEBOUNCE_MS);}
  }
 }
 function setSave(next){state.saveState=next;draw();}
 function setAnswer(questionId,value){state.answers={...state.answers,[questionId]:value};dirty=true;clearTimeout(timer);timer=setTimeout(()=>void save(),SAVE_DEBOUNCE_MS);draw();}
 // Leaving the tab or closing the page: the last change is sent synchronously as a keepalive request.
 const flush=()=>{if(!dirty)return;dirty=false;try{void fetch(`/api/reading/attempts/${p.attemptId}`,{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:saveBody(),keepalive:true,signal:AbortSignal.timeout(5000)}).catch(()=>{});}catch{}};
 const onHidden=()=>{if(document.visibilityState==='hidden')flush();};
 document.addEventListener('visibilitychange',onHidden);window.addEventListener('pagehide',flush);
 signal.addEventListener('abort',()=>{document.removeEventListener('visibilitychange',onHidden);window.removeEventListener('pagehide',flush);},{once:true});

 async function submit(){
  if(state.submitting)return;
  if(!window.confirm(dict.reading.submitConfirm))return;
  state.submitting=true;state.error=null;draw();
  try{
   await api.request(`/api/reading/attempts/${p.attemptId}/submit`,{method:'POST',body:{answers:p.questions.map(q=>({questionId:q.id,answer:state.answers[q.id]??''}))},signal});
   dirty=false;
   if(!signal.aborted)void context.refresh();
  }catch(e){
   if(signal.aborted)return;
   if(e.status===409){state.saveState='locked';state.error=dict.readingPractice.saveSubmitted;}
   else state.error=t.submitError;
  }finally{
   if(!signal.aborted){state.submitting=false;draw();}
  }
 }

 function saveBadge(){
  const s=state.saveState;
  if(s==='error')return el('span',{class:'flex items-center gap-2 text-sm text-band-bad','data-save-state':'error'},t.saveError,(()=>{const b=el('button',{type:'button',class:'btn-secondary ','data-save-retry':true},t.saveRetry);b.addEventListener('click',()=>void save());return b;})());
  if(s==='locked')return el('span',{class:'text-sm text-ink-500','data-save-state':'locked'},t.saveSubmitted);
  const label=s==='saving'?t.saveSaving:s==='saved'&&state.savedAt?t.saveSaved.replace('{time}',state.savedAt):s==='saved'?t.saveSaved.replace('{time}','--:--'):t.saveIdle;
  return el('span',{class:'flex items-center gap-1.5 text-sm text-ink-500','data-save-state':s},s==='saved'?IconCheck({class:'text-[16px] text-band-good'}):null,label);
 }

 let passageCache=null;
 function draw(){
  if(signal.aborted)return;
  const expired=timeExpired();
  const shownParagraphs=parts[state.activePart]?.paragraphs??p.paragraphs,shownBody=parts[state.activePart]?.body??p.passageBody,shownTitle=parts[state.activePart]?.title??p.passageTitle;
  const highlightOpts={scope:p.attemptId};
  const buildPassage=()=>el('div',{class:'contents'},el('div',{class:'flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-3'},el('h2',{class:'font-display text-base text-ink-900'},shownTitle)),el('div',{class:'flex flex-col gap-4 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-2','data-passage-body':true},shownParagraphs.length?shownParagraphs.map(paragraph=>el('div',{class:'flex gap-3','data-paragraph':paragraph.label??'none'},paragraph.label?el('span',{class:'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper-sunken text-xs font-semibold text-ink-700'},paragraph.label):el('span',{class:'w-7 shrink-0','aria-hidden':'true'}),el('div',{'data-exam-passage-text':true},readingHighlighted(context,{...highlightOpts,textKey:paragraph.id,text:paragraph.text,className:`academic-text text-sm leading-relaxed text-ink-700 ${paragraph.isFootnote?'italic':''}`})))):el('div',{'data-exam-passage-text':true},readingHighlighted(context,{...highlightOpts,textKey:`part:${state.activePart}`,text:shownBody,className:'academic-text text-sm leading-relaxed text-ink-700'}))));
  // The passage text is rebuilt only when the part changes; an answer or a save never rebuilds it.
  const passagePane=passageCache?.part===state.activePart?passageCache.node:(passageCache={part:state.activePart,node:buildPassage()}).node;
  const orderedNow=orderedBlocks();
  const answered=p.questions.filter(q=>(state.answers[q.id]??'').trim()!=='').length;
  const questionsPane=el('div',{class:'contents'},expired?el('p',{role:'status','data-attempt-expired':true,class:'rounded-[12px] border border-band-warn/40 bg-band-warn/10 px-3 py-2 text-sm text-ink-700'},t.timeExpired):null,el('div',{class:'flex flex-col gap-3 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-2'},el('fieldset',{class:'flex min-w-0 flex-col gap-3 border-0 p-0',disabled:expired?true:null},orderedNow.blocks.map(({group,questions})=>el('div',{class:'flex flex-col gap-3','data-question-group':group.position},groupHeading(dict,group),groupQuestions(context,{dict,group,questions,answers:state.answers,onChange:setAnswer}))),orderedNow.orphan.length?el('div',{class:'flex flex-col gap-3','data-question-group':'ungrouped'},orderedNow.orphan.map(question=>questionCard(context,{dict,question,group:null,value:state.answers[question.id]??'',onChange:v=>setAnswer(question.id,v),inputId:`answer-${question.id}`}))):null)));
  const submitButton=Button({variant:'primary',disabled:state.submitting||state.saveState==='locked','data-submit-attempt':true,children:state.submitting?dict.common.loading:dict.reading.submit});
  submitButton.addEventListener('click',()=>void submit());
  const progress=t.answered.replace('{answered}',String(answered)).replace('{total}',String(p.questions.length));
  const action=el('div',{class:'flex flex-col gap-2 rounded-[16px] border border-ink-100 bg-paper-raised p-4'},el('div',{class:'flex items-center justify-between text-sm text-ink-700'},el('span',{},progress),state.saveState==='error'?el('span',{class:'text-band-bad'},t.unsavedWarning):null),el('p',{class:'text-xs text-ink-300'},t.submitHint),state.error?el('p',{role:'alert',class:'text-sm text-band-bad'},state.error):null,submitButton);
  ws.update({passagePane,questionsPane,action,tools:[el('span',{class:'flex items-center gap-2 text-sm text-ink-700','data-practice-timer':true},el('span',{class:'text-ink-300'},t.timerLabel),(()=>{timerNode.textContent=formatDuration(remaining()*1000);timerNode.dataset.timeRemaining=String(remaining());return timerNode;})()),saveBadge()]});
 }
 function focusQuestion(questionId){
  const input=document.getElementById(`answer-${questionId}`);
  const target=input??[...host.querySelectorAll('[data-question]')].find(node=>node.dataset.question===questionId);
  target?.scrollIntoView?.({block:'center',behavior:'smooth'});
  if(input instanceof HTMLElement)input.focus({preventScroll:true});
 }
 const ws=academicWorkspace(context,p,state,v=>{state.pane=v;draw();},index=>{state.activePart=index;draw();});
 host.replaceChildren(ws.root);
 draw();
}
