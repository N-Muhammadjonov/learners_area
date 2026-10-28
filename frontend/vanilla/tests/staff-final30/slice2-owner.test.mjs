/** Slice 2: owner overview, transfer, retention, integrations/AI control, dictionary. Fixtures only; NOT live. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,envelope,dicts} from './harness.mjs';
import {ApiError} from '../../js/api-client.js';
import * as overview from '../../modules/staff-final30/owner-overview.js';
import {ACADEMIC_EN} from '../../modules/staff-final30/monitoring-strings.js';
import * as transfer from '../../modules/staff-final30/owner-transfer.js';
import * as retention from '../../modules/staff-final30/owner-retention.js';
import * as integ from '../../modules/staff-final30/owner-integrations.js';
import * as odict from '../../modules/staff-final30/owner-dictionary.js';
import {transferOwnership,saveAi,validateAiStatus} from '../../js/adapters/staff-final30/owner.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;});
const academic={filters:{from:null,to:null,student:'',teacher:'',module:null},activeStudents:7,onlineStudents:1,activity:{students:3,records:8},homework:{assigned:10,completed:7,inProgress:1,overdue:1,notStarted:1},completionPercent:70,pendingReviews:1,writingSubmissions:2,daily:Array.from({length:7},(_,i)=>({day:`2026-04-${String(i+24).padStart(2,'0')}`,count:i})),moduleSummary:['reading','listening','writing','speaking','retention','vocabulary','grammar','video','lessons','mocks'].map(module=>({module,started:0,completed:0,learners:0,accuracy:null,band:null,latest:null})),attention:[]};
const ov=(o={})=>envelope('owner-overview',{academic,counts:[{role:'student',status:'active',count:7},{role:'teacher',status:'active',count:2},{role:'student',status:'pending',count:1}],pendingCount:1,integrations:[{key:'database',state:'connected'},{key:'telegram',state:'unverified'},{key:'email',state:'not_configured'}],brand:{siteName:'Learners Area',favicon:'/brand/fav.png',assets:[{key:'logoMasterDark',path:'/brand/m.png'},{key:'logoMarkDark',path:'/brand/d.png'},{key:'logoMarkLight',path:'/brand/l.png'},{key:'logoHorizontalDark',path:'/brand/hd.png'},{key:'logoHorizontalLight',path:'/brand/hl.png'},{key:'favicon',path:'/brand/fav.png'}]},...o});
test('owner overview: stats computed from counts, links, brand preview; admin/teacher redirected',async()=>{
 h=setup({role:'owner',path:'/app/owner'});h.stub({'/api/frontend/staff/owner-overview':ov()});await h.mount(overview);
 const t=h.ctx.root.textContent;assert(t.includes('10')&&t.includes('9 active'));assert.equal(h.qa('a[href^="/app/"]').length,10);assert.equal(h.qa('[data-brand-asset]').length,6);assert.equal(h.qa('[data-brand-logo] img').length,6);h.dispose();
 for(const role of ['admin','teacher','student']){h=setup({role,path:'/app/owner'});h.stub({});await h.mount(overview);assert.equal(h.nav[0].path,'/app');assert.equal(h.calls.length,0);h.dispose();}
});
test('owner academic filters persist in URL, cover date/student/teacher/module, and reject invalid ranges',async()=>{
 h=setup({role:'owner',path:'/app/owner'});h.stub({'/api/frontend/staff/owner-overview':ov()});await h.mount(overview);
 const form=h.q('[data-owner-academic-filters]');assert(form);assert.equal(h.qa('[name=group]').length,0);
 h.input(form.elements.namedItem('from'),'2026-04-20');h.input(form.elements.namedItem('to'),'2026-04-28');h.input(form.elements.namedItem('student'),'Browser learner');h.input(form.elements.namedItem('teacher'),"O'qituvchi");h.change(form.elements.namedItem('module'),'reading');
 h.submit(form);assert.equal(h.nav.at(-1).path,'/app/owner?from=2026-04-20&to=2026-04-28&student=Browser+learner&teacher=O%27qituvchi&module=reading');
 h.input(form.elements.namedItem('from'),'2026-04-30');h.input(form.elements.namedItem('to'),'2026-04-20');h.submit(form);assert.equal(h.nav.length,1);assert.equal(form.querySelector('[role=alert]').textContent,ACADEMIC_EN.rangeInvalid);
 h.dispose();
});
test('owner overview: path traversal / foreign brand paths rejected (fail closed)',async()=>{
 for(const bad of ['https://evil.invalid/x.png','/brand/../../etc/passwd','javascript:alert(1)']){h=setup({role:'owner',path:'/app/owner'});h.stub({'/api/frontend/staff/owner-overview':ov({brand:{siteName:'x',favicon:bad,assets:[]}})});await h.mount(overview);assert(h.q('[data-region-failure]'),bad);h.dispose();}
});
test('transfer: button disabled until email+password; exact body; success wipes password and refreshes; no dialog invented',async()=>{
 h=setup({role:'owner',path:'/app/owner/transfer'});let refreshed=0;h.ctx.refresh=()=>{refreshed++;};
 globalThis.fetch=async(p,o)=>({status:200,ok:true,headers:{get:()=>'application/json'},json:async()=>({ok:true})});
 h.stub({'/api/frontend/staff/owner-transfer':envelope('owner-transfer',{ownerEmail:'owner@example.invalid'})});await h.mount(transfer);
 const btn=h.q('button.btn-primary');assert(btn.disabled);assert(h.ctx.root.textContent.includes('owner@example.invalid'));assert.equal(h.qa('dialog').length,0);
 h.input(h.q('#transfer-email'),'  new@example.invalid ');h.input(h.q('#transfer-password'),'pw');assert(!btn.disabled);h.change(h.q('#transfer-role'),'teacher');
 let sent;globalThis.fetch=async(p,o)=>{sent={p,o};return {status:200,ok:true,headers:{get:()=>'application/json'},json:async()=>({ok:true})};};
 h.click(btn);await tick(6);assert.equal(sent.p,'/api/owner/transfer');assert.deepEqual(JSON.parse(sent.o.body),{email:'new@example.invalid',password:'pw',keepRole:'teacher'});
 assert(h.ctx.root.textContent.includes(dicts.en.owner.transferDone));assert.equal(refreshed,1);assert.equal(h.q('#transfer-password'),null);
});
test('transfer: wrong password (401 invalid_credentials) shows form error and does NOT trigger global logout; fields kept',async()=>{
 h=setup({role:'owner',path:'/app/owner/transfer'});let logout=0;window.addEventListener('learners-area:auth-failure',()=>logout++);
 globalThis.fetch=async()=>({status:401,ok:false,headers:{get:()=>'application/json'},json:async()=>({error:'invalid_credentials'})});
 h.stub({'/api/frontend/staff/owner-transfer':envelope('owner-transfer',{ownerEmail:''})});await h.mount(transfer);
 h.input(h.q('#transfer-email'),'a@example.invalid');h.input(h.q('#transfer-password'),'bad');h.click(h.q('button.btn-primary'));await tick(6);
 assert.equal(logout,0);assert(h.ctx.root.textContent.includes(dicts.en.owner.transferFailed));assert.equal(h.q('#transfer-email').value,'a@example.invalid');assert.equal(h.q('button.btn-primary').disabled,false);assert.equal(h.nav.length,0);
});
test('transfer: a genuine expired session (401 unauthenticated) still signals logout; password cleared on abort; double click sends once',async()=>{
 h=setup({role:'owner',path:'/app/owner/transfer'});let logout=0,calls=0;window.addEventListener('learners-area:auth-failure',()=>logout++);
 globalThis.fetch=async()=>{calls++;await tick(2);return {status:401,ok:false,headers:{get:()=>'application/json'},json:async()=>({error:'unauthenticated'})};};
 h.stub({'/api/frontend/staff/owner-transfer':envelope('owner-transfer',{ownerEmail:''})});await h.mount(transfer);
 h.input(h.q('#transfer-email'),'a@example.invalid');h.input(h.q('#transfer-password'),'x');const pw=h.q('#transfer-password');const b=h.q('button.btn-primary');h.click(b);h.click(b);await tick(8);
 assert.equal(calls,1);assert.equal(logout,1);h.controller.abort();assert.equal(pw.value,'');
});
test('transfer: adapter rejects invalid keepRole (owner) and empty password locally',async()=>{
 await assert.rejects(()=>transferOwnership({email:'a@b.c',password:'x',keepRole:'owner'}),TypeError);await assert.rejects(()=>transferOwnership({email:'a@b.c',password:'',keepRole:'admin'}),TypeError);
});
const cfg={config:{inactiveStudentMonths:6,rawEventMonths:2,structuredResultMonths:18,auditMonths:18,generatedExportDays:7}};
test('retention: policy rows, native export form, preview sends dryRun:true, run sends dryRun:false, results rendered',async()=>{
 h=setup({role:'owner',path:'/app/owner/retention'});h.stub({'/api/frontend/staff/owner-retention':envelope('owner-retention',cfg),'/api/owner/retention':(p,o)=>({ok:true,dryRun:o.body.dryRun,config:{},results:[{rule:'raw_events',affected:o.body.dryRun?3:0,applied:!o.body.dryRun,note:'n'}]})});await h.mount(retention);
 assert(h.ctx.root.textContent.includes('6 months')&&h.ctx.root.textContent.includes('7 days'));const f=h.q('form[action="/api/owner/student-export"]');assert.equal(f.method,'get');assert.deepEqual([...f.querySelectorAll('option')].map(o=>o.value),['pdf','docx','zip']);
 const [dry,run]=h.qa('.card .btn-secondary,.card .btn-primary').filter(b=>b.classList.contains('text-xs'));h.click(dry);await tick(5);assert.equal(h.calls.at(-1).body.dryRun,true);assert.equal(h.q('[data-retention-mode]').dataset.retentionMode,'dry-run');assert.equal(h.q('[data-retention-rule]').dataset.retentionAffected,'3');
 h.click(run);await tick(5);assert.equal(h.calls.at(-1).body.dryRun,false);assert.equal(h.q('[data-retention-mode]').dataset.retentionMode,'applied');assert(h.ctx.root.textContent.includes(dicts.en.retention.nothing));
});
test('retention: failure shows generic error; malformed result fails closed; buttons recover',async()=>{
 h=setup({role:'owner',path:'/app/owner/retention'});h.stub({'/api/frontend/staff/owner-retention':envelope('owner-retention',cfg),'/api/owner/retention':{ok:true,dryRun:true,results:[{rule:'x',affected:-1,applied:false}]}});await h.mount(retention);
 const dry=h.qa('.text-xs').find(b=>b.tagName==='BUTTON');h.click(dry);await tick(5);assert(h.ctx.root.textContent.includes(dicts.en.errors.unknown));assert.equal(dry.disabled,false);assert.equal(h.qa('[data-retention-rule]').length,0);
});
const ai=(o={})=>({deploymentCeiling:true,owner:{externalEnabled:false,providerId:null,model:null,fallback:'riwi',updatedAt:null,source:'default'},effective:{externalEnabled:false,providerId:'riwi',providerIsExternal:false,ready:false,model:null,fallback:'riwi'},providers:[{id:'riwi',displayName:'RIWI',type:'internal',model:null,capabilities:[],secretsPresent:true,missingSecretNames:[]},{id:'acme',displayName:'Acme',type:'external',model:'m1',capabilities:['writing'],secretsPresent:false,missingSecretNames:['ACME_KEY']}],configIssues:[{index:0,reason:'bad url'}],...o});
const fetchJson=(status,data)=>async()=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
test('integrations: states and badges, AI panel renders secrets-missing names only (no values), ceiling-off note, unavailable alert',async()=>{
 h=setup({role:'owner',path:'/app/owner/integrations'});globalThis.fetch=fetchJson(200,ai({deploymentCeiling:false,owner:{...ai().owner,source:'unavailable'}}));
 h.stub({'/api/frontend/staff/owner-integrations':envelope('owner-integrations',{report:[{key:'database',state:'connected',detail:null,checkedAt:'2026-05-01T10:00:00Z'},{key:'storage',state:'not_configured',detail:'missing 2 variable(s)',checkedAt:'2026-05-01T10:00:00Z'},{key:'weird',state:'error',detail:null,checkedAt:'2026-05-01T10:00:00Z'}]})});await h.mount(integ);
 assert.equal(h.q('[data-integration=database]').dataset.state,'connected');assert(h.q('[data-integration=weird]'));assert(h.ctx.root.textContent.includes('ACME_KEY'));assert(h.q('[data-ai-ceiling=false]'));assert(h.q('[data-ai-control] [role=alert]'));assert(h.ctx.root.textContent.includes('#1 bad url'));
});
test('integrations: saving AI control sends exact body, maps nested error codes, updates effective state',async()=>{
 h=setup({role:'owner',path:'/app/owner/integrations'});const bodies=[];let mode='ok';
 globalThis.fetch=async(p,o)=>{if(o.method==='POST'){bodies.push(JSON.parse(o.body));if(mode==='unknown')return {status:400,ok:false,headers:{get:()=>'application/json'},json:async()=>({error:{code:'unknown_provider'}})};if(mode==='model')return {status:400,ok:false,headers:{get:()=>'application/json'},json:async()=>({error:{code:'invalid_model'}})};return {status:200,ok:true,headers:{get:()=>'application/json'},json:async()=>ai({owner:{externalEnabled:true,providerId:'acme',model:'m1',fallback:'none',updatedAt:'2026-05-02T10:00:00.000Z',source:'owner'},effective:{externalEnabled:true,providerId:'acme',providerIsExternal:true,ready:true,model:'m1',fallback:'none'}})};}return {status:200,ok:true,headers:{get:()=>'application/json'},json:async()=>ai()};};
 h.stub({'/api/frontend/staff/owner-integrations':envelope('owner-integrations',{report:[]})});await h.mount(integ);
 const panel=()=>h.q('[data-ai-control]');const radios=panel().querySelectorAll('input[name=ai-master]');radios[0].checked=true;radios[0].dispatchEvent(new window.Event('change'));
 h.change(h.q('[data-ai-provider-select]'),'acme');h.input(h.q('[data-ai-model-input]'),'  m1 ');panel().querySelectorAll('input[name=ai-fallback]')[1].checked=true;panel().querySelectorAll('input[name=ai-fallback]')[1].dispatchEvent(new window.Event('change'));
 mode='unknown';h.click(panel().querySelector('button.btn-primary'));await tick(6);assert(panel().textContent.includes(dicts.en.aiControl.unknownProvider));
 mode='model';h.click(panel().querySelector('button.btn-primary'));await tick(6);assert(panel().textContent.includes(dicts.en.aiControl.invalidModel));
 mode='ok';h.click(panel().querySelector('button.btn-primary'));await tick(6);assert.deepEqual(bodies.at(-1),{externalEnabled:true,providerId:'acme',model:'m1',fallback:'none'});assert(panel().querySelector('[data-ai-effective=ready]'));assert(panel().textContent.includes(dicts.en.aiControl.saved));
});
test('integrations: AI status with secret-like extra fields is not rendered; malformed status fails closed',async()=>{
 const s=ai();s.providers[1].apiKey='sk-live-SECRET';assert(!JSON.stringify(validateAiStatus(s)).includes('SECRET'));assert.throws(()=>validateAiStatus({owner:{}}));
 await assert.rejects(()=>saveAi({externalEnabled:true,providerId:'a',model:'x'.repeat(101),fallback:'riwi'}),TypeError);
});
const sum={channel:{active_release_id:'r2',previous_release_id:'r1'},release:{manifest:{lexemes:1500,senses:3000,examples:9,search_terms:4},manifest_sha:'abc'},drafts:1,custom:{lexemes:2,senses:3},published_at:'2026-05-01T10:00:00Z',index_state:'validated'};
const draftRow={id:ID(5),changes:{operation:'add_lexeme',lemma:'zebra',partOfSpeech:'noun',lexicalType:'word',definitionEn:'an animal',translationUz:'zebra',definitionUz:'hayvon',examples:[{textEn:'a',textUz:'b'}]}};
function dictRoutes(state={}){const calls=[];globalThis.fetch=async(p,o={})=>{const m=o.method??'GET',path=p.replace('/api/owner/dictionary/','');calls.push({m,path,body:o.body?JSON.parse(o.body):undefined});const j=d=>({status:200,ok:true,headers:{get:()=>'application/json'},json:async()=>d});
 if(m==='GET'&&path==='summary')return j(sum);if(m==='GET'&&path==='drafts')return j({drafts:state.drafts??[draftRow]});if(m==='GET'&&path==='history')return j({history:[{id:'h1',operation:'publish',created_at:'2026-05-01',result_release_id:'r2'}]});if(m==='GET'&&path==='publish')return j({job:state.job??null});
 if(m==='POST'&&path==='publish')return j({job:{id:ID(8),phase:'building',error:null,candidate_release_id:'r3'}});if(m==='POST'&&path.startsWith('publish/'))return j({job:{id:ID(8),phase:state.fail?'failed':(state.polls=(state.polls??0)+1)>=2?'complete':'validating',error:state.fail?'dup':null,candidate_release_id:'r3'}});
 if(path.startsWith('drafts')&&['POST','PATCH','DELETE'].includes(m)){if(state.dupe)return {status:409,ok:false,headers:{get:()=>'application/json'},json:async()=>({error:'duplicate_lexeme'})};return j({ok:true});}if(path==='rollback')return j({ok:true});return {status:404,ok:false,headers:{get:()=>'application/json'},json:async()=>({error:'not_found'})};};return calls;}
test('owner dictionary: overview, drafts, slot-missing marker, add word posts add_lexeme draft; duplicate maps to localized text',async()=>{
 h=setup({role:'owner',path:'/app/owner/dictionary'});const state={};const calls=dictRoutes(state);h.stub({});await h.mount(odict);
 assert(h.ctx.root.textContent.includes('1,500')||h.ctx.root.textContent.includes('1500'));assert(h.q('[data-global-dictionary]'));assert(h.q('[data-draft="'+ID(5)+'"]'));
 h.click(h.q('[data-dictionary-add-word]'));const form=h.q('[data-owner-dict-form]');const tas=form.querySelectorAll('textarea');h.input(form.querySelector('input'),'quokka');h.input(tas[0],'a marsupial');h.input(tas[1],'kvokka');h.input(tas[2],'hayvon');
 state.dupe=true;h.submit(form);await tick(6);assert(h.ctx.root.textContent.includes(dicts.en.globalDictionary.duplicateWord));assert(h.q('[data-owner-dict-form]'),'form kept');
 state.dupe=false;h.submit(h.q('[data-owner-dict-form]'));await tick(8);const post=calls.filter(c=>c.m==='POST'&&c.path==='drafts').at(-1);assert.deepEqual(post.body,{operation:'add_lexeme',lemma:'quokka',partOfSpeech:'noun',lexicalType:'word',definitionEn:'a marsupial',translationUz:'kvokka',definitionUz:'hayvon',examples:[]});assert(!h.q('[data-owner-dict-form]'));
});
test('owner dictionary: publish polls until complete; failure shows unavailable; rollback disabled without previous release; discard calls DELETE',async()=>{
 h=setup({role:'owner',path:'/app/owner/dictionary'});const state={};const calls=dictRoutes(state);h.stub({});await h.mount(odict);
 const pub=[...h.qa('button')].find(b=>b.textContent===dicts.en.globalDictionary.publish);h.click(pub);await tick(12);assert(calls.some(c=>c.path==='publish'&&c.m==='POST'));assert(calls.filter(c=>c.path.startsWith('publish/')).length>=2);
 h.click([...h.qa('button')].find(b=>b.textContent===dicts.en.globalDictionary.discard));await tick(6);assert(calls.some(c=>c.m==='DELETE'&&c.path==='drafts/'+ID(5)));
 h.dispose();h=setup({role:'owner',path:'/app/owner/dictionary'});const st2={fail:true};dictRoutes(st2);h.stub({});await h.mount(odict);h.click([...h.qa('button')].find(b=>b.textContent===dicts.en.globalDictionary.publish));await tick(10);assert(h.q('[role=alert]'));
});
test('owner dictionary: any endpoint failing yields generic unavailable region; non-owner redirected without any request',async()=>{
 h=setup({role:'owner',path:'/app/owner/dictionary'});globalThis.fetch=async()=>({status:503,ok:false,headers:{get:()=>'application/json'},json:async()=>({error:'x'})});h.stub({});await h.mount(odict);assert(h.q('[data-region-failure]'));h.dispose();
 h=setup({role:'admin',path:'/app/owner/dictionary'});let n=0;globalThis.fetch=async()=>{n++;};h.stub({});await h.mount(odict);assert.equal(n,0);assert.equal(h.nav[0].path,'/app');
});
