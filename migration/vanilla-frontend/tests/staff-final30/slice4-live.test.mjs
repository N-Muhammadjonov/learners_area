/** Slice 4: teacher live classes (list + detail). Fixtures only; NOT live. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,envelope,dicts} from './harness.mjs';
import {ApiError} from '../../js/api-client.js';
import * as L from '../../modules/staff-final30/teacher-live.js';
import {createLiveClass,patchLiveClass} from '../../js/adapters/staff-final30/teacher.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;});
const iso='2026-05-01T10:00:00.000Z';
const cls=(n,status='upcoming',extra={})=>({id:ID(n),title:'C'+n,status,scheduledAt:iso,durationMinutes:60,attendees:2,...extra});
const list=cs=>envelope('teacher-live-classes',{classes:cs});
const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
test('list: rows, centre-time, attendee count, per-status controls (upcoming/live/completed/cancelled)',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/live-classes'});h.stub({'/api/frontend/staff/teacher-live-classes':list([cls(1),cls(2,'live'),cls(3,'completed'),cls(4,'cancelled')])});await h.mount({mount:L.listMount});
 const row=n=>h.q(`[data-live-class="${ID(n)}"]`);assert(row(1).textContent.includes('15:00'));assert(row(1).textContent.includes('2 attendees'));
 assert(row(1).textContent.includes(dicts.en.liveClasses.markLive));assert(row(2).textContent.includes(dicts.en.liveClasses.markCompleted));assert(row(3).querySelector('input'));assert.equal(row(4).querySelectorAll('button,input').length,0);assert.equal(h.q('[data-class-roster-link="'+ID(1)+'"]').getAttribute('href'),'/app/teacher/live-classes/'+ID(1));
});
test('status controls: PATCH exact bodies, refresh after; failure shows alert and allows retry; recording requires https URL',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/live-classes'});let status='upcoming',fail=false;h.stub({'/api/frontend/staff/teacher-live-classes':()=>list([cls(1,status)]),'/api/teacher/live-classes/*':(p,o)=>{if(fail)return new ApiError(404,'not_found');status=o.body.status;return {ok:true};}});await h.mount({mount:L.listMount});
 fail=true;h.click([...h.qa('button')].find(b=>b.textContent===dicts.en.liveClasses.markLive));await tick(6);assert(h.q('[role=alert]'));fail=false;
 h.click([...h.qa('button')].find(b=>b.textContent===dicts.en.liveClasses.markLive));await tick(6);assert.deepEqual(h.calls.filter(c=>c.method==='PATCH').at(-1).body,{status:'live'});assert(h.ctx.root.textContent.includes(dicts.en.liveClasses.markCompleted));
 h.click([...h.qa('button')].find(b=>b.textContent===dicts.en.liveClasses.markCompleted));await tick(6);assert.deepEqual(h.calls.filter(c=>c.method==='PATCH').at(-1).body,{status:'completed'});
 const inp=h.q('[data-live-class] input'),add=[...h.qa('button')].find(b=>b.textContent===dicts.en.liveClasses.addRecording);assert(add.disabled);h.input(inp,'https://rec.example.invalid/1');assert(!add.disabled);h.submit(inp.closest('form'));await tick(6);assert.deepEqual(h.calls.filter(c=>c.method==='PATCH').at(-1).body,{recordingUrl:'https://rec.example.invalid/1',status:'recorded'});
});
test('patch adapter: rejects javascript: recording URL, empty body, unknown status, non-uuid',async()=>{
 await assert.rejects(()=>patchLiveClass(ID(1),{recordingUrl:'javascript:alert(1)',status:'recorded'}),TypeError);await assert.rejects(()=>patchLiveClass(ID(1),{}),TypeError);await assert.rejects(()=>patchLiveClass(ID(1),{status:'deleted'}),TypeError);await assert.rejects(()=>patchLiveClass('x',{status:'live'}),TypeError);
});
test('new class form: opens, validates, POSTs UTC ISO + string duration, closes and refreshes; server message shown; double submit once',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/live-classes'});let posts=[],fail=false;
 globalThis.fetch=async(p,o)=>{posts.push(JSON.parse(o.body));await tick(2);return fail?jres(400,{error:'invalid_input'}):jres(200,{ok:true,id:ID(5)});};
 h.stub({'/api/frontend/staff/teacher-live-classes':list([])});await h.mount({mount:L.listMount});h.click(h.q('[data-new-class]'));
 const f=()=>h.q('[data-new-class-form]');h.input(h.q('#title'),'Speaking club');h.input(h.q('#scheduledAt'),'2026-06-01T10:00');h.input(h.q('#durationMinutes'),'90');fail=true;h.submit(f());h.submit(f());await tick(8);assert.equal(posts.length,1);assert(f().textContent.includes(dicts.en.apiErrors.invalid));assert.equal(h.q('#title').value,'Speaking club');
 fail=false;h.submit(f());await tick(8);const b=posts.at(-1);assert.equal(b.title,'Speaking club');assert.equal(b.durationMinutes,'90');assert(/^2026-06-01T\d\d:00:00\.000Z$/.test(b.scheduledAt));assert(!('topic' in b)||b.topic===undefined);assert.equal(f(),null);
});
test('create adapter: invalid date/duration/title/url fail before any request (source would throw RangeError on bad date)',async()=>{
 let n=0;globalThis.fetch=async()=>{n++;return jres(200,{ok:true});};
 for(const bad of [{title:'ab',scheduledAt:'2026-06-01T10:00',durationMinutes:60},{title:'abc',scheduledAt:'not-a-date',durationMinutes:60},{title:'abc',scheduledAt:'2026-06-01T10:00',durationMinutes:14},{title:'abc',scheduledAt:'2026-06-01T10:00',durationMinutes:241},{title:'abc',scheduledAt:'2026-06-01T10:00',durationMinutes:60,meetingUrl:'javascript:x'}])await assert.rejects(()=>createLiveClass(bad),e=>e.status===400);
 assert.equal(n,0);
});
const detail=(o={})=>envelope('teacher-live-class',{liveClass:{id:ID(1),title:'T',topic:'<i>t</i>',status:'live',scheduledAt:iso,durationMinutes:60,hasMeetingUrl:true,hasRecordingUrl:false},joinState:'open',opensAt:'2026-05-01T09:50:00.000Z',roster:[{name:'A',email:'a@example.invalid',joinedAt:iso},{name:'B',email:null,joinedAt:iso}],...o});
test('detail: facts, join window state from server, link flags never expose URLs, roster count and escaped text',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/live-classes/'+ID(1)});h.stub({'/api/frontend/staff/teacher-live-class':detail()});await h.mount({mount:L.detailMount});
 assert.equal(h.q('[data-class-window]').dataset.classWindow,'open');assert.equal(h.q('[data-class-has-link]').dataset.classHasLink,'yes');assert.equal(h.q('[data-class-has-recording]').dataset.classHasRecording,'no');assert.equal(h.q('[data-attendee-count]').dataset.attendeeCount,'2');assert.equal(h.qa('[data-attendee]').length,2);assert.equal(h.qa('i').length,0);assert(!h.ctx.root.innerHTML.includes('http'));
});
test('detail: empty roster message; bad id/404 not found; malformed join state fails closed; student redirected',async()=>{
 h=setup({role:'teacher',path:'/app/teacher/live-classes/'+ID(1)});h.stub({'/api/frontend/staff/teacher-live-class':detail({roster:[]})});await h.mount({mount:L.detailMount});assert(h.q('[data-roster-empty]'));h.dispose();
 h=setup({role:'teacher',path:'/app/teacher/live-classes/nope'});h.stub({});await h.mount({mount:L.detailMount});assert(h.q('[data-staff-not-found]'));assert.equal(h.calls.length,0);h.dispose();
 h=setup({role:'teacher',path:'/app/teacher/live-classes/'+ID(2)});h.stub({'/api/frontend/staff/teacher-live-class':new ApiError(404,'not_found')});await h.mount({mount:L.detailMount});assert(h.q('[data-staff-not-found]'));h.dispose();
 h=setup({role:'teacher',path:'/app/teacher/live-classes/'+ID(1)});h.stub({'/api/frontend/staff/teacher-live-class':detail({joinState:'whenever'})});await h.mount({mount:L.detailMount});assert(h.q('[data-region-failure]'));h.dispose();
 h=setup({role:'student',path:'/app/teacher/live-classes'});h.stub({});await h.mount({mount:L.listMount});assert.equal(h.nav[0].path,'/app');assert.equal(h.calls.length,0);
});
