import {sourceDocument} from './source-layout.js';
import {el} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {uuid} from '../../js/adapters/listening-v7.js';
import {readingGeneralSetDTO} from '../../js/adapters/reading-v44.js';
import {api} from '../../js/api-client.js';
import {questionType} from '../../js/generated/reading-lib/question-types.js';
import {readingQuestionType} from '../../js/generated/reading-lib/question-model.js';
import {questionTypeLabel} from '../../js/generated/reading-lib/reading-labels.js';
import {isUnstatedAnswer} from '../../js/generated/reading-lib/unstated.js';
import {occurrenceSpans} from '../../js/generated/reading-lib/occurrence-spans.js';
import {groupHeading,groupQuestions,questionCard} from './questions.js';
import {readingHighlighted} from './lesson-text.js';
import {createWorkspace} from './workspace.js';
import {failure} from '../../js/request-errors.js';
import {evidence} from './analysis.js';
import {missing} from '../listening/catalogue-v9.js';
import {RegionFailureNotice} from '../shared/presentation.js';
/** Original (focus)/reading/general/[setId]/page.tsx + GeneralReadingSession.tsx (LEARNING mode). One passage per
 * session. Vocabulary help is on from the first second. Progress saves per passage (700 ms debounce, one request
 * queue per passage). Check answers is explicit; it is the only call that releases the key. */
