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
 const audio={current:null},container={current:null},pos={current:position};
 try{const raw=JSON.parse(localStorage.getItem(keys.draft)||'null');if(raw){answers={...answers,...answerRecord(raw.answers,ids)};dirty=true;}notes=(localStorage.getItem(keys.notes)||'').slice(0,12000);}catch{}
 function persist(){try{localStorage.setItem(keys.draft,JSON.stringify({answers}));}catch{saved=t.deviceUnavailable;}}
 function draw(){if(signal.aborted)return;const active=host.contains(document.activeElement)?document.activeElement:null,focus=active?{id:active.id,index:[...host.querySelectorAll('input,select,textarea,button,a')].indexOf(active),...fieldSelection(active)}:null,old=audio.current;
 const update=(key,value)=>{if(key==='error')error=value;if(key==='duration')mediaDuration=value;if(key==='position')position=value;draw();};
 const node=render({...p,dict,answers,section,mediaDuration,started,position,error,saved,busy,notesOpen,notes,confirm,audio,container,pos,ReadingText:composition.textSurface??(({text,className})=>h('span',{className},text)),change,play,submit,setNotesOpen:v=>{notesOpen=typeof v==='function'?v(notesOpen):v;draw();},updateNotes:v=>{notes=v;try{localStorage.setItem(keys.notes,v);}catch{}},setSection:v=>{section=v;draw();},setConfirm:v=>{confirm=v;draw();},setError:v=>update('error',v),setMediaDuration:v=>update('duration',v),setPosition:v=>update('position',v)});
 const next=node.querySelector('audio');if(old&&next)next.replaceWith(old);audio.current=old??next;container.current=node;host.replaceChildren(node);if(focus)restoreWhenAttached(focus.id?[...host.querySelectorAll('[id]')].find(n=>n.id===focus.id):host.querySelectorAll('input,select,textarea,button,a')[focus.index],signal,focus);
 }
 function change(id,value){if(!ids.has(id)||value.length>500||busy||submitted)return;answers={...answers,[id]:value};dirty=true;saved=t.saving;persist();draw();}
 // Source multi controls must use CURRENT checked state, not a stale render closure.
 host.addEventListener('change',e=>{const field=e.target.closest?.('[data-listening-answer-control=multi]');if(!field)return;e.stopImmediatePropagation();const q=p.questions.find(q=>'answer-'+q.id===field.id);if(q)change(q.id,[...field.querySelectorAll('input')].flatMap((n,i)=>n.checked?[(/^[A-Z](?:\s|$)/.test(q.options[i])?q.options[i][0]:String.fromCharCode(65+i))]:[]).join(','));},{capture:true,signal});
 async function save(startAudio=false){if(saving||signal.aborted||submitted||busy)return;saving=true;const snapshot=JSON.stringify(answers);try{await api.request(`/api/listening/attempts/${p.attemptId}/draft`,{method:'PUT',timeoutMs:12000,body:{answers:{...answers},audioPosition:pos.current,startAudio},signal});if(signal.aborted)return;saved=t.saved;dirty=JSON.stringify(answers)!==snapshot;}catch{if(!signal.aborted)saved=t.deviceOnly;}finally{saving=false;if(!signal.aborted)draw();}}
 async function play(){if(signal.aborted||!audio.current||mediaDuration>0&&pos.current>=mediaDuration-.5)return;error='';try{if(audio.current.error){const media=audio.current,recover=pos.current;media.addEventListener('loadedmetadata',()=>{if(!signal.aborted&&Number.isFinite(recover))media.currentTime=recover;},{once:true,signal});media.load();}await audio.current.play();if(signal.aborted)return;started=true;void save(true);}catch{if(!signal.aborted)error=t.audioPlayFailed;}draw();}
 async function submit(){if(busy||submitted||signal.aborted)return;busy=true;error='';draw();try{await api.request(`/api/listening/attempts/${p.attemptId}/submit`,{method:'POST',timeoutMs:12000,body:{answers:p.questions.map(q=>({questionId:q.id,answer:answers[q.id]??''}))},signal});if(signal.aborted)return;submitted=true;clearListeningAttemptLocalState(p.attemptId);await context.navigate(p.sectionMode?`/app/listening/general/${p.testId}`:`/app/listening/tests/${p.testId}/2`);}catch(e){if(signal.aborted)return;if(e.status===409){context.refresh();return;}error=t.submitFailed;busy=false;draw();}}
 const timer=setInterval(()=>{if(dirty||started)void save(started);},5000);
 signal.addEventListener('abort',()=>{clearInterval(timer);audio.current?.pause();audio.current?.removeAttribute('src');audio.current?.load();composition.dispose?.();host.replaceChildren();},{once:true});
 if(!signal.aborted)draw();else clearInterval(timer);return host;
}
