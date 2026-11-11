import {listen} from '../../js/dom.js';

export function partnerMedia(host,signal){
 const streams={},sources={},levels={};
 let context,timer,lock,requesting=false,connected=false;
 function detach(side){sources[side]?.source.disconnect();sources[side]?.analyser.disconnect();delete sources[side];levels[side]=0;}
 function paint(){
  for(const side of ['local','remote']){
   const meter=host.querySelector('[data-partner-meter="'+side+'"]');
   if(meter)meter.value=levels[side]??0;
  }
 }
 function sample(){
  for(const [side,{analyser,buffer}] of Object.entries(sources)){
   analyser.getFloatTimeDomainData(buffer);
   let power=0;for(const value of buffer)power+=value*value;
   levels[side]=Math.min(1,Math.sqrt(power/buffer.length)*6);
  }
  paint();
 }
 function attach(side){
  if(!streams[side]||!context||sources[side])return;
  const source=context.createMediaStreamSource(streams[side]),analyser=context.createAnalyser();
  analyser.fftSize=256;source.connect(analyser);sources[side]={source,analyser,buffer:new Float32Array(analyser.fftSize)};
  timer??=setInterval(sample,125);
 }
 function unlock(){
  const Audio=window.AudioContext??window.webkitAudioContext;
  if(signal.aborted||!Audio||!Object.values(streams).some(Boolean))return;
  try{context??=new Audio();if(context.state!=='running')void context.resume().catch(()=>{});for(const side of Object.keys(streams))attach(side);}catch{}
 }
 function stream(side,value){
  if(signal.aborted||streams[side]===value)return;
  detach(side);streams[side]=value;
  if(value)unlock();
  if(!Object.values(streams).some(Boolean)){clearInterval(timer);timer=null;}
  paint();
 }
 async function wake(){
  if(!connected||document.visibilityState!=='visible'||signal.aborted){
   const previous=lock;lock=null;await previous?.release().catch(()=>{});return;
  }
  if(lock||requesting||!navigator.wakeLock)return;
  requesting=true;
  try{
   const sentinel=await navigator.wakeLock.request('screen');
   if(!connected||signal.aborted||document.visibilityState!=='visible'){await sentinel.release();return;}
   lock=sentinel;
   lock.addEventListener('release',()=>{if(lock===sentinel)lock=null;},{once:true});
  }catch{}finally{requesting=false;}
 }
 listen(host,'pointerdown',unlock,signal);
 listen(document,'visibilitychange',wake,signal);
 signal.addEventListener('abort',()=>{
  clearInterval(timer);for(const side of Object.keys(streams))detach(side);
  if(context)void context.close().catch(()=>{});connected=false;void wake();
 },{once:true});
 return {stream,paint,connected(value){connected=value;void wake();}};
}
