import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateScope} from '../js/private-scope.js';
import {createAudioPreloader} from '../modules/listening/audio-preload.js';
import {AuthoredMediaController} from '../js/generated/authored-media-controller.js';

const origin='https://learnersarea.uz',path=id=>'/api/resources/listening/academic/'+id+'/full.mp3';
const response=(bytes=8,total=bytes,type='audio/mpeg')=>new Response(new Uint8Array(bytes),{headers:{'Content-Type':type,'Content-Length':String(total)}});
const turn=()=>new Promise(r=>setImmediate(r));
function fixture(read,options={}){
 const scope=createPrivateScope();scope.setScope('user-a');const calls=[],revoked=[];let n=0;
 const pool=createAudioPreloader({scope,origin:()=>origin,fetcher:async(url,init)=>{if(url.includes('?capability=1&direct=1'))return Response.json({url:origin+url.split('?')[0]+'?stream=1'});calls.push({url,init});return read(url,init);},
  createURL:()=>`blob:test-${++n}`,revokeURL:url=>revoked.push(url),...options});
 return {pool,scope,calls,revoked};
}
async function done(pool,id){for(let i=0;i<100;i++){const v=pool.status(id);if(['ready','error','idle'].includes(v.state))return v;await turn();}throw Error('Audio queue did not settle');}

test('catalogue downloads full unlocked audio and test reuses the completed bytes',async()=>{
 const {pool,calls}=fixture(async url=>url.includes('/authored?')?Response.json({audioUrl:path('one')+'?download=1'}):response(300000));
 pool.warm([{testId:'one',locked:false},{testId:'locked',locked:true}]);
 assert.equal((await done(pool,'one')).state,'ready');
 assert.equal(calls.length,2);assert(!calls.some(c=>c.url.includes('locked')));
 assert.equal(calls[1].url,path('one')+'?stream=1');assert(!('Range' in calls[1].init.headers));
 assert.equal(pool.bytes,300000);assert.equal(await pool.acquire(path('one')), 'blob:test-1');
 assert.equal(calls.length,2);pool.release(path('one'));pool.dispose();
});

test('leaving the catalogue does not cancel the transfer acquired by the test',async()=>{
 let finish,metaFinish;const {pool,calls}=fixture(async url=>url.includes('/authored?')?new Promise(r=>metaFinish=r):new Promise(r=>finish=r));
 pool.warm([{testId:'one',locked:false}]);
 const transfer=pool.acquire(path('one'),new AbortController().signal,'one');
 metaFinish(Response.json({audioUrl:path('one')}));await turn();
 assert.equal(calls.length,2);assert(!calls[1].init.signal.aborted);
 finish(response());assert.equal(await transfer,'blob:test-1');pool.dispose();
});

test('all unlocked cards enter a two-request queue without downloading locked cards',async()=>{
 const pending=[];const {pool,calls}=fixture(async(url,init)=>url.includes('/authored?')?Response.json({audioUrl:path(url.split('/')[4])}):new Promise(r=>pending.push(r)));
 pool.warm(['a','b','c','d'].map(testId=>({testId,locked:false})).concat({testId:'locked',locked:true}));
 await turn();assert.equal(pending.length,2);
 pending[0](response());await turn();assert.equal(pending.length,3);
 pending[1](response());await turn();assert.equal(pending.length,4);
 pending[2](response());pending[3](response());
 assert.equal((await done(pool,'d')).state,'ready');assert(!calls.some(c=>c.url.includes('locked')));pool.dispose();
});

for(const mode of ['truncated','wrong-mime','denied'])test('preload rejects '+mode+' and supports a real retry',async()=>{
 let attempt=0;const {pool}=fixture(async url=>{
  if(url.includes('/authored?'))return Response.json({audioUrl:path('one')});attempt++;
  if(attempt>1)return response();
  return mode==='truncated'?response(4,8):mode==='wrong-mime'?response(8,8,'text/html'):new Response(null,{status:403});
 });
 pool.warm([{testId:'one',locked:false}]);assert.equal((await done(pool,'one')).state,'error');assert.equal(pool.bytes,0);
 pool.retry('one');assert.equal((await done(pool,'one')).state,'ready');pool.dispose();
});

