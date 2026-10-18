export class ApiError extends Error {
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
/** Same-origin only, no persistent/private cache, no mutation retries. */
export function createApi(fetcher=globalThis.fetch.bind(globalThis)){
 const pending=new Map();
 async function execute(path,{method='GET',body,signal}={}){
  if(!path.startsWith('/api/')||/[\\\u0000-\u001f]/.test(path))throw new TypeError('Only same-origin /api paths accepted');
  const response=await fetcher(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal});
  const type=response.headers.get('content-type')??'';
  if(!type.includes('application/json'))throw new ApiError(response.status,'invalid_response');
  const data=await response.json();
  if(!response.ok)throw new ApiError(response.status,typeof data.error==='string'?data.error:'request_failed');
  return data;
 }
 // Only identical concurrent GETs share a transport. Every consumer can cancel
 // independently; the last departure aborts the shared network request.
 function request(path,options={}){
  if((options.method??'GET')!=='GET')return bounded(path,options);
  if(options.signal?.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
  let entry=pending.get(path);
  if(!entry){const controller=new AbortController();entry={controller,users:0};entry.promise=bounded(path,{...options,signal:controller.signal}).finally(()=>{if(pending.get(path)===entry)pending.delete(path);});pending.set(path,entry);}
  entry.users++;
  return new Promise((resolve,reject)=>{let ended=false;
   const finish=(fn,value)=>{if(ended)return;ended=true;options.signal?.removeEventListener('abort',abort);if(--entry.users===0){entry.controller.abort();if(pending.get(path)===entry)pending.delete(path);}fn(value);};
   const abort=()=>finish(reject,new DOMException('Aborted','AbortError'));
   options.signal?.addEventListener('abort',abort,{once:true});entry.promise.then(v=>finish(resolve,v),e=>finish(reject,e));
  });
 }
 async function bounded(path,options){const timeout=AbortSignal.timeout(25000);const signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;return execute(path,{...options,signal});}
 return {request,clear(){for(const e of pending.values())e.controller.abort();pending.clear();}};
}
export const api=createApi();
