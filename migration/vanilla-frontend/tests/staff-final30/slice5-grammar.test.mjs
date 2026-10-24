/** Slice 5: grammar admin + shared publication control. Fixtures only; NOT live. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,envelope,dicts} from './harness.mjs';
import {ApiError} from '../../js/api-client.js';
import * as G from '../../modules/staff-final30/grammar.js';
import {publicationControl} from '../../modules/staff-final30/kit.js';
import {parseGrammarBundle,createExercise,createTopic} from '../../js/adapters/staff-final30/grammar.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;});
const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
const ex=(o={})=>({promptText:'She go home',options:['going','goes'],correctOption:'goes',explanation:'3rd person s',translatePromptUz:'uzbek text',targetStructures:['past simple'],activationPrompt:'say it',...o});
const bundle=(o={})=>({schemaVersion:1,provenance:'owner review',topics:[{skillArea:'writing',title:'Tenses',explanation:'about tenses',exercises:[ex()]}],...o});
test('bundle parser (zod port): accepts valid, trims, rejects unknown keys, dup options, correct not in options, dup topics, bad version, bounds, bad JSON',()=>{
 assert(parseGrammarBundle(JSON.stringify(bundle())));assert.equal(parseGrammarBundle(JSON.stringify(bundle({provenance:'  owner ok  '}))).provenance,'owner ok');
 const bad=[bundle({extra:1}),bundle({schemaVersion:2}),bundle({provenance:'ab'}),bundle({topics:[]}),
  bundle({topics:[{skillArea:'reading',title:'Tenses',explanation:'about',exercises:[ex()]}]}),
  bundle({topics:[{skillArea:'writing',title:'Tenses',explanation:'about',exercises:[ex({correctOption:'x'})]}]}),
  bundle({topics:[{skillArea:'writing',title:'Tenses',explanation:'about',exercises:[ex({options:['a','a'],correctOption:'a'})]}]}),
  bundle({topics:[{skillArea:'writing',title:'Tenses',explanation:'about',exercises:[ex({options:['only'],correctOption:'only'})]}]}),
  bundle({topics:[{skillArea:'writing',title:'T',explanation:'about',exercises:[ex()]}]}),
  bundle({topics:[{skillArea:'writing',title:'Tenses',explanation:'about',exercises:[ex({unknown:1})]}]}),
  bundle({topics:[{skillArea:'writing',title:'Tenses',explanation:'about',exercises:[ex()]},{skillArea:'writing',title:'TENSES',explanation:'about',exercises:[ex()]}]})];
 for(const b of bad)assert.equal(parseGrammarBundle(JSON.stringify(b)),null,JSON.stringify(b).slice(0,80));assert.equal(parseGrammarBundle('{nope'),null);
});
test('grammar list: topics, empty, new topic form posts exact body and navigates to the new id; server error localized',async()=>{
 h=setup({path:'/app/admin/grammar'});let mode='ok';globalThis.fetch=async(p,o)=>mode==='ok'?jres(200,{ok:true,id:ID(7)}):jres(400,{error:'invalid_input'});
 h.stub({'/api/frontend/staff/grammar-topics':envelope('grammar-topics',{topics:[{id:ID(5),title:'Tenses',skillArea:'writing'}]})});await h.mount({mount:G.listMount});
 assert.equal(h.q('a[href="/app/admin/grammar/'+ID(5)+'"]').textContent.includes('Tenses'),true);h.click(h.q('[data-new-topic]'));
 h.input(h.q('#title'),'Articles');h.input(h.q('#explanation'),'a/an/the');h.change(h.q('#skillArea'),'speaking');mode='bad';h.submit(h.q('form'));await tick(6);assert(h.ctx.root.textContent.includes(dicts.en.apiErrors.invalid));assert.equal(h.q('#title').value,'Articles');
 mode='ok';let sent;globalThis.fetch=async(p,o)=>{sent={p,b:JSON.parse(o.body)};return jres(200,{ok:true,id:ID(7)});};h.submit(h.q('form'));await tick(6);assert.equal(sent.p,'/api/admin/grammar/topics');assert.deepEqual(sent.b,{skillArea:'speaking',title:'Articles',explanation:'a/an/the'});assert.equal(h.nav.at(-1).path,'/app/admin/grammar/'+ID(7));
});
test('grammar import: Apply hidden until the SAME text validated; edit invalidates; invalid JSON blocked locally; dry-run then apply refreshes',async()=>{
 h=setup({path:'/app/admin/grammar'});const bodies=[];globalThis.fetch=async(p,o)=>{bodies.push(JSON.parse(o.body));return jres(200,{ok:true,topics:1,exercises:1});};let topics=[];
 h.stub({'/api/frontend/staff/grammar-topics':()=>envelope('grammar-topics',{topics})});await h.mount({mount:G.listMount});
 const ta=()=>h.q('[data-grammar-import] textarea');assert(h.q('[data-grammar-validate]').disabled);h.input(ta(),'{nope');h.click(h.q('[data-grammar-validate]'));await tick(3);assert.equal(bodies.length,0);assert(h.ctx.root.textContent.includes(dicts.en.apiErrors.invalid));
 const text=JSON.stringify(bundle());h.input(ta(),text);h.click(h.q('[data-grammar-validate]'));await tick(6);assert.equal(bodies[0].dryRun,true);assert(h.ctx.root.textContent.includes('Ready: 1 topics, 1 exercises'));assert(h.q('[data-grammar-apply]'));
 h.input(ta(),text+' ');assert.equal(h.q('[data-grammar-apply]'),null,'edit removes apply');h.click(h.q('[data-grammar-validate]'));await tick(6);topics=[{id:ID(5),title:'Tenses',skillArea:'writing'}];h.click(h.q('[data-grammar-apply]'));await tick(8);assert.equal(bodies.at(-1).dryRun,false);assert(h.ctx.root.textContent.includes('Saved: 1 topics'));assert.equal(ta().value,'');assert.equal(h.qa('a[href^="/app/admin/grammar/"]').length,1);
});
test('grammar import: server 409 shows conflict and drops the preview; role gate',async()=>{
 h=setup({path:'/app/admin/grammar'});globalThis.fetch=async()=>jres(409,{error:'conflict'});h.stub({'/api/frontend/staff/grammar-topics':envelope('grammar-topics',{topics:[]})});await h.mount({mount:G.listMount});
 h.input(h.q('[data-grammar-import] textarea'),JSON.stringify(bundle()));h.click(h.q('[data-grammar-validate]'));await tick(6);assert(h.ctx.root.textContent.includes(dicts.en.apiErrors.conflict));assert.equal(h.q('[data-grammar-apply]'),null);h.dispose();
 h=setup({role:'teacher',path:'/app/admin/grammar'});h.stub({});await h.mount({mount:G.listMount});assert.equal(h.nav[0].path,'/app');assert.equal(h.calls.length,0);
});
const topic=(o={})=>envelope('grammar-topic',{topic:{id:ID(5),title:'Tenses',explanation:'<b>x</b>'},exercises:[{id:ID(6),order:1,promptText:'She go',correctOption:'goes'}],...o});
test('topic detail: exercises + correct option for staff, escaped text, 404/invalid id',async()=>{
 h=setup({path:'/app/admin/grammar/'+ID(5)});h.stub({'/api/frontend/staff/grammar-topic':topic()});await h.mount({mount:G.detailMount});assert(h.q('[data-exercise]').textContent.includes('Correct: goes'));assert.equal(h.qa('b').length,0);h.dispose();
 h=setup({path:'/app/admin/grammar/zzz'});h.stub({});await h.mount({mount:G.detailMount});assert(h.q('[data-staff-not-found]'));assert.equal(h.calls.length,0);h.dispose();
 h=setup({path:'/app/admin/grammar/'+ID(5)});h.stub({'/api/frontend/staff/grammar-topic':new ApiError(404,'not_found')});await h.mount({mount:G.detailMount});assert(h.q('[data-staff-not-found]'));
});
test('new exercise: correct-option select tracks typed options live; posts trimmed options; needs one of options; refresh adds it',async()=>{
 h=setup({path:'/app/admin/grammar/'+ID(5)});let sent,list=[];globalThis.fetch=async(p,o)=>{sent={p,b:JSON.parse(o.body)};list=[{id:ID(8),order:1,promptText:'She go',correctOption:'goes'}];return jres(200,{ok:true,id:ID(8)});};
 h.stub({'/api/frontend/staff/grammar-topic':()=>topic({exercises:list})});await h.mount({mount:G.detailMount});h.click(h.q('[data-new-exercise]'));
 const opts=[...h.qa('input[aria-label^="Option"]')];assert.equal(opts.length,4);assert.deepEqual([...h.q('#correctOption').options].map(o=>o.value),['']);
 h.input(opts[0],' go ');h.input(opts[1],'goes');assert.deepEqual([...h.q('#correctOption').options].map(o=>o.value),['','go','goes']);h.change(h.q('#correctOption'),'goes');
 h.input(h.q('#promptText'),'She go home');h.input(h.q('#explanation'),'3rd person');h.submit(h.q('form'));await tick(8);
 assert.equal(sent.p,`/api/admin/grammar/topics/${ID(5)}/exercises`);assert.deepEqual(sent.b,{promptText:'She go home',options:['go','goes'],correctOption:'goes',explanation:'3rd person'});assert.equal(h.qa('[data-exercise]').length,1);assert.equal(h.q('form'),null);
});
test('exercise/topic adapters reject invalid input before any request',async()=>{
 let n=0;globalThis.fetch=async()=>{n++;return jres(200,{});};
 await assert.rejects(()=>createExercise(ID(5),{promptText:'abc',options:['a'],correctOption:'a',explanation:'abc'}),TypeError);await assert.rejects(()=>createExercise(ID(5),{promptText:'abc',options:['a','b'],correctOption:'c',explanation:'abc'}),TypeError);await assert.rejects(()=>createExercise(ID(5),{promptText:'abc',options:Array(7).fill('x').map((x,i)=>x+i),correctOption:'x0',explanation:'abc'}),TypeError);
 await assert.rejects(()=>createTopic({skillArea:'reading',title:'abc',explanation:'abcde'}),TypeError);await assert.rejects(()=>createTopic({skillArea:'writing',title:'ab',explanation:'abcde'}),TypeError);assert.equal(n,0);
});
function pubMount(h,props){const host=document.createElement('div');h.ctx.root.append(host);return publicationControl({...h.ctx,root:host},props);}
test('publication control: state badge, schedule field only for scheduled, exact body with UTC instant, saved message + onSaved',async()=>{
 h=setup({path:'/app/admin/reading'});let sent,saved=0;globalThis.fetch=async(p,o)=>{sent={p,b:JSON.parse(o.body)};return jres(200,{ok:true});};
 const c=pubMount(h,{type:'reading',id:ID(3),state:'draft',publishAt:null,onSaved:async()=>{saved++;}});h.ctx.root.append(c);
 assert.equal(c.querySelector('[data-publication-state]').dataset.publicationState,'draft');assert.equal(c.querySelector('input[type=datetime-local]'),null);
 const sel=c.querySelector('select');sel.value='scheduled';sel.dispatchEvent(new window.Event('change'));const when=c.querySelector('input[type=datetime-local]');assert(when);when.value='2026-06-01T09:00';when.dispatchEvent(new window.Event('input'));
 c.querySelector('[data-publication-save]').click();await tick(6);assert.equal(sent.p,`/api/admin/content/reading/${ID(3)}/publication`);assert.equal(sent.b.state,'scheduled');assert(/^2026-06-01T\d\d:00:00\.000Z$/.test(sent.b.publishAt));assert(c.querySelector('[data-publication-result=saved]'));assert.equal(saved,1);
});
test('publication control: non-scheduled sends publishAt null; refusal shows localized issues (MCQ day, listening blockers, writing codes); never raw codes',async()=>{
 h=setup({path:'/app/admin/reading'});let resp;const bodies=[];globalThis.fetch=async(p,o)=>{bodies.push(JSON.parse(o.body));return resp;};
 const mk=(extra={})=>{const c=pubMount(h,{type:'listening',id:ID(3),state:'draft',publishAt:null,...extra});h.ctx.root.append(c);return c;};
 let c=mk();c.querySelector('select').value='published';c.querySelector('select').dispatchEvent(new window.Event('change'));resp=jres(409,{error:'incomplete_mcq_day',present:4,required:5,issues:['Q3 has no answer']});c.querySelector('[data-publication-save]').click();await tick(6);
 assert.equal(bodies[0].publishAt,null);const li=[...c.querySelectorAll('[data-publication-issues] li')].map(x=>x.textContent);assert.equal(li[0],dicts.en.listening.mcqProgram.publishRequiresFive);assert(li[1].includes('4')&&li[1].includes('5'));assert.equal(li[2],'Q3 has no answer');assert(c.querySelector('[data-publication-result=error]'));
 c=mk();c.querySelector('select').value='published';c.querySelector('select').dispatchEvent(new window.Event('change'));resp=jres(409,{error:'incomplete_listening_package',issues:['raw english'],blockers:[{kind:'transcript_missing',section:2},{kind:'review',section:3}]});c.querySelector('[data-publication-save]').click();await tick(6);
 const bl=[...c.querySelectorAll('[data-publication-issues] li')].map(x=>x.textContent);assert.equal(bl.length,2);assert(!bl.join().includes('raw english'));
 c=mk({issueLabels:{need_title:'Add a title'}});c.querySelector('select').value='published';c.querySelector('select').dispatchEvent(new window.Event('change'));resp=jres(409,{error:'x',issues:['need_title','unknown_code']});c.querySelector('[data-publication-save]').click();await tick(6);assert.deepEqual([...c.querySelectorAll('[data-publication-issues] li')].map(x=>x.textContent),['Add a title']);
});
test('publication control: network failure shows failed and re-enables; double click sends once; scheduled without a moment is sent as null (server refuses, as in source)',async()=>{
 h=setup({path:'/app/admin/reading'});let n=0;globalThis.fetch=async()=>{n++;await tick(2);throw new Error('net');};
 const c=pubMount(h,{type:'reading',id:ID(3),state:'published',publishAt:null});h.ctx.root.append(c);const save=()=>c.querySelector('[data-publication-save]');save().click();save().click();await tick(8);assert.equal(n,1);assert(c.querySelector('[data-publication-result=error]'));assert.equal(save().disabled,false);
 const sel=c.querySelector('select');sel.value='scheduled';sel.dispatchEvent(new window.Event('change'));save().click();await tick(4);assert.equal(n,2,'source sends publishAt:null and lets the server refuse');
});
