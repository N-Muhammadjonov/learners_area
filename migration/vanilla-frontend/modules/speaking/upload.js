/** Speaking recording upload: the existing authenticated intent → bytes → finalize
 * protocol. Never create a storage key or decide permissions on the client. */
import {ApiError} from '../../js/api-client.js';
async function jsonResponse(response){
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new ApiError(response.status,typeof data?.error==='string'?data.error:(typeof data?.error?.code==='string'?data.error.code:'request_failed'));
 return data;
}
export async function uploadRecording(file,attemptId,{signal,onProgress=()=>{}}={}){
 if(!file||!attemptId)throw Error('missing_upload');
 const request=await fetch('/api/uploads/intent',{method:'POST',credentials:'same-origin',cache:'no-store',signal,headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({purpose:'speaking_recording',speakingAttemptId:attemptId,filename:file.name,contentType:file.type||'application/octet-stream',size:file.size})});
 const intent=await jsonResponse(request);if(typeof intent.uploadId!=='string'||!['direct','proxy'].includes(intent.mode))throw Error('bad_upload_intent');
 const url=intent.mode==='direct'?intent.uploadUrl:'/api/uploads';
 if(intent.mode==='direct'&&(!url||new URL(url).protocol!=='https:'))throw Error('invalid_upload_url');
 const send=()=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new DOMException('Aborted','AbortError'));return;}const xhr=new XMLHttpRequest();const onAbort=()=>xhr.abort();signal?.addEventListener('abort',onAbort,{once:true});
  const end=(fn,value)=>{signal?.removeEventListener('abort',onAbort);fn(value);};
  xhr.upload.addEventListener('progress',e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));});
  xhr.addEventListener('load',()=>xhr.status>=200&&xhr.status<300?end(resolve):end(reject,new ApiError(xhr.status,'upload_failed')));
  xhr.addEventListener('error',()=>end(reject,Error('network_error')));
  xhr.addEventListener('abort',()=>end(reject,Error('cancelled')));
  xhr.open(intent.mode==='direct'?'PUT':'POST',url,true);
  if(intent.mode==='direct'){xhr.setRequestHeader('Content-Type',intent.contentType);xhr.send(file);}
  else {const form=new FormData();form.append('uploadId',intent.uploadId);form.append('file',file);xhr.send(form);}
 });
 try{await send();}catch(error){if(signal?.aborted){void fetch(`/api/uploads/${encodeURIComponent(intent.uploadId)}`,{method:'DELETE',credentials:'same-origin',signal:AbortSignal.timeout(5000)}).catch(()=>{});}throw error;}
 if(signal?.aborted)throw Error('cancelled');
 const finalized=await fetch('/api/uploads/finalize',{method:'POST',credentials:'same-origin',cache:'no-store',signal,headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({uploadId:intent.uploadId})});
 await jsonResponse(finalized);onProgress(100);
 return {uploadId:intent.uploadId,objectKey:intent.objectKey};
}
