import {el} from '../../js/dom.js';
import {formatClock} from './provider.js';

/** Owner-authorised direct media (original src/components/courses/DirectMediaPlayer.tsx): native <video> with our
 * controls, a WebVTT track, keyboard shortcuts and reported position. No autoplay; playback starts only on a user action. */
const SPEEDS=[0.75,1,1.25,1.5];
export function createDirectPlayer({src,captions,title,labels,onTime,onPulse,signal}){
 let failed=false,ccOn=true;
 const video=el('video',{class:'absolute inset-0 h-full w-full',src,title,preload:'metadata',playsinline:'',crossorigin:'anonymous',controlslist:'nodownload'});
 if(captions)video.append(el('track',{kind:'captions',src:captions,srclang:'en',label:'English',default:''}));
 const error=el('p',{role:'alert',class:'bg-warn-50 px-3 py-2 text-sm text-warn-800'},labels.error);
 error.hidden=true;
 const playButton=el('button',{type:'button',class:'btn-ghost btn-sm'});
 const time=el('span',{class:'font-mono text-xs tabular-nums'});
 const seek=el('input',{type:'range','aria-label':labels.seek,min:0,max:1,step:1,value:0,class:'flex-1'});
 const ccButton=captions?el('button',{type:'button',class:'btn-ghost btn-sm'}):null;
 const speed=el('select',{class:'rounded bg-ink-900 px-1 text-white'},SPEEDS.map(s=>el('option',{value:String(s)},`${s}×`)));
 const fullscreenButton=el('button',{type:'button',class:'btn-ghost btn-sm','aria-label':labels.fullscreen},'⛶');
 const frame=el('div',{class:'relative aspect-video w-full'},video);
 const bar=el('div',{class:'flex items-center gap-2 px-3 py-2 text-sm'},playButton,time,seek,ccButton,el('label',{class:'flex items-center gap-1 text-xs'},el('span',{},labels.speed),speed),fullscreenButton);
 const container=el('div',{class:'flex flex-col bg-ink-950 text-white','data-direct-player':''},frame,error,bar);
 seek.max=1;
 paintPlay();paintCc();

 function fail(){failed=true;error.hidden=false;}
 function paintPlay(){
  playButton.textContent=video.paused?'▶':'❚❚';
  playButton.setAttribute('aria-label',video.paused?labels.play:labels.pause);
 }
 function paintTime(){
  const duration=Number.isFinite(video.duration)?video.duration:0;
  time.textContent=`${formatClock(video.currentTime||0)} / ${formatClock(duration)}`;
  seek.max=Math.max(1,Math.floor(duration));
  seek.value=String(Math.floor(video.currentTime||0));
 }
 function paintCc(){
  const track=video.textTracks?.[0];
  if(track)track.mode=ccOn?'showing':'hidden';
  if(ccButton){
   ccButton.setAttribute('aria-pressed',String(ccOn));
   ccButton.textContent=ccOn?labels.captionsOn:labels.captionsOff;
  }
 }
 function toggle(){
  if(video.paused)video.play().catch(fail);
  else video.pause();
 }
 async function fullscreen(){
  try{
   if(document.fullscreenElement)await document.exitFullscreen();
   else if(container.requestFullscreen)await container.requestFullscreen();
   else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();
   else fail();
  }catch{fail();}
 }

 function pulse(force=false){
  if(!onPulse)return;
  const now=Date.now();
  if(!force&&now-(video._coinPulse||0)<15000)return;
  video._coinPulse=now;
  onPulse({positionMs:Math.round((video.currentTime||0)*1000),playbackRate:Number(video.playbackRate)||1,
   playing:!video.paused&&!video.seeking&&document.visibilityState==='visible',
   durationMs:Number.isFinite(video.duration)?Math.round(video.duration*1000):null});
 }
 for(const event of ['play','pause','seeking','seeked','ratechange','ended'])video.addEventListener(event,()=>pulse(true),{signal});
 document.addEventListener('visibilitychange',()=>pulse(true),{signal});
 video.addEventListener('click',toggle,{signal});
 video.addEventListener('play',paintPlay,{signal});
 video.addEventListener('pause',paintPlay,{signal});
 video.addEventListener('loadedmetadata',()=>{paintTime();paintCc();},{signal});
 video.addEventListener('timeupdate',()=>{
  paintTime();
  onTime?.(video.currentTime);
  if(!video.paused&&document.visibilityState==='visible')pulse();
 },{signal});
 video.addEventListener('error',fail,{signal});
 playButton.addEventListener('click',toggle,{signal});
 fullscreenButton.addEventListener('click',()=>void fullscreen(),{signal});
 seek.addEventListener('input',()=>{video.currentTime=Number(seek.value);},{signal});
 speed.addEventListener('change',()=>{video.playbackRate=Number(speed.value);},{signal});
 ccButton?.addEventListener('click',()=>{ccOn=!ccOn;paintCc();},{signal});
 container.addEventListener('keydown',event=>{
  if(event.key===' '||event.key==='k'){event.preventDefault();toggle();}
  else if(event.key==='ArrowRight'){event.preventDefault();video.currentTime=Math.min(video.duration||Infinity,video.currentTime+5);}
  else if(event.key==='ArrowLeft'){event.preventDefault();video.currentTime=Math.max(0,video.currentTime-5);}
  else if(event.key==='c'){event.preventDefault();ccOn=!ccOn;paintCc();}
 },{signal});

 function seekTo(seconds){
  video.currentTime=Math.max(0,seconds);
  video.play().catch(()=>{});
 }
 function destroy(){
  video.pause();
  video.removeAttribute('src');
  video.load();
 }
 return {node:container,seekTo,destroy,get failed(){return failed;}};
}

