import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ApiError} from '../js/api-client.js';
import {learnerJourney} from '../modules/shared/learner-journey.js';
import {setup,tick} from './staff-final30/harness.mjs';

const endpoint='/api/academy/journey';
const base={kind:'reading_completed',title:null,status:null,score:12,total:15,occurredAt:'2026-11-15T08:00:00Z'};

test('student journey lazily shows authoritative review link and navigates to the next page',async()=>{
 const h=setup({role:'student'});
 h.stub({[endpoint]:path=>path.endsWith('page=2')?{items:[],goal:null,hasNext:false}:
  {items:[{...base,href:'/app/reading/attempts/test-id'}],goal:{targetBand:7.5},hasNext:true}});
 try{
  const panel=learnerJourney(h.ctx,endpoint);
  h.ctx.root.append(panel);
  assert.equal(h.calls.length,0);
  panel.open=true;await tick();await tick();
  assert.equal(panel.querySelector('a').getAttribute('href'),'/app/reading/attempts/test-id');
  assert.match(panel.textContent,/Target band 7.5/);
  assert.match(panel.textContent,/12\/15/);
  h.click([...panel.querySelectorAll('button')].find(b=>b.textContent==='Next'));await tick();
  assert.match(panel.textContent,/No milestones recorded/);
 }finally{h.dispose();}
});

test('guardian journey retries a temporary error and keeps child milestones read-only',async()=>{
 const h=setup({role:'guardian'});
 const child='/api/guardian/children/fixture/journey';
 let attempts=0;
 h.stub({[child]:()=>++attempts===1?new ApiError(503,'unavailable'):{items:[base],goal:null,hasNext:false}});
 try{
  const panel=learnerJourney(h.ctx,child);
  h.ctx.root.append(panel);panel.open=true;
  await tick();await tick();
  assert(panel.querySelector('[role="alert"]'));
  h.click(panel.querySelector('button'));await tick();
  assert.match(panel.textContent,/Reading completed/);
  assert.equal(panel.querySelectorAll('a').length,0);
 }finally{h.dispose();}
});
