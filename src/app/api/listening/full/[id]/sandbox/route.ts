import {listeningSequenceAccess} from "@/lib/data/listening-sequence";
import { hasOriginalListeningRuntime } from "@/lib/listening/original-listening";
import {NextRequest,NextResponse} from 'next/server';
import {requireActiveUser, requireAdministrator} from '@/lib/auth/current-user';
import {fullListeningDetail} from '@/lib/data/full-listening';
import {isUuid} from '@/lib/validation/ids';
import {AUTHORED_CSP} from '@/lib/listening/authored-sandbox';
/** Static opaque-origin launcher; source is never served under an unsandboxed origin. */
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 const user=id==="preview"?await requireAdministrator():await requireActiveUser();if(!user)return NextResponse.json({error:'unauthenticated'},{status: 401});
 if(id!=="preview"&&!isUuid(id))return NextResponse.json({error:'not_found'},{status:404});
 if(id!=='preview'){if(!await listeningSequenceAccess(user,id))return NextResponse.json({error:'sequence_locked'},{status:403,headers:{'Cache-Control':'private, no-store'}});}
 const detail=id==="preview"?null:await fullListeningDetail(id,user.role);if(id!=="preview"&&!(detail && (detail.pkg.payload.authoredRuntime || hasOriginalListeningRuntime(id, detail.pkg.sourceId))))return NextResponse.json({error:'not_found'},{status:404});
 const host=req.headers.get("x-forwarded-host")?.split(",")[0]?.trim()??req.headers.get("host")??req.nextUrl.host;
 const protocol=req.headers.get("x-forwarded-proto")==="https"?"https:":req.nextUrl.protocol;
 const expected=JSON.stringify(new URL(`${protocol}//${host}`).origin).replace(/</g,'\\u003c');
 const html=`<!doctype html><script>addEventListener('message',function init(e){if(e.source!==parent||e.origin!==${expected}||e.data?.channel!=='learners-area-sandbox-init'||typeof e.data.html!=='string'||e.data.html.length>6*1024*1024)return;let html=e.data.html,total=0;const assets=Object.entries(e.data.assets||{});if(assets.length>200)return;for(const [key,blob]of assets){if(!key.startsWith('blob:')||!(blob instanceof Blob)||(total+=blob.size)>150*1024*1024)return;}for(const [key,blob]of assets)html=html.replaceAll(key,URL.createObjectURL(blob));removeEventListener('message',init);document.open();document.write(html);document.close();});</script>`;
 return new NextResponse(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Content-Security-Policy':AUTHORED_CSP+'; sandbox allow-scripts','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
