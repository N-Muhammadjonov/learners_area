/** Explicit source DTO/streaming checks; no API/server implementation. */
import {test,afterEach} from 'node:test';
import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {dashboardDTO,openLessonsDTO,mockDTO} from '../js/adapters/dashboard.js';import {mount} from '../modules/dashboard.js';import {api} from '../js/api-client.js';import {viewFixture,fixtureSession} from './fixtures.mjs';import dict from '../js/i18n/en.js';import {render} from '../js/generated/dashboard.js';
const request=api.request;let dom,controller;afterEach(()=>{controller?.abort();api.request=request;dom?.window.close();});const tick=()=>new Promise(r=>setTimeout(r,0));
function setup(){dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/app',pretendToBeVisual:true});for(const k of ['window','document','Node'])globalThis[k]=dom.window[k];controller=new dom.window.AbortController();return {root:document.querySelector('#root'),dict,locale:'en',url:new URL(window.location.href),signal:controller.signal,session:fixtureSession().session,refresh:()=>{}};}
const valid=()=>structuredClone(viewFixture('/app'));
test('dashboard valid empty/unavailable distinctions are retained, not invented zeroes',()=>{const d=valid().dashboard;d.writingAttempts=null;d.skillCounts.listening=null;d.unavailable.writingAttempts=true;assert.equal(dashboardDTO(d),d);assert.equal(d.writingAttempts,null);});
test('nullable source target/feedback estimates remain valid and display dash, not a fake score',()=>{setup();const d=valid().dashboard;d.profile={targetBand:null};d.latestEvaluation={overallEstimate:null,weaknesses:[],checkedByName:'Public fixture'};dashboardDTO(d);const n=render({dict,locale:'en',user:fixtureSession().session.user,context:{refresh(){}},dashboard:d,openLessonsResult:{ok:true,lessons:[]},mock:{...valid().mock,finishedCount:0}});assert(n.textContent.includes('—'));assert(!n.textContent.includes('undefined'));});
for(const mutation of [d=>d.skillCounts.reading=undefined,d=>d.skillCounts.reading=-1,d=>d.streak=Infinity,d=>d.openAssignments={},d=>d.lastActivity={module:'reading',href:'//evil.invalid',at:'2026-10-18T00:00:00Z'},d=>d.nextLiveClass={id:'x',title:'x',scheduledAt:'invalid'},d=>d.latestEvaluation={overallEstimate:10,weaknesses:[],checkedByName:'Fixture'}])test(`malformed dashboard consumer field rejected: ${mutation}`,()=>{const d=valid().dashboard;mutation(d);assert.throws(()=>dashboardDTO(d),e=>e.code==='invalid_dashboard_adapter');});
test('assigned source lessons are accepted; unavailable != empty, locked/scheduled are not fabricated as open',()=>{const row={id:'synthetic',title:'Synthetic',moduleTitle:'Synthetic',unitTitle:'Synthetic',state:'assigned'};assert.equal(openLessonsDTO({ok:true,lessons:[row]}).lessons.length,1);assert.deepEqual(openLessonsDTO({ok:false}),{ok:false});for(const state of ['locked','scheduled','wrong'])assert.throws(()=>openLessonsDTO({ok:true,lessons:[{...row,state}]}));assert.throws(()=>openLessonsDTO({ok:true,lessons:'no'}));});
test('mock dates hydrate on a copy and original owned outcomes are never recomputed',()=>{const raw={...valid().mock,finishedCount:1,attempts:[{id:'isolated',mockTestId:null,title:null,skill:'full',startedAt:'2026-10-17T12:00:00Z',finishedAt:'2026-10-18T00:00:00Z',estimatedBand:7,rawScore:30}]};const clean=mockDTO(raw);assert(clean.attempts[0].finishedAt instanceof Date);assert.equal(typeof raw.attempts[0].finishedAt,'string');assert.equal(clean.attempts[0].estimatedBand,7);assert.equal(clean.attempts[0].mockTestId,null);});
test('mock unknown/malformed fields do not become empty/successful attempts',()=>{assert.throws(()=>mockDTO({tests:[],attempts:[]}));assert.throws(()=>mockDTO({...valid().mock,finishedCount:0,attempts:[{id:'bad',finishedAt:'bad'}]}));});
test('all source dashboard slots initially load independently without reading absent DTOs',()=>{setup();const slots={},renderers={},n=render({slots,renderers,dict,locale:'en',user:fixtureSession().session.user,context:{}});assert.equal(n.querySelectorAll('[data-dashboard-region-slot]').length,2);assert.deepEqual(Object.keys(renderers).sort(),['dashboard','mock','openLessons']);assert(!n.querySelector('[data-dashboard-content]'));});
test('dashboard streams three regions plus separate thirty-day plan and aborts stale responses',async()=>{const ctx=setup(),resolvers=[],paths=[];api.request=(path)=>{paths.push(path);return new Promise(r=>resolvers.push(r));};await mount(ctx);assert.equal(paths.length,4);assert.equal(ctx.root.querySelector('[data-dashboard-plan-open]'),null);assert.equal(ctx.root.querySelector('[data-dashboard-companion-link]').getAttribute('href'),'/app/speaking/speak-or-die');assert(ctx.root.querySelector('[data-dashboard-companion-link] svg'),'existing Speak or Die companion is reused');assert(ctx.root.querySelector('.la-dashboard-top-grid > [data-dashboard-30-plan]'),'plan has its own rectangle next to the hero');
assert.equal(ctx.root.querySelector('.la-dashboard-top-grid').children.length,2);
assert(ctx.root.querySelector('.la-dashboard-hero h1').nextElementSibling?.matches('[data-dashboard-companion-link]'),'companion sits beneath the greeting');assert.equal(ctx.root.querySelector('[data-dashboard-study-plan]'),null,'old weekly plan no longer duplicates dashboard card');assert(paths.includes('/api/study-plan/monthly/sequence'));assert(paths.some(p=>p.endsWith('&region=openLessons')));assert(paths.some(p=>p.endsWith('&region=dashboard')));assert(paths.some(p=>p.endsWith('&region=mock')));controller.abort();ctx.root.textContent='newer route';for(const resolve of resolvers)resolve({version:1,route:'/app',data:valid()});await tick();assert.equal(ctx.root.textContent,'newer route');});

test('owner dashboard mounts plan and Speak or Die companion in the greeting',async()=>{
  const ctx=setup(),paths=[];
  ctx.session=fixtureSession('owner').session;
  api.request=path=>{paths.push(path);return new Promise(()=>{});};
  await mount(ctx);
  assert(ctx.root.querySelector('.la-dashboard-top-grid > [data-dashboard-30-plan]'));
  assert(ctx.root.querySelector('.la-dashboard-hero [data-dashboard-companion-link] svg'));
  assert.equal(ctx.root.querySelector('.la-dashboard-hero h1')?.nextElementSibling?.getAttribute('data-dashboard-companion-link'),'',
    'companion belongs immediately below the greeting and learner name');
  assert.equal(ctx.root.querySelector('[data-dashboard-companion-link]').getAttribute('href'),
    '/app/speaking/speak-or-die');
  assert(paths.includes('/api/study-plan/monthly/sequence'));
});

test('dashboard no longer renders redundant assignments card',()=>{
 const source=readFileSync(new URL('../js/generated/dashboard.js',import.meta.url),'utf8');
 assert(!source.includes("data-my-tasks"));
 assert(source.includes("data-dashboard-skills"));
});
