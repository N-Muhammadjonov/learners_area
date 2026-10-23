import {el} from '../../js/dom.js';
import {embedUrlFor,safeEmbedOrigin,formatClock} from './provider.js';
import {createVideoVocabulary} from './vocabulary.js';

/** Shared TED / PODCAST studio (original src/components/courses/VideoLessonStudio.tsx).
 * mode "standalone": tabs notes?/vocabulary/summary, transcript as a dialog, reflection recorder on Summary.
 * mode "course":     tabs before?/transcript?/notes?/comprehension?/gap?/vocabulary?/opinion/summary, transcript as a tab.
 * Grading, completion and progress are decided by the server; the client sends text and displays what comes back.
 * Everything it starts (player listeners, timers, requests, recorder, dialog) is torn down by destroy() or the route signal. */

const YOUTUBE_ORIGIN='https://www.youtube-nocookie.com';
const PROGRESS_STEP=5;      // at least 5 new watched seconds before a periodic write
const REQUEST_LIMIT=12000;  // every write gives up after 12 s
let studioSeq=0;

const tabClass=(active)=>`rounded-sm px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600 ${active?'bg-signal-600 text-white':'bg-ink-100 text-ink-700 hover:bg-ink-200'}`;

function tabsFor(mode,lesson,{hasTranscript,notes,comprehension,gapFill,vocabulary}){
 if(mode==='standalone')return [...(notes?['notes']:[]),'vocabulary','summary'];
 const list=[];
 if(lesson.beforeYouWatch?.trim())list.push('before');
 if(hasTranscript)list.push('transcript');
 if(notes)list.push('notes');
 if(comprehension>0)list.push('comprehension');
 if(gapFill>0)list.push('gap');
 if(vocabulary>0)list.push('vocabulary');
 list.push('opinion','summary');
 return list;
}

