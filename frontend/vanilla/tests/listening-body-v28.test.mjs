import test from 'node:test';
import assert from 'node:assert/strict';
import {RangeMedia} from '../modules/listening/media/range-v11.js';
const headers={'Content-Type':'audio/mpeg','Content-Range':'bytes 0-3/4'};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const setup=()=>globalThis.location={origin:'https://fixture.invalid'};
test('V28 Range slots include held response bodies not only resolved headers',async()=>{
 setup();const held=[],started=[gate(),gate()],packets=[];let calls=0;
 const media=new RangeMedia([0,1,2].map(n=>({id:String(n),url:'/api/resources/body-'+n})),p=>packets.push(p),{chunkSize:4,fetch:async()=>{const n=calls++;if(n===2)return new Response(new Uint8Array(4),{status:206,headers});return new Response(new ReadableStream({start(c){held.push(c);},pull(){started[n].resolve();}},{highWaterMark:0}),{status:206,headers});}});
 const work=[media.pull('0'),media.pull('1'),media.pull('2')];await Promise.all(started.map(g=>g.promise));assert.equal(calls,2);assert.equal(media.reading,2);assert.equal(media.waiters.length,1);assert.equal(packets.length,0);
 for(const c of held){c.enqueue(new Uint8Array(4));c.close();}await Promise.all(work);assert.equal(calls,3);assert.equal(media.reading,0);assert.equal(media.waiters.length,0);assert.equal(packets.length,3);assert.equal(media.cacheBytes,12);media.dispose();assert.equal(media.cacheBytes,0);
});
test('V28 disposal cancels an actively read response body and cannot emit old bytes',async()=>{
 setup();const reading=gate();let cancelled=0;const packets=[];
 const media=new RangeMedia([{id:'0',url:'/api/resources/body'}],p=>packets.push(p),{chunkSize:4,fetch:async()=>new Response(new ReadableStream({pull(){reading.resolve();return new Promise(()=>{});},cancel(){cancelled++;}},{highWaterMark:0}),{status:206,headers})});
 const work=media.pull('0');await reading.promise;assert.equal(media.reading,1);media.dispose();await work;assert.equal(cancelled,1);assert.equal(media.reading,0);assert.equal(media.cacheBytes,0);assert.equal(packets.length,0);assert.equal(media.states.size,0);
});
