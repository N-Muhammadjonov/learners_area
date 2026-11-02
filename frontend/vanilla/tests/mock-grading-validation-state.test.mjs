import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick} from './staff-final30/harness.mjs';
import {mockGradingMount} from '../modules/staff-final30/mock-grading.js';

test('editing grading JSON invalidates prior validation, including an in-flight dry run',async()=>{
 const h=setup({path:'/app/management/mocks/grading',role:'teacher'});let respond;const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Promise(resolve=>{respond=data=>resolve(new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));});
 try{
  h.stub({'/api/frontend/staff/mock-grading':{data:{summary:{submissions:0,pendingReview:0,readyToPublish:0},items:[],batches:[]}},'/api/staff/mocks/grade-imports/validate':()=>new Promise(resolve=>{respond=resolve;})});
  await mockGradingMount(h.ctx);await tick();
  const input=h.q('[data-import-json-textarea]'),validate=h.q('[data-import-validate-btn]'),commit=h.q('[data-import-commit-btn]');
  h.input(input,JSON.stringify({batch_id:'original'}));h.click(validate);await tick();assert.equal(typeof respond,'function');
  h.input(input,JSON.stringify({batch_id:'edited while validating'}));respond({report:{ok:true,counts:{valid:1},issues:[]}});await tick();assert(commit.disabled);
  h.click(validate);await tick();respond({report:{ok:true,counts:{valid:1},issues:[]}});await tick();assert.equal(commit.disabled,false);
  h.input(input,JSON.stringify({batch_id:'edited after validation'}));assert(commit.disabled);assert.equal(h.q('[data-import-dryrun-report]').textContent,'');
 }finally{globalThis.fetch=originalFetch;h.dispose();}
});