/** `video`: { videoLesson, questions, progress, vocabulary, directMedia, embedOrigin } (video-v47.js videoStudioDTO). */
export function createVideoStudio(context,{mode,video}){
 const {dict,signal}=context,t=dict.videoLesson;
 const lesson=video.videoLesson,questions=video.questions,progress=video.progress;
 const isDirect=lesson.provider==='direct';
 const own=new AbortController(),life=own.signal;
 let destroyed=false;

 // ---- Derived content (same rules as the original useMemo blocks) ----
 const notes=(lesson.notes??'').trim();
 const timed=(lesson.transcript??[]).filter(line=>line.text.trim().length>0);
 const plain=(lesson.transcriptText??'').trim();
 const hasTranscript=timed.length>0||plain.length>0;
 const comprehension=questions.filter(q=>q.stage==='comprehension');
 const gapFill=questions.filter(q=>q.stage==='gap_fill');
 const vocabWords=video.vocabulary.items;
 const tabs=tabsFor(mode,lesson,{hasTranscript,notes:notes.length>0,comprehension:comprehension.length,gapFill:gapFill.length,vocabulary:vocabWords.length});
 const tabIdBase=`video-studio-${++studioSeq}`;

 // ---- Mutable state (plain variables: high-frequency player data never re-renders the tabs) ----
 let state=progress?.state??'not_started';
 let tab=tabs[0]??'opinion';
 let tracking=false, liveTime=null, blocked=false, ended=false, generation=0, finalizedGeneration=-1;
 let restartAt=progress&&progress.state!=='completed'&&Number.isFinite(progress.watchedSeconds)&&progress.watchedSeconds>=5?Math.floor(progress.watchedSeconds):0;
 let reported=progress?.watchedSeconds??0;
 let graded={...(progress?.answers??{})};
 const drafts=new Map();
 let opinion=progress?.responseText??'', summary=progress?.summaryText??'';
 let saving=false, requestError=false, savedResponse=null, notesShown=false;
 let progressRequest=null, mutation=null;
 let frame=null, frameTeardown=null, directHandle=null, transcriptHandle=null, transcriptOpening=false, recorder=null, recorderLoading=false;
 let panelRefs={checkButtons:[],saveButton:null,responseStatus:null,questionList:null,questions:[]};

 // ---- DOM skeleton (built once; only the visible panel and small status nodes change later) ----
 const section=el('section',{class:'flex flex-col gap-4','data-video-lesson':lesson.id,'data-video-state':state});
 const stage=el('div',{class:'overflow-hidden rounded-lg border border-ink-200 bg-ink-950'});
 const blockedNote=el('p',{class:'rounded-md border border-warn-500/40 bg-warn-50 px-3 py-2 text-sm text-warn-800','data-video-blocked':''},t.blocked);
 blockedNote.hidden=true;
 const liveLabel=el('span',{class:'text-xs text-ink-500','data-video-live-transcript':'no'},t.liveTrackingOff);
 const stateLabel=el('span',{class:'text-xs font-medium text-ink-700','data-video-progress-state':''});
 const meta=el('div',{class:'flex flex-wrap items-center gap-2'},liveLabel,stateLabel);
 const transcriptButton=mode==='standalone'&&hasTranscript?el('button',{type:'button',class:'btn-secondary w-fit','data-video-open-transcript':''},t.tabs.transcript):null;
 const vocabStatus=el('p',{role:'status',class:'text-sm text-ink-500'},t.vocabularyUnavailable);
 vocabStatus.hidden=video.vocabulary.ready;
 const tablist=el('div',{class:'flex flex-wrap gap-2',role:'tablist','aria-label':t.stagesLabel,'data-video-tablist':''});
 const requestErr=el('p',{role:'alert','data-video-request-error':''},dict.common.error);
 requestErr.hidden=true;
 const panel=el('div',{class:'motion-tab-panel rounded-lg border border-ink-200 bg-paper-50 p-4',role:'tabpanel',id:`${tabIdBase}-panel`,tabindex:'0','data-video-tabpanel':''});
 const recorderHost=el('div',{'data-video-recorder-host':''});
 recorderHost.hidden=mode!=='standalone';
 const tabButtons=new Map();

 section.append(stage,blockedNote,meta);
 if(transcriptButton)section.append(transcriptButton);
 section.append(vocabStatus,tablist,requestErr,panel,recorderHost);

 // ---- Player ----
 const frameBox=el('div',{class:'relative aspect-video w-full'});
 const endedOverlay=el('div',{class:'absolute inset-0 flex flex-col items-center justify-center gap-4 text-white','data-video-ended':''},el('p',{},t.ended),el('button',{type:'button',class:'btn-primary'},`▶ ${t.replay}`));
 endedOverlay.hidden=true;
 endedOverlay.querySelector('button').addEventListener('click',()=>replay(),{signal:life});
 frameBox.append(endedOverlay);

 function setState(next){
  if(typeof next!=='string')return;
  state=next;
  section.setAttribute('data-video-state',next);
  stateLabel.textContent=next==='completed'?t.stateCompleted:next==='in_progress'?t.stateInProgress:t.stateNotStarted;
  if(panelRefs.responseStatus)panelRefs.responseStatus.setAttribute('data-video-response-verdict',next);
 }

 function setTracking(){
  if(tracking)return;
  tracking=true;
  liveLabel.setAttribute('data-video-live-transcript','yes');
  liveLabel.textContent=t.liveTrackingOn;
 }

 function postTo(node,payload){node.contentWindow?.postMessage(JSON.stringify(payload),YOUTUBE_ORIGIN);}

 function mountFrame(){
  unmountFrame();
  const src=embedUrlFor('youtube',lesson.videoId,{origin:safeEmbedOrigin(video.embedOrigin),start:restartAt});
  const node=el('iframe',{
   src,title:lesson.title,loading:'lazy',class:'absolute inset-0 h-full w-full',
   // No popups or top navigation: provider links cannot take the learner out of this site.
   sandbox:'allow-scripts allow-same-origin allow-presentation',
   allow:'encrypted-media; picture-in-picture; fullscreen',allowfullscreen:'',
   referrerpolicy:'strict-origin-when-cross-origin','data-video-frame':'',
  });
  frame=node;
  const ctl=new AbortController();
  const ask=()=>{postTo(node,{event:'listening',id:1,channel:'widget'});postTo(node,{event:'command',func:'addEventListener',args:['onStateChange']});};
  let loadTimer=0;
  node.addEventListener('load',()=>{ask();clearTimeout(loadTimer);loadTimer=setTimeout(ask,600);},{signal:ctl.signal});
  node.addEventListener('error',()=>{blocked=true;blockedNote.hidden=false;},{signal:ctl.signal});
  const interval=setInterval(ask,5000);
  // Only the player's own window, on the fixed provider origin, may report position or end.
  window.addEventListener('message',event=>{
   if(event.source!==node.contentWindow||event.origin!==YOUTUBE_ORIGIN)return;
   let data;
   try{data=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
   if(!data||typeof data!=='object')return;
   const info=data.info;
   if(info&&typeof info.currentTime==='number'&&Number.isFinite(info.currentTime)&&info.currentTime>=0)onPosition(info.currentTime);
   const reachedEnd=(data.event==='onStateChange'&&data.info===0)||(data.event==='infoDelivery'&&info?.playerState===0);
   if(reachedEnd){flushFinalProgress();showEnded();}
  },{signal:ctl.signal});
  frameTeardown=()=>{ctl.abort();clearInterval(interval);clearTimeout(loadTimer);node.removeAttribute('src');node.remove();};
  frameBox.insertBefore(node,endedOverlay);
 }
 function unmountFrame(){
  if(frameTeardown)frameTeardown();
  frameTeardown=null;frame=null;
 }
 function showEnded(){
  unmountFrame();
  ended=true;
  endedOverlay.hidden=false;
 }
 function startFrame(){
  ended=false;
  endedOverlay.hidden=true;
  mountFrame();
 }
 function replay(){
  restartAt=0;
  generation++;
  startFrame();
 }
 function seekTo(seconds){
  if(directHandle){directHandle.seekTo(seconds);return;}
  if(ended){restartAt=seconds;generation++;startFrame();return;}
  if(!frame)return;
  postTo(frame,{event:'command',func:'seekTo',args:[seconds,true]});
  postTo(frame,{event:'command',func:'playVideo',args:[]});
 }

 // ---- Progress (monotonic, server-decided) ----
 function applyServer(body){
  if(!body||destroyed)return;
  if(typeof body.watchedSeconds==='number'&&Number.isFinite(body.watchedSeconds))reported=Math.max(reported,body.watchedSeconds);
  if(typeof body.state==='string')setState(body.state);
 }
 function progressUrl(){return `/api/video-lessons/${lesson.id}/progress`;}
 function maybeSendProgress(){
  const seconds=liveTime;
  if(seconds===null||seconds-reported<PROGRESS_STEP||progressRequest)return;
  const ctl=new AbortController();
  progressRequest=ctl;
  const deadline=setTimeout(()=>ctl.abort(),REQUEST_LIMIT);
  fetch(progressUrl(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({watchedSeconds:seconds}),signal:ctl.signal,credentials:'same-origin',cache:'no-store',redirect:'error'})
   .then(res=>res.ok?res.json():null)
   .then(body=>{if(progressRequest!==ctl||ctl.signal.aborted)return;applyServer(body);})
   .catch(()=>{})
   .finally(()=>{clearTimeout(deadline);if(progressRequest===ctl)progressRequest=null;});
 }
 function onPosition(seconds){
  liveTime=seconds;
  setTracking();
  maybeSendProgress();
 }
 // One final write per playback generation. keepalive, and not cancelled by navigation or replay.
 function flushFinalProgress(){
  if(finalizedGeneration===generation)return;
  const duration=lesson.durationSeconds&&lesson.durationSeconds>0?lesson.durationSeconds:null;
  const seconds=duration??liveTime??(reported>0?reported:null);
  if(seconds===null)return;
  finalizedGeneration=generation;
  const ctl=new AbortController();
  const deadline=setTimeout(()=>ctl.abort(),REQUEST_LIMIT);
  fetch(progressUrl(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({watchedSeconds:seconds,ended:true}),keepalive:true,signal:ctl.signal,credentials:'same-origin',cache:'no-store',redirect:'error'})
   .then(res=>res.ok?res.json():null)
   .then(applyServer)
   .catch(()=>{})
   .finally(()=>clearTimeout(deadline));
 }

 // ---- Writes (answers / response): one in flight, verdicts only from the server ----
 async function writeLesson(kind,payload){
  if(mutation)return false;
  const ctl=new AbortController();
  mutation=ctl;
  const deadline=setTimeout(()=>ctl.abort(),REQUEST_LIMIT);
  saving=true;requestError=false;
  if(kind==='response')savedResponse=null;
  paint();
  try{
   const res=await fetch(`/api/video-lessons/${lesson.id}/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ctl.signal,credentials:'same-origin',cache:'no-store',redirect:'error'});
   if(!res.ok)throw new Error('Video lesson write failed');
   const body=await res.json();
   if(mutation!==ctl||ctl.signal.aborted||destroyed)return false;
   if(kind==='answers'&&body.graded){graded={...graded,...body.graded};renderQuestions();}
   if(body.state)setState(body.state);
   if(kind==='response')savedResponse=true;
   return true;
  }catch{
   if(mutation===ctl&&!destroyed){requestError=true;if(kind==='response')savedResponse=false;}
   return false;
  }finally{
   clearTimeout(deadline);
   if(mutation===ctl){mutation=null;saving=false;paint();}
  }
 }
 async function checkAnswers(stage){
  const list=stage==='comprehension'?comprehension:gapFill;
  const payload={};
  for(const q of list){const value=drafts.get(q.id)?.trim();if(value)payload[q.id]=value;}
  if(Object.keys(payload).length===0)return;
  await writeLesson('answers',{answers:payload});
 }
 function saveResponse(){
  if(mode==='standalone')return writeLesson('response',{summaryText:summary});
  return writeLesson('response',{responseText:opinion,summaryText:summary});
 }

 function paint(){
  if(destroyed)return;
  requestErr.hidden=!requestError;
  for(const b of panelRefs.checkButtons){b.disabled=saving;b.textContent=saving?t.checking:t.checkAnswers;}
  if(panelRefs.saveButton){panelRefs.saveButton.disabled=saving;panelRefs.saveButton.textContent=saving?t.saving:t.save;}
  const status=panelRefs.responseStatus;
  if(status){
   status.setAttribute('data-video-response-state',savedResponse===true?'saved':savedResponse===false?'error':'idle');
   status.setAttribute('data-video-response-verdict',state);
   status.replaceChildren();
   if(savedResponse===true)status.append(el('span',{class:'text-xs text-band-700'},t.saved));
   else if(savedResponse===false)status.append(el('span',{class:'text-xs text-warn-700'},dict.common.error));
  }
 }

 // ---- Exercises ----
 function questionItem(q){
  const verdict=graded[q.id];
  const prompt=el('span',{class:'text-sm text-ink-800'},q.prompt);
  if(q.atSeconds!==null&&q.atSeconds!==undefined){
   prompt.append(el('button',{type:'button',class:'ml-2 rounded-sm border border-signal-600/40 px-1.5 py-0.5 text-xs text-signal-700 hover:bg-signal-50','data-video-question-seek':''},formatClock(q.atSeconds)));
   prompt.querySelector('[data-video-question-seek]').addEventListener('click',()=>seekTo(q.atSeconds),{signal:life});
  }
  const top=el('div',{class:'flex items-start justify-between gap-3'},prompt);
  if(verdict){
   top.append(el('span',{class:verdict.correct?'text-xs font-medium text-band-700':'text-xs font-medium text-warn-700','data-video-answer':verdict.correct?'correct':'wrong'},verdict.correct?t.answerCorrect:t.answerWrong));
  }
  const input=el('input',{class:'input',placeholder:t.answerPlaceholder,'data-video-answer-input':q.id});
  input.value=drafts.get(q.id)??verdict?.answer??'';
  input.addEventListener('input',()=>drafts.set(q.id,input.value),{signal:life});
  return el('li',{class:'flex flex-col gap-2 border-b border-ink-200/60 py-3 last:border-0'},top,el('div',{class:'flex gap-2'},input));
 }
 function renderQuestions(){
  if(!panelRefs.questionList)return;
  panelRefs.questionList.replaceChildren(...panelRefs.questions.map(questionItem));
 }
 function questionsPanel(list,stage){
  const wrap=el('div',stage==='comprehension'?{'data-video-comprehension':''}:{'data-video-gap':''});
  const ul=el('ul');
  const check=el('button',{type:'button',class:'btn-primary mt-3'},t.checkAnswers);
  check.addEventListener('click',()=>checkAnswers(stage),{signal:life});
  panelRefs.questionList=ul;panelRefs.questions=list;panelRefs.checkButtons=[check];
  renderQuestions();
  wrap.append(ul,check);
  return wrap;
 }

 // ---- Panels ----
 function responseBlock(kind){
  const input=el('textarea',{class:'input min-h-28',['data-video-'+kind+'-input']:'',placeholder:kind==='opinion'?t.opinionPlaceholder:t.summaryPlaceholder});
  input.value=kind==='opinion'?opinion:summary;
  input.addEventListener('input',()=>{if(kind==='opinion')opinion=input.value;else summary=input.value;},{signal:life});
  const hint=el('p',{class:'text-sm text-ink-600'},kind==='opinion'?t.opinionHint:t.summaryHint);
  const save=el('button',{type:'button',class:'btn-primary','data-video-save-response':''},t.save);
  save.addEventListener('click',()=>saveResponse(),{signal:life});
  const status=el('span',{'data-video-response-state':'idle','data-video-response-verdict':state});
  panelRefs.saveButton=save;panelRefs.responseStatus=status;
  return el('div',{},
   el('div',{class:'flex flex-col gap-3',['data-video-'+kind]:''},hint,input),
   el('div',{class:'mt-3 flex items-center gap-3'},save,status),
   el('p',{class:'mt-3 text-xs text-ink-500','data-video-feedback-note':''},t.feedbackNote));
 }

 function notesPanel(){
  const toggle=el('button',{type:'button',class:'btn-secondary w-fit','data-video-notes-reveal':'','aria-controls':`${tabIdBase}-notes`,'aria-expanded':String(notesShown)},notesShown?t.hideNotes:t.revealNotes);
  const text=el('p',{id:`${tabIdBase}-notes`,class:`whitespace-pre-line text-sm text-ink-700 ${notesShown?'':'hidden'}`,'data-video-notes':notesShown?'shown':'hidden'},notes);
  toggle.addEventListener('click',()=>{
   notesShown=!notesShown;
   toggle.textContent=notesShown?t.hideNotes:t.revealNotes;
   toggle.setAttribute('aria-expanded',String(notesShown));
   text.className=`whitespace-pre-line text-sm text-ink-700 ${notesShown?'':'hidden'}`;
   text.setAttribute('data-video-notes',notesShown?'shown':'hidden');
  },{signal:life});
  return el('div',{class:'flex flex-col gap-2','data-video-notes-panel':''},toggle,text);
 }

 function transcriptPanel(){
  const body=timed.length>0
   ? el('ol',{class:'flex flex-col gap-1.5'},timed.map((line,index)=>el('li',{class:'flex gap-3 text-sm text-ink-700'},el('span',{class:'shrink-0 font-mono text-xs leading-5 text-ink-500'},formatClock(line.startSeconds)),el('span',{},line.text))))
   : el('p',{class:'whitespace-pre-line text-sm text-ink-700','data-video-transcript-text':''},plain);
  return el('div',{class:'flex flex-col gap-2','data-video-transcript-panel':''},body,
   lesson.transcriptAttribution?el('p',{class:'text-xs text-ink-500'},`${t.transcriptProvenance}: ${lesson.transcriptAttribution}`):null);
 }

 function buildPanel(name){
  panelRefs={checkButtons:[],saveButton:null,responseStatus:null,questionList:null,questions:[]};
  if(name==='vocabulary')return createVideoVocabulary({context:{...context,signal:life},id:lesson.id,words:vocabWords,dict});
  if(name==='before')return el('p',{class:'whitespace-pre-line text-sm text-ink-700','data-video-before':''},lesson.beforeYouWatch);
  if(name==='transcript')return transcriptPanel();
  if(name==='notes')return notesPanel();
  if(name==='comprehension')return questionsPanel(comprehension,'comprehension');
  if(name==='gap')return questionsPanel(gapFill,'gap_fill');
  if(name==='opinion')return el('div',{},responseBlock('opinion'));
  return el('div',{},responseBlock('summary'));
 }

 function paintTabs(){
  for(const [name,button] of tabButtons){
   const active=name===tab;
   button.setAttribute('aria-selected',String(active));
   button.tabIndex=active?0:-1;
   button.className=tabClass(active);
  }
 }
 function mountPanel(){
  panel.replaceChildren(buildPanel(tab));
  panel.setAttribute('aria-labelledby',`${tabIdBase}-tab-${tab}`);
  panel.setAttribute('data-video-tab-active',tab);
  paint();
  syncRecorder();
 }
 function selectTab(name){
  if(!tabs.includes(name))return;
  tab=name;
  paintTabs();
  mountPanel();
 }
 for(const [index,name] of tabs.entries()){
  const button=el('button',{type:'button',role:'tab',id:`${tabIdBase}-tab-${name}`,'aria-controls':`${tabIdBase}-panel`,'data-video-tab':name},t.tabs[name]);
  button.addEventListener('click',()=>selectTab(name),{signal:life});
  button.addEventListener('keydown',event=>{
   const last=tabs.length-1;
   const next=event.key==='ArrowRight'?(index===last?0:index+1):event.key==='ArrowLeft'?(index===0?last:index-1):event.key==='Home'?0:event.key==='End'?last:null;
   if(next===null)return;
   event.preventDefault();
   selectTab(tabs[next]);
   document.getElementById(`${tabIdBase}-tab-${tabs[next]}`)?.focus();
  },{signal:life});
  tabButtons.set(name,button);
  tablist.append(button);
 }

 // ---- Reflection recorder (standalone Summary only; loaded on first use) ----
 function syncRecorder(){
  if(mode!=='standalone')return;
  if(tab==='summary'&&!recorder&&!recorderLoading)loadRecorder();
  recorder?.setActive(tab==='summary');
 }
 async function loadRecorder(){
  recorderLoading=true;
  try{
   const {createReflectionRecorder}=await import('./reflection-recorder.js');
   if(destroyed)return;
   recorder=createReflectionRecorder({dict,signal:life});
   recorderHost.append(recorder.node);
   recorder.setActive(tab==='summary');
  }catch{
   if(!destroyed)recorderHost.append(el('p',{role:'alert'},dict.videoLesson.voiceSummary.failed));
  }finally{recorderLoading=false;}
 }

 // ---- Transcript dialog (standalone; loaded on first open) ----
 async function openTranscript(){
  if(transcriptHandle||transcriptOpening)return;
  transcriptOpening=true;
  try{
   const {openTranscriptDialog}=await import('./transcript-dialog.js');
   if(destroyed)return;
   transcriptHandle=openTranscriptDialog({
    context:{...context,signal:life},id:lesson.id,dict,
    text:timed.length?timed.map(line=>line.text).join('\n'):plain,
    onClose:()=>{transcriptHandle=null;},
   });
  }finally{transcriptOpening=false;}
 }
 transcriptButton?.addEventListener('click',()=>openTranscript(),{signal:life});

 // ---- Direct media (owner-authorised file) or blocked notice ----
 if(isDirect){
  if(video.directMedia){
   import('./direct-player.js').then(({createDirectPlayer})=>{
    if(destroyed)return;
    const player=createDirectPlayer({
     src:video.directMedia.src,captions:video.directMedia.captions,title:lesson.title,labels:t.directPlayer,
     onTime:onPosition,signal:life,
    });
    directHandle=player;
    stage.replaceChildren(player.node);
   }).catch(()=>{if(!destroyed)stage.replaceChildren(el('p',{class:'p-4 text-sm text-white','data-video-blocked':''},t.blocked));});
  }else{
   stage.append(el('p',{class:'p-4 text-sm text-white','data-video-blocked':''},t.blocked));
  }
 }else if(lesson.provider==='youtube'){
  stage.append(frameBox);
  startFrame();
 }else{
  stage.append(el('p',{class:'p-4 text-sm text-white','data-video-blocked':''},t.blocked));
 }

 // ---- Teardown ----
 function destroy(){
  if(destroyed)return;
  destroyed=true;
  signal.removeEventListener('abort',destroy);
  unmountFrame();
  progressRequest?.abort();progressRequest=null;
  const pending=mutation;mutation=null;pending?.abort();
  transcriptHandle?.close();transcriptHandle=null;
  recorder?.destroy();recorder=null;
  directHandle?.destroy();directHandle=null;
  own.abort();
  section.remove();
 }
 if(signal.aborted)destroy();
 else signal.addEventListener('abort',destroy,{once:true});

 // First paint: the tab strip, the first panel, and the progress/status labels.
 setState(state);
 paintTabs();
 mountPanel();
 return {node:section,destroy};
}
