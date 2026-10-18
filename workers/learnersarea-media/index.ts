import {createMediaAuthorizationProof,decodeMediaKey,parseMediaRange,verifyMediaCapability} from '../../src/lib/media/protocol';

type ObjectInfo = {size:number;httpEtag:string;uploaded:Date;httpMetadata?:{contentType?:string};writeHttpMetadata(headers:Headers):void};
type ObjectBody = ObjectInfo & {body:ReadableStream<Uint8Array>};
export type MediaEnvironment = {
 MEDIA_SIGNING_SECRET:string;
 MEDIA_BUCKET:{head(key:string):Promise<ObjectInfo|null>;get(key:string,options?:{range?:{offset:number;length:number};onlyIf?:Headers}):Promise<ObjectBody|ObjectInfo|null>};
};
const APP_ORIGIN='https://learnersarea.uz';
const AUTHORIZATION_URL=APP_ORIGIN+'/api/media/authorize';
function baseHeaders(origin:string|null) {
 const headers=new Headers({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin','Accept-Ranges':'bytes','Timing-Allow-Origin':APP_ORIGIN});
 if(origin===APP_ORIGIN){headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Expose-Headers','Content-Length, Content-Range, Accept-Ranges, ETag');}
 return headers;
}
/** Every new read is authorized before the bucket is touched, including seeks. */
export async function serveMedia(request:Request,env:MediaEnvironment,authorizeFetch:typeof fetch=fetch):Promise<Response> {
 const origin=request.headers.get('origin'),headers=baseHeaders(origin);
 const reject=(status:number)=>{headers.delete('Content-Length');if(status!==416)headers.delete('Content-Range');return new Response(null,{status,headers});};
 if(origin && origin!==APP_ORIGIN)return reject(403);
 if(request.method==='OPTIONS') {
  if(origin!==APP_ORIGIN || !['GET','HEAD'].includes(request.headers.get('access-control-request-method')??'') ||
    (request.headers.get('access-control-request-headers')??'').split(',').some(h=>h.trim()&&!['range','if-range'].includes(h.trim().toLowerCase())))return reject(403);
  headers.set('Access-Control-Allow-Methods','GET, HEAD');headers.set('Access-Control-Allow-Headers','Range, If-Range');return reject(204);
 }
 if(request.method!=='GET'&&request.method!=='HEAD'){headers.set('Allow','GET, HEAD');return reject(405);}
 const url=new URL(request.url),match=/^\/v1\/media\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
 const key=match?decodeMediaKey(match[1]!):null;
 if(!key || url.searchParams.getAll('token').length!==1 || [...url.searchParams.keys()].some(k=>k!=='token'))return reject(403);
 const token=url.searchParams.get('token')!;
 if(!await verifyMediaCapability(env.MEDIA_SIGNING_SECRET,token,key))return reject(403);
 try {
  const timestamp=Math.floor(Date.now()/1000),method=request.method as 'GET'|'HEAD';
  const proof=await createMediaAuthorizationProof(env.MEDIA_SIGNING_SECRET,{method,token,timestamp});
  // Workers rejects redirect:'error' before sending the request. Manual mode
  // preserves the same fail-closed policy: only this fixed origin's 200 passes.
  const authority=await authorizeFetch(AUTHORIZATION_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,token,key,timestamp,proof}),redirect:'manual',signal:AbortSignal.timeout(6000),cache:'no-store'});
  if(authority.status!==200)return reject(authority.status===401||authority.status===403?403:503);
  if((await authority.json() as {allowed?:boolean}).allowed!==true)return reject(403);
  const object=await env.MEDIA_BUCKET.head(key);if(!object)return reject(404);
  object.writeHttpMetadata(headers);
  // Upload metadata cannot turn private educational bytes into cacheable data.
  headers.set('Cache-Control','private, no-store');
  headers.set('Content-Type',object.httpMetadata?.contentType??'application/octet-stream');
  headers.set('ETag',object.httpEtag);headers.set('Last-Modified',object.uploaded.toUTCString());
  const inline=/^(audio\/|video\/|image\/|text\/plain)/.test(headers.get('Content-Type')??'');
  headers.set('Content-Disposition',`${inline?'inline':'attachment'}; filename="${key.split('/').pop()}"`);
  let range=null;
  const rangeHeader=request.headers.get('range'),ifRange=request.headers.get('if-range');
  const rangeMatches=!ifRange || ifRange===object.httpEtag || (!ifRange.startsWith('W/') && Number.isFinite(Date.parse(ifRange)) && object.uploaded.getTime()<=Date.parse(ifRange)+999);
  // RFC 9110: Range applies to GET; HEAD describes the complete representation.
  if(method==='GET'&&rangeHeader&&rangeMatches){
   range=parseMediaRange(rangeHeader,object.size);
   if(!range){headers.set('Content-Range',`bytes */${object.size}`);return reject(416);}
  }
  const size=range?range.end-range.start+1:object.size;
  headers.set('Content-Length',String(size));
  if(range)headers.set('Content-Range',`bytes ${range.start}-${range.end}/${object.size}`);
  if(method==='HEAD')return new Response(null,{status:200,headers});
  const result=await env.MEDIA_BUCKET.get(key,{onlyIf:new Headers({'If-Match':object.httpEtag}),...(range?{range:{offset:range.start,length:size}}:{})});
  if(!result)return reject(404);
  if(!('body' in result))return reject(412);
  // R2's readable body is passed directly; never materialize a complete file.
  return new Response(result.body,{status:range?206:200,headers});
 } catch {return reject(503);}
}
const worker={async fetch(request:Request,env:MediaEnvironment):Promise<Response> {
 const started=Date.now(),response=await serveMedia(request,env);
 // Replaces raw invocation URL logs with bounded, non-identifying diagnostics.
 console.log(JSON.stringify({event:'media_read',method:['GET','HEAD','OPTIONS'].includes(request.method)?request.method:'other',status:response.status,durationMs:Date.now()-started}));
 return response;
}};
export default worker;
