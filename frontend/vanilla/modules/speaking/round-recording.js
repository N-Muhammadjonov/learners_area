/** Record the already-open microphone. No second permission request or upload. */
export function createRoundRecording(stream,{Recorder=globalThis.MediaRecorder}={}){
 if(!stream||!Recorder)return null;
 const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg','audio/mp4'].find(type=>Recorder.isTypeSupported?.(type));
 const recorder=new Recorder(stream,mime?{mimeType:mime}:undefined),chunks=[];
 let done=false,pending=null;
 recorder.addEventListener('dataavailable',event=>{if(event.data?.size)chunks.push(event.data);});
 recorder.start(250);
 return {stop(){
  if(pending)return pending;
  if(done)return Promise.resolve(null);
  done=true;
  pending=new Promise(resolve=>{
   let timer;
   const finish=()=>{clearTimeout(timer);resolve(chunks.length?new Blob(chunks,{type:recorder.mimeType||mime||'audio/webm'}):null);};
   recorder.addEventListener('stop',finish,{once:true});
   recorder.addEventListener('error',()=>{clearTimeout(timer);resolve(null);},{once:true});
   timer=setTimeout(()=>resolve(null),5000);
   try{recorder.stop();}catch{clearTimeout(timer);resolve(null);}
  });
  return pending;
 }};
}
