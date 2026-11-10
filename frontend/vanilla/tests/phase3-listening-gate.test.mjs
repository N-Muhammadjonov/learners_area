import test from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {secureExamGate} from '../modules/listening/secure-exam-gate.js';

test('unstarted course shows Activities with a real start action and keeps study locked',async()=>{
 const h=setup({role:'student'}),id=ID(2);try{
  h.stub({['/api/listening/full/'+id+'/start']:{id:ID(3)}});
  h.ctx.root.append(secureExamGate(h.ctx,{kind:'exam_required',testId:id,title:'Synthetic Listening',attemptId:null,activities:['review','script','unknown']},id));
  assert.match(h.ctx.root.textContent,/Activities/);
  assert.deepEqual(h.qa('[data-listening-activity]').map(card=>card.dataset.listeningActivity),['exam','review','script']);
  assert.equal(h.qa('[data-listening-activity-locked] :is(a,button)').length,0);
  assert.equal(h.q('iframe'),null);h.click(h.qa('button').find(n=>n.textContent===h.ctx.dict.fullListeningHub.examStart.start));await tick();
  assert.equal(h.nav[0].path,'/app/listening/attempts/'+ID(3));
 }finally{h.dispose();}
});
test('owned active attempt resumes directly without downloading a runtime',()=>{
 const h=setup({role:'student'}),id=ID(2);try{h.ctx.root.append(secureExamGate(h.ctx,{testId:id,title:'Synthetic Listening',attemptId:ID(3)},id));assert.equal(h.q('[data-listening-resume]').getAttribute('href'),'/app/listening/attempts/'+ID(3));assert.equal(h.calls.length,0);}finally{h.dispose();}
});
test('foreign or malformed gate identity cannot create navigation',()=>{
 const h=setup({role:'student'});try{assert.throws(()=>secureExamGate(h.ctx,{testId:ID(7),title:'Synthetic',attemptId:null},ID(2)));assert.throws(()=>secureExamGate(h.ctx,{testId:ID(2),title:'Synthetic',attemptId:'https://example.test'},ID(2)));}finally{h.dispose();}
});
