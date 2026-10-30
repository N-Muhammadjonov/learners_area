/** Slice 6: reading list + passage detail. Fixtures only; NOT live. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,envelope,dicts} from './harness.mjs';
import {ApiError} from '../../js/api-client.js';
import * as R from '../../modules/staff-final30/reading.js';
import {createPassage,createQuestion} from '../../js/adapters/staff-final30/reading.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;});
const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
const list=(o={})=>envelope('reading-passages',{passages:[{id:ID(3),title:'Cities',difficultyLevel:'B2',suggestedMinutes:20,publicationState:'draft',publishAt:null}],...o});
test('reading list: card per passage, link and publication control are siblings, retention/import links, state badge',async()=>{
 h=setup({path:'/app/admin/reading'});h.stub({'/api/frontend/staff/reading-passages':list()});await h.mount({mount:R.listMount});
 const card=h.q('[data-passage="'+ID(3)+'"]');assert.equal(card.querySelector('a').getAttribute('href'),'/app/admin/reading/'+ID(3));assert(card.textContent.includes('B2 · 20 min'));assert.equal(card.querySelector('a [data-publication-control]'),null);assert.equal(card.querySelector('[data-publication-state]').dataset.publicationState,'draft');
 assert(h.q('[data-reading-retention-link]'));assert.equal(h.q('[data-admin-reading-import]').getAttribute('href'),'/app/admin/reading/import');
});
test('reading list: publishing from the list refreshes the list; teacher redirected',async()=>{
 h=setup({path:'/app/admin/reading'});let state='draft',n=0;globalThis.fetch=async(p,o)=>{state=JSON.parse(o.body).state;return jres(200,{ok:true});};
 h.stub({'/api/frontend/staff/reading-passages':()=>{n++;return list({passages:[{id:ID(3),title:'Cities',difficultyLevel:'B2',suggestedMinutes:20,publicationState:state,publishAt:null}]});}});await h.mount({mount:R.listMount});
 const sel=h.q('[data-publication-control] select');sel.value='published';sel.dispatchEvent(new window.Event('change'));h.q('[data-publication-save]').click();await tick(8);assert.equal(h.q('[data-publication-state]').dataset.publicationState,'published');assert.equal(n,2);h.dispose();
 h=setup({role:'teacher',path:'/app/admin/reading'});h.stub({});await h.mount({mount:R.listMount});assert.equal(h.nav[0].path,'/app');
});
test('new passage: defaults B2/15, posts exact body, navigates to new id; failure shows generic error and keeps text; short body blocked before request',async()=>{
 h=setup({path:'/app/admin/reading'});let sent,ok=true,calls=0;globalThis.fetch=async(p,o)=>{calls++;sent=JSON.parse(o.body);return ok?jres(200,{ok:true,id:ID(9)}):jres(400,{error:'x'});};
 h.stub({'/api/frontend/staff/reading-passages':list({passages:[]})});await h.mount({mount:R.listMount});h.click(h.q('[data-new-passage]'));
 assert.equal(h.q('#difficultyLevel').value,'B2');assert.equal(h.q('#suggestedMinutes').value,'15');h.input(h.q('#title'),'Water');h.input(h.q('#bodyText'),'short');h.submit(h.q('form'));await tick(4);assert.equal(calls,0);assert(h.q('[role=alert]'));
 const body='x'.repeat(60);h.input(h.q('#bodyText'),body);ok=false;h.submit(h.q('form'));await tick(6);assert.equal(calls,1);assert(h.q('[role=alert]'));assert.equal(h.q('#title').value,'Water');
 ok=true;h.change(h.q('#difficultyLevel'),'C1');h.submit(h.q('form'));await tick(6);assert.deepEqual(sent,{title:'Water',bodyText:body,difficultyLevel:'C1',suggestedMinutes:'15'});assert.equal(h.nav.at(-1).path,'/app/admin/reading/'+ID(9));
});
const det=(o={})=>envelope('reading-passage',{passage:{id:ID(3),title:'Cities',bodyText:'<b>body</b>\nline2'},questions:[{id:ID(4),order:1,questionText:'Q one',type:'multiple_choice',correctAnswer:'B'}],...o});
test('passage detail: body and answers for staff, escaped, real composer by default, overridable via ctx, 404/invalid id',async()=>{
 h=setup({path:'/app/admin/reading/'+ID(3)});h.stub({'/api/frontend/staff/reading-passage':det()});await h.mount({mount:R.detailMount});assert(h.q('[data-question]').textContent.includes('Answer: B'));assert.equal(h.qa('b').length,0);assert(h.q('[data-resource-composer=reading]'));h.dispose();
 h=setup({path:'/app/admin/reading/'+ID(3)});h.ctx.resourceComposer=(c,{ownerType,ownerId})=>{const n=document.createElement('section');n.dataset.composerOwner=ownerType+':'+ownerId;return n;};h.stub({'/api/frontend/staff/reading-passage':det()});await h.mount({mount:R.detailMount});assert.equal(h.q('[data-composer-owner]').dataset.composerOwner,'reading:'+ID(3));h.dispose();
 h=setup({path:'/app/admin/reading/zzz'});h.stub({});await h.mount({mount:R.detailMount});assert(h.q('[data-staff-not-found]'));assert.equal(h.calls.length,0);h.dispose();
 h=setup({path:'/app/admin/reading/'+ID(3)});h.stub({'/api/frontend/staff/reading-passage':new ApiError(404,'not_found')});await h.mount({mount:R.detailMount});assert(h.q('[data-staff-not-found]'));
});
async function open(h,type){h.click(h.q('[data-new-question]'));if(type)h.change(h.q('#type'),type);}
test('new question: type switch resets correct answer (true/yes/empty); MCQ correct select follows typed options; posts options only for MCQ; evidence omitted when empty',async()=>{
 h=setup({path:'/app/admin/reading/'+ID(3)});const bodies=[];globalThis.fetch=async(p,o)=>{bodies.push({p,b:JSON.parse(o.body)});return jres(200,{ok:true,id:ID(5)});};
 h.stub({'/api/frontend/staff/reading-passage':()=>det()});await h.mount({mount:R.detailMount});await open(h);
 assert.equal(h.q('#correctAnswerTernary').value,'true');h.input(h.q('#questionText'),'Is it true?');h.input(h.q('#explanation'),'because');h.change(h.q('#correctAnswerTernary'),'not_given');h.submit(h.q('form'));await tick(8);
 assert.equal(bodies[0].p,`/api/admin/reading/passages/${ID(3)}/questions`);assert.deepEqual(bodies[0].b,{type:'true_false_not_given',questionText:'Is it true?',correctAnswer:'not_given',explanation:'because'});
 await open(h,'yes_no_not_given');assert.equal(h.q('#correctAnswerTernary').value,'yes');h.change(h.q('#type'),'multiple_choice');assert.equal(h.q('#correctAnswerMcq').value,'');
 const opts=[...h.qa('input[aria-label^="Option"]')];h.input(opts[0],' alpha ');h.input(opts[1],'beta');assert.deepEqual([...h.q('#correctAnswerMcq').options].map(o=>o.value),['','alpha','beta']);h.change(h.q('#correctAnswerMcq'),'beta');h.input(h.q('#questionText'),'Pick one');h.input(h.q('#evidenceQuote'),'quote');h.input(h.q('#explanation'),'why');h.submit(h.q('form'));await tick(8);
 assert.deepEqual(bodies.at(-1).b,{type:'multiple_choice',questionText:'Pick one',options:['alpha','beta'],correctAnswer:'beta',evidenceQuote:'quote',explanation:'why'});
 await open(h,'short_answer');h.input(h.q('#correctAnswerShort'),'  42 ');h.input(h.q('#questionText'),'How many?');h.input(h.q('#explanation'),'why');h.submit(h.q('form'));await tick(8);assert.equal(bodies.at(-1).b.correctAnswer,'  42 ');assert.equal('options' in bodies.at(-1).b,false);
});
test('new question: revision_managed 409 shows the localized refusal and keeps the form; adapters validate before request',async()=>{
 h=setup({path:'/app/admin/reading/'+ID(3)});globalThis.fetch=async()=>jres(409,{error:'revision_managed'});h.stub({'/api/frontend/staff/reading-passage':det()});await h.mount({mount:R.detailMount});await open(h);
 h.input(h.q('#questionText'),'Is it true?');h.input(h.q('#explanation'),'because');h.submit(h.q('form'));await tick(6);assert(h.ctx.root.textContent.includes(dicts.en.apiErrors.revisionManaged));assert(h.q('form'));
 let n=0;globalThis.fetch=async()=>{n++;return jres(200,{});};
 await assert.rejects(()=>createQuestion(ID(3),{type:'multiple_choice',questionText:'Valid q',options:['one'],correctAnswer:'one',explanation:'x'}),e=>e.status===400);await assert.rejects(()=>createQuestion(ID(3),{type:'essay',questionText:'Valid q',correctAnswer:'a',explanation:'x'}),TypeError);
 await assert.rejects(()=>createPassage({title:'ab',bodyText:'x'.repeat(60),difficultyLevel:'B2',suggestedMinutes:'15'}),e=>e.status===400);await assert.rejects(()=>createPassage({title:'abc',bodyText:'x'.repeat(60),difficultyLevel:'B2',suggestedMinutes:'4'}),e=>e.status===400);assert.equal(n,0);
});
