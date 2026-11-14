import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../js/api-client.js';
const response=(status=503,after='0')=>new Response(JSON.stringify(status===200?{ok:true}:{error:'service_unavailable'}),{status,headers:{'Content-Type':'application/json',...(after===null?{}:{'Retry-After':after})}});
test('only login retries 503 Retry-After, with at most two retries',async()=>{
 let calls=0;const client=createApi(async()=>response(++calls<3?503:200));
 assert.deepEqual(await client.request('/api/auth/login',{method:'POST',body:{email:'fixture@example.invalid',password:'local-only'}}),{ok:true});assert.equal(calls,3);
 for(const path of ['/api/auth/register','/api/study-plan/monthly/sequence/level/landing/import']){
  calls=0;const ordinary=createApi(async()=>{calls++;return response();});
  await assert.rejects(ordinary.request(path,{method:'POST',body:{}}),error=>error.status===503);assert.equal(calls,1);
 }
 calls=0;const exhausted=createApi(async()=>{calls++;return response();});
 await assert.rejects(exhausted.request('/api/auth/login',{method:'POST'}),error=>error.status===503);assert.equal(calls,3);
});
test('missing or excessive Retry-After is not retried and abort cancels the wait',async()=>{
 for(const after of [null,'not-a-date','30']){let calls=0;const client=createApi(async()=>{calls++;return response(503,after);});await assert.rejects(client.request('/api/auth/login',{method:'POST'}));assert.equal(calls,1);}
 let calls=0;const controller=new AbortController(),client=createApi(async()=>{calls++;return response(503,'1');});
 const pending=client.request('/api/auth/login',{method:'POST',signal:controller.signal});
 setTimeout(()=>controller.abort(),5);await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(calls,1);
});