test('session change aborts old reads, revokes bytes, and never returns another user audio',async()=>{
 let finish;const {pool,scope,revoked}=fixture(async url=>url.includes('/authored?')?Response.json({audioUrl:path(url.split('/')[4])}):url.includes('/one/')?response():new Promise(r=>finish=r));
 pool.warm([{testId:'one',locked:false}]);await done(pool,'one');pool.warm([{testId:'two',locked:false}]);await turn();
 const old=pool.acquire(path('two'),undefined,'two');scope.setScope('user-b');
 assert.equal(await old,null);assert.equal(pool.bytes,0);assert.deepEqual(revoked,['blob:test-1']);
 finish(response());await turn();assert.equal(pool.status('two').state,'idle');pool.dispose();
});

test('bounded cache evicts unpinned audio while preserving the playing recording',async()=>{
 const {pool,revoked}=fixture(async url=>url.includes('/authored?')?Response.json({audioUrl:path(url.split('/')[4])}):response(4),{maxBytes:8,maxFileBytes:8});
 pool.warm([{testId:'a',locked:false}]);await done(pool,'a');assert.equal(await pool.acquire(path('a')), 'blob:test-1');
 pool.warm([{testId:'b',locked:false}]);await done(pool,'b');pool.warm([{testId:'c',locked:false}]);await done(pool,'c');
 assert.equal(pool.bytes,8);assert.equal(pool.status('a').state,'ready');assert.equal(pool.status('b').state,'idle');
 assert.deepEqual(revoked,['blob:test-2']);pool.release(path('a'));pool.dispose();
});

test('preload deadline cancels an unresponsive body instead of leaving the list busy',async()=>{
 let cancelled=false;const {pool}=fixture(async url=>url.includes('/authored?')?Response.json({audioUrl:path('one')}):new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg','Content-Length':'8'}}),{timeout:10});
 pool.warm([{testId:'one',locked:false}]);await new Promise(r=>setTimeout(r,25));assert(cancelled);assert.equal(pool.status('one').state,'idle');assert.equal(pool.bytes,0);pool.dispose();
});

test('cached bytes are only resolved after a fresh server authorization succeeds',async()=>{
 globalThis.window={location:{origin}};let resolved=0;
 class Audio extends EventTarget{pause(){}load(){}removeAttribute(){}}
 const controller=new AuthoredMediaController([{id:'0',url:path('one')}],()=>{},
  {createAudio:()=>new Audio(),fetch:async()=>new Response(null,{status:403}),resolveMediaUrl:()=>{resolved++;return 'blob:private';}});
 await assert.rejects(controller.select('0'));assert.equal(resolved,0);assert.equal(controller.audio.src,undefined);controller.dispose();
});

test('catalogue transfers the complete recording directly from Cloudflare without a Railway relay',async()=>{
 const direct='https://learnersarea-media.owneruchunla.workers.dev/v1/media/listening/academic/one/full.mp3?token=synthetic';
 const {pool,calls,scope}=fixture(async url=>url.includes('/authored?')?Response.json({audioUrl:path('one'),downloadUrl:direct}):response(64));
 pool.warm([{testId:'one',locked:false}]);assert.equal((await done(pool,'one')).state,'ready');
 assert.deepEqual(calls.map(c=>c.url),['/api/listening/full/one/authored?warmup=1',direct]);
 assert.equal(calls[1].init.credentials,'omit');assert.equal(calls[1].init.mode,'cors');assert.equal(calls[1].init.priority,'high');
 assert.equal(pool.blob(path('one')).size,64);scope.setScope(null);assert.equal(pool.blob(path('one')),null);pool.dispose();
});

for(const failure of ['network','denied'])test('direct '+failure+' falls back to the authenticated stream',async()=>{
 const direct='https://learnersarea-media.owneruchunla.workers.dev/v1/media/listening/academic/one/full.mp3?token=synthetic';
 const {pool,calls}=fixture(async url=>{
  if(url.includes('/authored?'))return Response.json({audioUrl:path('one'),downloadUrl:direct});
  if(url===direct){if(failure==='network')throw new TypeError('Failed to fetch');return new Response(null,{status:403});}
  return response(64);
 });
 pool.warm([{testId:'one',locked:false}]);assert.equal((await done(pool,'one')).state,'ready');
 assert.equal(calls[2].url,path('one')+'?stream=1');assert.equal(calls[2].init.credentials,'same-origin');pool.dispose();
});
