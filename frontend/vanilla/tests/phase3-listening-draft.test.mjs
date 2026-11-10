import test from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,api} from './staff-final30/harness.mjs';
import {listeningDraftWriter} from '../modules/listening/draft-writer.js';
import {listeningExam} from '../modules/listening/exam.js';

test('one flight coalesces pending snapshots and uses the last acknowledgement',async()=>{
 const h=setup(),old=api.request,calls=[];let release;try{
  api.request=async(path,options)=>{calls.push(options);if(calls.length===1)return new Promise(r=>release=()=>r({draftHash:'b'.repeat(64)}));return {draftHash:'c'.repeat(64)};};
  const w=listeningDraftWriter(ID(301),'a'.repeat(64));const a=w.write({answers:{q:'first'},audioPosition:0,startAudio:false});const b=w.write({answers:{q:'second'},audioPosition:1,startAudio:true});const c=w.write({answers:{q:'latest'},audioPosition:2,startAudio:false});assert.equal(calls.length,1);release();await Promise.all([a,b,c]);
  assert.equal(calls.length,2);assert.equal(calls[1].body.answers.q,'latest');assert.equal(calls[1].body.expectedDraftHash,'b'.repeat(64));assert.equal(calls[1].body.startAudio,true);assert(calls[1].keepalive);assert.equal(calls[1].timeoutMs,12000);
 }finally{api.request=old;h.dispose();}
});
test('a conflict or expired session stops writes until explicit reconciliation',async()=>{
 const h=setup(),old=api.request;let calls=0;try{api.request=async()=>{calls++;throw Object.assign(Error('conflict'),{status:409,code:'draft_conflict'});};const w=listeningDraftWriter(ID(302),'a'.repeat(64));await assert.rejects(w.write({answers:{},audioPosition:0}));await assert.rejects(w.write({answers:{},audioPosition:0}));assert.equal(calls,1);w.reconcile('b'.repeat(64));api.request=async()=>({draftHash:'c'.repeat(64)});await w.write({answers:{},audioPosition:0});assert.equal(w.hash,'c'.repeat(64));}finally{api.request=old;h.dispose();}
});
test('leaving a native exam flushes the latest answer without the route signal',async()=>{
 const h=setup(),old=api.request,calls=[];try{
  api.request=async(path,options)=>{calls.push({path,options});return {draftHash:'b'.repeat(64)};};
  const p={attemptId:ID(303),testId:ID(304),title:'Synthetic exam',audioUrl:'/api/resources/listening/fixture.mp3',duration:120,audioPosition:0,audioStartedAt:null,sectionMode:true,initial:{},draftHash:'a'.repeat(64),questions:[{id:ID(305),number:1,section:1,text:'Synthetic question',instruction:'Answer',options:[]}]};
  h.dom.window.HTMLMediaElement.prototype.pause=function(){};h.dom.window.HTMLMediaElement.prototype.load=function(){};
  h.ctx.root.append(listeningExam(h.ctx,p));h.input(h.q('input[id^="answer-"]'),'latest on exit');h.controller.abort();await tick();assert.equal(calls[0].options.body.answers[ID(305)],'latest on exit');assert.equal(calls[0].options.signal,undefined);assert.equal(calls[0].options.keepalive,true);
 }finally{api.request=old;h.dispose();}
});
