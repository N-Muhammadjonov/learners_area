/** Optional on-device recognition only. Original audio is always the authority. */
export function createLocalTranscriptCapture({signal,Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition}={}){
 let engine=null,reason='on_device_recognition_unavailable',ended=false,stopping=false,resolveEnd=null;
 const fragments=new Map();
 const value=()=>{const text=[...fragments].sort((a,b)=>a[0]-b[0]).map(([,text])=>text).join('');return {text,status:text?'browser_unverified':'unavailable',reason};};
 const cancel=()=>{ended=true;try{engine?.abort();}catch{}resolveEnd?.();};
 signal?.addEventListener('abort',cancel,{once:true});
 return {
  start(){
   if(signal?.aborted||!Recognition)return;
   try{
    engine=new Recognition();
    // Never silently send a learner's speech to a browser vendor/cloud engine.
    if(!('processLocally' in engine)){engine=null;return;}
    engine.processLocally=true;engine.lang='en-US';engine.continuous=true;engine.interimResults=true;engine.maxAlternatives=1;
    reason='';
    engine.onresult=event=>{if(ended)return;for(let i=event.resultIndex;i<event.results.length;i++){
     const result=event.results[i];if(result.isFinal&&typeof result[0]?.transcript==='string')fragments.set(i,result[0].transcript);
    }};
    engine.onerror=event=>{reason=String(event.error||'recognition_failed');};
    engine.onend=()=>{if(!stopping)reason='recognition_ended_early';ended=true;resolveEnd?.();};
    engine.start();
   }catch{reason='recognition_unavailable';engine=null;}
  },
  async stop(){
   stopping=true;
   if(engine&&!ended){
    await new Promise(resolve=>{let timer;resolveEnd=()=>{clearTimeout(timer);resolve();};timer=setTimeout(resolveEnd,750);try{engine.stop();}catch{resolveEnd();}});
   }
   const result=value();cancel();signal?.removeEventListener('abort',cancel);return result;
  },
  cancel(){cancel();signal?.removeEventListener('abort',cancel);},
 };
}
