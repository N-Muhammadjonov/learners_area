import {listeningDraftWriter,sameListeningAnswers} from './draft-writer.js';
import {h} from '../../js/native.js';
import {api} from '../../js/api-client.js';
import {fieldSelection,restoreWhenAttached} from '../../js/focus-restore.js';
import {examAudio,render} from '../../js/generated/NativeListeningExam-v7.js';
import {listeningAttemptLocalKeys,clearListeningAttemptLocalState} from '../../js/generated/listening-attempt-local.js';
import {examRecording,recordingSeekReady} from './exam-recording.js';
import {authoredCdView} from './cd-view.js';
import {examDTO,answerRecord} from '../../js/adapters/listening-v7.js';
/** Explicit native exam lifecycle. No lexical controller, answer keys or local grading. */
export function listeningExam(context,input,composition={}){
 const p=examDTO(input),{dict,signal}=context,t=dict.fullListeningHub.examScreen,host=document.createElement('div'),keys=listeningAttemptLocalKeys(p.attemptId),ids=new Set(p.questions.map(q=>q.id));
 let answers={...p.initial},notes='',section=1,mediaDuration=p.duration??0,started=!!p.audioStartedAt,position=p.audioPosition,error='',saved='',busy=false,notesOpen=false,confirm=false,dirty=false,saving=false,submitted=false;
 const writer=listeningDraftWriter(p.attemptId,p.draftHash);let conflict=false,reconciling=false,savedAnswers=p.initial;
 let playing=false,startPersisted=started,saveRequested=false,saveTimeout=null,lastSavedPosition=position,forceSavePosition=false;const SAVE_INTERVAL=15000;
 const audio={current:null},container={current:null},pos={current:position};
 // A media element must stay attached across notes/section/error presentation.
 // Recreating a detached replacement also speculatively starts another preload.
 const mediaHost=document.createElement('div'),viewHost=document.createElement('div');
 host.dataset.listeningExamMount='';viewHost.dataset.listeningExamView='';
 mediaHost.hidden=true;host.append(mediaHost,viewHost);let playFlight=null,entered=false,preparing=!!p.cdExam,stallTimer=null;
 function paintPlayback(){
  host.dataset.listeningPlayback=playing?'playing':playFlight?'loading':error?'error':'paused';
  if(cd){paintCd();return;}
  const b=host.querySelector('[data-listening-start-audio]');if(!b)return;
  b.hidden=!p.sectionMode&&playing;b.style.display=b.hidden?'none':'';
  b.disabled=busy||!!playFlight||(mediaDuration>0&&pos.current>=mediaDuration-.5);
  if(playFlight)b.setAttribute('aria-busy','true');else b.removeAttribute('aria-busy');
  b.textContent=started?t.resume:t.begin;
 }
 try{const raw=JSON.parse(localStorage.getItem(keys.draft)||'null');if(raw){
  const local=answerRecord(raw.answers,ids);
  const recovered={...answers,...local};
  if(!sameListeningAnswers(recovered,answers)){
   answers=recovered;dirty=true;
   conflict=typeof p.draftHash==='string'&&raw.draftHash!==p.draftHash;
  }
 }notes=(localStorage.getItem(keys.notes)||'').slice(0,p.cdExam?45000:12000);}catch{}
 const recording=p.cdExam?examRecording(p.audioUrl,p.testId,signal,p.recordingParts,p.audioPosition):null;
 if(recording?.duration)mediaDuration=recording.duration;
 const cd=p.cdExam?authoredCdView(p.cdExam,{questions:p.questions,imageUrl:p.imageUrl,notes,saveWorkspace:saveNotes,signal}):null;
 function saveNotes(value){notes=value;try{localStorage.setItem(keys.notes,value);}catch{}}
 function paintCd(){
  cd.update({answers,position,duration:mediaDuration,started,entered,preparing,playing,loading:!!playFlight,
   busy,conflict,error,saved,audio:audio.current,change,play,submit});
 }
 function persist(){try{localStorage.setItem(keys.draft,JSON.stringify({answers,draftHash:writer.hash}));}catch{saved=t.deviceUnavailable;paintSaved();}}
 function paintSaved(){if(cd){cd.saveStatus(saved);return;}const n=host.querySelector('[data-listening-save-status]');if(n)n.textContent=saved;}
 function paintPosition(){
  if(cd){cd.paintTime(position,mediaDuration);return;}
  const n=host.querySelector('[data-listening-position]');if(!n)return;
  const clock=v=>Math.floor(v/60)+':'+String(Math.floor(v%60)).padStart(2,'0');
  n.textContent=clock(position)+(mediaDuration>0?' / '+clock(mediaDuration):'');
 }
 function paintAnswers(){
  if(cd){cd.paintAnswers(answers);return;}
  const n=host.querySelector('[data-listening-answered-count]');
  if(n)n.textContent=p.questions.filter(q=>answers[q.id]?.trim()).length+' / '+p.questions.length+' answered';
  host.querySelectorAll('[data-listening-question-index]').forEach(btn=>{
   const has=!!answers[btn.dataset.listeningQuestionIndex]?.trim();
   btn.classList.toggle('btn-primary',has);btn.classList.toggle('btn-secondary',!has);
   const q=p.questions.find(x=>x.id===btn.dataset.listeningQuestionIndex);
   if(q)btn.setAttribute('aria-label','Question '+q.number+', '+(has?'answered':'unanswered'));
  });
 }
 function draw(){
  if(signal.aborted)return;
  const active=host.contains(document.activeElement)?document.activeElement:null;
  const focus=active?{id:active.id,index:[...host.querySelectorAll('input,select,textarea,button,a')].indexOf(active),...fieldSelection(active)}:null;
  const old=audio.current;
  const update=(key,value)=>{
   if(key==='error'){if(recording)playing=false;error=value;draw();}
   if(key==='duration'){mediaDuration=value;paintPosition();}
   if(key==='position'){position=value;pos.current=value;paintPosition();}
  };
  const model={...p,audioUrl:recording?undefined:p.audioUrl,dict,answers,section,mediaDuration,started,position,error,saved,busy,notesOpen,notes,confirm,audio,container,pos,recording,renderMedia:false,
   ReadingText:composition.textSurface??(({text,className})=>h('span',{className},text)),
   change,play,submit,
   setNotesOpen:v=>{notesOpen=typeof v==='function'?v(notesOpen):v;draw();},
   updateNotes:saveNotes,
   setSection:v=>{section=v;draw();},
   setConfirm:v=>{if(!cd){confirm=v;draw();}},
   setError:v=>update('error',v),
   setMediaDuration:v=>update('duration',v),setPosition:v=>update('position',v)};
  if(!old){const media=examAudio(model);audio.current=media;mediaHost.append(media);}
  if(cd){
   viewHost.querySelector('[data-listening-draft-conflict]')?.remove();
   if(!viewHost.contains(cd.surface))viewHost.append(cd.surface);
   paintPlayback();
  }else{
   const node=render(model);
   container.current=node;
   viewHost.replaceChildren(node);
   paintAnswers();paintPosition();paintSaved();paintPlayback();
  }
  if(conflict){const box=h('div',{role:'alert','data-listening-draft-conflict':'',className:'card p-4'},context.locale==='uz'?'Boshqa tabda yoki qurilmada boshqa javob saqlangan. Bu qurilmadagi nusxa saqlanib turibdi.':'Another tab or device saved different answers. This device copy is retained.',h('button',{type:'button',className:'btn-secondary',disabled:reconciling,onClick:()=>void reconcile(false)},context.locale==='uz'?'Server javoblarini olish':'Use server answers'),h('button',{type:'button',className:'btn-secondary',disabled:reconciling,onClick:()=>void reconcile(true)},context.locale==='uz'?'Bu qurilma nusxasini saqlash':'Keep this device copy'));viewHost.prepend(box);}
  if(focus&&!cd)restoreWhenAttached(focus.id?[...host.querySelectorAll('[id]')].find(n=>n.id===focus.id):host.querySelectorAll('input,select,textarea,button,a')[focus.index],signal,focus);
 }
 function requestSave(delay=1800,force=false){
  if(signal.aborted||submitted||busy)return;
  if(force)forceSavePosition=true;
  clearTimeout(saveTimeout);saveTimeout=setTimeout(()=>void save(),delay);
 }
 function change(id,value){if(!ids.has(id)||value.length>500||busy||submitted)return;answers={...answers,[id]:value};dirty=true;saved=t.saving;persist();paintAnswers();paintSaved();requestSave();}
 // Source multi controls must use CURRENT checked state, not a stale render closure.
 host.addEventListener('change',e=>{const field=e.target.closest?.('[data-listening-answer-control=multi]');if(!field)return;e.stopImmediatePropagation();const q=p.questions.find(q=>'answer-'+q.id===field.id);if(q)change(q.id,[...field.querySelectorAll('input')].flatMap((n,i)=>n.checked?[(/^[A-Z](?:\s|$)/.test(q.options[i])?q.options[i][0]:String.fromCharCode(65+i))]:[]).join(','));},{capture:true,signal});
 async function readDraft(){
  const data=await api.request('/api/frontend/view?'+new URLSearchParams({route:'/app/listening/attempts/'+p.attemptId}),{signal,fresh:true});
  return examDTO(data.data.exam);
 }
 async function reconcile(keepLocal){if(reconciling)return;reconciling=true;draw();try{const latest=await readDraft();writer.reconcile(latest.draftHash);savedAnswers=latest.initial;if(!keepLocal){answers={...latest.initial};position=latest.audioPosition;pos.current=position;if(recording?.select(position)){
   audio.current.pause();await prepareRecording();
  }else try{if(audio.current)audio.current.currentTime=Math.max(0,position-(recording?.offset??0));}catch{}}conflict=false;dirty=keepLocal;persist();}catch{saved=t.deviceOnly;}finally{reconciling=false;if(!signal.aborted){draw();if(!conflict&&dirty)requestSave(0);}}}
 async function save(){
  if(signal.aborted||submitted||busy||conflict)return;
  if(saving){saveRequested=true;return;}
  const positionNow=pos.current;
  const startNow=started&&!startPersisted;
  if(!dirty&&!startNow&&!(forceSavePosition&&started&&Math.abs(positionNow-lastSavedPosition)>=.25)&&(!playing||Math.abs(positionNow-lastSavedPosition)<12))return;
  saving=true;saveRequested=false;forceSavePosition=false;
  const snapshot={...answers};
  let succeeded=false;
  try{
   await writer.write({answers:snapshot,audioPosition:positionNow,startAudio:startNow});
   if(signal.aborted||submitted)return;
   saved=t.saved;savedAnswers=snapshot;dirty=!sameListeningAnswers(answers,snapshot);
   lastSavedPosition=positionNow;if(startNow)startPersisted=true;succeeded=true;persist();
  }catch(cause){
   if(!signal.aborted){
    saved=t.deviceOnly;
    if(cause?.code==='draft_conflict'){
     const latest=await readDraft().catch(()=>null);
     if(signal.aborted)return;
     if(latest&&(sameListeningAnswers(latest.initial,answers)||sameListeningAnswers(latest.initial,savedAnswers))){
      writer.reconcile(latest.draftHash);
      savedAnswers=latest.initial;
      dirty=!sameListeningAnswers(latest.initial,answers);
      lastSavedPosition=latest.audioPosition;
      saved=t.saved;persist();succeeded=true;
     }else{conflict=true;draw();}
    }
   }
  }finally{
   saving=false;if(!signal.aborted){paintSaved();if(succeeded&&(saveRequested||dirty||forceSavePosition))requestSave(2000);}
  }
 }
 async function prepareRecording(timeout=6500){
  if(!recording||signal.aborted)return;
  preparing=true;paintPlayback();
  try{
   const source=await recording.prepare(timeout);
   if(!signal.aborted&&audio.current.getAttribute('src')!==source)audio.current.src=source;
   if(!signal.aborted){
    recording.warmNext();
    if(mediaDuration<=0||pos.current<mediaDuration-.25){
     await recordingSeekReady(audio.current,pos.current-recording.offset,signal).catch(()=>{
      if(!signal.aborted)error=t.audioPlayFailed;
     });
    }
   }
  }catch{
   if(!signal.aborted){audio.current.removeAttribute('src');error=t.recordingUnavailable;}
  }finally{
   if(!signal.aborted){preparing=false;paintPlayback();}
  }
 }
 function play(){
  if(signal.aborted||!audio.current||preparing||mediaDuration>0&&pos.current>=mediaDuration-.25)return Promise.resolve();
  if(recording&&!audio.current.getAttribute('src'))return prepareRecording().then(()=>{if(!signal.aborted&&audio.current.getAttribute('src'))return play();});
  if(playFlight)return playFlight;
  error='';
  let deadline;
  const work=(async()=>{
  try{
   if(audio.current.error)audio.current.load();
   const start=audio.current.play();
   if(recording)await Promise.race([start,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Recording stalled')),12000);})]);
   else await start;
   if(signal.aborted)return;
   host.querySelector('[data-listening-error]')?.remove();
   playing=true;entered=true;
   if(!started){started=true;requestSave(0);}
   else if(!startPersisted)requestSave(0);
  }catch(cause){
   if(!signal.aborted){
    if(recording)audio.current.pause();
    playing=false;error=t.audioPlayFailed;draw();
    if(recording&&cause?.name!=='NotAllowedError')await prepareRecording(12000);
   }
  }finally{clearTimeout(deadline);}
  })();
  playFlight=work.finally(()=>{playFlight=null;if(!signal.aborted)paintPlayback();});
  paintPlayback();return playFlight;
 }
 if(!signal.aborted){
  // Playback events represent real audio progression, not a UI re-render.
  if(recording){
   host.addEventListener('waiting',e=>{
    if(e.target!==audio.current||!playing||stallTimer!==null)return;
    stallTimer=setTimeout(()=>{
     stallTimer=null;
     if(!playing||signal.aborted)return;
     audio.current.pause();playing=false;error=t.audioPlayFailed;
     void prepareRecording(12000);
    },10000);
   },{capture:true,signal});
   for(const event of ['playing','timeupdate','pause','ended','error'])host.addEventListener(event,e=>{
    if(e.target===audio.current&&stallTimer!==null){clearTimeout(stallTimer);stallTimer=null;}
   },{capture:true,signal});
  }
  host.addEventListener('playing',e=>{if(e.target===audio.current){playing=true;entered=true;if(!started){started=true;requestSave(0);}paintPlayback();}}, {capture:true,signal});
  host.addEventListener('pause',e=>{if(e.target===audio.current){playing=false;requestSave(0,true);paintPlayback();}}, {capture:true,signal});
  host.addEventListener('ended',e=>{
   if(e.target!==audio.current)return;
   playing=false;
   if(recording?.advance()){
    position=pos.current=recording.offset;
    requestSave(0,true);paintPosition();
    void prepareRecording().then(()=>{if(!signal.aborted&&audio.current.getAttribute('src'))void play();});
    return;
   }
   cd?.beginReview();requestSave(0,true);paintPlayback();
  },{capture:true,signal});
 }
 async function submit(){if(busy||submitted||signal.aborted||conflict)return;busy=true;error='';draw();try{await api.request(`/api/listening/attempts/${p.attemptId}/submit`,{method:'POST',timeoutMs:12000,body:{answers:p.questions.map(q=>({questionId:q.id,answer:answers[q.id]??''}))},signal});if(signal.aborted)return;submitted=true;clearListeningAttemptLocalState(p.attemptId);await context.navigate(p.sectionMode?`/app/listening/general/${p.testId}`:`/app/listening/tests/${p.testId}/2`);}catch(e){if(signal.aborted)return;if(e.status===409){context.refresh();return;}error=t.submitFailed;busy=false;draw();}}
 const timer=setInterval(()=>{if(dirty||started&&!startPersisted||playing&&Math.abs(pos.current-lastSavedPosition)>=12)void save();},SAVE_INTERVAL);
 const flush=()=>{if(document.visibilityState==='hidden'&&(dirty||playing||started)){forceSavePosition=true;void save();}};
 document.addEventListener('visibilitychange',flush,{signal});
 signal.addEventListener('abort',()=>{
  clearInterval(timer);clearTimeout(saveTimeout);clearTimeout(stallTimer);
  if(!submitted&&!conflict&&(dirty||playing||started&&!startPersisted))void writer.write({answers:{...answers},audioPosition:pos.current,startAudio:started&&!startPersisted}).catch(()=>{});
  audio.current?.pause();audio.current?.removeAttribute('src');audio.current?.load();
  composition.dispose?.();host.replaceChildren();
 },{once:true});
 if(!signal.aborted){
  draw();
  // CD uses the source Start/Resume click after the recording and seek are prepared.
  if(recording)void prepareRecording().then(()=>{
   if(!signal.aborted&&mediaDuration>0&&pos.current>=mediaDuration-.25){
    entered=true;cd.beginReview();paintPlayback();
   }
  });
  else if(!p.sectionMode)void play();
 }else clearInterval(timer);
 return host;
}
