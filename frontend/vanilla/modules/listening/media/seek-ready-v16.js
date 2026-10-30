/** A queued resume seek must settle before native play, not merely before metadata.
 * Cancellation removes every temporary listener; outer owned-command timeout remains. */
export function seekReady(controller,signal){
 const audio=controller.audio;
 if(!controller.disposed&&!signal.aborted&&!audio.error&&controller.pendingSeek===null&&!audio.seeking)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const events=['loadedmetadata','durationchange','seeked','canplay','error'];
  const cleanup=()=>{for(const event of events)audio.removeEventListener(event,check);signal.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();reject(new DOMException('Playback cancelled','AbortError'));};
  function check(){if(signal.aborted||controller.disposed)return abort();if(audio.error){cleanup();reject(new DOMException('Media unavailable','NotSupportedError'));return;}if(controller.pendingSeek===null&&!audio.seeking){cleanup();resolve();}}
  for(const event of events)audio.addEventListener(event,check);signal.addEventListener('abort',abort,{once:true});check();
 });
}
