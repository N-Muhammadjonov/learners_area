import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,ID} from './staff-final30/harness.mjs';
import {mount as mountExam} from '../modules/writing/exam.js';
import {tick} from './staff-final30/harness.mjs';
import {mountExamPractice} from '../modules/writing/exam-practice.js';

test('Practice stays separate from timed Exam: local answer, elapsed timer and no server submission',()=>{
 const h=setup({path:'/app/writing?tab=exam',role:'student'});const oldFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=()=>{requests++;throw Error('Practice must never submit');};
 try{
  mountExamPractice(h.ctx,h.ctx.root,{id:ID(1),taskType:'task2',prompt:'Exact original practice question'},()=>{});
  assert(h.q('[data-writing-practice="task2"]'));assert.equal(h.q('[data-practice-timer]').textContent,'00:00');
  const input=h.q('[data-practice-editor]');h.input(input,'  Original answer with ummm  ');
  h.click(h.q('[data-practice-finish]'));assert.equal(input.value,'  Original answer with ummm  ');assert(input.readOnly);
  assert.equal(requests,0);assert(h.q('[data-practice-status]').textContent.includes('finished'));
 }finally{globalThis.fetch=oldFetch;h.dispose();}
});


test('Exam conflict keeps local text visible and never claims it saved or finalizes the newer server answer',async()=>{
 const id=ID(17),h=setup({path:'/app/writing/exam/'+id,role:'student'});const oldFetch=globalThis.fetch,oldConfirm=globalThis.confirm;let writes=0;
 try{
  const paper={id,mode:'task2',durationSeconds:2400,remainingSeconds:600,finalizedAt:null,entries:[{position:1,taskType:'task2',promptId:ID(18),prompt:'Exact question',category:'opinion',targetWordCount:250,content:'Original saved text',revision:1,savedAt:null}]};
  h.stub({'/api/frontend/view':{version:1,route:'/app/writing/exam/'+id,data:{paper,materials:{}}}});
  globalThis.confirm=()=>true;globalThis.fetch=async(path)=>{writes++;assert.equal(path,'/api/writing/exam/'+id+'/draft');return new Response(JSON.stringify({error:{code:'draft_conflict'}}),{status:409,headers:{'Content-Type':'application/json'}});};
  mountExam(h.ctx);await tick();const input=h.q('[data-exam-editor]');assert(input);
  h.input(input,'Local answer that must remain available to copy');h.click(h.q('[data-exam-submit]'));await tick(5);
  assert.equal(writes,1);assert.equal(input.value,'Local answer that must remain available to copy');assert(input.readOnly);
  assert(h.ctx.root.textContent.includes('Copy this local text'));assert.equal(h.q('[data-exam-save]').dataset.examSave,'failed');assert(h.q('[data-exam-submit]').disabled);
 }finally{globalThis.fetch=oldFetch;globalThis.confirm=oldConfirm;h.dispose();}
});


test('same-text retry advances local revision without marking newer unsaved typing as saved',async()=>{
 const id=ID(27),h=setup({path:'/app/writing/exam/'+id,role:'student'});const oldFetch=globalThis.fetch,oldTimeout=globalThis.setTimeout;let saveNow,resolveAck;const writes=[];
 globalThis.setTimeout=(fn,ms,...args)=>ms===1500?(saveNow=fn,-1):oldTimeout(fn,ms,...args);
 try{
  h.stub({'/api/frontend/view':{version:1,route:'/app/writing/exam/'+id,data:{paper:{id,mode:'task2',durationSeconds:2400,remainingSeconds:600,finalizedAt:null,entries:[{position:1,taskType:'task2',promptId:ID(28),prompt:'Exact question',category:'opinion',content:'',revision:0}]},materials:{}}}});
  globalThis.fetch=async(path,options)=>{const body=JSON.parse(options.body);writes.push(body);if(writes.length===1)return new Promise(resolve=>{resolveAck=()=>resolve(new Response(JSON.stringify({ok:true,stale:true,revision:5}),{headers:{'Content-Type':'application/json'}}));});return new Response(JSON.stringify({ok:true,stale:false,revision:body.revision}),{headers:{'Content-Type':'application/json'}});};
  mountExam(h.ctx);await tick();const input=h.q('[data-exam-editor]');h.input(input,'First text');saveNow();await tick();
  h.input(input,'First text with newer typing');resolveAck();await tick();assert.notEqual(h.q('[data-exam-save]').dataset.examSave,'saved');saveNow();await tick();
  assert.equal(writes[1].content,'First text with newer typing');assert.equal(writes[1].revision,6);assert.equal(input.value,'First text with newer typing');
 }finally{globalThis.fetch=oldFetch;globalThis.setTimeout=oldTimeout;h.dispose();}
});
