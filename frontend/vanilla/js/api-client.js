import {privateScope} from './private-scope.js';
import {anySignal} from './signals.js';
import {affectsLearningData} from './cache-policy.js';
export class ApiError extends Error {
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
function retryDelay(value){
 if(!value)return null;
 const seconds=/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value):Math.max(0,(Date.parse(value)-Date.now())/1000);
 return Number.isFinite(seconds)&&seconds>=0&&seconds<=10?seconds*1000+Math.random()*150:null;
}
function retryWait(delay,signal){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason??new DOMException('Aborted','AbortError'));return;}
  const finish=()=>{signal?.removeEventListener('abort',abort);resolve();};
  const timer=setTimeout(finish,delay);
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason??new DOMException('Aborted','AbortError'));};
  signal?.addEventListener('abort',abort,{once:true});
 });
}
/** Same-origin transport; only the login POST retries an explicit 503 Retry-After. */
export function createApi(fetcher=globalThis.fetch.bind(globalThis),onUnauthorized=()=>{},onMutation=()=>{}){
 const pending=new Map();let epoch=0;
 async function execute(path,{method='GET',body,signal,maxBytes,keepalive=false}={}){
  if(!path.startsWith('/api/')||/[\\\u0000-\u001f]/.test(path))throw new TypeError('Only same-origin /api paths accepted');
  const multipart=typeof FormData!=='undefined'&&body instanceof FormData;
  const options={method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(body===undefined||multipart?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:multipart?body:JSON.stringify(body),signal,...keepalive?{keepalive:true}:{}};
  let response;
  for(let attempt=0;;attempt++){
   response=await fetcher(path,options);
   const delay=method==='POST'&&path==='/api/auth/login'&&response.status===503&&attempt<2?retryDelay(response.headers.get('retry-after')):null;
   if(delay===null)break;
   try{await response.body?.cancel();}catch{}
   await retryWait(delay,signal);
  }
  if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
  if(response.status===401)onUnauthorized(path);
  const type=response.headers.get('content-type')??'';
  if(!type.includes('application/json'))throw new ApiError(response.status,'invalid_response');
  let data;try{
   if(maxBytes){
    if(Number(response.headers.get('content-length'))>maxBytes)throw new ApiError(413,'prefetch_limit');
    const reader=response.body?.getReader();let size=0;const chunks=[];
    if(reader){try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new ApiError(413,'prefetch_limit');chunks.push(value);}}finally{if(size>maxBytes)await reader.cancel();reader.releaseLock();}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}data=JSON.parse(new TextDecoder().decode(bytes));}
    else{const text=await response.text();if(text.length*2>maxBytes)throw new ApiError(413,'prefetch_limit');data=JSON.parse(text);}
   }else data=await response.json();
  }catch(e){if(signal?.aborted)throw signal.reason??e;if(e instanceof ApiError)throw e;throw new ApiError(response.status,'invalid_response');}
  if(!response.ok)throw new ApiError(response.status,typeof data?.error==='string'?data.error:'request_failed');
  return data;
 }
 // Only identical concurrent GETs share a transport. Every consumer can cancel
 // independently; the last departure aborts the shared network request.
 function request(path,options={}){
  if((options.method??'GET')!=='GET'){epoch++;onMutation(path);return bounded(path,options).finally(()=>{epoch++;onMutation(path);});}
  // `fresh` is for a re-read that must reflect a mutation made after an identical request started: it never joins
  // an in-flight GET (which may predate the change) and is not shared with later callers.
  if(options.fresh===true)return bounded(path,options);
  if(options.signal?.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
  // A bounded prefetch and the real navigation are the SAME read. Share one
  // transport where possible instead of sending duplicate GETs for maxBytes.
  // A later unbounded consumer can retry only if the bounded leader hit its
  // explicit size ceiling. The regular navigation is never size-restricted.
  const key=epoch+':'+path;let entry=pending.get(key);
  if(!entry){
   const controller=new AbortController();
   entry={controller,users:0,maxBytes:options.maxBytes};
   entry.promise=bounded(path,{...options,signal:controller.signal})
    .finally(()=>{if(pending.get(key)===entry)pending.delete(key);});
   pending.set(key,entry);
  }
  entry.users++;
  return new Promise((resolve,reject)=>{
   let ended=false;
   const finish=(fn,value)=>{if(ended)return;ended=true;options.signal?.removeEventListener('abort',abort);
    if(--entry.users===0){entry.controller.abort();if(pending.get(key)===entry)pending.delete(key);}fn(value);};
   const abort=()=>finish(reject,new DOMException('Aborted','AbortError'));
   options.signal?.addEventListener('abort',abort,{once:true});
   const deliver=data=>{
    // When a bounded prefetch joins an already-unbounded request, apply its
    // own memory cap before returning any data to the prefetch caller.
    if(options.maxBytes){
     let size;try{size=new TextEncoder().encode(JSON.stringify(data)).byteLength;}
     catch{return finish(reject,new ApiError(413,'prefetch_limit'));}
     if(size>options.maxBytes)return finish(reject,new ApiError(413,'prefetch_limit'));
    }
    finish(resolve,data);
   };
   entry.promise.then(deliver,error=>{
    // The original size limit applies only to the speculative reader. Never
    // surface its prefetch_limit failure as a navigation error. The fallback
    // is a single explicit uncapped GET, without joining the failed flight.
    if(!ended&&entry.maxBytes&&options.maxBytes==null&&
       error instanceof ApiError&&error.status===413&&error.code==='prefetch_limit'){
     bounded(path,options).then(deliver,e=>finish(reject,e));
    }else finish(reject,error);
   });
  });
 }
 async function bounded(path,options){const timeout=AbortSignal.timeout(options.timeoutMs??25000);const signal=options.signal?anySignal([options.signal,timeout]):timeout;return execute(path,{...options,signal});}
 return {request,clear(){epoch++;for(const e of pending.values())e.controller.abort();pending.clear();}};
}
export const api=createApi(globalThis.fetch.bind(globalThis),()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('learners-area:auth-failure'));},path=>{if(affectsLearningData(path)){privateScope.invalidate('view:');privateScope.invalidate('catalogue:');}});
