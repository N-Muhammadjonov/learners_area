import test from 'node:test';import assert from 'node:assert/strict';
import {setup,ID} from './staff-final30/harness.mjs';import {mountExam} from '../modules/reading/exam.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const question=(n,type,options=[])=>({id:ID(n),order:n,questionNo:n,type,typeCode:type,renderMode:null,answerConstraint:null,questionText:'Synthetic question '+n,options,groupId:null});
const fixture=questions=>({attemptId:ID(99),passageTitle:'Synthetic reading',passageBody:'Synthetic passage.',parts:[],groups:[],paragraphs:[],questions,savedAnswers:{},startedAt:new Date().toISOString(),suggestedMinutes:60});
test('text/IME, radio chips, multi-select and heading choices patch in place without stale closures',()=>{
 const h=setup(),old=globalThis.fetch;globalThis.fetch=async()=>new Response('{}');try{
  mountExam(h.ctx,fixture([question(1,'short_answer'),question(2,'true_false_not_given'),question(3,'mcq_multi',['one','two','three']),question(4,'matching_headings',['A — first','B — second'])]));
  const field=h.q('#answer-'+ID(1)),questions=h.q('#reading-questions-pane').firstElementChild,passage=h.q('#reading-passage-pane').firstElementChild;
  field.focus();field.value='synthetic';field.setSelectionRange(2,4);field.dispatchEvent(new window.InputEvent('input',{bubbles:true,isComposing:true,data:'n'}));
  assert.equal(h.q('#answer-'+ID(1)),field);assert.equal(field.selectionStart,2);assert.equal(field.selectionEnd,4);
  const radios=h.q('[data-question="'+ID(2)+'"]').querySelectorAll('[role=radio]');h.click(radios[0]);assert.equal(radios[0].getAttribute('aria-checked'),'true');h.click(radios[0]);assert.equal(radios[0].getAttribute('aria-checked'),'false');h.click(radios[1]);assert.equal(radios[1].getAttribute('aria-checked'),'true');
  const boxes=h.q('[data-question="'+ID(3)+'"]').querySelectorAll('input');for(const n of [0,1,0]){boxes[n].checked=!boxes[n].checked;boxes[n].dispatchEvent(new window.Event('change',{bubbles:true}));}assert(!boxes[0].checked);assert(boxes[1].checked);
  const headings=h.q('[data-question="'+ID(4)+'"]').querySelectorAll('[role=radio]');h.click(headings[0]);h.click(headings[1]);assert.equal(headings[0].getAttribute('aria-checked'),'false');assert.equal(headings[1].getAttribute('aria-checked'),'true');
  assert.equal(h.q('#reading-questions-pane').firstElementChild,questions);assert.equal(h.q('#reading-passage-pane').firstElementChild,passage);assert.equal(h.q('#answer-'+ID(1)),field);
 }finally{h.dispose();globalThis.fetch=old;}
});
test('an older save ACK cannot label a newer pending answer Saved or replace its input',async()=>{
 const h=setup(),old=globalThis.fetch,calls=[];let release;
 globalThis.fetch=async(path,options)=>{calls.push(JSON.parse(options.body));if(calls.length===1)return new Promise(r=>release=()=>r(new Response('{}')));return new Response('{}');};
 try{mountExam(h.ctx,fixture([question(1,'short_answer')]));const field=h.q('input'),pane=h.q('#reading-questions-pane').firstElementChild;h.input(field,'first');await pause(950);assert.equal(calls.length,1);h.input(field,'latest');release();await pause(10);assert(h.q('[data-save-state="saving"]'));assert(!h.q('[data-save-state="saved"]'));await pause(2050);assert.equal(calls.at(-1).answers[0].answer,'latest');assert(h.q('[data-save-state="saved"]'));assert.equal(h.q('input'),field);assert.equal(h.q('#reading-questions-pane').firstElementChild,pane);
 }finally{h.dispose();globalThis.fetch=old;}
});
test('source Choose TWO keeps the native controls, exact slots and extra-selection guard',()=>{
 const h=setup(),old=globalThis.fetch;globalThis.fetch=async()=>new Response('{}');globalThis.DOMParser=h.dom.window.DOMParser;
 try{const qs=[question(1,'mcq_multi'),question(2,'mcq_multi')].map(q=>({...q,groupId:ID(90)})),p=fixture(qs);p.groups=[{id:ID(90),position:1,typeCode:'mcq_multi',sharedChoices:[],sourceHtml:['A','B','C'].map(v=>'<label><input type="checkbox" value="'+v+'" data-source-numbers="1,2">'+v+'</label>').join('')}];mountExam(h.ctx,p);const boxes=[...h.ctx.root.querySelectorAll('input')];for(const b of boxes){b.checked=true;b.dispatchEvent(new window.Event('change'));}assert(boxes[0].checked&&boxes[1].checked);assert(!boxes[2].checked);assert.equal(h.qa('input')[0],boxes[0]);assert(h.q('[data-exam-answered]').textContent.includes('2'));
 }finally{h.dispose();globalThis.fetch=old;}
});
test('two source radio questions sharing a table row retain independent native selections',()=>{
 const h=setup(),old=globalThis.fetch;globalThis.fetch=async()=>new Response('{}');globalThis.DOMParser=h.dom.window.DOMParser;
 try{const qs=[question(1,'multiple_choice'),question(2,'multiple_choice')].map(q=>({...q,groupId:ID(90)})),p=fixture(qs);p.groups=[{id:ID(90),position:1,typeCode:'multiple_choice',sharedChoices:[],sourceHtml:'<table><tr>'+[1,2].map(n=>'<td>'+['A','B'].map(v=>'<input type="radio" value="'+v+'" data-source-numbers="'+n+'">').join('')+'</td>').join('')+'</tr></table>'}];mountExam(h.ctx,p);const inputs=h.qa('input');inputs[1].checked=true;inputs[1].dispatchEvent(new window.Event('change'));inputs[2].checked=true;inputs[2].dispatchEvent(new window.Event('change'));assert(inputs[1].checked);assert(inputs[2].checked);
 }finally{h.dispose();globalThis.fetch=old;}
});
