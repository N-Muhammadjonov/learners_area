import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalTranscriptCapture} from '../modules/mocks/local-transcript.js';
import {uploadSpeakingPartRecording,sha256FromBlob} from '../modules/mocks/runner.js';

test('site capture keeps ummm, repeats and raw whitespace; no cloud recognition fallback',async()=>{
 let engine;
 class LocalRecognition{
  processLocally=false;
  constructor(){engine=this;}
  start(){assert.equal(this.processLocally,true);}
  stop(){queueMicrotask(()=>this.onend());}
  abort(){}
 }
 const c=createLocalTranscriptCapture({Recognition:LocalRecognition});c.start();
 const result=(text,final=true)=>Object.assign([{transcript:text}],{isFinal:final});
 engine.onresult({resultIndex:0,results:[result('  ummm I I '),result('was uh ...\n'),result('unfinished',false)]});
 const captured=await c.stop();
 assert.equal(captured.text,'  ummm I I was uh ...\n');assert.equal(captured.status,'browser_unverified');
 let starts=0;
 class RemoteOnly{start(){starts++;}}
 const unavailable=createLocalTranscriptCapture({Recognition:RemoteOnly});unavailable.start();
 assert.equal((await unavailable.stop()).status,'unavailable');assert.equal(starts,0);
});

test('route abort stops local recognition and ignores late transcript events',async()=>{
 const controller=new AbortController();let engine,aborts=0;
 class LocalRecognition{processLocally=false;constructor(){engine=this;}start(){}abort(){aborts++;}stop(){this.onend();}}
 const c=createLocalTranscriptCapture({signal:controller.signal,Recognition:LocalRecognition});c.start();controller.abort();
 engine.onresult({resultIndex:0,results:[Object.assign([{transcript:'late invented text'}],{isFinal:true})]});
 assert.equal((await c.stop()).text,'');assert(aborts>=1);
});

test('one question posts original binary plus unchanged raw transcript to its own endpoint',async()=>{
 const blob=new Blob([new Uint8Array(100).fill(11)],{type:'audio/webm'});const sha256=await sha256FromBlob(blob);
 const capture={text:'ummm  I I was uh',status:'browser_unverified',reason:''};let calls=0;
 const response=await uploadSpeakingPartRecording({attemptId:'test-attempt',part:'P1',recording:{blob,bytes:blob.size,sha256,codec:'webm',durationMs:3000,captureMode:'question',questionIds:['question-id'],transcriptCapture:capture},fetcher:async(url,options)=>{
  calls++;assert.equal(url,'/api/mocks/attempts/test-attempt/speaking/responses');assert.equal(options.credentials,'same-origin');
  assert.equal(options.body.get('questionId'),'question-id');assert.deepEqual(JSON.parse(options.body.get('transcriptCapture')),capture);
  assert.deepEqual(new Uint8Array(await options.body.get('audio').arrayBuffer()),new Uint8Array(await blob.arrayBuffer()));
  return new Response(JSON.stringify({ok:true,captureStatus:'finalized'}),{headers:{'Content-Type':'application/json'}});
 }});
 assert.equal(calls,1);assert.equal(response.captureStatus,'finalized');
});

test('question capture screen renders a distinct control per frozen question and preserves the cue card',async()=>{
 const {setup,ID}=await import('./staff-final30/harness.mjs');
 const {renderExamRunnerScreen}=await import('../modules/mocks/runner.js');
 const h=setup({path:'/app/mocks/'+ID(40),role:'student'});
 try{
  const parts=[{part:'P1',questionId:ID(41),promptText:'First question?'},{part:'P1',questionId:ID(42),promptText:'Second question?'},{part:'P2',questionId:ID(43),promptText:'Describe a place.',cueCard:'You should say:\nwhere it is\nwhy it matters'},{part:'P3',questionId:ID(44),promptText:'Final question?'}];
  h.stub({['/api/mocks/attempts/'+ID(40)]:{ok:true,serverNow:new Date().toISOString(),attempt:{id:ID(40),title:'Fixture Mock',track:'academic',speakingCaptureMode:'question',deadlineAt:new Date(Date.now()+840000).toISOString(),sections:[{position:1,skill:'speaking',status:'in_progress',remainingSeconds:840,deadlineAt:new Date(Date.now()+840000).toISOString(),material:{parts}}],speakingParts:[],writingTasks:[]}}});
  await renderExamRunnerScreen(h.ctx,h.ctx.root,ID(40));
  const controls=h.qa('[data-mock-speaking-record]');assert.equal(controls.length,4);assert.equal(new Set(controls.map(x=>x.dataset.mockSpeakingRecord)).size,4);
  assert(h.ctx.root.textContent.includes('where it is'));assert(h.ctx.root.textContent.includes('Second question?'));
 }finally{h.dispose();}
});
