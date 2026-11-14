import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consumePublicLevelHint,PUBLIC_LEVEL_KEY} from '../js/public-level-hint.js';
const valid=()=>({version:1,source:'public-level-check',created_at:new Date().toISOString(),raw_answers:Array(17).fill({id:'A1-grammar-1',answer:1})});
function storage(value){return{value,getItem(){return this.value;},removeItem(key){assert.equal(key,PUBLIC_LEVEL_KEY);this.value=null;}};}
test('successful imports consume once and unavailable storage never escapes',async()=>{
 let calls=0;const client={request:async()=>{calls++;}},store=storage(JSON.stringify(valid()));
 await consumePublicLevelHint(client,store);await consumePublicLevelHint(client,store);assert.equal(calls,1);assert.equal(store.value,null);
 await consumePublicLevelHint(client,{getItem(){throw Error('blocked');}});assert.equal(calls,1);
});
test('malformed, oversized and expired hints are removed without a request',async()=>{
 const client={request:()=>{throw Error('must not fetch');}};
 for(const value of ['{','x'.repeat(4097),JSON.stringify({...valid(),version:2}),JSON.stringify({...valid(),created_at:'2000-01-01'})]){
  const store=storage(value);await consumePublicLevelHint(client,store);assert.equal(store.value,null);
 }
});
test('server failures retain the hint for a later session and malformed hints are consumed',async()=>{
 const store=storage(JSON.stringify(valid()));
 await consumePublicLevelHint({request:async()=>{throw{status:503};}},store);assert(store.value);
 await consumePublicLevelHint({request:async()=>{throw{status:400};}},store);assert.equal(store.value,null);
});
test('optional unauthorized imports never broadcast an auth failure or remove the hint',async()=>{
 const previousFetch=globalThis.fetch,previousWindow=globalThis.window;
 let events=0;
 try{
  globalThis.window={dispatchEvent(){events++;}};
  globalThis.fetch=async()=>new Response('{"error":"unauthenticated"}',{status:401,headers:{'Content-Type':'application/json'}});
  const isolated=await import('../js/public-level-hint.js?quiet-import');
  const store=storage(JSON.stringify(valid()));
  await isolated.consumePublicLevelHint(undefined,store);
  assert.equal(events,0);assert(store.value);
 }finally{globalThis.fetch=previousFetch;globalThis.window=previousWindow;}
});