const SAVE_DEBOUNCE_MS=700;
export function mountGeneralSession(context){
 const {root,url,signal,dict,locale,session,navigate}=context,setId=url.pathname.split('/')[4],host=el('div',{class:'reading-session reading-fill','data-native-view':'reading-general-session'});root.append(host);let busy=false;
 async function load(){
  if(busy||signal.aborted)return;busy=true;host.replaceChildren(el('p',{role:'status'},dict.common.loading));
  try{
   if(!uuid(setId)){host.replaceChildren(missing(dict));return;}
   const raw=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
   if(raw.kind==='not_found'){host.replaceChildren(missing(dict));return;}
   const d=readingGeneralSetDTO(raw,setId);
   const passageParam=url.searchParams.get('passage'),type=url.searchParams.get('type');
   const selected=d.passages.find(p=>p.passageNo===Number(passageParam))??d.passages[0];
   if(!selected){host.replaceChildren(missing(dict));return;}
   if(passageParam!==String(selected.passageNo)){
    const query=new URLSearchParams({passage:String(selected.passageNo)});if(type&&questionType(type,'reading'))query.set('type',type);
    void navigate(`/app/reading/general/${setId}?${query}`,{replace:true});return;
   }
   const notice=type&&questionType(type,'reading')&&selected.questions.some(q=>readingQuestionType(q.typeCode??q.type)?.id===type)
    ?el('p',{class:'body-text','data-requested-reading-type':type},`${dict.readingV4.requestedType}: ${questionTypeLabel(type,locale)}. ${dict.readingV4.wholePassage}`):null;
   const main=el('div',{class:'reading-fill'});host.replaceChildren(notice??'',main);
   mountSession(context,{setId,userId:session.user.id,passage:selected,initialProgress:d.initialProgress,mode:selected.passageNo,root:main});
  }catch(e){
   if(signal.aborted)return;
   host.replaceChildren(RegionFailureNotice({region:'reading-general-session',message:dict.auth.errorServer,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }finally{busy=false;}
 }
 void load();
}
function mountSession(context,{setId,userId,passage,initialProgress,mode,root}){
 const {dict,signal,navigate}=context,t=dict.generalReading,host=el('div',{class:'reading-fill','data-general-reading':true,'data-general-mode':String(mode),'data-general-passage':String(passage.passageNo)});root.append(host);
 const passageId=passage.passageId;
 const hasSaved=Object.hasOwn(initialProgress,passageId);
 const started=Date.now();
 const elapsedNode=el('output',{class:'reading-elapsed','data-general-elapsed':true,'aria-label':dict.readingWorkspace.elapsed},'00:00');
 const clock=setInterval(()=>{const elapsed=Math.floor((Date.now()-started)/1000);elapsedNode.textContent=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;},1000);
 signal.addEventListener('abort',()=>clearInterval(clock),{once:true});
 // The learner's own answers, checks and status for this one passage.
 const saved=initialProgress[passageId];
 const state={answers:saved?.answers??{},status:'idle',error:null,leaving:false,checkPending:false,pane:'passage',split:58,fontSize:16,check:saved?.checked&&saved.result?{rows:saved.result,score:saved.score,total:saved.total}:null,revision:0};
 let timer=null,queue=Promise.resolve(),pendingDraft=null,lastOk=true;
 // Open a session: create the progress row once (the original start request). Nothing is rebuilt for it.
 if(!hasSaved)api.request('/api/reading/general/progress',{method:'POST',body:{passageId,answers:{},check:false,start:true},signal})
 .catch(e=>{if(signal.aborted)return;
  // A failed start is shown with the mapped message; it is never reported as a started session. The learner's next save still sends the answers.
  state.error=failure(e,dict);draw();});
 function persist(nextAnswers,check){
  clearTimeout(timer);pendingDraft=null;
  const revision=state.revision;
  const run=async()=>{
   if(signal.aborted)return false;
   state.status=check?'checking':'saving';draw();
   try{
    const result=await api.request('/api/reading/general/progress',{method:'POST',body:{passageId,answers:nextAnswers,check},signal});
    // An answer typed while this save was in flight owns the screen now: its own save reports back.
    if(revision!==state.revision)return false;
    state.error=null;lastOk=true;state.status='saved';
    if(check&&result?.result)state.check={rows:result.result,score:result.score,total:result.total};
    draw();
    return true;
   }catch(e){
    if(signal.aborted||revision!==state.revision)return false;
    // Original GeneralReadingSession: the failure is the mapped message, never a fabricated success.
    lastOk=false;state.status='error';state.error=failure(e,dict);draw();
    return false;
   }
  };
  queue=queue.then(run,run);
  return queue;
 }
 function setAnswer(questionId,value){
  state.revision++;state.check=null;
  state.answers={...state.answers,[questionId]:value};pendingDraft=state.answers;
  clearTimeout(timer);timer=setTimeout(()=>void persist(state.answers,false),SAVE_DEBOUNCE_MS);
  draw();
 }
 function requestCheck(){
  // One check at a time: a second press while one is queued or running is not a second write.
  if(state.checkPending||state.leaving)return;
  state.checkPending=true;clearTimeout(timer);draw();
  void persist(state.answers,true).finally(()=>{state.checkPending=false;draw();});
 }
 async function leave(){
  if(state.leaving)return;state.leaving=true;draw();
  clearTimeout(timer);await queue;
  const draft=pendingDraft;
  if((draft||!lastOk)&&!(await persist(draft??state.answers,false))){state.leaving=false;draw();return;}
  void navigate('/app/reading/general');
 }
 const flush=()=>{clearTimeout(timer);if(!pendingDraft)return;try{void fetch('/api/reading/general/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passageId,answers:pendingDraft,check:false}),keepalive:true}).catch(()=>{});}catch{}pendingDraft=null;};
 window.addEventListener('pagehide',flush);signal.addEventListener('abort',()=>{window.removeEventListener('pagehide',flush);clearTimeout(timer);},{once:true});

 const highlightScope=`${userId}:${setId}`;
 const first=passage.questions[0]?.questionNo??1,last=passage.questions.at(-1)?.questionNo??first;
 const range=dict.readingWorkspace.questionRange.replace('{from}',String(first)).replace('{to}',String(last));
 const groups=passage.groups??[];
 // The passage is static for this session: it is built once and never rebuilt on an answer.
 function buildPassage(){
  return el('div',{},
   el('h2',{class:'reading-pane-heading'},dict.readingWorkspace.passageHeading.replace('{n}',String(passage.passageNo))),
   el('p',{class:'reading-part-instruction'},range),
   el('h3',{class:'reading-passage-title'},passage.title),
   passage.sourceHtml?sourceDocument(passage.sourceHtml,{skipTitle:true}):el('div',{class:'reading-passage-text','data-passage-body':true},
    passage.paragraphs.length?passage.paragraphs.map(paragraph=>el('div',{class:'reading-paragraph'},
     paragraph.label?el('strong',{class:'reading-paragraph-label'},paragraph.label):null,
     readingHighlighted(context,{scope:highlightScope,textKey:paragraph.id,text:paragraph.text,lexicalAssistance:true,occurrences:occurrenceSpans(passage.body,paragraph.text,passage.occurrences),sourceId:passageId,className:`academic-text ${paragraph.isFootnote?'italic':''}`}))):
    readingHighlighted(context,{scope:highlightScope,textKey:passageId,text:passage.body,lexicalAssistance:true,occurrences:occurrenceSpans(passage.body,passage.body,passage.occurrences),sourceId:passageId,className:'academic-text'})));
 }
 function buildQuestions(){
  const answers=state.answers;
  return el('div',{'data-general-questions':true},
   el('h2',{class:'reading-pane-heading'},range),
   passage.questions.length===0?el('p',{},t.noQuestions):null,
   el('fieldset',{class:'reading-question-blocks',disabled:state.leaving?true:null},
    groups.map(group=>el('section',{class:'reading-question-group'},groupHeading(dict,group),groupQuestions(context,{dict,group,questions:passage.questions.filter(q=>q.groupId===group.id),answers,onChange:setAnswer}))),
    passage.questions.filter(q=>!q.groupId||!groups.some(g=>g.id===q.groupId)).map(q=>questionCard(context,{dict,question:q,group:null,value:answers[q.id]??'',onChange:v=>setAnswer(q.id,v),inputId:`answer-${q.id}`}))),
   feedback(state.check,t,dict,passage),
   state.error?el('p',{role:'alert',class:'reading-error'},state.error):null);
 }
 function buildNavigation(){
  return el('div',{class:'reading-part-navigation','data-general-passage-tabs':true},el('div',{class:'reading-part-navigation'},
   el('button',{type:'button',class:'reading-part-button','aria-pressed':'true','data-general-passage-tab':String(passage.passageNo)},t.passageN.replace('{n}',String(passage.passageNo))),
   el('div',{class:'reading-question-numbers'},passage.questions.map(q=>{
    const b=el('button',{type:'button','data-reading-question-nav':q.id,'data-answered':(state.answers[q.id]??'').trim()?'true':'false','aria-label':`${dict.reading.yourAnswer} ${q.questionNo??q.order}`},String(q.questionNo??q.order));
    b.addEventListener('click',()=>{state.pane='questions';draw();requestAnimationFrame(()=>focusQuestion(q.id));});return b;}))));
 }
 function buildAction(){
  const check=state.check;
  const shownScore=check?{score:check.score,total:check.total}:saved?.checked&&!state.revision?{score:saved.score,total:saved.total}:null;
  const busy=state.leaving||state.checkPending||state.status==='checking';
  const checkButton=passage.questions.length>0?(()=>{const b=el('button',{type:'button',class:'btn-primary','data-general-check':true,disabled:busy?true:null},state.status==='checking'?t.checking:t.check);b.addEventListener('click',requestCheck);return b;})():null;
  return [shownScore&&shownScore.total!==null?el('span',{'data-general-score':true},t.score.replace('{score}',String(shownScore.score??0)).replace('{total}',String(shownScore.total))):null,checkButton];
 }
 function buildTools(){
  const back=el('button',{type:'button',class:'reading-back','data-general-back':true,disabled:state.leaving?true:null,'aria-label':t.back},`← ${dict.common.back}`);
  back.addEventListener('click',()=>void leave());
  return [back,elapsedNode,el('span',{role:'status','aria-live':'polite','data-general-save-state':state.status},state.status==='saving'?t.saving:state.status==='saved'?t.saved:'')];
 }
 function focusQuestion(questionId){
  const input=document.getElementById(`answer-${questionId}`);
  const target=input??[...host.querySelectorAll('[data-question]')].find(node=>node.dataset.question===questionId);
  target?.scrollIntoView?.({block:'center',behavior:'smooth'});
  if(input instanceof HTMLElement)input.focus({preventScroll:true});
 }
 // One persistent workspace: a save, an answer or a check patches the slots that changed; the scroll position and
 // the focused control survive the patch.
 const ws=createWorkspace({labels:dict.readingWorkspace,title:passage.title,brand:dict.marketing.title,state,
  setPane:v=>{state.pane=v;ws.update({pane:v});},setFont:f=>{state.fontSize=f;ws.update({});}});
 host.replaceChildren(ws.root);
 const passagePane=buildPassage();
 function draw(){
  if(signal.aborted)return;
  ws.update({passagePane,tools:buildTools(),questionsPane:buildQuestions(),navigation:buildNavigation(),action:buildAction(),pane:state.pane});
 }
 draw();
}
/** Original `<ol className="reading-feedback">`: each checked question with its key, accepted answers, evidence and explanation. */
function feedback(check,t,dict,passage){
 return el('ol',{class:'reading-feedback'},(check?.rows??[]).map(row=>el('li',{'data-general-question':row.questionId},el('div',{'data-general-result':row.isCorrect?'correct':'incorrect'},
  el('p',{},`${row.isCorrect?'✓':'✗'} ${t.correctAnswer.replace('{answer}',row.correctAnswer)}`),
  row.acceptedAnswers?.length?el('p',{'data-general-accepted':true},`${dict.readingPractice.acceptedAnswers}: ${row.acceptedAnswers.join(' / ')}`):null,
  row.evidenceQuote?el('p',{'data-general-evidence':true},`${t.evidence} ${row.evidenceQuote}`):(isUnstatedAnswer(row.correctAnswer)?null:el('p',{'data-general-evidence-missing':true},dict.readingV4.evidenceMissing)),
  (row.evidenceQuote||isUnstatedAnswer(row.correctAnswer))?evidence({dict},{dict,body:passage.body,title:passage.title,quote:row.evidenceQuote??'',unstated:isUnstatedAnswer(row.correctAnswer)}):null,
  row.explanation?el('p',{'data-general-explanation':true},`${dict.reading.explanation}: ${row.explanation}`):el('p',{'data-general-explanation-missing':true},dict.readingV4.explanationMissing)))));
}
