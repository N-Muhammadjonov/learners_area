import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker,{gateway} from '../worker/index.js';
const site='https://learners-area-riwi-qa.beefydrape.chatgpt.site';
const env={BACKEND_ACCESS_TOKEN:'test-token-only'};

test('unconfigured handler makes no network request and reports blocked pages and APIs',async()=>{
  const forbidden=()=>{throw Error('network not permitted')};
  const page=await worker.fetch(new Request(site),{}, {waitUntil(){}});
  assert.equal(page.status,503);
  assert.match(await page.text(),/To‘liq ulanish kutilmoqda/);
  const api=await gateway(new Request(site+'/api/riwi/chat'),{},forbidden);
  assert.equal(api.status,503);
  assert.deepEqual(await api.json(),{error:'backend_access_not_configured'});
});
test('status never advertises successful live validation or leaks a key',async()=>{
  for(const config of [{},env]){
    const response=await gateway(new Request(site+'/__riwi/status'),config);
    const data=await response.json();
    assert.equal(data.liveRiwiValidated,false);
    assert.equal(data.databaseMigration,'blocked_pending_approval');
    assert.equal(data.state,config.BACKEND_ACCESS_TOKEN?'connection_unverified':'blocked');
    assert.ok(!JSON.stringify(data).includes('test-token-only'));
  }
});
test('rejects cross-origin or missing-origin writes before contacting backend',async()=>{
  for(const origin of [undefined,'https://elsewhere.invalid','null']){
    const request=new Request(site+'/api/riwi/chat',{method:'POST',headers:origin?{origin}:{},body:'{}'});
    const result=await gateway(request,env,()=>{throw Error('network not permitted')});
    assert.equal(result.status,403);
  }
});
test('pins the backend even for a protocol-relative incoming path',async()=>{
  const response=await gateway(new Request(site+'//elsewhere.invalid/secret'),env,()=>{throw Error('network not permitted')});
  assert.equal(response.status,400);
});
test('streams native payloads and strips unrelated identities and cookies',async()=>{
  const request=new Request(site+'/api/riwi/chat?lang=uz',{method:'POST',headers:{origin:site,
    cookie:'la_session=native; oai_session=private; la_locale=uz; _vercel_jwt=private',
    authorization:'Bearer visitor-secret','oai-authenticated-user-email':'person@example.invalid',
    'x-forwarded-host':'attacker.invalid','x-vercel-protection-bypass':'attacker'},body:'{"message":"hello"}'});
  const response=await gateway(request,env,async(url,options)=>{
    assert.equal(url.origin,'https://learners-area-hsi8ndnuf-learners-area.vercel.app');
    assert.equal(url.pathname,'/api/riwi/chat');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.get('cookie'),'la_session=native; la_locale=uz');
    assert.equal(options.headers.get('authorization'),null);
    assert.equal(options.headers.get('oai-authenticated-user-email'),null);
    assert.equal(options.headers.get('x-forwarded-host'),new URL(site).host);
    assert.equal(options.headers.get('x-vercel-protection-bypass'),'test-token-only');
    assert.equal(await new Response(options.body).text(),'{"message":"hello"}');
    const headers=new Headers({'content-type':'application/json','x-vercel-private':'secret'});
    headers.append('set-cookie','la_session=renewed; HttpOnly; Secure');
    headers.append('set-cookie','_vercel_jwt=private; HttpOnly');
    return new Response('native result',{headers});
  });
  assert.equal(await response.text(),'native result');
  assert.deepEqual(response.headers.getSetCookie(),['la_session=renewed; HttpOnly; Secure']);
  assert.equal(response.headers.get('x-vercel-private'),null);
});
test('does not follow or expose protected redirect credentials',async()=>{
  for(const location of ['https://vercel.com/login','/home?_vercel_share=hidden']){
    const response=await gateway(new Request(site),env,async()=>new Response(null,{status:302,headers:{location}}));
    assert.equal(response.status,503);
    assert.equal(response.headers.get('location'),null);
    assert.ok(!(await response.text()).includes('hidden'));
  }
});
test('keeps a normal app redirect on the Site origin',async()=>{
  const response=await gateway(new Request(site),env,async()=>new Response(null,{status:302,headers:{location:'/login'}}));
  assert.equal(response.headers.get('location'),site+'/login');
});
test('retains native application 401 responses',async()=>{
  const response=await gateway(new Request(site+'/api/frontend/session'),env,async()=>Response.json({error:'unauthenticated'},{status:401}));
  assert.equal(response.status,401);
  assert.deepEqual(await response.json(),{error:'unauthenticated'});
});
test('upstream errors do not expose credentials',async()=>{
  const response=await gateway(new Request(site+'/api/frontend/session'),env,async()=>{throw Error(env.BACKEND_ACCESS_TOKEN)});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'backend_unavailable'});
});
