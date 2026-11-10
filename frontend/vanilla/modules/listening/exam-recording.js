import {api} from '../../js/api-client.js';
import {anySignal} from '../../js/signals.js';
import {audioResource,listeningAudio} from './audio-preload.js';

/** Source order and cumulative time for recordings uploaded as separate Parts. */
export function examRecording(url,testId,signal,parts=[],position=0){
 let duration=0;
 const tracks=(parts.length?parts:[{url,duration:0}]).map(part=>{
  const track={...part,offset:duration};
  duration+=part.duration;
  return track;
 });
 const at=value=>tracks.findLastIndex(track=>track.offset<=value);
 let index=at(position);
 let cached=null,heldResource=null;
 function release(){
  if(heldResource)listeningAudio.release(heldResource);
  cached=heldResource=null;
 }
 async function prepare(timeout){
  const track=tracks[index],resource=audioResource(track.url,window.location.origin);
  const stream=resource?resource+'?stream=1':track.url;
  if(cached||!resource||signal.aborted)return cached||stream;
  const deadline=anySignal([signal,AbortSignal.timeout(timeout)]);
  const candidate=await listeningAudio.acquire(resource,deadline,index===0?testId:undefined);
  if(!candidate)return stream;
  try{
   // Retained bytes are bound to the session and need a current resource grant.
   const grant=await api.request(resource+'?capability=1',{signal:deadline,fresh:true});
   if(Number.isFinite(grant.expiresAt)&&grant.expiresAt>Date.now()&&!deadline.aborted){
    cached=candidate;heldResource=resource;return cached;
   }
  }catch(error){
   if([401,403,404].includes(error.status))throw error;
  }finally{
   if(!cached)listeningAudio.release(resource);
  }
  return stream;
 }
 signal.addEventListener('abort',release,{once:true});
 return {
  prepare,duration,
  get offset(){return tracks[index].offset;},
  select(position){
   const next=at(position);
   if(next===index)return false;
   release();index=next;return true;
  },
  warmNext(){listeningAudio.warmResources(tracks.slice(index+1,index+2).map(track=>({url:track.url,priority:4})));},
  advance(){
   if(index+1>=tracks.length)return false;
   release();index++;return true;
  },
 };
}


export function recordingSeekReady(audio,position,signal){
 if(position<=0)return Promise.resolve();
 const deadline=anySignal([signal,AbortSignal.timeout(5000)]);
 return new Promise((resolve,reject)=>{
  const events=['loadedmetadata','seeked','canplay','error'];
  function finish(error){
   for(const event of events)audio.removeEventListener(event,check);
   deadline.removeEventListener('abort',abort);
   if(error)reject(error);else resolve();
  }
  const abort=()=>finish(deadline.reason);
  function check(){
   if(deadline.aborted)return abort();
   if(audio.error)return finish(Error('Recording unavailable'));
   if(audio.readyState>0&&!audio.seeking&&Math.abs(audio.currentTime-position)<.25)finish();
  }
  for(const event of events)audio.addEventListener(event,check);
  deadline.addEventListener('abort',abort,{once:true});
  check();
 });
}
