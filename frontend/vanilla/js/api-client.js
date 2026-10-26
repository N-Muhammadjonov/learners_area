import {privateScope} from './private-scope.js';
import {anySignal} from './signals.js';
import {affectsLearningData} from './cache-policy.js';
export class ApiError extends Error {
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
/** Same-origin transport only, no persistent cache or mutation retries. */
export function createApi(fetcher=globalThis.fetch.bind(globalThis),onUnauthorized=()=>{},onMutation=()=>{}){
 const pending=new Map();let epoch=0;
 async function execute(path,{method='GET',body,signal,maxBytes}={}){
  if(!path.startsWith('/api/')||/[\\\u0000-\u001f]/.test(path))throw new TypeError('Only same-origin /api paths accepted');
  const multipart=typeof FormData!=='undefined'&&body instanceof FormData;
  const response=await fetcher(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(body===undefined||multipart?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:multipart?body:JSON.stringify(body),signal});
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
  const key=epoch+':'+path+':'+(options.maxBytes??'unlimited');let entry=pending.get(key);
  if(!entry){const controller=new AbortController();entry={controller,users:0};entry.promise=bounded(path,{...options,signal:controller.signal}).finally(()=>{if(pending.get(key)===entry)pending.delete(key);});pending.set(key,entry);}
  entry.users++;
  return new Promise((resolve,reject)=>{let ended=false;
   const finish=(fn,value)=>{if(ended)return;ended=true;options.signal?.removeEventListener('abort',abort);if(--entry.users===0){entry.controller.abort();if(pending.get(key)===entry)pending.delete(key);}fn(value);};
   const abort=()=>finish(reject,new DOMException('Aborted','AbortError'));
   options.signal?.addEventListener('abort',abort,{once:true});entry.promise.then(v=>finish(resolve,v),e=>finish(reject,e));
  });
 }
 async function bounded(path,options){const timeout=AbortSignal.timeout(options.timeoutMs??25000);const signal=options.signal?anySignal([options.signal,timeout]):timeout;return execute(path,{...options,signal});}
 return {request,clear(){epoch++;for(const e of pending.values())e.controller.abort();pending.clear();}};
}
export const api=createApi(globalThis.fetch.bind(globalThis),()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('learners-area:auth-failure'));},path=>{if(affectsLearningData(path)){privateScope.invalidate('view:');privateScope.invalidate('catalogue:');}});
