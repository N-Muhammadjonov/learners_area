import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,ID} from './staff-final30/harness.mjs';
import {mountExam} from '../modules/reading/exam.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fixture=()=>({attemptId:ID(99),passageTitle:'Synthetic recovery check',passageBody:'Synthetic passage.',parts:[],groups:[],paragraphs:[],questions:[{id:ID(1),order:1,questionNo:1,type:'short_answer',typeCode:'short_answer',renderMode:null,answerConstraint:null,questionText:'Synthetic question',options:[],groupId:null}],savedAnswers:{},startedAt:new Date().toISOString(),suggestedMinutes:60});

test('exiting before the debounce sends the latest answer with an independent bounded signal',async()=>{
 const h=setup(),old=globalThis.fetch,calls=[];
 globalThis.fetch=async(path,options)=>{calls.push({path,options,body:JSON.parse(options.body)});return new Response('{}');};
 try{
  mountExam(h.ctx,fixture());h.input(h.q('input'),'latest-before-exit');
  assert(h.q('[data-save-state="saving"]'));
  h.controller.abort();
  await pause(0);
  assert.equal(calls.length,1);
  assert.equal(calls[0].body.answers[0].answer,'latest-before-exit');
  assert.equal(calls[0].options.keepalive,true);
  assert.notEqual(calls[0].options.signal,h.ctx.signal);
  assert.equal(calls[0].options.signal.aborted,false);
 }finally{h.dispose();globalThis.fetch=old;}
});

test('a failed hidden-page flush retains dirty data and returns to retry state',async()=>{
 const h=setup(),old=globalThis.fetch,calls=[];
 globalThis.fetch=async(path,options)=>{calls.push(JSON.parse(options.body));return new Response('{}',{status:503});};
 try{
  mountExam(h.ctx,fixture());h.input(h.q('input'),'recover-after-hidden');
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
  document.dispatchEvent(new window.Event('visibilitychange'));
  await pause(5);
  assert(h.q('[data-save-state="error"]'));
  globalThis.fetch=async(path,options)=>{calls.push(JSON.parse(options.body));return new Response('{}');};
  h.click(h.q('[data-save-retry]'));await pause(5);
  assert(h.q('[data-save-state="saved"]'));
  assert.equal(calls.at(-1).answers[0].answer,'recover-after-hidden');
 }finally{h.dispose();globalThis.fetch=old;}
});

test('a pending save settles before the latest exit snapshot is sent',async()=>{
 const h=setup(),old=globalThis.fetch,calls=[];let release;
 globalThis.fetch=async(path,options)=>{calls.push({options,body:JSON.parse(options.body)});if(calls.length===1)return new Promise(resolve=>release=()=>resolve(new Response('{}')));return new Response('{}');};
 try{
  mountExam(h.ctx,fixture());h.input(h.q('input'),'older-pending');await pause(950);
  assert.equal(calls.length,1);h.input(h.q('input'),'newest-before-exit');h.controller.abort();
  assert.equal(calls.length,1);assert.equal(calls[0].options.signal.aborted,false);
  release();await pause(5);
  assert.equal(calls.length,2);assert.equal(calls[1].body.answers[0].answer,'newest-before-exit');
  assert.equal(calls[1].options.keepalive,true);
 }finally{h.dispose();globalThis.fetch=old;}
});

test('a rejected transport preserves the editor and explicit retry saves the latest draft',async()=>{
 const h=setup(),old=globalThis.fetch,calls=[];
 globalThis.fetch=async()=>{throw new TypeError('Synthetic offline transport');};
 try{
  mountExam(h.ctx,fixture());const input=h.q('input');h.input(input,'offline-latest');await pause(950);
  assert(h.q('[data-save-state="error"]'));assert.equal(h.q('input'),input);assert.equal(input.value,'offline-latest');
  globalThis.fetch=async(path,options)=>{calls.push(JSON.parse(options.body));return new Response('{}');};
  h.click(h.q('[data-save-retry]'));await pause(5);
  assert.equal(calls.length,1);assert.equal(calls[0].answers[0].answer,'offline-latest');assert(h.q('[data-save-state="saved"]'));
 }finally{h.dispose();globalThis.fetch=old;}
});

test('an expired session stops draft retries and uses the existing authentication gate',async()=>{
 const h=setup(),old=globalThis.fetch;let authFailures=0,calls=0;
 window.addEventListener('learners-area:auth-failure',()=>authFailures++);
 globalThis.fetch=async()=>{calls++;return new Response('{}',{status:401});};
 try{
  mountExam(h.ctx,fixture());h.input(h.q('input'),'session-expired');await pause(950);
  assert.equal(authFailures,1);assert(h.q('[data-save-state="locked"]'));
  await pause(950);assert.equal(calls,1);
 }finally{h.dispose();globalThis.fetch=old;}
});

test('a transport that never acknowledges is bounded and exposes recovery',{timeout:15000},async()=>{
 const h=setup(),old=globalThis.fetch;let aborted;
 const timeoutObserved=new Promise(resolve=>aborted=resolve);
 globalThis.fetch=async(path,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{reject(options.signal.reason);aborted();},{once:true}));
 try{
  mountExam(h.ctx,fixture());h.input(h.q('input'),'unacknowledged-answer');
  await timeoutObserved;await pause(5);
  assert(h.q('[data-save-state="error"]'));assert.equal(h.q('input').value,'unacknowledged-answer');
 }finally{h.dispose();globalThis.fetch=old;}
});

test('the exit queue uses the server acknowledgement token from the pending write',async()=>{
 const h=setup(),old=globalThis.fetch,calls=[];let release;
 globalThis.fetch=async(path,options)=>{calls.push(JSON.parse(options.body));if(calls.length===1)return new Promise(resolve=>release=()=>resolve(new Response(JSON.stringify({draftHash:'b'.repeat(64)}))));return new Response(JSON.stringify({draftHash:'c'.repeat(64)}));};
 try{
  mountExam(h.ctx,{...fixture(),draftHash:'a'.repeat(64)});h.input(h.q('input'),'first');await pause(950);
  h.input(h.q('input'),'latest');h.controller.abort();release();await pause(5);
  assert.equal(calls.length,2);assert.equal(calls[0].expectedDraftHash,'a'.repeat(64));assert.equal(calls[1].expectedDraftHash,'b'.repeat(64));
  assert.equal(calls[1].answers[0].answer,'latest');
 }finally{h.dispose();globalThis.fetch=old;}
});

test('a stale-tab conflict preserves local answers and stops automatic overwrites',async()=>{
 const h=setup(),old=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:'draft_conflict'}),{status:409});};
 try{
  mountExam(h.ctx,{...fixture(),draftHash:'a'.repeat(64)});h.input(h.q('input'),'copy-this-local-answer');await pause(950);
  assert.match(h.q('[data-save-state="locked"]').textContent,/another tab/);assert.equal(h.q('input').value,'copy-this-local-answer');
  h.input(h.q('input'),'still-local');await pause(950);assert.equal(calls,1);
 }finally{h.dispose();globalThis.fetch=old;}
});
