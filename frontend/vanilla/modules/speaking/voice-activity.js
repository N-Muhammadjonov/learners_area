/** Local energy activity only. No recording, recognition, upload or audio output. */
export const CALIBRATION_MS=1200;
const audioError=code=>Object.assign(Error(code),{code});
/** @param {ArrayLike<number>} samples @returns {number} */
export function rmsEnergy(samples){
 if(!samples.length)return 0;
 let mean=0,total=0;for(const value of samples){if(!Number.isFinite(value))throw audioError('invalid_signal');mean+=value;}mean/=samples.length;
 for(const value of samples)total+=(value-mean)**2;
 return Math.sqrt(total/samples.length);
}
/** Time-based smoothing, calibrated noise floor and separate onset/release thresholds.
 * @param {{speechActivationMs:number,speechReleaseMs:number,sensitivity:number}} config */
export function createEnergyDetector(config){
 let began=null,last=null,levels=[],floor=.001,energy=0,onset=0,release=0,speaking=false,ready=false;
 return {sample(rms,at){
  if(!Number.isFinite(rms)||rms<0||!Number.isFinite(at))throw audioError('invalid_signal');
  if(last!==null&&at<last)throw audioError('invalid_signal');
  began??=at;const dt=last===null?0:Math.min(100,at-last);last=at;
  energy+=(rms-energy)*(1-Math.exp(-dt/65));
  if(!ready){
   levels.push(rms);
   if(at-began>=CALIBRATION_MS&&levels.length>=12){
    const sorted=[...levels].sort((a,b)=>a-b);floor=sorted[Math.floor(sorted.length*.6)];
    if(sorted.at(-1)<.0000001)throw audioError('no_signal');
    if(floor>.045)throw audioError('too_noisy');
    ready=true;levels=[];energy=floor;
   }
  }else{
   const threshold=Math.max(.007,floor*2.8)/config.sensitivity;
   if(!speaking){
    onset=energy>=threshold?onset+dt:0;
    if(onset>=config.speechActivationMs){speaking=true;release=0;}
    else if(energy<threshold*.65)floor+=(rms-floor)*(1-Math.exp(-dt/5000));
   }else{
    release=energy<threshold*.6?release+dt:0;
    if(release>=config.speechReleaseMs){speaking=false;onset=0;}
   }
  }
  return {ready,speaking,energy,noiseFloor:floor,level:Math.min(1,energy/.12)};
 }};
}
/** @param {{signal?:AbortSignal,onInterrupted?:(code:string)=>void,mediaDevices?:MediaDevices,AudioContextClass?:typeof AudioContext,timeoutMs?:number,setTimer?:typeof setTimeout,clearTimer?:typeof clearTimeout}} options */
export function createVoiceInput({signal,onInterrupted=()=>{},mediaDevices=globalThis.navigator?.mediaDevices,AudioContextClass=globalThis.AudioContext??globalThis.webkitAudioContext,timeoutMs=30000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let context=null,stream=null,source=null,analyser=null,buffer=null,disposed=false,promise=null,timer=null,rejectCancel=null;
 const listeners=[];
 function watch(target,event,handler){target.addEventListener(event,handler);listeners.push(()=>target.removeEventListener(event,handler));}
 function dispose(){
  if(disposed)return;disposed=true;clearTimer(timer);signal?.removeEventListener('abort',dispose);listeners.splice(0).forEach(remove=>remove());
  source?.disconnect();analyser?.disconnect();stream?.getTracks().forEach(track=>track.stop());stream=null;source=null;analyser=null;buffer=null;
  if(context){const closing=context;context=null;void closing.close().catch(()=>{});}
  rejectCancel?.(audioError('cancelled'));rejectCancel=null;
 }
 function open(){
  if(promise)return promise;
  if(disposed||signal?.aborted)return Promise.reject(audioError('cancelled'));
  if(!mediaDevices?.getUserMedia||!AudioContextClass)return Promise.reject(audioError('unsupported'));
  // Both calls happen before the first await, preserving the Start user gesture.
  try{
   context=new AudioContextClass();
   const resumed=context.state==='running'?Promise.resolve():context.resume();
   const requested=mediaDevices.getUserMedia({video:false,audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false}}).then(media=>{
    if(disposed){media.getTracks().forEach(track=>track.stop());throw audioError('cancelled');}stream=media;return media;
   });
   const cancelled=new Promise((_,reject)=>{rejectCancel=reject;timer=setTimer(()=>{reject(audioError('permission_timeout'));dispose();},timeoutMs);});
   promise=Promise.race([Promise.all([requested,resumed]),cancelled]).then(()=>{
    clearTimer(timer);
    if(disposed)throw audioError('cancelled');
    if(context.state!=='running')throw audioError('audio_suspended');
    const tracks=stream.getAudioTracks();if(!tracks.length||tracks.some(track=>track.readyState!=='live'||track.muted))throw audioError('device_interrupted');
    analyser=context.createAnalyser();analyser.fftSize=1024;source=context.createMediaStreamSource(stream);source.connect(analyser);buffer=new Float32Array(analyser.fftSize);
    for(const track of tracks){watch(track,'ended',()=>onInterrupted('device_interrupted'));watch(track,'mute',()=>onInterrupted('device_interrupted'));}
    watch(context,'statechange',()=>{if(!disposed&&context.state!=='running')onInterrupted('audio_suspended');});
   }).catch(error=>{dispose();throw error;});
  }catch(error){dispose();return Promise.reject(error);}
  return promise;
 }
 if(signal?.aborted)dispose();else signal?.addEventListener('abort',dispose,{once:true});
 return {open,dispose,sample(){if(disposed||!analyser||context.state!=='running')throw audioError('audio_suspended');analyser.getFloatTimeDomainData(buffer);return {rms:rmsEnergy(buffer),samples:buffer};}};
}
