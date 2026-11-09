import {sourceDocument} from './source-layout.js';
import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {announceFocusEntry} from '../../js/focus-entry.js';
import {IconCheck} from '../../js/generated/icons.js';
import {readingDurationSeconds,readingRemainingSeconds} from '../../js/generated/reading-lib/timer.js';
import {readingHighlighted} from './lesson-text.js';
import {groupHeading,groupQuestions,questionCard,patchAnswer} from './questions.js';
import {Button} from '../shared/presentation.js';
import {createWorkspace} from './workspace.js';
const SAVE_DEBOUNCE_MS=900;
const formatDuration=ms=>{const total=Math.max(0,Math.floor(ms/1000)),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60,pad=n=>String(n).padStart(2,'0');return h>0?`${h}:${pad(m)}:${pad(s)}`:`${pad(m)}:${pad(s)}`;};
/** Original ReadingExam.tsx + ReadingWorkspace.tsx as one native controller. Nothing here grades: the server does
 * that once, on submit. Autosave: one PATCH in flight, a change during a save is saved right after, a 409 locks the
 * screen, a 410 freezes it as expired, and the last change is sent with keepalive when the page is hidden. */
export function mountExam(context,p){
 const {root,signal,dict}=context,t=dict.readingPractice,host=el('div',{'data-native-view':'reading-attempt',class:'reading-fill','data-reading-practice':true,'data-attempt':p.attemptId});
 root.append(host);
 const durationSeconds=readingDurationSeconds(p.suggestedMinutes);
 const state={activePart:0,pending:null,answers:{...p.savedAnswers},pane:'passage',saveState:Object.keys(p.savedAnswers).length?'saved':'idle',savedAt:null,submitting:false,error:null,now:Date.now(),expiredByServer:false,fontSize:16,split:50,locked:false};
 let inFlight=false,dirty=false,timer=null,alive=true,expiredShown=false;
 const remaining=()=>readingRemainingSeconds(p.startedAt,durationSeconds,state.now);
 const timeExpired=()=>state.expiredByServer||remaining()===0;
 announceFocusEntry(p.attemptId);
 const parts=p.parts.length?p.parts:[];
 const visibleQuestions=()=>{const part=parts[state.activePart];return part?p.questions.filter(q=>part.questionIds.includes(q.id)):p.questions;};
 const visibleGroups=()=>{const part=parts[state.activePart];return part?p.groups.filter(g=>part.groupIds.includes(g.id)):p.groups;};
 const groupById=new Map(p.groups.map(g=>[g.id,g]));
 const questionById=new Map(p.questions.map(q=>[q.id,q]));
 const saveSlot=el('span',{'data-reading-save-slot':''});let saveKey='';
 function paintSave(){
  const key=state.saveState+'|'+(state.savedAt??'');
  if(key!==saveKey){saveSlot.replaceChildren(saveBadge());saveKey=key;}
  const submit=ws.root.querySelector('[data-submit-attempt]');if(submit)submit.disabled=state.submitting||state.saveState==='locked';
 }
 function paintAnswer(id){
  const question=questionById.get(id);if(!question)return;
  patchAnswer(ws.root,{question,group:groupById.get(question.groupId),value:state.answers[id]??''});
  for(const button of ws.root.querySelectorAll('[data-reading-question-nav]'))if(button.dataset.readingQuestionNav===id)button.dataset.answered=String(Boolean(state.answers[id]?.trim()));
  const count=ws.root.querySelector('[data-exam-answered]'),label=t.answered.replace('{answered}',String(p.questions.filter(q=>state.answers[q.id]?.trim()).length)).replace('{total}',String(p.questions.length));
  if(count&&count.textContent!==label)count.textContent=label;
 }
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
  inFlight=true;dirty=false;const snapshot=JSON.stringify(state.answers);setSave('saving');
  try{
   const response=await fetch(`/api/reading/attempts/${p.attemptId}`,{method:'PATCH',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json'},body:saveBody(),signal});
   if(!alive||signal.aborted)return;
   if(response.status===409){state.locked=true;setSave('locked');return;}
   if(response.status===410){dirty=false;state.expiredByServer=true;setSave('idle');return;}
   if(!response.ok)throw new Error('save failed');
   if(!dirty&&JSON.stringify(state.answers)===snapshot){state.savedAt=new Date().toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});setSave('saved');}
   else setSave('saving');
  }catch{
   if(signal.aborted)return;
   dirty=true;setSave('error');
  }finally{
   inFlight=false;
   if(alive&&dirty&&!state.locked){clearTimeout(timer);timer=setTimeout(()=>void save(),SAVE_DEBOUNCE_MS);}
  }
 }
 function setSave(next){state.saveState=next;if(timeExpired())draw();else paintSave();}
 function setAnswer(questionId,value){state.answers={...state.answers,[questionId]:value};dirty=true;clearTimeout(timer);timer=setTimeout(()=>void save(),SAVE_DEBOUNCE_MS);paintAnswer(questionId);}
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
 const partLabel=index=>dict.generalReading.passageN.replace('{n}',String(index+1));
 const activeRange=()=>{
  const qs=visibleQuestions(),numbers=qs.map(q=>q.questionNo??q.order).filter(n=>Number.isFinite(n));
  return numbers.length?dict.readingWorkspace.questionRange.replace('{from}',String(Math.min(...numbers))).replace('{to}',String(Math.max(...numbers))):'';
 };
 function buildNavigation(){
  const nav=el('div',{class:'reading-part-navigation','data-academic-exam-navigation':''});
  const partButtons=el('div',{class:'reading-part-navigation'});
  for(let i=0;i<(parts.length||1);i++){
   const button=el('button',{type:'button',class:'reading-part-button','aria-pressed':String(i===state.activePart),'data-academic-part':String(i+1)},partLabel(i));
   button.addEventListener('click',()=>{if(i===state.activePart)return;state.activePart=i;draw();const pane=ws.root.querySelector('.reading-workspace-questions');if(pane)pane.scrollTop=0;},{signal});
   partButtons.append(button);
  }
  const numbers=el('div',{class:'reading-question-numbers','data-academic-question-numbers':''});
  for(const q of visibleQuestions()){
   const no=q.questionNo??q.order,button=el('button',{type:'button','data-reading-question-nav':q.id,'data-answered':(state.answers[q.id]??'').trim()?'true':'false','aria-label':`${dict.reading.yourAnswer} ${no}`},String(no));
   button.addEventListener('click',()=>focusQuestion(q.id),{signal});
   numbers.append(button);
  }
  nav.append(partButtons,numbers);return nav;
 }
 function draw(){
  if(signal.aborted)return;
  const expired=timeExpired(),current=parts[state.activePart],shownParagraphs=current?.paragraphs??p.paragraphs;
  const shownBody=current?.body??p.passageBody,shownTitle=current?.title??p.passageTitle;
  const highlightOpts={scope:p.attemptId},range=activeRange();
  const buildPassage=()=>el('div',{},
   el('h2',{class:'reading-pane-heading'},partLabel(state.activePart)),
   range?el('p',{class:'reading-part-instruction'},range):null,
   el('h3',{class:'reading-passage-title'},shownTitle),
   (current?.sourceHtml??p.passageSourceHtml)?sourceDocument(current?.sourceHtml??p.passageSourceHtml,{skipTitle:true}):el('div',{class:'reading-passage-text','data-passage-body':true},
    shownParagraphs.length?shownParagraphs.map(paragraph=>el('div',{class:'reading-paragraph','data-paragraph':paragraph.label??'none'},
     paragraph.label?el('strong',{class:'reading-paragraph-label'},paragraph.label):null,
     readingHighlighted(context,{...highlightOpts,textKey:paragraph.id,text:paragraph.text,className:`academic-text ${paragraph.isFootnote?'italic':''}`}))):
     readingHighlighted(context,{...highlightOpts,textKey:`part:${state.activePart}`,text:shownBody,className:'academic-text'})));
  const passagePane=passageCache?.part===state.activePart?passageCache.node:(passageCache={part:state.activePart,node:buildPassage()}).node;
  const orderedNow=orderedBlocks();
  const questionsPane=el('div',{'data-academic-exam-questions':''},
   el('h2',{class:'reading-pane-heading'},range||partLabel(state.activePart)),
   expired?el('p',{role:'status','data-attempt-expired':true,class:'reading-error'},t.timeExpired):null,
   el('fieldset',{class:'reading-question-blocks',disabled:expired?true:null},
    orderedNow.blocks.map(({group,questions})=>el('section',{class:'reading-question-group','data-question-group':group.position},
     groupHeading(dict,group),...groupQuestions(context,{dict,group,questions,answers:state.answers,onChange:setAnswer,getAnswer:id=>state.answers[id]??''}))),
    orderedNow.orphan.length?el('section',{class:'reading-question-group','data-question-group':'ungrouped'},orderedNow.orphan.map(question=>questionCard(context,{dict,question,group:null,value:state.answers[question.id]??'',getAnswer:()=>state.answers[question.id]??'',onChange:v=>setAnswer(question.id,v),inputId:`answer-${question.id}`}))):null));
  const answered=p.questions.filter(q=>(state.answers[q.id]??'').trim()).length;
  const progress=t.answered.replace('{answered}',String(answered)).replace('{total}',String(p.questions.length));
  const submitButton=Button({variant:'primary',disabled:state.submitting||state.saveState==='locked','data-submit-attempt':true,children:state.submitting?dict.common.loading:dict.reading.submit});
  submitButton.addEventListener('click',()=>void submit(),{signal});
  const action=[el('span',{class:'reading-answered','data-exam-answered':''},progress),state.error?el('span',{role:'alert',class:'reading-error'},state.error):null,submitButton];
  ws.update({passagePane,questionsPane,navigation:buildNavigation(),action,tools:[
   el('span',{class:'flex items-center gap-2','data-practice-timer':true},el('span',{},t.timerLabel),(()=>{timerNode.textContent=formatDuration(remaining()*1000);timerNode.dataset.timeRemaining=String(remaining());return timerNode;})()),
   saveSlot,el('a',{href:'/app/reading/academic',class:'reading-back','data-practice-exit':''},t.exit)
  ],pane:state.pane});
  paintSave();
 }
 function focusQuestion(questionId){
  const input=document.getElementById(`answer-${questionId}`);
  const target=input??[...host.querySelectorAll('[data-question]')].find(node=>node.dataset.question===questionId);
  target?.scrollIntoView?.({block:'center',behavior:'smooth'});
  if(input instanceof HTMLElement)input.focus({preventScroll:true});
 }
 const ws=createWorkspace({labels:dict.readingWorkspace,title:p.testTitle??p.passageTitle,brand:dict.marketing.title,state,setPane:v=>{state.pane=v;ws.update({pane:v});},setFont:v=>{state.fontSize=Math.max(14,Math.min(22,v));ws.update({});}});
 host.replaceChildren(ws.root);
 draw();
}
