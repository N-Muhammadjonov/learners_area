import {el} from '../../js/dom.js';
import {prepareRecordingPlayback,releaseRecordingPlayback} from './recording-playback.js';

/** Decode the final recording before enabling Play. A user's first click resumes
 * the audio context before starting its buffer; no muted warm-up or second play.
 * Keep the original container as a native fallback and for the existing upload.
 * All bytes stay local. This component owns no object URL or microphone. */
export function createRecordingPreview({blob,url,dict,label}){
 const t=dict.videoLesson.directPlayer;
 const node=el('div',{class:'w-full min-w-0','data-recording-preview':'preparing'});
 const audio=el('audio',{src:url,controls:'',preload:'auto',class:'w-full max-w-full','aria-label':label});
 const play=el('button',{type:'button',class:'btn-secondary shrink-0',disabled:true,'aria-label':t.play},'▶');
 const seek=el('input',{type:'range',min:'0',max:'0',step:'0.01',value:'0',disabled:true,class:'min-w-0 flex-1','aria-label':t.seek});
 const clock=el('span',{class:'shrink-0 text-xs text-ink-600','aria-live':'off'},'0:00 / 0:00');
 const error=el('p',{class:'text-sm text-warn-700',role:'alert'});
 const status=el('p',{class:'text-xs text-ink-500',role:'status'},dict.videoLesson.voiceSummary.preparing);
 const controls=el('div',{class:'flex w-full items-center gap-3 rounded-xl border border-ink-200 p-3',role:'group','aria-label':label},play,seek,clock);
 node.append(audio,controls,status,error);
 prepareRecordingPlayback(audio);
 let context=null,buffer=null,source=null,offset=0,started=0,timer=null,playing=false,pending=false,dead=false,decodeTimer=null;
 let generation=0;
 const life=new window.AbortController(),signal=life.signal;
 const format=value=>{const s=Math.floor(Math.max(0,value));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
 const position=()=>Math.min(buffer?.duration??0,offset+(playing?context.currentTime-started:0));
 function paint(){
  const pos=position(),total=buffer?.duration??0;
  seek.value=String(pos);seek.setAttribute('aria-valuetext',`${format(pos)} / ${format(total)}`);
  clock.textContent=`${format(pos)} / ${format(total)}`;
  play.textContent=playing?'❚❚':'▶';play.setAttribute('aria-label',playing?t.pause:t.play);
  play.setAttribute('aria-pressed',String(playing));
 }
 function pause(){
  generation++;pending=false;
  if(playing)offset=position();
  playing=false;clearInterval(timer);timer=null;
  if(source){source.onended=null;try{source.stop();}catch{}source.disconnect();source=null;}
  audio.pause();paint();
 }
 async function start(){
  if(dead||pending||!buffer)return;
  pending=true;const token=++generation;error.textContent='';
  try{
   // resume() is invoked synchronously inside this click, before any await.
   await context.resume();
   if(dead||token!==generation)return;
   if(context.state!=='running')throw new Error('Audio output is suspended');
   if(offset>=buffer.duration)offset=0;
   const next=context.createBufferSource();next.buffer=buffer;next.connect(context.destination);
   next.onended=()=>{if(source!==next||dead)return;offset=buffer.duration;pause();offset=buffer.duration;paint();};
   source=next;started=context.currentTime;playing=true;next.start(0,offset);
   node.dataset.recordingPreview='ready';timer=setInterval(paint,150);paint();
  }catch{if(!dead&&token===generation){pause();error.textContent=dict.common.error;}}
  finally{if(token===generation)pending=false;}
 }
 play.addEventListener('click',()=>{if(playing||pending)pause();else void start();},{signal});
 seek.addEventListener('input',()=>{const resume=playing,value=Number(seek.value)||0;pause();offset=Math.max(0,Math.min(value,buffer?.duration??0));paint();if(resume)void start();},{signal});
 const visibility=()=>{if(document.visibilityState==='hidden')pause();};
 document.addEventListener('visibilitychange',visibility,{signal});
 window.addEventListener('pagehide',pause,{signal});
 function closeContext(){if(context){const old=context;context=null;try{Promise.resolve(old.close()).catch(()=>{});}catch{}}}
 function fallback(){
  if(dead)return;
  clearTimeout(decodeTimer);pause();closeContext();buffer=null;
  controls.hidden=true;status.hidden=true;audio.hidden=false;node.dataset.recordingPreview='native';
 }
 const AudioContext=globalThis.AudioContext??globalThis.webkitAudioContext??window.AudioContext??window.webkitAudioContext;
 let ready;
 if(!AudioContext||!blob?.arrayBuffer){fallback();ready=Promise.resolve();}
 else{
  audio.hidden=true;
  ready=(async()=>{
   try{
    context=new AudioContext();const decodingContext=context;
    // Decoding can run while suspended; output starts only from the Play gesture.
    const suspended=context.suspend();
    context.onstatechange=()=>{if(playing&&context?.state!=='running')pause();};
    const decoded=await Promise.race([
     blob.arrayBuffer().then(bytes=>decodingContext.decodeAudioData(bytes)),
     new Promise((_,reject)=>{decodeTimer=setTimeout(()=>reject(new Error('Decode timeout')),12000);}),
    ]);
    await suspended;clearTimeout(decodeTimer);
    if(dead)return;
    if(!(decoded.duration>0)||!Number.isFinite(decoded.duration))throw new Error('Empty recording');
    buffer=decoded;seek.max=String(buffer.duration);seek.disabled=false;play.disabled=false;
    status.hidden=true;node.dataset.recordingPreview='ready';paint();
   }catch{fallback();}
  })();
 }
 return {node,ready,pause,destroy(){if(dead)return;pause();dead=true;clearTimeout(decodeTimer);life.abort();releaseRecordingPlayback(audio);closeContext();buffer=null;node.remove();}};
}
