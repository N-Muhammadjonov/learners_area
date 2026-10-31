import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi,ApiError} from '../js/api-client.js';
const json=(data)=>({ok:true,status:200,headers:{get:k=>k==='content-type'?'application/json':null},json:async()=>data,text:async()=>JSON.stringify(data)});
const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
test('bounded speculative GET and normal navigation share one HTTP request',async()=>{
 let count=0;const pending=gate();
 const api=createApi(async()=>{count++;await pending.promise;return json({ok:true,rows:[1]});});
 const prefetch=api.request('/api/data',{maxBytes:1024});
 const navigation=api.request('/api/data');
 pending.release();
 const [a,b]=await Promise.all([prefetch,navigation]);
 assert.deepEqual(a,b);assert.equal(count,1);api.clear();
});
test('bounded prefetch fails closed on large payload; navigation retries uncapped',async()=>{
 let count=0;const api=createApi(async()=>{count++;return json({rows:'x'.repeat(2048)});});
 const prefetch=api.request('/api/data',{maxBytes:100});
 const navigation=api.request('/api/data');
 await assert.rejects(prefetch,e=>e instanceof ApiError&&e.status===413);
 const value=await navigation;assert.equal(value.rows.length,2048);assert.equal(count,2);api.clear();
});
test('abort one subscriber without aborting navigation subscriber',async()=>{
 let count=0;const pending=gate();const first=new AbortController();
 const api=createApi(async()=>{count++;await pending.promise;return json({ok:true});});
 const prefetch=api.request('/api/data',{signal:first.signal,maxBytes:512});
 const navigation=api.request('/api/data');first.abort();
 await assert.rejects(prefetch,e=>e.name==='AbortError');
 pending.release();assert.equal((await navigation).ok,true);assert.equal(count,1);api.clear();
});
