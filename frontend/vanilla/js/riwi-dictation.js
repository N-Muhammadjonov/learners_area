import {createRecorder} from '../modules/speaking/recorder.js';
export async function decodeDictationAudio(blob){
 const Context=globalThis.OfflineAudioContext??globalThis.webkitOfflineAudioContext;
 if(!Context)throw Error('dictation_unsupported');
 const context=new Context(1,1,16000),decoded=await context.decodeAudioData(await blob.arrayBuffer());
 if(decoded.length>16000*65)throw Error('dictation_audio_limit');
 const audio=new Float32Array(decoded.length);
 for(let channel=0;channel<decoded.numberOfChannels;channel++){
  const values=decoded.getChannelData(channel);for(let i=0;i<values.length;i++)audio[i]+=values[i]/decoded.numberOfChannels;
 }
 return audio;
}
export function createLocalDictation({signal,onState,onText,recorderFactory=createRecorder,decode=decodeDictationAudio,Worker=globalThis.Worker}={}){
 let phase='idle',recorder,worker,clock,deadline,epoch=0,started=0,request=0,language='auto',ready=false;
 const emit=(next,extra={})=>{phase=next;onState?.({phase,elapsedMs:Date.now()-started,progress:ready?1:undefined,...extra});};
 const stopTimers=()=>{clearInterval(clock);clearTimeout(deadline);};
 function cancel(){epoch++;stopTimers();recorder?.cancel();recorder=null;worker?.terminate();worker=null;ready=false;phase='idle';}
 function failure(code){cancel();if(!signal?.aborted)emit('idle',{error:code});}
 function ensureWorker(){
  if(worker)return;
  if(!Worker)throw Error('dictation_unsupported');
  worker=new Worker(new URL('./riwi-speech-worker.js',import.meta.url),{type:'module'});
  const current=worker;
  worker.onmessage=({data})=>{
   if(signal?.aborted||worker!==current)return;
   if(data.type==='ready'){ready=true;onState?.({phase,progress:1,elapsedMs:Date.now()-started});}
   if(data.type==='progress')onState?.({phase,progress:data.progress,elapsedMs:Date.now()-started});
   if(data.type==='error')failure(data.code);
   if(data.type==='result'&&data.id===request){stopTimers();emit('idle');onText?.(data.text);}
  };
  worker.onerror=()=>{if(worker===current)failure('dictation_unavailable');};worker.postMessage({type:'load'});
 }
 async function start(){
  if(phase!=='idle'||signal?.aborted)return;const id=++epoch;emit('opening');
  try{
   ensureWorker();const next=await recorderFactory({signal});
   if(id!==epoch||signal?.aborted){next.cancel();return;}recorder=next;await next.start();
   if(id!==epoch||signal?.aborted){next.cancel();return;}started=Date.now();emit('recording');
   clock=setInterval(()=>{if(Date.now()-started>=60000)void stop();else emit('recording');},250);
  }catch(error){if(id===epoch)failure(error.code??error.message??'dictation_unavailable');}
 }
 async function stop(){
  if(phase!=='recording'||!recorder)return;
  const id=epoch,current=recorder;recorder=null;stopTimers();emit('transcribing');
  deadline=setTimeout(()=>failure('dictation_timeout'),180000);
  try{
   const result=await current.stop();if(id!==epoch||signal?.aborted)return;
   if(!result?.size)throw Error('dictation_no_speech');const audio=await decode(result.blob);
   if(id!==epoch||signal?.aborted)return;worker.postMessage({type:'transcribe',id:++request,language,audio},[audio.buffer]);
  }catch(error){if(id===epoch)failure(error.code??error.message??'dictation_unavailable');}
 }
 signal?.addEventListener('abort',cancel,{once:true});
 return {start,stop,cancel,setLanguage(value){if(['auto','uz','en'].includes(value))language=value;},get phase(){return phase;}};
}
export function dictationError(code,locale='uz'){
 const text={permission_denied:['Mikrofonga ruxsat berilmadi. Brauzer ruxsatini tekshiring.','Microphone permission was denied. Check browser permissions.'],
  no_microphone:['Mikrofon topilmadi.','No microphone was found.'],
  dictation_no_speech:['Gap aniqlanmadi. Tiniqroq gapirib, qayta urinib ko‘ring.','No speech was detected. Try speaking clearly again.'],
  dictation_text_limit:['Ovoz matni 4000 belgidan oshdi. Qisqaroq yozib oling.','The transcript exceeds 4,000 characters. Record a shorter prompt.'],
  dictation_timeout:['Qurilmada matnga aylantirish juda uzoq davom etdi. Qisqaroq yozuv bilan qayta urinib ko‘ring.','On-device transcription took too long. Try a shorter recording.'],
  dictation_unsupported:['Bu qurilma yoki brauzerda mahalliy ovoz yozuvi ishlamaydi.','Local voice input is unavailable on this device or browser.']};
 return (text[code]??['Qurilmada ovozni matnga aylantira olmadim. Model yuklanishini yoki boshqa brauzerni tekshiring. Ovoz tashqi xizmatga yuborilmadi.','On-device transcription failed. Check the model download or try another browser. Audio was not sent to an external service.'])[locale==='en'?1:0];
}
