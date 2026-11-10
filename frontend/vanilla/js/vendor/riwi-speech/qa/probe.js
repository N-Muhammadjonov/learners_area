import {decodeDictationAudio} from '../../../riwi-dictation.js';
let worker;const result=document.querySelector('#result'),progress=document.querySelector('progress');
for(const language of ['en','uz'])document.getElementById(language).onclick=async()=>{
 document.querySelectorAll('button').forEach(x=>x.disabled=true);const start=performance.now();result.textContent='Loading local speech model…';
 try{
  const fixtures=await(await fetch('fixtures.json')).json(),fixture=fixtures.find(x=>x.language===language),blob=await(await fetch(fixture.file)).blob(),audio=await decodeDictationAudio(blob);
  if(!worker)worker=new Worker(new URL('../../../riwi-speech-worker.js',import.meta.url),{type:'module'});
  const data=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('fixture_timeout')),240000);
   worker.onmessage=({data})=>{if(data.type==='progress'){progress.value=data.progress;result.textContent=`Downloading local model: ${Math.round(data.progress*100)}%`;}if(data.type==='ready'){progress.value=1;result.textContent='Transcribing locally…';}if(['result','error'].includes(data.type)){clearTimeout(timeout);resolve(data);}};
   worker.onerror=event=>{clearTimeout(timeout);reject(Error(event.message));};
   worker.postMessage({type:'transcribe',id:language,language,audio,diagnostic:true},[audio.buffer]);
  });
  result.textContent=JSON.stringify({language,expected:fixture.expected,...data,elapsedMs:Math.round(performance.now()-start)},null,2);
 }catch(error){result.textContent='ERROR: '+error.message;worker?.terminate();worker=null;}
 document.querySelectorAll('button').forEach(x=>x.disabled=false);
};
