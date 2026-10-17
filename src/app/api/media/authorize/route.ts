import {NextRequest,NextResponse} from 'next/server';
import {actorOf,validateSessionAuthority} from '@/lib/auth/current-user';
import {hasPrivateAccess} from '@/lib/auth/account-status';
import {authorizeResourceRead} from '@/lib/data/uploads';
import {mediaWorkerConfiguration} from '@/lib/media/config';
import {verifyMediaAuthorizationProof,verifyMediaCapability,type MediaAuthorizationRequest} from '@/lib/media/protocol';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
/** Worker backchannel only. No browser cookie, no authority from plain JSON. */
export async function POST(req:NextRequest) {
  try {
    const config=mediaWorkerConfiguration();
    if (!config || Number(req.headers.get('content-length'))>5000) return NextResponse.json({allowed:false},{status:403,headers});
    // Bound the stream as Content-Length is not trustworthy for chunked bodies.
    const reader=req.body?.getReader();if(!reader)return NextResponse.json({allowed:false},{status:403,headers});
    let text='',size=0;const decoder=new TextDecoder();
    for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>5000){await reader.cancel();return NextResponse.json({allowed:false},{status:403,headers});}text+=decoder.decode(part.value,{stream:true});}
    text+=decoder.decode();const input=JSON.parse(text) as MediaAuthorizationRequest;
    if (!input || !await verifyMediaAuthorizationProof(config.secret,input)) return NextResponse.json({allowed:false},{status:403,headers});
    const claims=await verifyMediaCapability(config.secret,input.token,input.key);
    if (!claims) return NextResponse.json({allowed:false},{status:403,headers});
    const user=await validateSessionAuthority({userId:claims.uid,authVersion:claims.authVersion,sessionKey:claims.sessionKey,expiresAt:claims.sessionExpiresAt});
    if (!user || !hasPrivateAccess(user.accountStatus) || !(await authorizeResourceRead(actorOf(user),claims.key)).allowed) return NextResponse.json({allowed:false},{status:403,headers});
    return NextResponse.json({allowed:true},{headers});
  } catch { return NextResponse.json({allowed:false},{status:503,headers}); }
}
