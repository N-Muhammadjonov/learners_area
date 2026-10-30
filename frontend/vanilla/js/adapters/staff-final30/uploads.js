/**
 * Staff upload engine — a faithful vanilla port of src/lib/uploads/{client,errors,signature,format}.ts and the policy in
 * src/lib/validation/uploads.ts. SERVER STAYS AUTHORITATIVE: it re-validates type/size/signature and finalizes; this module
 * only gives instant, honest feedback and drives the existing lifecycle:
 *   POST /api/uploads/intent -> PUT bytes (R2 presigned URL, or POST /api/uploads for local disk) -> POST /api/uploads/finalize
 * Real byte progress via XMLHttpRequest (fetch has no upload progress). No simulated percentages.
 * Client-side ceilings are the product defaults; per-deployment env overrides apply server-side only.
 */
const mb=v=>Math.round(v*1024*1024);
export const DOC_MIME=['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip','application/x-zip-compressed','text/plain','text/csv','text/markdown','text/x-markdown','application/rtf','text/rtf','text/html','application/xml','text/xml','application/json'];
export const DOC_EXT=['.pdf','.doc','.docx','.ppt','.pptx','.xls','.xlsx','.zip','.txt','.csv','.md','.rtf','.html','.htm','.xml','.json'];
export const MEDIA_EXT=['.mp4','.webm','.mov','.m4v','.mp3','.wav','.m4a','.aac','.ogg','.oga','.opus','.flac','.png','.jpg','.jpeg','.webp','.gif']; // SVG deliberately absent (script-capable)
export const RULES={
 primary:{maxBytes:mb(500),mimePrefixes:['video/','audio/','image/'],mimeTypes:DOC_MIME,extensions:[...MEDIA_EXT,...DOC_EXT]},
 image:{maxBytes:mb(10),mimePrefixes:['image/'],mimeTypes:[],extensions:['.png','.jpg','.jpeg','.webp','.gif']},
 audio:{maxBytes:mb(60),mimePrefixes:['audio/'],mimeTypes:[],extensions:['.mp3','.wav','.m4a','.aac','.ogg','.oga','.opus','.webm','.flac','.mp4']},
 video:{maxBytes:mb(500),mimePrefixes:['video/'],mimeTypes:[],extensions:['.mp4','.webm','.mov','.m4v']},
 file:{maxBytes:mb(60),mimePrefixes:[],mimeTypes:DOC_MIME,extensions:DOC_EXT},
};
export const CODES=['unauthenticated','forbidden','unsupported_type','dangerous_type','file_too_large','missing_file','type_mismatch','size_mismatch','rate_limited','storage_not_configured','storage_unavailable','database_unavailable','server_error','network_error','upload_timeout','cancelled','storage_rejected','intent_expired','already_finalized','not_found','unknown'];
const RETRYABLE=new Set(['rate_limited','storage_unavailable','database_unavailable','server_error','network_error','upload_timeout','storage_rejected','intent_expired','size_mismatch','unknown']);
const ALIASES={invalid_input:'unknown',invalid_purpose:'forbidden',invalid_size:'missing_file',invalid_block_kind:'unsupported_type',missing_block_kind:'unsupported_type',missing_attempt_id:'not_found',attempt_not_found:'not_found',attempt_already_submitted:'already_finalized',material_not_found:'not_found',invalid_upload_id:'not_found',upload_not_found:'not_found',expired:'intent_expired',object_missing:'size_mismatch',upload_expired:'intent_expired',upload_not_active:'intent_expired',upload_not_found_in_storage:'size_mismatch',upload_type_mismatch:'type_mismatch',upload_size_mismatch:'size_mismatch',upload_not_owned_or_finalized:'not_found',rate_limit:'rate_limited',too_many_requests:'rate_limited'};
export const isRetryable=c=>RETRYABLE.has(c);
export function normalizeCode(raw){const s=typeof raw==='string'?raw:'';if(CODES.includes(s))return s;if(s.startsWith('file_too_large'))return 'file_too_large';return ALIASES[s]??'unknown';}
export function failureFromResponse(status,body){
 const b=body&&typeof body==='object'?body:{};const technical=typeof b.code==='string'?b.code:typeof b.error==='string'?b.error:undefined;let code;
 if(technical)code=normalizeCode(technical);else if(status===401)code='unauthenticated';else if(status===403)code='forbidden';else if(status===404)code='not_found';else if(status===413)code='file_too_large';else if(status===429)code='rate_limited';else if(status===504||status===408)code='upload_timeout';else if(status>=500)code='server_error';else code='unknown';
 if(code==='unknown'&&status>=500)code='server_error';
 return {code,technical:technical??`http_${status}`,retryable:typeof b.retryable==='boolean'?b.retryable:isRetryable(code),correlationId:typeof b.correlationId==='string'?b.correlationId.slice(0,64):undefined};
}
/** Localized sentence; never the raw code. */
export function uploadErrorMessage(f,messages){const tpl=messages[f.code]??messages.unknown;return tpl.replace('{max}',f.max??'').replace('{ref}',f.correlationId??'—');}
export function describeUploadError(raw,messages){if(!raw)return '';const [head,...rest]=raw.split(':');const code=normalizeCode(head);if(code==='unknown'&&head!=='unknown')return raw;return uploadErrorMessage({code,max:rest.join(':')||undefined},messages);}
const DANGEROUS=/\.(exe|msi|dmg|pkg|app|apk|ipa|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|jse?|wsf|wsh|hta|cpl|jar|sh|bash|zsh|csh|ksh|command|run|bin|elf|dll|so|dylib|lnk|reg|gadget|msc|php\d?|phtml|py|pl|rb|cgi|asp|aspx|jsp)$/i;
export function isDangerousFilename(name){const lower=String(name).trim().toLowerCase();if(DANGEROUS.test(lower))return true;const parts=lower.split('.').slice(1);return parts.slice(0,-1).some(p=>DANGEROUS.test('.'+p)&&['exe','bat','cmd','ps1','sh','msi','scr','vbs','js','jar','apk','dmg'].includes(p));}
export function extensionOf(name){const d=name.lastIndexOf('.');return d<=0||d===name.length-1?'':name.slice(d).toLowerCase();}
export function validateUploadFile({filename,contentType,size,category}){
 if(!filename)return {ok:false,error:'missing_file'};if(isDangerousFilename(filename))return {ok:false,error:'dangerous_type'};
 const r=RULES[category];if(!r)throw new TypeError('category');const ext=extensionOf(filename),mime=(contentType||'').split(';')[0].trim().toLowerCase();
 const mimeOk=r.mimePrefixes.some(p=>mime.startsWith(p))||r.mimeTypes.includes(mime),extOk=r.extensions.includes(ext),generic=mime===''||mime==='application/octet-stream';
 if(!extOk&&!mimeOk)return {ok:false,error:'unsupported_type'};if(!extOk&&!generic)return {ok:false,error:'unsupported_type'};
 if(!Number.isFinite(size)||size<=0)return {ok:false,error:'missing_file'};if(size>r.maxBytes)return {ok:false,error:'file_too_large'};return {ok:true,category,extension:ext};
}
export const maxBytesLabel=c=>{const b=RULES[c].maxBytes;return b>=1048576?`${Math.round(b/1048576)} MB`:`${Math.round(b/1024)} KB`;};
export const acceptAttribute=c=>[...RULES[c].mimePrefixes,...RULES[c].mimeTypes,...RULES[c].extensions].join(',');
export function preflight(file,category){const v=validateUploadFile({filename:file.name,contentType:file.type,size:file.size,category});if(v.ok)return {ok:true};if(v.error==='file_too_large')return {ok:false,error:`file_too_large:${maxBytesLabel(category)}`};return {ok:false,error:v.error==='dangerous_type'?'dangerous_type':'unsupported_type'};}
export function formatBytes(n){if(!n||n<=0)return '';if(n<1024)return `${n} B`;if(n<1048576)return `${Math.round(n/1024)} KB`;if(n<1073741824)return `${(n/1048576).toFixed(1)} MB`;return `${(n/1073741824).toFixed(2)} GB`;}
/* ---- signature (magic bytes): the first bytes are evidence, name and MIME are claims ---- */
const ascii=(b,s,t)=>[...t].every((c,i)=>b[s+i]===c.charCodeAt(0));
const isZip=b=>b[0]===0x50&&b[1]===0x4b&&(b[2]===3||b[2]===5||b[2]===7);
const isOle=b=>[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((v,i)=>b[i]===v);
const isBmff=b=>['ftyp','moov','mdat','wide','free'].some(t=>ascii(b,4,t));
const isEbml=b=>b[0]===0x1a&&b[1]===0x45&&b[2]===0xdf&&b[3]===0xa3;
const exe=b=>(b[0]===0x4d&&b[1]===0x5a)||ascii(b,0,'\u007fELF')||[0xcf,0xfa,0xed,0xfe].every((v,i)=>b[i]===v)||[0xfe,0xed,0xfa,0xcf].every((v,i)=>b[i]===v)||ascii(b,0,'#!');
const isText=b=>{const n=Math.min(b.length,4096);for(let i=0;i<n;i++)if(b[i]===0)return false;return true;};
export function sniffAudio(b){const at=i=>b[i]??-1,a=(s,t)=>[...t].every((c,i)=>at(s+i)===c.charCodeAt(0));
 if(a(0,'ID3'))return 'mp3';if(a(0,'RIFF')&&a(8,'WAVE'))return 'wav';if(a(0,'fLaC'))return 'flac';if(a(0,'OggS'))return 'ogg';if(at(0)===0x1a&&at(1)===0x45&&at(2)===0xdf&&at(3)===0xa3)return 'webm';if(a(4,'ftyp'))return 'm4a';
 if(at(0)===0xff&&(at(1)&0xf6)===0xf0)return 'aac';if(at(0)===0xff&&(at(1)&0xe0)===0xe0)return 'mp3';return null;}
export function verifySignature(name,head){
 if(!head.length)return {ok:false,reason:'mismatch'};if(exe(head))return {ok:false,reason:'executable'};const ext=extensionOf(name),pass=c=>c?{ok:true}:{ok:false,reason:'mismatch'};
 switch(ext){case '.pdf':return pass(ascii(head,0,'%PDF'));case '.docx':case '.pptx':case '.xlsx':case '.zip':return pass(isZip(head));case '.doc':case '.ppt':case '.xls':return pass(isOle(head));case '.rtf':return pass(ascii(head,0,'{\\rtf'));
  case '.png':return pass([0x89,0x50,0x4e,0x47].every((v,i)=>head[i]===v));case '.jpg':case '.jpeg':return pass(head[0]===0xff&&head[1]===0xd8);case '.gif':return pass(ascii(head,0,'GIF8'));case '.webp':return pass(ascii(head,0,'RIFF')&&ascii(head,8,'WEBP'));
  case '.mp4':case '.mov':case '.m4v':return pass(isBmff(head));case '.webm':return pass(isEbml(head));case '.mp3':case '.wav':case '.m4a':case '.aac':case '.ogg':case '.oga':case '.opus':case '.flac':return pass(sniffAudio(head)!==null);
  case '.txt':case '.csv':case '.md':case '.html':case '.htm':case '.xml':case '.json':return pass(isText(head));default:return {ok:false,reason:'mismatch'};}
}
export const readHead=async(file,n=4096)=>new Uint8Array(await file.slice(0,n).arrayBuffer());
/* ---- engine ---- */
const inflight=new Map();
const fail=(code,extra={})=>({ok:false,error:code,failure:{code,retryable:isRetryable(code),...extra}});
/** Only https presigned URLs (or same-origin paths) may receive bytes; anything else is a storage rejection. */
function safeUploadUrl(u){try{const x=new URL(u,globalThis.location?.href??'https://invalid.invalid');return x.protocol==='https:'||(x.origin===globalThis.location?.origin);}catch{return false;}}
export function startUpload(file,options,deps={}){
 const key=[options.purpose,options.blockKind??'',options.materialId??'',file.name,file.size,file.lastModified??0].join('|'),running=inflight.get(key);if(running)return running;
 const h=once(file,options,deps);inflight.set(key,h);void h.promise.finally(()=>inflight.delete(key));return h;
}
function once(file,options,deps){
 const f=deps.fetch??globalThis.fetch.bind(globalThis),XHR=deps.XHR??globalThis.XMLHttpRequest;let xhr=null,cancelled=false,uploadId=null;
 const setState=s=>{if(!cancelled)options.onState?.(s);};
 let dropped=false;const discard=async id=>{if(dropped)return;dropped=true;try{await f(`/api/uploads/${id}`,{method:'DELETE',signal:AbortSignal.timeout(5000)});}catch{/* best effort: the intent expires and cleanup reclaims it */}};
 const promise=(async()=>{
  setState('queued');
  try{const v=verifySignature(file.name,await readHead(file));if(!v.ok)return fail(v.reason==='executable'?'dangerous_type':'type_mismatch');}catch{return fail('missing_file');}
  let intent;
  try{const res=await f('/api/uploads/intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:options.purpose,blockKind:options.blockKind,materialId:options.materialId,filename:file.name,contentType:file.type||'application/octet-stream',size:file.size})});
   const data=await res.json().catch(()=>null);if(!res.ok){const fl=failureFromResponse(res.status,data);return {ok:false,error:fl.code,failure:fl};}
   if(!data||typeof data.uploadId!=='string')return fail('server_error',{technical:'intent_malformed'});intent=data;uploadId=intent.uploadId;}catch{return fail('network_error');}
  if(cancelled)return fail('cancelled');
  setState('uploading');const put=await sendBytes(intent);
  if(cancelled){void discard(uploadId);return fail('cancelled');}
  if(!put.ok)return {ok:false,error:put.failure.code,failure:put.failure};
  setState('finalizing');
  try{const res=await f('/api/uploads/finalize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadId:intent.uploadId})});const data=await res.json().catch(()=>null);if(!res.ok){const fl=failureFromResponse(res.status,data);return {ok:false,error:fl.code,failure:fl};}}catch{return fail('network_error');}
  if(cancelled)return fail('cancelled');
  setState('complete');return {ok:true,uploadId:intent.uploadId,objectKey:intent.objectKey};
 })();
 function sendBytes(intent){
  const direct=intent.mode==='direct'&&intent.uploadUrl;
  if(direct&&!safeUploadUrl(intent.uploadUrl))return Promise.resolve({ok:false,failure:{code:'storage_rejected',technical:'unsafe_upload_url',retryable:true}});
  return new Promise(resolve=>{
   const r=new XHR();xhr=r;
   r.upload.addEventListener('progress',e=>{if(e.lengthComputable)options.onProgress?.(Math.round(e.loaded/e.total*100));});
   r.addEventListener('load',()=>{if(r.status>=200&&r.status<300){options.onProgress?.(100);resolve({ok:true});}else{let body=null;try{body=JSON.parse(r.responseText);}catch{}resolve({ok:false,failure:direct&&!body&&r.status>=400&&r.status<500?{code:'storage_rejected',technical:`storage_${r.status}`,retryable:true}:failureFromResponse(r.status,body)});}});
   r.addEventListener('error',()=>resolve({ok:false,failure:{code:direct?'storage_rejected':'network_error',technical:'xhr_error',retryable:true}}));
   r.addEventListener('abort',()=>resolve({ok:false,failure:{code:'cancelled',retryable:false}}));
   r.addEventListener('timeout',()=>resolve({ok:false,failure:{code:'upload_timeout',retryable:true}}));
   if(direct){r.open('PUT',intent.uploadUrl);r.setRequestHeader('Content-Type',intent.contentType);r.send(file);}
   else{const fd=new FormData();fd.append('uploadId',intent.uploadId);fd.append('file',file);r.open('POST','/api/uploads');r.send(fd);}
  });
 }
 return {promise,cancel:()=>{cancelled=true;xhr?.abort();if(uploadId)void discard(uploadId);}};
}
