import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createSpeechAssetFetch} from '../js/riwi-speech-assets.js';
import {createLocalDictation} from '../js/riwi-dictation.js';
import {setup,tick} from './staff-final30/harness.mjs';
import {mount} from '../modules/riwi/index.js';
const sha=b=>createHash('sha256').update(b).digest('hex');

test('ASR fetch is GET-only and same-origin, validates hashes and cannot transmit audio',async()=>{
 const raw=new Uint8Array([1,2,3]),digest=sha(raw),path='parts/'+digest.slice(0,16)+'-000.bin',calls=[];
 const asset={bytes:3,sha256:digest,mime:'application/octet-stream',parts:[{path,bytes:3,sha256:digest}]};
 const f=createSpeechAssetFetch({root:'https://qa.invalid/assets/speech/',crypto:webcrypto,
  manifest:{totalBinaryBytes:3,assets:{'model.onnx':asset}},fetch:async(url,options)=>{calls.push({url:String(url),options});return new Response(raw);}});
 assert.deepEqual(new Uint8Array(await(await f('model.onnx')).arrayBuffer()),raw);
 assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.credentials,'omit');
 for(const [url,options]of [['https://other.invalid/upload',{}],['https://qa.invalid/api/riwi',{}],['model.onnx',{method:'POST',body:raw}],['model.onnx',{body:raw}]])await assert.rejects(()=>f(url,options),/network_forbidden/);
 assert.equal(calls.length,1);assert.equal((await f('unknown.json')).status,404);
 const broken=createSpeechAssetFetch({root:'https://qa.invalid/assets/speech/',crypto:webcrypto,manifest:{totalBinaryBytes:3,assets:{'model.onnx':asset}},fetch:async()=>new Response(new Uint8Array([1,2,4]))});
 await assert.rejects(()=>broken('model.onnx'),/integrity/);
});

test('record, stop and local worker result release microphone and never auto-submit a prompt',async()=>{
 let worker,released=0,text;const states=[];
 class FakeWorker{constructor(){worker=this;this.sent=[];}postMessage(data){this.sent.push(data);}terminate(){this.terminated=true;}}
 const d=createLocalDictation({Worker:FakeWorker,onState:x=>states.push(x),onText:x=>text=x,
  recorderFactory:async()=>({start:async()=>{},stop:async()=>{released++;return {size:2,blob:new Blob(['xx'])};},cancel(){released++;}}),decode:async()=>new Float32Array(3200).fill(.1)});
 assert.equal(worker,undefined);d.setLanguage('uz');await d.start();assert.equal(d.phase,'recording');
 await d.stop();assert.equal(d.phase,'transcribing');assert.equal(released,1);
 const job=worker.sent.find(x=>x.type==='transcribe');assert(job.audio instanceof Float32Array);assert.equal(job.language,'uz');
 worker.onmessage({data:{type:'result',id:job.id,text:'Savolimni yozdim.'}});assert.equal(text,'Savolimni yozdim.');assert.equal(d.phase,'idle');
 assert(states.some(x=>x.phase==='transcribing'));d.cancel();assert(worker.terminated);
});

test('permission rejection and route exit stop pending capture and worker activity',async()=>{
 let worker,late,closed=0;class FakeWorker{constructor(){worker=this;}postMessage(){}terminate(){this.terminated=true;}}
 const states=[],d=createLocalDictation({Worker:FakeWorker,onState:x=>states.push(x),recorderFactory:async()=>{throw {code:'permission_denied'};}});
 await d.start();assert.equal(states.at(-1).error,'permission_denied');assert(worker.terminated);
 const controller=new AbortController(),next=createLocalDictation({Worker:FakeWorker,signal:controller.signal,
  recorderFactory:()=>new Promise(r=>late=r)});const starting=next.start();controller.abort();
 late({start:async()=>{},cancel(){closed++;}});await starting;assert.equal(closed,1);assert(worker.terminated);
});

test('microphone stops into editable composer text with no chat or audio API call',async()=>{
 const h=setup({path:'/app/riwi',role:'owner',locale:'uz'});let handler;
 try{
  await mount(h.ctx,{dictationFactory:callbacks=>{
   handler={phase:'idle',start:async()=>{handler.phase='recording';callbacks.onState({phase:'recording',elapsedMs:1000});},
    stop:async()=>{handler.phase='transcribing';callbacks.onState({phase:'transcribing'});await tick();handler.phase='idle';callbacks.onState({phase:'idle'});callbacks.onText('Bugun nimani o‘rganamiz?');},setLanguage(){},cancel(){}};return handler;
  }});
  h.input(h.q('.riwi-chat-input'),'Avvalgi jumla.');h.click(h.q('.riwi-microphone'));assert(h.q('button[type=submit]').disabled);
  assert.equal(h.q('.riwi-microphone').getAttribute('aria-label'),'Yozishni to‘xtatish');h.click(h.q('.riwi-microphone'));await tick(7);
  assert.equal(h.q('.riwi-chat-input').value,'Avvalgi jumla. Bugun nimani o‘rganamiz?');assert.equal(h.calls.length,0);
  assert(!h.q('button[type=submit]').disabled);
 }finally{h.dispose()}
});

test('vendored ASR chunks and runtime match the pinned provenance manifest',()=>{
 const root=new URL('../js/vendor/riwi-speech/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
 assert.equal(manifest.runtimeVersion,'3.8.1');assert.equal(manifest.modelRevision.length,40);
 for(const row of Object.values(manifest.assets)){
  const parts=row.parts.map(part=>{const bytes=readFileSync(new URL(part.path,root));assert(bytes.length<=2*1024*1024);assert.equal(sha(bytes),part.sha256);return bytes;});
  assert.equal(sha(Buffer.concat(parts)),row.sha256);
 }
 for(const [name,expected]of Object.entries(manifest.runtimeHashes))assert.equal(sha(readFileSync(new URL(name,root))),expected);
 for(const name of ['LICENSE.model','LICENSE.upstream','LICENSE.onnxruntime','LICENSE.transformers'])assert(readFileSync(new URL(name,root)).length>500);
});
