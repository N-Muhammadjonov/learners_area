/** Slice 1: admissions, people, student results, roster. Fixtures only; NOT live integration. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,envelope,api,dicts} from './harness.mjs';
import {ApiError} from '../../js/api-client.js';
import * as admissions from '../../modules/staff-final30/admissions.js';
import * as people from '../../modules/staff-final30/people.js';
import * as detail from '../../modules/staff-final30/people-detail.js';
import * as rosterMod from '../../modules/staff-final30/roster.js';
import {summarize} from '../../modules/staff-final30/people-detail.js';
let h;afterEach(()=>h?.dispose());
const iso='2026-05-01T10:00:00.000Z';
const adm=(extra={})=>envelope('admissions',{pending:[{id:ID(11),applicantName:'Aziza <b>X</b>',applicantEmail:'a@example.invalid',message:'IELTS 7',createdAt:iso},{id:ID(12),applicantName:'Bek',applicantEmail:null,message:null,createdAt:iso}],recent:[{id:ID(13),applicantName:'Done',decidedAt:iso},{id:ID(14),applicantName:'NoDate',decidedAt:null}],...extra});
const person=(n,o={})=>({id:ID(n),name:'P'+n,email:`p${n}@example.invalid`,role:'student',accountStatus:'active',statusReason:null,createdAt:iso,telegramLinked:false,...o});
const dir=(over={})=>envelope('people',{people:[person(2),person(3,{role:'teacher'}),person(4,{role:'owner'}),person(1,{role:'admin'}),person(5,{accountStatus:'suspended',statusReason:'spam'})],filters:{q:'',role:null,status:null},page:1,pageSize:25,total:5,totalPages:1,actorId:ID(1),actorRole:'admin',grantableRoles:['student','teacher'],...over});

test('admissions: renders queue, escapes applicant text, shows recent with em dash for missing date',async()=>{
 h=setup({path:'/app/admin/admissions'});h.stub({'/api/frontend/staff/admissions':adm()});await h.mount(admissions);
 assert.equal(h.qa('[data-access-request]').length,2);assert.equal(h.q('[data-pending-count]').textContent,'2');
 assert.equal(h.q('[data-access-request] p').textContent,'Aziza <b>X</b>');assert.equal(h.qa('b').length,0);
 assert.equal(h.q('[data-access-request="'+ID(12)+'"]').dataset.applicant,'Bek');
 assert(h.ctx.root.textContent.includes('—'));
});
test('admissions: approve needs confirmation, trims note, posts exact body then refetches quietly',async()=>{
 h=setup({path:'/app/admin/admissions'});let pending=adm();h.stub({'/api/frontend/staff/admissions':()=>pending,'/api/admin/admission/*':()=>{pending=adm({pending:[]});return {ok:true,status:'active',userId:ID(99)};}});await h.mount(admissions);
 const card=h.q('[data-access-request="'+ID(11)+'"]');h.input(card.querySelector('input'),'  welcome  ');
 const trigger=[...card.querySelectorAll('button')].find(b=>b.textContent===dicts.en.admission.approve);h.click(trigger);
 assert(h.calls.every(c=>c.method==='GET'),'no mutation before confirmation');
 h.click(card.querySelector('[data-confirm-action]'));await tick(6);
 const post=h.calls.find(c=>c.method==='POST');assert.equal(post.path,`/api/admin/admission/${ID(11)}/decide`);assert.deepEqual(post.body,{decision:'approve',note:'welcome'});
 assert.equal(h.qa('[data-access-request]').length,0);assert(h.ctx.root.textContent.includes(dicts.en.admission.reviewEmpty));
});
test('admissions: rejection with empty note sends null; server 409 shows localized conflict and keeps card',async()=>{
 h=setup({path:'/app/admin/admissions'});h.stub({'/api/frontend/staff/admissions':adm(),'/api/admin/admission/*':new ApiError(409,'already_decided')});await h.mount(admissions);
 const card=h.q('[data-access-request="'+ID(12)+'"]');const rej=[...card.querySelectorAll('button')].find(b=>b.textContent===dicts.en.admission.reject);h.click(rej);h.click(rej.parentNode.querySelector('[data-confirm-action]'));await tick(6);
 assert.deepEqual(h.calls.find(c=>c.method==='POST').body,{decision:'reject',note:null});
 assert(h.ctx.root.textContent.includes(dicts.en.apiErrors.conflict));assert(h.q('[data-access-request="'+ID(12)+'"]'));
 assert(!h.ctx.root.textContent.includes('already_decided'),'raw code never shown');
});
test('admissions: students/teachers are redirected to /app; 401 goes to /login; 403 goes to /app; malformed DTO fails closed with retry',async()=>{
 for(const role of ['student','teacher']){h=setup({role,path:'/app/admin/admissions'});h.stub({});await h.mount(admissions);assert.deepEqual(h.nav[0],{path:'/app',replace:true});assert.equal(h.calls.length,0);h.dispose();}
 h=setup({path:'/app/admin/admissions'});h.stub({'/api/frontend/staff/admissions':new ApiError(401,'unauthenticated')});await h.mount(admissions);assert.equal(h.nav[0].path,'/login');h.dispose();
 h=setup({path:'/app/admin/admissions'});h.stub({'/api/frontend/staff/admissions':new ApiError(403,'forbidden')});await h.mount(admissions);assert.equal(h.nav[0].path,'/app');h.dispose();
 h=setup({path:'/app/admin/admissions'});h.stub({'/api/frontend/staff/admissions':envelope('admissions',{pending:[{id:'not-a-uuid'}],recent:[]})});await h.mount(admissions);
 assert(h.q('[data-region-failure]'),'failure notice with retry');assert(!h.q('[data-access-request]'));
});
test('admissions: disconnected backend (503) never fabricates a queue',async()=>{h=setup({path:'/app/admin/admissions'});h.stub({});await h.mount(admissions);assert(h.q('[data-region-failure]'));assert.equal(h.qa('[data-access-request]').length,0);});
test('people: sanitizes URL filters, locks self/owner rows, Admin does not open academic results',async()=>{
 h=setup({path:'/app/admin/people?q=%20ann%20&role=superuser&status=suspended&page=-3'});h.stub({'/api/frontend/staff/people':dir()});await h.mount(people);
 const url=h.calls[0].path;assert(url.includes('q=ann')&&url.includes('status=suspended')&&!url.includes('role=')&&url.includes('page=1'),url);
 const row=id=>h.q(`tr[data-person-id="${id}"]`);
 assert.equal(row(ID(1)).querySelector('select'),null,'own role locked');assert(row(ID(1)).textContent.includes(dicts.en.people.you));assert(row(ID(1)).textContent.includes(dicts.en.people.cannotChangeSelf));
 assert.equal(row(ID(4)).querySelector('select'),null,'owner locked');
 assert.deepEqual([...row(ID(2)).querySelectorAll('option')].map(o=>o.value),['student','teacher']);
 assert.equal(row(ID(2)).querySelector('a[href="/app/admin/people/'+ID(2)+'"]'),null,'Admin cannot open student results');
 assert.equal(row(ID(3)).querySelector('a[href="/app/admin/people/'+ID(3)+'"]'),null,'Admin cannot open staff academic records');
 assert(row(ID(5)).textContent.includes('spam'));assert.equal(h.qa('[data-person-id]').length,10,'table + mobile cards');
});
test('people: owner may grant admin and owner options; select reverts until server acceptance',async()=>{
 h=setup({role:'owner',path:'/app/admin/people'});let role='student';h.stub({'/api/frontend/staff/people':()=>dir({actorRole:'owner',grantableRoles:['student','teacher','admin','owner'],people:[person(2,{role}),person(1,{role:'owner'})]}),'/api/admin/users/*':()=>{role='teacher';return {ok:true};}});await h.mount(people);
 const sel=h.q(`tr[data-person-id="${ID(2)}"] select`);assert.equal(sel.options.length,4);
 h.change(sel,'teacher');assert.equal(sel.value,'student','visual value unchanged before confirmation');assert(sel.parentNode.querySelector('dialog').hasAttribute('open'));
 h.click(sel.parentNode.querySelector('[data-confirm-action]'));await tick(6);
 const patch=h.calls.find(c=>c.method==='PATCH');assert.equal(patch.path,`/api/admin/users/${ID(2)}/role`);assert.deepEqual(patch.body,{role:'teacher'});
 assert.equal(h.q(`tr[data-person-id="${ID(2)}"]`).dataset.personRole,'teacher');
});
test('people: cancelled role change sends nothing; outranked 403 keeps old role and explains',async()=>{
 h=setup({path:'/app/admin/people'});h.stub({'/api/frontend/staff/people':dir(),'/api/admin/users/*':new ApiError(403,'outranked')});await h.mount(people);
 const sel=h.q(`tr[data-person-id="${ID(2)}"] select`),dlg=sel.parentNode.querySelector('dialog');
 h.change(sel,'teacher');h.click(dlg.querySelector('button:not([data-confirm-action])'));assert(!h.calls.some(c=>c.method==='PATCH'));assert.equal(sel.value,'student');
 h.change(sel,'teacher');h.click(dlg.querySelector('[data-confirm-action]'));await tick(6);assert.equal(h.calls.filter(c=>c.method==='PATCH').length,1);
 assert.equal(sel.value,'student');assert(h.ctx.root.textContent.includes(dicts.en.people.failed));
});
test('people: suspend asks for optional reason, posts trimmed reason, reactivate requires confirmation',async()=>{
 h=setup({path:'/app/admin/people'});let status='active';h.stub({'/api/frontend/staff/people':()=>dir({people:[person(2,{accountStatus:status}),person(1,{role:'admin'})]}),'/api/admin/users/*':(p,o)=>{status=o.body.status;return {ok:true};}});await h.mount(people);
 const row=()=>h.q(`tr[data-person-id="${ID(2)}"]`);
 h.click([...row().querySelectorAll('button')].find(b=>b.textContent===dicts.en.people.suspend));
 const reason=h.q('[data-focus-key="reason-'+ID(2)+'"]');assert(reason);h.input(reason,'  abuse  ');
 h.click([...row().querySelectorAll('button')].find(b=>b.textContent===dicts.en.people.suspend));await tick(6);
 const post=h.calls.find(c=>c.method==='POST');assert.equal(post.path,`/api/admin/users/${ID(2)}/status`);assert.deepEqual(post.body,{status:'suspended',reason:'abuse'});
 assert.equal(row().dataset.personStatus,'suspended');
 const react=[...row().querySelectorAll('button')].find(b=>b.textContent===dicts.en.people.reactivate);h.click(react);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
 h.click(react.parentNode.querySelector('[data-confirm-action]'));await tick(6);assert.equal(h.calls.filter(c=>c.method==='POST').at(-1).body.status,'active');
});
test('people: search submits URL state, clear link, empty state, pagination hrefs keep filters; locale UZ labels',async()=>{
 h=setup({path:'/app/admin/people?q=x&page=2',locale:'uz'});h.stub({'/api/frontend/staff/people':dir({people:[],total:60,totalPages:3,page:2,filters:{q:'x',role:'teacher',status:null}})});await h.mount(people);
 assert(h.q('[data-people-empty]'));const nav=h.q('[data-people-pagination]');assert.equal(nav.querySelectorAll('a')[0].getAttribute('href'),'/app/admin/people?q=x&role=teacher');assert.equal(nav.querySelectorAll('a')[1].getAttribute('href'),'/app/admin/people?q=x&role=teacher&page=3');
 assert(h.q('#people-role').textContent.includes("O'qituvchi"));
 h.input(h.q('#people-search'),'  zed ');h.submit(h.q('[data-people-search-form]'));assert.equal(h.nav.at(-1).path,'/app/admin/people?q=zed&role=teacher');
});
test('people: names containing markup render as text; 100-char search cap enforced client-side',async()=>{
 h=setup({path:'/app/admin/people'});h.stub({'/api/frontend/staff/people':dir({people:[person(2,{name:'<img src=x onerror=alert(1)>'})]})});await h.mount(people);
 assert.equal(h.qa('img').length,0);assert.equal(h.q('#people-search').getAttribute('maxlength'),'100');
});
test('student results: summary math matches source, unavailable state, not found, role gate',()=>{
 const d=(n)=>new Date(Date.UTC(2026,0,n));
 const a=[{id:'1',mockTestId:'skill1',title:'A',skill:'reading',finishedAt:d(1),estimatedBand:9,rawScore:null},{id:'2',mockTestId:'t1',title:'B',skill:'full',finishedAt:d(5),estimatedBand:6,rawScore:null},{id:'3',mockTestId:'t2',title:'C',skill:'full',finishedAt:d(6),estimatedBand:7,rawScore:null},{id:'4',mockTestId:null,title:'Deleted full mock',skill:'full',finishedAt:d(7),estimatedBand:null,rawScore:null}];
 const s=summarize(a,['t1','t2','t3']);assert.equal(s.finished.length,3);assert.equal(s.latest,7);assert.equal(s.best,7);assert.equal(s.average,6.5);assert.equal(s.improvement,1);assert.equal(s.total,3);assert.equal(s.complete,2);assert.equal(s.skillFinished.length,1);
});
const results=(over={})=>envelope('student-results',{student:{id:ID(2),name:'Stu',email:null},unavailable:false,testIds:['t1'],attempts:[{id:'0',mockTestId:'t1',title:'Full mock',skill:'full',finishedAt:iso,estimatedBand:6.5,rawScore:null},{id:'1',mockTestId:'t1',title:'Mock',skill:'reading',finishedAt:iso,estimatedBand:6.5,rawScore:null},{id:'2',mockTestId:'t1',title:'Raw',skill:'writing',finishedAt:iso,estimatedBand:null,rawScore:12}],practice:{reading:4,listening:null,speaking:0,writing:2},...over});
test('student results: renders cards, svg trend, Telegram fallback, raw score fallback, practice counts',async()=>{
 h=setup({role:'owner',path:'/app/admin/people/'+ID(2)});h.stub({'/api/frontend/staff/student-results':results()});await h.mount(detail);
 assert(h.q('h1').textContent==='Stu');assert(h.ctx.root.textContent.includes('Telegram'));assert(h.q('svg[role=img]'));assert.equal(h.q('[data-skill=writing]').textContent.includes('12'),true);
 assert(h.q('[data-skill=listening]').textContent.includes('—'));assert(h.q('[data-skill=reading] li').textContent.includes('6.5'));
});
test('student results: unavailable flag shows alert only; non-UUID id is not-found and issues no request; 404 shows not found',async()=>{
 h=setup({role:'owner',path:'/app/admin/people/'+ID(2)});h.stub({'/api/frontend/staff/student-results':results({unavailable:true})});await h.mount(detail);assert(h.q('[role=alert]'));assert(!h.q('dl'));h.dispose();
 h=setup({role:'owner',path:'/app/admin/people/not-a-uuid'});h.stub({});await h.mount(detail);assert(h.q('[data-staff-not-found]'));assert.equal(h.calls.length,0);h.dispose();
 h=setup({role:'owner',path:'/app/admin/people/'+ID(9)});h.stub({'/api/frontend/staff/student-results':new ApiError(404,'not_found')});await h.mount(detail);assert(h.q('[data-staff-not-found]'));
});
test('private student results view redirects Admin before requesting academic data',async()=>{h=setup({role:'admin',path:'/app/admin/people/'+ID(2)});h.stub({});await h.mount(detail);assert.equal(h.nav[0].path,'/app');assert.equal(h.calls.length,0);});
test('student results: out-of-range band rejected by adapter (no silent re-grading)',async()=>{
 h=setup({role:'owner',path:'/app/admin/people/'+ID(2)});h.stub({'/api/frontend/staff/student-results':results({attempts:[{id:'1',mockTestId:'t1',title:null,skill:'reading',finishedAt:iso,estimatedBand:11,rawScore:null}]})});await h.mount(detail);assert(h.q('[data-region-failure]'));
});
const roster=(over={})=>envelope('roster',{teachers:[{id:ID(7),name:'Teach'}],selected:{id:ID(7),name:'Teach'},roster:[{id:ID(21),name:'In'}],candidates:[{id:ID(22),name:'Cand'}],listCap:1000,rosterCap:500,query:'',...over});
test('roster: keeps native source form posts (hidden fields), status banner, chooser navigation',async()=>{
 h=setup({path:'/app/admin/roster?teacher='+ID(7)+'&status=saved'});h.stub({'/api/frontend/staff/roster':roster()});await h.mount(rosterMod);
 assert.equal(h.q('[data-roster-status]').textContent,dicts.en.reporter.roster.saved);
 const un=h.q('[data-roster-list] form');assert.equal(un.method,'post');assert.equal(un.getAttribute('action'),'/api/admin/roster');assert.equal(un.hasAttribute('data-native'),true);
 assert.deepEqual([...un.querySelectorAll('input')].map(i=>[i.name,i.value]),[['teacherId',ID(7)],['studentId',ID(21)],['action','unassign']]);
 const assign=[...h.qa('form[action="/api/admin/roster"]')].at(-1);assert.equal(assign.querySelector('input[name=action]').value,'assign');assert(assign.querySelector('select[name=studentId]').required);
 h.change(h.q('[data-roster-chooser] select'),ID(7));h.submit(h.q('[data-roster-chooser]'));assert.equal(h.nav.at(-1).path,'/app/admin/roster?teacher='+ID(7));
});
test('roster: no teachers, capped candidates notice, full roster hides assign form, ignores forged status words',async()=>{
 h=setup({path:'/app/admin/roster?status=<script>'});h.stub({'/api/frontend/staff/roster':roster({teachers:[],selected:null,roster:[],candidates:[]})});await h.mount(rosterMod);assert(h.ctx.root.textContent.includes(dicts.en.reporter.roster.noTeachers));assert(!h.q('[data-roster-status]'));h.dispose();
 h=setup({path:'/app/admin/roster?teacher='+ID(7)});h.stub({'/api/frontend/staff/roster':roster({listCap:1,rosterCap:1})});await h.mount(rosterMod);
 assert(h.ctx.root.textContent.includes('Showing the first 1 students'));assert.equal(h.qa('form[action="/api/admin/roster"]').filter(f=>f.querySelector('[name=action][value=assign]')).length,0);
});
test('roster: teacher role cannot open the admin roster screen',async()=>{h=setup({role:'teacher',path:'/app/admin/roster'});h.stub({});await h.mount(rosterMod);assert.equal(h.nav[0].path,'/app');assert.equal(h.calls.length,0);});

test('people: only owner can permanently delete suspended students after confirmation',async()=>{
 h=setup({role:'owner',path:'/app/admin/people?status=suspended'});
 let entries=[person(2,{accountStatus:'suspended'}),person(3,{accountStatus:'rejected'}),person(4)];
 h.stub({'/api/frontend/staff/people':()=>dir({actorRole:'owner',actorId:ID(1),people:entries,total:entries.length,grantableRoles:['student','teacher','admin','owner']}),
  '/api/admin/users/*':(_path,options)=>{
   if(options.method==='DELETE'){entries=entries.filter(item=>item.id!==ID(2));return {ok:true,deleted:true};}
   return {ok:true};
  }});
 await h.mount(people);
 const row=id=>h.q(`tr[data-person-id="${id}"]`);
 const remove=[...row(ID(2)).querySelectorAll('button')].find(button=>button.textContent==='Delete permanently');
 assert(remove,'owner can erase a suspended learner');
 assert(!row(ID(3)).textContent.includes('Delete permanently'),'rejected learners expire via retention');
 assert(!row(ID(4)).textContent.includes('Delete permanently'),'active learners are protected');
 h.click(remove);assert.equal(h.calls.filter(c=>c.method==='DELETE').length,0,'confirmation is required');
 h.click(remove.parentNode.querySelector('[data-confirm-action]'));await tick(6);
 const call=h.calls.find(c=>c.method==='DELETE');
 assert.equal(call.path,`/api/admin/users/${ID(2)}`);
 assert.equal(row(ID(2)),null,'deleted learner vanishes from the directory');
});
