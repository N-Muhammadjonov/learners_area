import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID,envelope} from './staff-final30/harness.mjs';
import {studentLearningPanel} from '../modules/staff-final30/learning-results.js';
import {mount as statistics} from '../modules/staff-final30/statistics.js';
import {RESULT_MODULES} from '../js/adapters/staff-final30/statistics.js';
import {createRouter,compilePattern} from '../js/router.js';
const summary=()=>RESULT_MODULES.map(module=>({module,started:0,completed:0,learners:0,accuracy:null,band:null,latest:null}));
const history={module:'reading',total:1,pages:1,page:1,rows:[{id:ID(2),module:'reading',activity:'attempt',at:'2026-11-17T09:00:00Z',completed:true,score:3,maximum:4,unit:'questions',title:'QA reading',studentId:ID(3),studentName:'QA Learner'}]};

test('student results load while their page is staged off-screen',async()=>{
 const h=setup({role:'owner',path:'/app/admin/people/'+ID(3)+'?module=reading'});
 try{
  h.stub({'/api/frontend/staff/student-learning':envelope('student-learning',{summary:summary(),history})});
  const staging=document.createElement('div');
  staging.append(studentLearningPanel(h.ctx,ID(3),'/app/admin/people/'+ID(3)));
  await tick();assert.equal(h.calls.length,1);
  assert(staging.querySelector('[data-result-history]'));assert.match(staging.textContent,/QA reading/);
  h.ctx.root.append(staging);assert.equal(h.q('[data-student-learning-unavailable]'),null);
 }finally{h.dispose();}
});
test('each statistics module opens a filtered result history and the named learner',async()=>{
 const h=setup({role:'owner',path:'/app/admin/statistics?module=reading#result-history'});
 try{
  h.stub({'/api/frontend/staff/centre-statistics':envelope('centre-statistics',{selected:'reading',summary:summary(),daily:[],students:[],levels:[],history})});
  await statistics(h.ctx);
  assert(h.q('#result-history'));assert.equal(h.qa('[data-result-module]').length,10);
  for(const card of h.qa('[data-result-module]'))assert.equal(new URL(card.href).hash,'#result-history');
  assert.match(h.q('#result-history').textContent,/QA reading/);
  assert.match(h.q('#result-history').textContent,/75.0%/);
  assert(h.q('#result-history a[href="/app/admin/people/'+ID(3)+'?module=reading#result-history"]'));
 }finally{h.dispose();}
});
test('router reveals a history anchor that arrives after the route commits',async()=>{
 const h=setup({role:'owner',path:'/app/admin/statistics#result-history'});let scrolls=0,router;
 try{
  router=createRouter({root:h.ctx.root,window,routes:[{pattern:'/app/admin/statistics',match:compilePattern('/app/admin/statistics'),load:async()=>({mount:({root})=>root.append(document.createElement('h1'))})}],onError:e=>{throw e;}});
  await router.start();const section=document.createElement('section');section.id='result-history';section.scrollIntoView=()=>scrolls++;
  h.ctx.root.append(section);await tick();assert.equal(scrolls,1);assert.equal(document.activeElement,section);
 }finally{router?.destroy();h.dispose();}
});
test('profile waits for an in-flight landing import before reading the saved level',async()=>{
 const h=setup({role:'owner',path:'/app/profile'});
 const {consumePublicLevelHint}=await import('../js/public-level-hint.js');
 const {profileLevel}=await import('../modules/profile/level-select.js');
 let finish;
 try{
  const raw=JSON.stringify({version:1,source:'public-level-check',created_at:new Date().toISOString(),raw_answers:Array.from({length:17},()=>({id:'fixture',answer:0}))});
  const storage={getItem:()=>raw,removeItem(){}};
  const importing=consumePublicLevelHint({request:()=>new Promise(resolve=>finish=resolve)},storage);
  h.stub({'/api/study-plan/monthly/sequence/level':{state:'select',currentLevel:'B2'}});
  h.ctx.root.append(profileLevel(h.ctx));await tick();assert.equal(h.calls.length,0);
  finish({state:'saved'});await importing;await tick();
  assert.equal(h.q('[data-profile-level-select]').value,'B2');assert.equal(h.calls.length,1);
 }finally{finish?.({state:'saved'});h.dispose();}
});
