import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mountTab} from '../modules/writing/exam.js';
import {questionPicker} from '../modules/writing/exam-picker.js';

const types=[{id:'opinion',label:{en:'Opinion',uz:'Fikr'}},{id:'discussion',label:{en:'Discussion',uz:'Ikki qarash'}}];
const questions=[{id:ID(2),taskType:'task2',category:'opinion',title:'Education question',prompt:'Should university education be free?',code:'NEW-01',isNew:true,sourceDate:'29 Oct · year not independently verified',addedDate:'2026-10-29'},{id:ID(3),taskType:'task2',category:'discussion',title:'Transport question',prompt:'Discuss both views about transport.'}];
test('question types filter without losing search focus, and show original dates and NEW',()=>{
 const h=setup({path:'/app/writing?tab=exam',role:'student'});try{
  questionPicker(h.ctx,h.ctx.root,{mode:'task2',questions,types,onStart:()=>{},onBack:()=>{}});
  assert.equal(h.qa('[data-exam-question]').length,2);
  assert(h.q('.exam-new-badge'));
  assert(h.ctx.root.textContent.includes('year not independently verified'));
  h.click(h.q('[data-exam-question-type="discussion"]'));
  assert.equal(h.qa('[data-exam-question]').length,1);
  assert.equal(h.q('[data-exam-question]').dataset.examQuestion,ID(3));
  const search=h.q('[data-exam-search]');search.focus();h.input(search,'trans');
  assert.equal(document.activeElement,search);assert.equal(h.qa('[data-exam-question]').length,1);
  h.input(search,'unknown');assert.equal(h.qa('[data-exam-question]').length,0);
 }finally{h.dispose();}
});
test('Task 2 starts only after choosing a question and sends its exact persisted id',async()=>{
 const h=setup({path:'/app/writing?tab=exam',role:'student'});const fetch=globalThis.fetch;
 try{
  h.stub({'/api/frontend/view':{version:1,route:'/app/writing?tab=exam',data:{exam:{availability:{task1:0,task2:2},questions,questionTypes:{task2:types}}}}});
  const calls=[];globalThis.fetch=async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return new Response(JSON.stringify({id:ID(8)}),{headers:{'Content-Type':'application/json'}});};
  mountTab(h.ctx,h.ctx.root);await tick();h.click(h.q('[data-exam-start="task2"]'));
  assert.equal(calls.length,0);assert(h.q('[data-exam-picker="task2"]'));
  h.click(h.q('[data-exam-question]'));h.click(h.q('[data-exam-selected-start]'));await tick();
  assert.deepEqual(calls,[{path:'/api/writing/exam',body:{mode:'task2',promptId:ID(2)}}]);
  assert.equal(h.nav[0].path,'/app/writing/exam/'+ID(8));
 }finally{globalThis.fetch=fetch;h.dispose();}
});
