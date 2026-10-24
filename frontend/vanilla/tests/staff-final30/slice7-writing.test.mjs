/** Slice 7: Writing Management (list / new / edit). Fixtures only; NOT live. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,envelope,dicts} from './harness.mjs';
import {ApiError} from '../../js/api-client.js';
import * as W from '../../modules/staff-final30/writing.js';
import {buildPayload,parseSection,wordsIn,save} from '../../js/adapters/staff-final30/writing.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;});
const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
const cnt=(t=0)=>({total:t,draft:t,scheduled:0,published:0,archived:0});
const ov=(section,rows=[],o={})=>envelope('writing-admin',{section,counts:{lesson:cnt(2),prompt:cnt(),translation:cnt(),'model-text':cnt(),pattern:cnt()},rows,...o});
const row=(n,s='draft')=>({id:ID(n),title:'Row '+n,subtitle:'sub',publicationState:s,publishAt:null});
test('section parsing: exam alias, topic, unknown falls back to lesson',()=>{assert.equal(parseSection('exam'),'prompt');assert.equal(parseSection('topic'),'topic');assert.equal(parseSection('pattern'),'pattern');assert.equal(parseSection('nope'),'lesson');assert.equal(parseSection(undefined),'lesson');});
test('list: section cards with counts, active aria-current, rows with edit link + publication control using writing type',async()=>{
 h=setup({path:'/app/admin/writing?section=exam'});h.stub({'/api/frontend/staff/writing-admin':ov('prompt',[row(1)])});await h.mount({mount:W.listMount});
 assert(h.calls[0].path.includes('section=prompt'));assert.equal(h.q('[data-admin-writing]').dataset.adminWritingSection,'prompt');assert.equal(h.q('[data-admin-writing-card=prompt]').getAttribute('aria-current'),'page');assert.equal(h.q('[data-admin-writing-card=prompt]').getAttribute('href'),'/app/admin/writing?section=exam');assert.equal(h.q('[data-admin-writing-counts=lesson]').textContent.includes('Total 2'),true);assert.equal(h.q('[data-admin-writing-card=topic] [data-admin-writing-counts]'),null);
 assert.equal(h.q('[data-admin-writing-row] a.btn-secondary').getAttribute('href'),'/app/admin/writing/prompt/'+ID(1));assert.equal(h.q('[data-admin-writing-new]').getAttribute('href'),'/app/admin/writing/prompt/new');
});
test('list: publishing uses the kind-specific type and shows LOCALIZED writing issues (task1_visual_missing), never raw codes',async()=>{
 h=setup({path:'/app/admin/writing?section=exam'});let url;globalThis.fetch=async(p,o)=>{url=p;return jres(409,{error:'x',issues:['task1_visual_missing','weird_code']});};
 h.stub({'/api/frontend/staff/writing-admin':ov('prompt',[row(1)])});await h.mount({mount:W.listMount});const sel=h.q('[data-publication-control] select');sel.value='published';sel.dispatchEvent(new window.Event('change'));h.q('[data-publication-save]').click();await tick(6);
 assert.equal(url,`/api/admin/content/writing/${ID(1)}/publication`);const li=[...h.qa('[data-publication-issues] li')].map(x=>x.textContent);assert.deepEqual(li,[dicts.en.admin.writingAdmin.issues.task1_visual_missing]);
});
test('list: empty state, topic section (no rows, link to vocabulary), unavailable (not migrated) alert, unknown section label; teacher redirected',async()=>{
 h=setup({path:'/app/admin/writing'});h.stub({'/api/frontend/staff/writing-admin':ov('lesson',[])});await h.mount({mount:W.listMount});assert(h.q('[role=status]'));h.dispose();
 h=setup({path:'/app/admin/writing?section=topic'});h.stub({'/api/frontend/staff/writing-admin':ov('topic',[])});await h.mount({mount:W.listMount});assert(h.q('[data-admin-writing-topic] a[href="/app/vocabulary"]'));assert.equal(h.q('[data-admin-writing-new]'),null);h.dispose();
 h=setup({path:'/app/admin/writing'});h.stub({'/api/frontend/staff/writing-admin':ov('lesson',[],{unavailable:true})});await h.mount({mount:W.listMount});assert(h.q('[data-writing-not-migrated] [role=alert]'));h.dispose();
 h=setup({role:'teacher',path:'/app/admin/writing'});h.stub({});await h.mount({mount:W.listMount});assert.equal(h.nav[0].path,'/app');
});
test('payload builder equals source mapping for every kind (empty->null, numeric coercion, multiline split, targetBand optional)',()=>{
 assert.deepEqual(buildPayload('lesson',{title:'T',category:'task2',summary:'',body:'B',durationMinutes:'',position:'3'},[]),{title:'T',category:'task2',summary:null,body:'B',durationMinutes:null,position:3});
 assert.deepEqual(buildPayload('prompt',{taskType:'task1',category:'c',prompt:'p',targetWordCount:'150'},[]),{taskType:'task1',category:'c',prompt:'p',targetWordCount:150});
 const t=buildPayload('translation',{title:'a',topic:'b',questionType:'opinion',taskType:'task2',promptText:'p',provenance:'x',targetBand:'7'},[{position:'2',uzbekSource:'u',modelEnglish:'m',acceptedAlternatives:' a \n\n b ',notes:'',targetLexicalItems:'x'}]);assert.deepEqual(t.sentences[0],{position:2,uzbekSource:'u',modelEnglish:'m',acceptedAlternatives:['a','b'],notes:[],targetLexicalItems:['x']});assert.equal(t.targetBand,7);
 assert.equal(buildPayload('pattern',{pattern:'p',function:'trend',taskType:'task1',topic:'',example:'e',usageNote:'',provenance:'x',targetBand:'',sourceRef:''},[]).targetBand,null);assert.equal(buildPayload('pattern',{pattern:'p',function:'trend',taskType:'task1',example:'e',provenance:'x',targetBand:'6',sourceRef:ID(2)},[]).sourceRef,ID(2));
 assert.equal(buildPayload('model-text',{title:'t',taskType:'task2',topic:'x',body:'b',provenance:'p',targetBand:'8.5'},[]).targetBand,8.5);assert.throws(()=>buildPayload('essay',{},[]),TypeError);assert.equal(wordsIn("It's a well-known fact, 3 times."),6);
});
const sendTo=(h,out)=>{globalThis.fetch=async(p,o)=>{out.push({p,m:o.method,b:JSON.parse(o.body)});return jres(200,{ok:true,id:ID(40)});};};
test('new lesson: defaults task2/0, POST exact body, navigates (replace) to the edit page; form state cleaned',async()=>{
 h=setup({path:'/app/admin/writing/lesson/new'});const out=[];sendTo(h,out);h.stub({'/api/frontend/staff/writing-admin-new':envelope('writing-admin-new',{sources:[]})});await h.mount({mount:W.newMount});
 assert.equal(h.q('[data-admin-writing-form]').dataset.adminWritingForm,'lesson');assert.equal(h.q('[data-field=category]').value,'task2');assert.equal(h.q('[data-field=position]').value,'0');
 h.input(h.q('[data-field=title]'),'Intro');h.input(h.q('[data-field=body]'),'Body text');h.submit(h.q('form'));await tick(8);assert.equal(out[0].p,'/api/admin/writing/lesson');assert.equal(out[0].m,'POST');assert.deepEqual(out[0].b,{title:'Intro',category:'task2',body:'Body text',durationMinutes:null,position:0});assert.deepEqual(h.nav.at(-1),{path:'/app/admin/writing/lesson/'+ID(40),replace:true});
});
test('new form: required fields block submit (no request); unknown kind => not found without request; pattern offers source list',async()=>{
 h=setup({path:'/app/admin/writing/lesson/new'});let n=0;globalThis.fetch=async()=>{n++;return jres(200,{id:ID(1)});};h.stub({'/api/frontend/staff/writing-admin-new':envelope('writing-admin-new',{sources:[]})});await h.mount({mount:W.newMount});h.submit(h.q('form'));await tick(3);assert.equal(n,0);h.dispose();
 h=setup({path:'/app/admin/writing/bogus/new'});h.stub({});await h.mount({mount:W.newMount});assert(h.q('[data-staff-not-found]'));assert.equal(h.calls.length,0);h.dispose();
 h=setup({path:'/app/admin/writing/pattern/new'});h.stub({'/api/frontend/staff/writing-admin-new':envelope('writing-admin-new',{sources:[{id:ID(7),title:'Model essay'}]})});await h.mount({mount:W.newMount});assert.deepEqual([...h.q('[data-field=sourceRef]').options].map(o=>o.value),['',ID(7)]);assert.equal(h.q('[data-field=function]').value,'collocation');
});
test('translation form: add/remove sentences with next position, posts parsed sentences; model-text shows live word count',async()=>{
 h=setup({path:'/app/admin/writing/translation/new'});const out=[];sendTo(h,out);h.stub({'/api/frontend/staff/writing-admin-new':envelope('writing-admin-new',{sources:[]})});await h.mount({mount:W.newMount});
 for(const k of ['title','topic','promptText','provenance'])h.input(h.q(`[data-field=${k}]`),'text '+k);
 h.click(h.q('[data-add-sentence]'));h.click(h.q('[data-add-sentence]'));assert.equal(h.qa('[data-admin-sentence]').length,2);h.click(h.q('[data-admin-sentence="0"] [data-remove-sentence]'));assert.equal(h.qa('[data-admin-sentence]').length,1);
 const s=h.q('[data-admin-sentence]');h.input(s.querySelector('[data-sentence-field=uzbekSource]'),'salom');h.input(s.querySelector('[data-sentence-field=modelEnglish]'),'hello');h.input(s.querySelector('[data-sentence-field=acceptedAlternatives]'),'hi\nhey');h.submit(h.q('form'));await tick(8);
 assert.deepEqual(out[0].b.sentences,[{position:2,uzbekSource:'salom',modelEnglish:'hello',acceptedAlternatives:['hi','hey'],notes:[],targetLexicalItems:[]}]);assert.equal(out[0].b.targetBand,7);h.dispose();
 h=setup({path:'/app/admin/writing/model-text/new'});h.stub({'/api/frontend/staff/writing-admin-new':envelope('writing-admin-new',{sources:[]})});await h.mount({mount:W.newMount});h.input(h.q('[data-field=body]'),'one two three');assert(h.q('[data-admin-word-count]').textContent.endsWith(': 3'));
});
test('save failure: server issues localized, unknown code falls back to write_failed, network failure => write_failed; form values kept; no raw codes',async()=>{
 h=setup({path:'/app/admin/writing/lesson/new'});let mode='issues';globalThis.fetch=async()=>mode==='issues'?jres(400,{error:{issues:['model_too_short','duplicate_position','zzz']}}):mode==='html'?{status:502,ok:false,headers:{get:()=>'text/html'},json:async()=>{throw new Error('x');}}:Promise.reject(new Error('net'));
 h.stub({'/api/frontend/staff/writing-admin-new':envelope('writing-admin-new',{sources:[]})});await h.mount({mount:W.newMount});h.input(h.q('[data-field=title]'),'Keep me');h.input(h.q('[data-field=body]'),'b');h.submit(h.q('form'));await tick(6);
 const t=dicts.en.admin.writingAdmin.issues;assert.deepEqual([...h.qa('[data-admin-writing-issues] li')].map(x=>x.textContent),[t.model_too_short,t.duplicate_position,t.write_failed]);assert.equal(h.q('[data-field=title]').value,'Keep me');
 mode='html';h.submit(h.q('form'));await tick(6);assert.deepEqual([...h.qa('[data-admin-writing-issues] li')].map(x=>x.textContent),[t.write_failed]);mode='net';h.submit(h.q('form'));await tick(6);assert.deepEqual([...h.qa('[data-admin-writing-issues] li')].map(x=>x.textContent),[t.write_failed]);assert.equal(h.nav.length,0);
});
const item=(kind,o={})=>envelope('writing-admin-item',{item:{publicationState:'draft',publishAt:null,...o},sources:[]});
test('edit: PUT to the item, publication section with kind type, saved message; prompt kind shows visuals slot; others do not',async()=>{
 h=setup({path:'/app/admin/writing/prompt/'+ID(5)});const out=[];sendTo(h,out);let reloads=0;h.stub({'/api/frontend/staff/writing-admin-item':()=>{reloads++;return item('prompt',{taskType:'task1',category:'charts',prompt:'Describe the chart',targetWordCount:150});}});await h.mount({mount:W.editMount});
 assert.equal(h.q('[data-field=prompt]').value,'Describe the chart');assert(h.q('[data-admin-writing-visuals] [data-resource-composer=writing]'));assert.equal(h.q('[data-publication-control]').dataset.publicationControl,ID(5));
 h.input(h.q('[data-field=prompt]'),'Describe the chart in detail');h.submit(h.q('form'));await tick(8);assert.equal(out[0].p,`/api/admin/writing/prompt/${ID(5)}`);assert.equal(out[0].m,'PUT');assert.equal(out[0].b.targetWordCount,150);assert(h.ctx.root.textContent.includes(dicts.en.admin.writingAdmin.saved));assert.equal(reloads,2);h.dispose();
 h=setup({path:'/app/admin/writing/lesson/'+ID(5)});h.stub({'/api/frontend/staff/writing-admin-item':item('lesson',{title:'T',category:'task2',summary:null,body:'B',durationMinutes:null,position:1})});await h.mount({mount:W.editMount});assert.equal(h.q('[data-admin-writing-visuals]'),null);assert.equal(h.q('[data-field=summary]').value,'');
});
test('edit: 404, non-uuid id, translation sentences prefilled (lines joined); adapter rejects bad kind/id',async()=>{
 h=setup({path:'/app/admin/writing/lesson/'+ID(5)});h.stub({'/api/frontend/staff/writing-admin-item':new ApiError(404,'not_found')});await h.mount({mount:W.editMount});assert(h.q('[data-staff-not-found]'));h.dispose();
 h=setup({path:'/app/admin/writing/lesson/xyz'});h.stub({});await h.mount({mount:W.editMount});assert(h.q('[data-staff-not-found]'));assert.equal(h.calls.length,0);h.dispose();
 h=setup({path:'/app/admin/writing/translation/'+ID(5)});h.stub({'/api/frontend/staff/writing-admin-item':item('translation',{title:'t',topic:'x',questionType:'opinion',taskType:'task2',targetBand:7,promptText:'p',provenance:'prov',sentences:[{position:1,uzbekSource:'u',modelEnglish:'m',acceptedAlternatives:['a','b'],notes:[],targetLexicalItems:[]}]})});await h.mount({mount:W.editMount});assert.equal(h.q('[data-sentence-field=acceptedAlternatives]').value,'a\nb');
 await assert.rejects(()=>save('essay',null,{}),TypeError);await assert.rejects(()=>save('lesson','bad',{}),TypeError);
});
