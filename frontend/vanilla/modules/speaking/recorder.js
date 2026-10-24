import {el,listen} from '../../js/dom.js';
/** Port of src/lib/audio/recorder.ts and LocalAnswerRecorder.tsx.
 * Local practice recordings never leave the browser. The stop/cancel methods
 * release media tracks even on cancellation, rejection and route exit. */
const CANDIDATES=[['audio/webm;codecs=opus','webm'],['audio/webm','webm'],['audio/ogg;codecs=opus','ogg'],['audio/mp4','m4a'],['audio/aac','aac'],['','webm']];
export class RecorderError extends Error{constructor(code){super(code);this.code=code;this.name='RecorderError';}}
export const isSupported=()=>typeof MediaRecorder!=='undefined'&&!!navigator.mediaDevices?.getUserMedia;
export const duration=ms=>{const s=Math.max(0,Math.round(ms/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
export const extensionForMime=m=>{const match=CANDIDATES.find(c=>c[0]===m);return match?.[1]??(m.includes('mp4')?'m4a':m.includes('ogg')?'ogg':'webm');};
export async function createRecorder({signal,permissionTimeoutMs=30000}={}){
 if(!isSupported())throw new RecorderError('unsupported');
 const pair=CANDIDATES.find(([mime])=>!mime||MediaRecorder.isTypeSupported(mime));if(!pair)throw new RecorderError('unsupported');
 const ctl=new AbortController();const timeout=setTimeout(()=>ctl.abort(),permissionTimeoutMs);
 const abort=()=>ctl.abort();signal?.addEventListener('abort',abort,{once:true});
 let tracks;
 try{
  const pending=navigator.mediaDevices.getUserMedia({audio:true});
  // Permission may resolve *after* timeout/route exit; close every late track.
  pending.then(s=>{if(ctl.signal.aborted)s.getTracks().forEach(t=>t.stop());}).catch(()=>{});
  tracks=await Promise.race([pending,new Promise((_,reject)=>ctl.signal.addEventListener('abort',()=>reject(new RecorderError('unknown')),{once:true}))]);
  if(ctl.signal.aborted){tracks.getTracks().forEach(t=>t.stop());throw new RecorderError('unknown');}
 }catch(e){
  if(e instanceof RecorderError)throw e;
  throw new RecorderError(['NotAllowedError','SecurityError'].includes(e?.name)?'permission_denied':['NotFoundError','OverconstrainedError'].includes(e?.name)?'no_microphone':'unknown');
 }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
 let mr;try{mr=new MediaRecorder(tracks,pair[0]?{mimeType:pair[0]}:undefined);}catch{tracks.getTracks().forEach(t=>t.stop());throw new RecorderError('unknown');}
 const pieces=[];let started=Date.now(),stopped=false;
 mr.addEventListener('dataavailable',e=>{if(e.data?.size)pieces.push(e.data);});
 const release=()=>tracks.getTracks().forEach(t=>t.stop());
 const cancel=()=>{if(stopped)return;stopped=true;try{if(mr.state!=='inactive')mr.stop();}catch{}release();};
 return {
  async start(){if(stopped)throw new RecorderError('unknown');mr.start(250);started=Date.now();},
  stop(){if(stopped)return Promise.resolve(null);stopped=true;return new Promise(resolve=>{
   const timer=setTimeout(()=>{release();resolve(null);},5000);
   mr.addEventListener('stop',()=>{clearTimeout(timer);release();if(!pieces.length){resolve(null);return;}
    const blob=new Blob(pieces,{type:mr.mimeType||pair[0]||'audio/webm'});resolve({blob,mimeType:blob.type,size:blob.size,durationMs:Date.now()-started});
   },{once:true});try{mr.stop();}catch{clearTimeout(timer);release();resolve(null);}
  });},cancel,elapsedMs:()=>Date.now()-started
 };
}
/** Native local-only Practice answer recording. Mirrors preparation and answer limits. */
export function localAnswerRecorder(context,{id,part,lock}){
 const t=context.dict.speakingStudy,{signal}=context;
 const host=el('div',{class:'mt-3 space-y-3','data-local-recorder':id}),actions=el('div',{class:'flex flex-wrap gap-2'}),output=el('div',{}),err=el('p',{role:'alert',class:'text-band-bad'});
 host.append(actions,output,err);
 const limit=part==='part2'?120:part==='part3'?45:30;
 let phase='idle',epoch=0,record=null,media=null,objectURL=null,timer=null,started=0,prepStart=0,busy=false,getting=false;
 const clear=()=>{if(timer)clearInterval(timer);timer=null;};
 const releaseAudio=()=>{output.querySelector('audio')?.pause();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;output.replaceChildren();};
 const destroy=()=>{epoch++;clear();record?.cancel();record=null;releaseAudio();getting=false;busy=false;lock(id,false);};
 signal.addEventListener('abort',destroy,{once:true});
 function setBusy(v){if(busy!==v){busy=v;lock(id,v);}}
 function render(){if(signal.aborted)return;actions.replaceChildren();
  const b=(label,fn,cls='btn-secondary',attrs={})=>{const x=el('button',{type:'button',class:cls+' min-h-11',...attrs},label);listen(x,'click',fn,signal);actions.append(x);return x;};
  if(phase==='idle')b('● '+(media?t.recordAgain:t.record),()=>{if(part==='part2'){phase='preparing';prepStart=Date.now();setBusy(true);startClock();render();}else void start();},'btn-secondary',{disabled:lock(id,'isLocked')?'':null});
  if(phase==='preparing'){actions.append(el('span',{role:'status','data-prep-count':''},`${t.prepare} ${duration(Math.max(0,60000-(Date.now()-prepStart)))}`));b(`${t.talk} 2:00`,()=>void start(),'btn-primary');b(t.cancel,()=>{clear();phase='idle';setBusy(false);render();});}
  if(phase==='recording'){actions.append(el('span',{role:'status','data-record-count':''},`${duration(Date.now()-started)} / ${duration(limit*1000)}`));b('■ '+t.stop,()=>void stop(),'btn-primary');}
  if(phase==='starting'||phase==='stopping')actions.append(el('span',{role:'status'},phase==='starting'?t.openingMic:t.preparingRecording));
  if(phase==='idle'&&objectURL){output.replaceChildren(el('div',{class:'flex flex-wrap items-center gap-2'},el('audio',{src:objectURL,controls:'',preload:'metadata',class:'max-w-full','aria-label':t.playback})));b(t.deleteRecording,()=>{releaseAudio();media=null;err.textContent='';render();},'btn-secondary',{'data-delete-recording':id});}
 }
 function startClock(){clear();timer=setInterval(()=>{if(phase==='preparing'){const left=60000-(Date.now()-prepStart);const n=actions.querySelector('[data-prep-count]');if(n)n.textContent=`${t.prepare} ${duration(left)}`;if(left<=0)void start();}if(phase==='recording'){const elapsed=Date.now()-started;const n=actions.querySelector('[data-record-count]');if(n)n.textContent=`${duration(elapsed)} / ${duration(limit*1000)}`;if(elapsed>=limit*1000)void stop();}},200);}
 async function start(){if(getting||signal.aborted)return;getting=true;const e=++epoch;clear();releaseAudio();media=null;setBusy(true);phase='starting';render();err.textContent='';
  try{
   try{const c=new AbortController(),clock=setTimeout(()=>c.abort(),5000);const res=await fetch('/api/live-partner',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'practice_started'}),signal:c.signal});clearTimeout(clock);if(res.status===409)throw new RecorderError('liveCallActive');}catch(x){if(x.code==='liveCallActive')throw x;}
   const next=await createRecorder({signal});if(e!==epoch||signal.aborted){next.cancel();return;}record=next;await next.start();if(e!==epoch||signal.aborted){next.cancel();return;}started=Date.now();phase='recording';startClock();render();
  }catch(error){if(e!==epoch||signal.aborted)return;record?.cancel();record=null;phase='idle';setBusy(false);err.textContent=error?.code==='liveCallActive'?context.dict.speakingPractice.errors.liveCallActive:context.dict.speakingPractice.errors[error?.code]??t.micError;render();}
  finally{getting=false;}
 }
 async function stop(){if(phase!=='recording'||!record)return;const e=epoch,current=record;record=null;clear();phase='stopping';render();try{const result=await current.stop();if(e!==epoch||signal.aborted)return;if(result?.size){media=result;objectURL=URL.createObjectURL(result.blob);}else err.textContent=t.noAudio;}catch{if(e===epoch)err.textContent=t.micError;}finally{if(e===epoch&&!signal.aborted){phase='idle';setBusy(false);render();}}}
 render();return {node:host,stop:destroy};
}
