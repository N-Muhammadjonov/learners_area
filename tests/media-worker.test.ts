import test from 'node:test';
import assert from 'node:assert/strict';
import {serveMedia,type MediaEnvironment} from '../workers/learnersarea-media';
import {createMediaCapability,mediaCapabilityUrl,verifyMediaAuthorizationProof} from '../src/lib/media/protocol';
const secret='fixture-only-shared-secret-32-characters',key='listening/academic/test-01/full.mp3',scope={uid:'11111111-1111-4111-8111-111111111111',authVersion:0,sessionKey:'a'.repeat(64),sessionExpiresAt:Math.floor(Date.now()/1000)+3600,key};
async function fixture(){let authorityReads=0,headReads=0,bodyReads=0,pulls=0,revoked=false;const bytes=new TextEncoder().encode('0123456789');
 const object={size:10,httpEtag:'"fixture"',uploaded:new Date('2026-10-17T00:00:00Z'),httpMetadata:{contentType:'audio/mpeg'},writeHttpMetadata(headers:Headers){headers.set('Content-Type','audio/mpeg');headers.set('Cache-Control','public, max-age=3600');}};
 const env:MediaEnvironment={MEDIA_SIGNING_SECRET:secret,MEDIA_BUCKET:{async head(){headReads++;return object;},async get(_key,options){bodyReads++;assert.equal(options?.onlyIf?.get('If-Match'),object.httpEtag);const range=options?.range;const data=range?bytes.slice(range.offset,range.offset+range.length):bytes;return {...object,body:new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(data);controller.close();}},{highWaterMark:0})};}}};
 const authorize:typeof fetch=async(input,init)=>{authorityReads++;assert.equal(String(input),'https://learnersarea.uz/api/media/authorize');const body=JSON.parse(String(init?.body));assert.equal(await verifyMediaAuthorizationProof(secret,body),true);return Response.json({allowed:!revoked});};
 const cap=await createMediaCapability(secret,scope),url=mediaCapabilityUrl('https://media.fixture',key,cap.token);
 return {env,authorize,url,cap,counts:()=>({authorityReads,headReads,bodyReads,pulls}),revoke:()=>{revoked=true;}};
}
test('Worker GET streams body without buffering, HEAD reads metadata only, ranges are accurate and private',async()=>{
 const f=await fixture();const full=await serveMedia(new Request(f.url,{headers:{Origin:'https://learnersarea.uz'}}),f.env,f.authorize);
 assert.equal(full.status,200);assert.equal(f.counts().pulls,0);assert.equal(full.headers.get('Cache-Control'),'private, no-store');assert.equal(full.headers.get('Access-Control-Allow-Origin'),'https://learnersarea.uz');assert.equal(full.headers.get('Content-Length'),'10');assert.equal(await full.text(),'0123456789');
 const head=await serveMedia(new Request(f.url,{method:'HEAD',headers:{Range:'bytes=1-2'}}),f.env,f.authorize);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(f.counts().bodyReads,1);assert.equal(head.headers.get('Content-Length'),'10');
 for(const [range,text,contentRange]of [['bytes=2-5','2345','bytes 2-5/10'],['bytes=7-','789','bytes 7-9/10'],['bytes=-2','89','bytes 8-9/10']]){const response=await serveMedia(new Request(f.url,{headers:{Range:range!}}),f.env,f.authorize);assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),contentRange);assert.equal(response.headers.get('Content-Length'),String(text!.length));assert.equal(await response.text(),text);}
 const malformed=await serveMedia(new Request(f.url,{headers:{Range:'bytes=1-2,4-5'}}),f.env,f.authorize);assert.equal(malformed.status,416);assert.equal(malformed.headers.get('Content-Range'),'bytes */10');
 const old=await serveMedia(new Request(f.url,{headers:{Range:'bytes=2-3','If-Range':'"old"'}}),f.env,f.authorize);assert.equal(old.status,200);assert.equal(await old.text(),'0123456789');
});
test('invalid/expired/tampered/wrong-resource/method/CORS reads do not reach authorization or bucket',async()=>{
 const f=await fixture();const wrong=new URL(f.url);wrong.pathname=wrong.pathname.slice(0,-1)+'X';
 const expired=await createMediaCapability(secret,{...scope,sessionExpiresAt:Math.floor(Date.now()/1000)+3600},{now:Math.floor(Date.now()/1000)-200});
 const bad=[new Request('https://media.fixture/'),new Request(f.url.replace(/token=.*/,'token=invalid')),new Request(f.url+'x'),new Request(wrong),new Request(mediaCapabilityUrl('https://media.fixture',key,expired.token)),new Request(f.url,{method:'POST'}),new Request(f.url,{headers:{Origin:'https://attacker.fixture'}})];
 for(const req of bad)assert.ok([403,405].includes((await serveMedia(req,f.env,f.authorize)).status));assert.deepEqual(f.counts(),{authorityReads:0,headReads:0,bodyReads:0,pulls:0});
});
test('an unexpired capability is rejected after revocation on every GET, HEAD and new Range; outages fail closed',async()=>{
 const f=await fixture();assert.equal((await serveMedia(new Request(f.url,{method:'HEAD'}),f.env,f.authorize)).status,200);f.revoke();
 for(const req of [new Request(f.url),new Request(f.url,{method:'HEAD'}),new Request(f.url,{headers:{Range:'bytes=0-1'}})])assert.equal((await serveMedia(req,f.env,f.authorize)).status,403);
 assert.equal(f.counts().authorityReads,4);assert.equal(f.counts().headReads,1);assert.equal(f.counts().bodyReads,0);
 assert.equal((await serveMedia(new Request(f.url),f.env,async()=>{throw Error('unavailable');})).status,503);
 assert.equal((await serveMedia(new Request(f.url),f.env,async()=>Response.json({allowed:true},{status:302}))).status,503);
});
test('CORS preflight is bounded and never grants writes, credentials or wildcard access',async()=>{
 const f=await fixture();const good=await serveMedia(new Request(f.url,{method:'OPTIONS',headers:{Origin:'https://learnersarea.uz','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'range'}}),f.env,f.authorize);assert.equal(good.status,204);assert.equal(good.headers.get('Access-Control-Allow-Credentials'),null);assert.equal(good.headers.get('Access-Control-Allow-Origin'),'https://learnersarea.uz');
 const bad=await serveMedia(new Request(f.url,{method:'OPTIONS',headers:{Origin:'https://learnersarea.uz','Access-Control-Request-Method':'PUT'}}),f.env,f.authorize);assert.equal(bad.status,403);assert.equal(f.counts().authorityReads,0);
});

test('the Workers-compatible authorization transport refuses redirects without following or reading R2',async()=>{
 const f=await fixture();let requests=0;
 const fetchInWorkers:typeof fetch=async(_url,init)=>{
  // Workers implements follow/manual, unlike Node's supported error mode.
  if(init?.redirect==='error')throw new TypeError('Unsupported redirect mode');
  assert.equal(init?.redirect,'manual');requests++;
  return new Response(null,{status:307,headers:{Location:'https://attacker.invalid'}});
 };
 const response=await serveMedia(new Request(f.url),f.env,fetchInWorkers);
 assert.equal(response.status,503);assert.equal(requests,1);
 assert.equal(f.counts().headReads,0);assert.equal(f.counts().bodyReads,0);
});

test('a concurrent object replacement or deletion never sends an old Content-Length with an empty error response',async()=>{
 const f=await fixture();
 const info=await f.env.MEDIA_BUCKET.head(key);assert.ok(info);
 f.env.MEDIA_BUCKET.get=async()=>info;
 const changed=await serveMedia(new Request(f.url,{headers:{Range:'bytes=2-4'}}),f.env,f.authorize);assert.equal(changed.status,412);assert.equal(changed.headers.get('Content-Length'),null);assert.equal(changed.headers.get('Content-Range'),null);assert.equal(await changed.text(),'');
 f.env.MEDIA_BUCKET.get=async()=>null;
 const missing=await serveMedia(new Request(f.url),f.env,f.authorize);assert.equal(missing.status,404);assert.equal(missing.headers.get('Content-Length'),null);
});
