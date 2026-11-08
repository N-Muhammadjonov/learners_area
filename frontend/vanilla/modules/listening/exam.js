import {h} from '../../js/native.js';
import {api} from '../../js/api-client.js';
import {fieldSelection,restoreWhenAttached} from '../../js/focus-restore.js';
import {render} from '../../js/generated/NativeListeningExam-v7.js';
import {listeningAttemptLocalKeys,clearListeningAttemptLocalState} from '../../js/generated/listening-attempt-local.js';
import {examDTO,answerRecord} from '../../js/adapters/listening-v7.js';
/** Explicit native exam lifecycle. No lexical controller, answer keys or local grading. */
export function listeningExam(context,input,composition={}){
 const p=examDTO(input),{dict,signal}=context,t=dict.fullListeningHub.examScreen,host=document.createElement('div'),keys=listeningAttemptLocalKeys(p.attemptId),ids=new Set(p.questions.map(q=>q.id));
 let answers={...p.initial},notes='',section=1,mediaDuration=p.duration??0,started=!!p.audioStartedAt,position=p.audioPosition,error='',saved='',busy=false,notesOpen=false,confirm=false,dirty=false,saving=false,submitted=false;
 let playing=false,startPersisted=started,saveRequested=false,saveTimeout=null,lastSavedPosition=position,forceSavePosition=false;const SAVE_INTERVAL=15000;
 const audio={current:null},container={current:null},pos={current:position};
 try{const raw=JSON.parse(localStorage.getItem(keys.draft)||'null');if(raw){answers={...answers,...answerRecord(raw.answers,ids)};dirty=true;}notes=(localStorage.getItem(keys.notes)||'').slice(0,12000);}catch{}
 function persist(){try{localStorage.setItem(keys.draft,JSON.stringify({answers}));}catch{saved=t.deviceUnavailable;paintSaved();}}
 function paintSaved(){const n=host.querySelector('[data-listening-save-status]');if(n)n.textContent=saved;}
 function paintPosition(){
  const n=host.querySelector('[data-listening-position]');if(!n)return;
  const clock=v=>Math.floor(v/60)+':'+String(Math.floor(v%60)).padStart(2,'0');
  n.textContent=clock(position)+(mediaDuration>0?' / '+clock(mediaDuration):'');
 }
 function paintAnswers(){
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
   if(key==='error'){error=value;draw();}
   if(key==='duration'){mediaDuration=value;paintPosition();}
   if(key==='position'){position=value;pos.current=value;paintPosition();}
  };
  const node=render({...p,dict,answers,section,mediaDuration,started,position,error,saved,busy,notesOpen,notes,confirm,audio,container,pos,
   ReadingText:composition.textSurface??(({text,className})=>h('span',{className},text)),
   change,play,submit,
   setNotesOpen:v=>{notesOpen=typeof v==='function'?v(notesOpen):v;draw();},
   updateNotes:v=>{notes=v;try{localStorage.setItem(keys.notes,v);}catch{}},
   setSection:v=>{section=v;draw();},
   setConfirm:v=>{confirm=v;draw();},
   setError:v=>update('error',v),
   setMediaDuration:v=>update('duration',v),setPosition:v=>update('position',v)});
  const next=node.querySelector('audio');if(old&&next)next.replaceWith(old);
  audio.current=old??next;container.current=node;
  host.replaceChildren(node);
  paintAnswers();paintPosition();paintSaved();
  if(focus)restoreWhenAttached(focus.id?[...host.querySelectorAll('[id]')].find(n=>n.id===focus.id):host.querySelectorAll('input,select,textarea,button,a')[focus.index],signal,focus);
 }
 function requestSave(delay=1800,force=false){
  if(signal.aborted||submitted||busy)return;
  if(force)forceSavePosition=true;
  clearTimeout(saveTimeout);saveTimeout=setTimeout(()=>void save(),delay);
 }
 function change(id,value){if(!ids.has(id)||value.length>500||busy||submitted)return;answers={...answers,[id]:value};dirty=true;saved=t.saving;persist();paintAnswers();paintSaved();requestSave();}
 // Source multi controls must use CURRENT checked state, not a stale render closure.
 host.addEventListener('change',e=>{const field=e.target.closest?.('[data-listening-answer-control=multi]');if(!field)return;e.stopImmediatePropagation();const q=p.questions.find(q=>'answer-'+q.id===field.id);if(q)change(q.id,[...field.querySelectorAll('input')].flatMap((n,i)=>n.checked?[(/^[A-Z](?:\s|$)/.test(q.options[i])?q.options[i][0]:String.fromCharCode(65+i))]:[]).join(','));},{capture:true,signal});
 async function save(){
  if(signal.aborted||submitted||busy)return;
  if(saving){saveRequested=true;return;}
  const positionNow=pos.current;
  const startNow=started&&!startPersisted;
  if(!dirty&&!startNow&&!(forceSavePosition&&started&&Math.abs(positionNow-lastSavedPosition)>=.25)&&(!playing||Math.abs(positionNow-lastSavedPosition)<12))return;
  saving=true;saveRequested=false;forceSavePosition=false;
  const snapshot=JSON.stringify(answers);
  let succeeded=false;
  try{
   await api.request('/api/listening/attempts/'+p.attemptId+'/draft',{
    method:'PUT',timeoutMs:12000,
    body:{answers:{...answers},audioPosition:positionNow,startAudio:startNow},signal
   });
   if(signal.aborted)return;
   saved=t.saved;dirty=JSON.stringify(answers)!==snapshot;
   lastSavedPosition=positionNow;if(startNow)startPersisted=true;succeeded=true;
  }catch{
   if(!signal.aborted)saved=t.deviceOnly;
  }finally{
   saving=false;if(!signal.aborted){paintSaved();if(succeeded&&(saveRequested||dirty||forceSavePosition))requestSave(2000);}
  }
 }
 async function play(){
  if(signal.aborted||!audio.current||mediaDuration>0&&pos.current>=mediaDuration-.5)return;
  error='';
  try{
   if(audio.current.error){
    const media=audio.current,recover=pos.current;
    media.addEventListener('loadedmetadata',()=>{if(!signal.aborted&&Number.isFinite(recover))media.currentTime=recover;},{once:true,signal});
    media.load();
   }
   await audio.current.play();
   if(signal.aborted)return;
   host.querySelector('[data-listening-error]')?.remove();
   playing=true;
   if(!started){started=true;requestSave(0);}
   else if(!startPersisted)requestSave(0);
   const button=host.querySelector('[data-listening-start-audio]');
   if(button)button.textContent=t.resume;
  }catch{
   if(!signal.aborted){playing=false;error=t.audioPlayFailed;draw();}
  }
 }
 if(!signal.aborted){
  // Playback events represent real audio progression, not a UI re-render.
  host.addEventListener('playing',e=>{if(e.target===audio.current){playing=true;if(!started){started=true;requestSave(0);}}}, {capture:true,signal});
  host.addEventListener('pause',e=>{if(e.target===audio.current){playing=false;requestSave(0,true);}}, {capture:true,signal});
  host.addEventListener('ended',e=>{if(e.target===audio.current){playing=false;requestSave(0,true);}}, {capture:true,signal});
 }
 async function submit(){if(busy||submitted||signal.aborted)return;busy=true;error='';draw();try{await api.request(`/api/listening/attempts/${p.attemptId}/submit`,{method:'POST',timeoutMs:12000,body:{answers:p.questions.map(q=>({questionId:q.id,answer:answers[q.id]??''}))},signal});if(signal.aborted)return;submitted=true;clearListeningAttemptLocalState(p.attemptId);await context.navigate(p.sectionMode?`/app/listening/general/${p.testId}`:`/app/listening/tests/${p.testId}/2`);}catch(e){if(signal.aborted)return;if(e.status===409){context.refresh();return;}error=t.submitFailed;busy=false;draw();}}
 const timer=setInterval(()=>{if(dirty||started&&!startPersisted||playing&&Math.abs(pos.current-lastSavedPosition)>=12)void save();},SAVE_INTERVAL);
 const flush=()=>{if(document.visibilityState==='hidden'&&(dirty||playing||started))requestSave(0,true);};
 document.addEventListener('visibilitychange',flush,{signal});
 signal.addEventListener('abort',()=>{
  clearInterval(timer);clearTimeout(saveTimeout);
  audio.current?.pause();audio.current?.removeAttribute('src');audio.current?.load();
  composition.dispose?.();host.replaceChildren();
 },{once:true});
 if(!signal.aborted){
  draw();
  // Full IELTS attempts request playback on entry. Browser autoplay policy
  // may reject an async route transition; in that case the Start button remains.
  if(!p.sectionMode)void play();
 }else clearInterval(timer);
 return host;
}
