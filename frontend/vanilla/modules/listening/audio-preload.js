import {privateScope} from '../../js/private-scope.js';

export function audioResource(value,origin=globalThis.location?.origin){
 try{const u=new URL(value,origin);if(u.origin!==origin||!u.pathname.startsWith('/api/resources/')||u.pathname==='/api/resources/'||/[\\\s]/.test(value)||/%2f|%5c|%2e/i.test(u.pathname))return null;return u.pathname;}catch{return null;}
}

/** Complete recordings shared across catalogue/test routes for one login.
 * Playback still requires a fresh server grant. No persistent storage is used.
 */
export function createAudioPreloader({scope=privateScope,fetcher=(...a)=>globalThis.fetch(...a),origin=()=>globalThis.location?.origin,
 maxBytes=96*1024*1024,maxFileBytes=40*1024*1024,parallel=2,timeout=180000,
 createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}={}){
 const jobs=new Map(),listeners=new Set();let owner=scope.scope,epoch=0,active=0,bytes=0;
 const notify=j=>{for(const f of listeners)f({id:j.id,state:j.state,loaded:j.loaded||0,total:j.total||0});};
 function clear(){epoch++;for(const j of jobs.values()){j.abort?.abort();if(j.url)revokeURL(j.url);j.resolve?.(null);}jobs.clear();bytes=0;owner=scope.scope;}
 const unsubscribe=scope.subscribe(reason=>{if(!reason.startsWith('invalidate:'))clear();});
 function identity(){if(owner!==scope.scope)clear();return !!scope.scope;}
 function settle(job,url){job.resolve?.(url);job.resolve=null;}
 function trim(incoming,priority){
  const candidates=[...jobs.values()].filter(j=>j.state==='ready'&&!j.pins&&j.priority<=priority).sort((a,b)=>a.priority-b.priority);
  for(const j of candidates){if(bytes+incoming<=maxBytes)break;bytes-=j.total;revokeURL(j.url);j.url=null;j.blob=null;j.state='idle';notify(j);}
  return bytes+incoming<=maxBytes;
 }
 async function download(job,version){
  const controller=new AbortController();job.abort=controller;
  const timer=setTimeout(()=>controller.abort(),timeout);let response,reader;
  const cancel=()=>{void reader?.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
  const current=()=>version===epoch&&owner===scope.scope&&!controller.signal.aborted;
  try{
   let resource=job.resource,downloadUrl;
   if(!resource){
    const meta=await fetcher('/api/listening/full/'+encodeURIComponent(job.id)+'/authored?warmup=1',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
    if(!meta.ok)throw Error('Audio access unavailable');
    const data=await meta.json();resource=audioResource(data.audioUrl,origin());if(!resource||job.resource&&job.resource!==resource)throw Error('Invalid audio resource');job.resource=resource;
    if(typeof data.downloadUrl==='string')downloadUrl=data.downloadUrl;
   }
   if(!current())throw Error('Cancelled');
   if(!downloadUrl){
    const access=await fetcher(resource+'?capability=1&direct=1',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
    if(access.ok&&access.headers.get('Content-Type')?.includes('application/json'))downloadUrl=(await access.json()).url;
   }
   let target;try{target=new URL(downloadUrl,origin());}catch{target=new URL(resource+'?stream=1',origin());}
   const direct=target.origin==='https://learnersarea-media.owneruchunla.workers.dev'&&target.pathname.startsWith('/v1/media/');
   if(!direct&&target.origin!==origin())throw Error('Invalid audio origin');
   if(direct){
    try{response=await fetcher(target.href,{credentials:'omit',mode:'cors',cache:'no-store',redirect:'error',signal:controller.signal,priority:job.priority>=2?'high':'low',headers:{Accept:'audio/*'}});if(!response.ok){await response.body?.cancel().catch(()=>{});response=null;}}catch(error){if(controller.signal.aborted)throw error;}
   }
   if(!response)response=await fetcher(resource+'?stream=1',{credentials:'same-origin',mode:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,priority:job.priority>=2?'high':'low',headers:{Accept:'audio/*'}});
   if(response.status!==200)throw Error('Audio unavailable');
   const declared=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase(),total=Number(response.headers.get('Content-Length'));
   // Older private uploads may have generic object metadata. Preserve their
   // audio format without accepting HTML/JSON error pages as recordings.
   const known={mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',wav:'audio/wav',ogg:'audio/ogg',opus:'audio/opus'};
   const mime=['application/octet-stream','binary/octet-stream'].includes(declared)?known[resource.split('.').at(-1).toLowerCase()]??declared:declared;
   if(!/^audio\/[a-z0-9.+-]+$/.test(mime)||!Number.isSafeInteger(total)||total<1||total>maxFileBytes)throw Error('Invalid audio response');
   job.total=total;job.loaded=0;notify(job);reader=response.body?.getReader();if(!reader)throw Error('Missing audio body');
   const chunks=[];
   for(;;){const {done,value}=await reader.read();if(!current())throw Error('Cancelled');if(done)break;job.loaded+=value.byteLength;if(job.loaded>total)throw Error('Oversized audio');chunks.push(value);notify(job);}
   if(job.loaded!==total)throw Error('Incomplete audio');
   if(!trim(total,job.priority)){job.state='idle';settle(job,null);notify(job);return;}
   const blob=new Blob(chunks,{type:mime});job.blob=blob;job.url=createURL(blob);bytes+=total;job.state='ready';settle(job,job.url);notify(job);
  }catch(error){if(version===epoch){job.state=controller.signal.aborted?'idle':'error';settle(job,null);notify(job);}}
  finally{clearTimeout(timer);controller.signal.removeEventListener('abort',cancel);if(reader){void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}else if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{});}
 }
 function pump(){
  if(!identity())return;
  while(active<parallel){const job=[...jobs.values()].filter(j=>j.state==='queued').sort((a,b)=>b.priority-a.priority)[0];if(!job)return;
   const version=epoch;active++;job.state='loading';notify(job);void download(job,version).finally(()=>{active--;pump();});
  }
 }
 function enqueue(id,{resource=null,priority=0,retry=false}={}){
  if(!identity()||typeof id!=='string')return null;
  let job=jobs.get(id)||(resource?[...jobs.values()].find(j=>j.resource===resource):null);if(job&&resource&&job.resource&&job.resource!==resource)return null;
  if(!job){job={id,resource,state:'idle',priority,pins:0};jobs.set(id,job);}
  else if(resource&&!job.resource)job.resource=resource;
  job.priority=Math.max(priority,job.priority);
  if(job.state==='idle'||retry&&job.state==='error'){job.state='queued';job.promise=new Promise(resolve=>job.resolve=resolve);pump();}
  return job;
 }
 function warm(cards){
  if(!Array.isArray(cards)||!identity())return;
  const priority=c=>c.answerProgress?.state==='in_progress'?3:!c.started?2:1;
  for(const c of [...cards].filter(c=>!c.locked&&typeof c.testId==='string').sort((a,b)=>priority(b)-priority(a))){
   const job=enqueue(c.testId,{priority:priority(c)});if(job){job.basePriority=priority(c);if(!job.pins)job.priority=priority(c);}
  }
 }
 function status(id){const j=jobs.get(id);return j?{id,state:j.state,loaded:j.loaded||0,total:j.total||0}:{id,state:'idle',loaded:0,total:0};}
 function releaseResource(resource){const j=[...jobs.values()].find(j=>j.resource===resource);if(j){j.pins=Math.max(0,j.pins-1);if(!j.pins)j.priority=j.basePriority??1;}}
 async function acquire(resource,signal,testId){
  resource=audioResource(resource,origin());if(!resource||!identity()||signal?.aborted)return null;
  let job=testId?jobs.get(testId):[...jobs.values()].find(j=>j.resource===resource);
  job=enqueue(job?.id||testId||resource,{resource,priority:10,retry:true});if(!job)return null;
  const version=epoch;job.pins++;let cancel;
  try{
   const url=job.state==='ready'?job.url:await Promise.race([job.promise,new Promise(resolve=>{cancel=()=>resolve(null);signal?.addEventListener('abort',cancel,{once:true});})]);
   if(!url||version!==epoch||signal?.aborted){releaseResource(resource);return null;}
   jobs.delete(job.id);jobs.set(job.id,job);return url;
  }finally{if(cancel)signal?.removeEventListener('abort',cancel);}
 }
 function warmResources(items){for(const item of items??[]){const resource=audioResource(typeof item==='string'?item:item?.url,origin());if(!resource)continue;const priority=item?.priority??2,job=enqueue(resource,{resource,priority});if(job){job.basePriority=priority;if(!job.pins)job.priority=priority;}}}
 return {warm,warmResources,status,acquire,blob:resource=>[...jobs.values()].find(j=>j.resource===audioResource(resource,origin())&&j.state==='ready')?.blob??null,release:releaseResource,retry:id=>enqueue(id,{retry:true,priority:5}),
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},get bytes(){return bytes;},clear,
  dispose(){unsubscribe();clear();listeners.clear();}};
}
export const listeningAudio=createAudioPreloader();
