import {NextRequest,NextResponse} from 'next/server';
import {actorOf,getCurrentSessionAuthority} from '@/lib/auth/current-user';
import {hasPrivateAccess} from '@/lib/auth/account-status';
import {authorizeResourceRead,storedContentType} from '@/lib/data/uploads';
import {getStorageService,isSafeObjectKey} from '@/lib/services/storage';
import {inferContentType} from '@/lib/services/storage/local-provider';
import {mediaWorkerConfiguration} from '@/lib/media/config';
import {createMediaCapability,mediaCapabilityUrl,parseMediaRange} from '@/lib/media/protocol';
const privateHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
type Context={params:Promise<{key:string[]}>};
/** Object ownership remains authoritative. A capability grants transport only. */
async function deliver(req:NextRequest,{params}:Context,head:boolean) {
 try {
  const authority=await getCurrentSessionAuthority();
  if(!authority || !hasPrivateAccess(authority.user.accountStatus))return NextResponse.json({error:'unauthenticated'},{status:401,headers:privateHeaders});
  const objectKey=(await params).key.join('/');
  if(!isSafeObjectKey(objectKey))return NextResponse.json({error:'invalid_key'},{status:400,headers:privateHeaders});
  const access=await authorizeResourceRead(actorOf(authority.user),objectKey);
  if(!access.allowed)return NextResponse.json({error:access.reason==='forbidden'?'forbidden':'not_found'},{status:access.reason==='forbidden'?403:404,headers:privateHeaders});
  const config=mediaWorkerConfiguration();
  const capabilityRequested=req.nextUrl.searchParams.get('capability')==='1';
  if(config) {
   const {token,claims}=await createMediaCapability(config.secret,{uid:authority.user.id,authVersion:authority.authVersion,
    sessionKey:authority.sessionKey,sessionExpiresAt:authority.expiresAt,key:objectKey});
   const url=mediaCapabilityUrl(config.url,objectKey,token);
   if(capabilityRequested)return NextResponse.json({url,expiresAt:claims.exp*1000,key:objectKey},{headers:privateHeaders});
   // Blob/document readers stay same-origin; native media redirects directly to
   // the Worker. Both paths check revocation again for every Worker read.
   if(req.nextUrl.searchParams.get('download')!=='1')return NextResponse.redirect(url,{status:302,headers:privateHeaders});
   const headers=new Headers();for(const name of ['Range','If-Range']){const value=req.headers.get(name);if(value)headers.set(name,value);}
   const response=await fetch(url,{method:head?'HEAD':'GET',headers,cache:'no-store',redirect:'error',signal:req.signal});
   const output=new Headers(privateHeaders);
   for(const name of ['Content-Type','Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified','Content-Disposition']){const value=response.headers.get(name);if(value)output.set(name,value);}
   return new NextResponse(head?null:response.body,{status:response.status,headers:output});
  }
  if(capabilityRequested){
   // Development / staged rollout still uses authenticated reads on each seek.
   const url=new URL(req.url);url.search='';url.searchParams.set('stream','1');
   return NextResponse.json({url:url.toString(),expiresAt:Math.min(Date.now()+120000,authority.expiresAt*1000),key:objectKey},{headers:privateHeaders});
  }
  const storage=getStorageService(),object=await storage.head(objectKey);
  if(!object || object.size===undefined)return NextResponse.json({error:'not_found'},{status:404,headers:privateHeaders});
  const headers=new Headers({...privateHeaders,'Content-Type':object.contentType??(await storedContentType(objectKey))??inferContentType(objectKey),'Accept-Ranges':'bytes'});
  const rangeHeader=head?null:req.headers.get('range'),range=rangeHeader?parseMediaRange(rangeHeader,object.size):null;
  if(rangeHeader&&!range){headers.set('Content-Range',`bytes */${object.size}`);return new NextResponse(null,{status:416,headers});}
  headers.set('Content-Length',String(range?range.end-range.start+1:object.size));
  const inline=/^(image\/|audio\/|video\/|text\/plain)/.test(headers.get('Content-Type')!);
  headers.set('Content-Disposition',`${inline?'inline':'attachment'}; filename="${objectKey.split('/').pop()}"`);
  if(range)headers.set('Content-Range',`bytes ${range.start}-${range.end}/${object.size}`);
  if(head)return new NextResponse(null,{headers});
  if(!storage.stream)throw Error('streaming_provider_unavailable');
  const result=await storage.stream(objectKey,range??undefined);
  return result?new NextResponse(result.body,{status:range?206:200,headers}):NextResponse.json({error:'not_found'},{status:404,headers:privateHeaders});
 }catch{return NextResponse.json({error:'temporarily_unavailable'},{status:503,headers:privateHeaders});}
}
export async function GET(req:NextRequest,context:Context){return deliver(req,context,false);}
export async function HEAD(req:NextRequest,context:Context){return deliver(req,context,true);}
