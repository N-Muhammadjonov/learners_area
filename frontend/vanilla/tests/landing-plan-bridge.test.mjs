import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {markLandingPlanIntent,consumeLandingPlanIntent,clearLandingPlanIntent,
  LANDING_PLAN_DESTINATION} from '../js/plan-entry-intent.js';

let storage;
beforeEach(()=>{
  const values=new Map();
  storage={
    setItem:(k,v)=>values.set(k,String(v)),
    getItem:k=>values.has(k)?values.get(k):null,
    removeItem:k=>values.delete(k),
  };
  globalThis.sessionStorage=storage;
});
afterEach(()=>{delete globalThis.sessionStorage;});

test('public landing quiz continues into authenticated 7/30-day plan setup',()=>{
  const source=readFileSync(new URL('../modules/premium-landing.js',import.meta.url),'utf8');
  assert(source.includes('data-v5-plan-entry'));
  assert(source.includes('7 yoki 30 kunlik reja tuzish'));
  assert(source.includes('/login?next=%2Fapp%2Fassignments%23study-plan-30'));
  assert(source.includes('markLandingPlanIntent()'));
  assert(source.includes('server tasdiqlagan daraja'));
  assert.equal(LANDING_PLAN_DESTINATION,'/app/assignments#study-plan-30');
});

test('landing plan continuation is one-use, time bounded, and never a credential',()=>{
  markLandingPlanIntent(1000);
  assert.equal(consumeLandingPlanIntent(2000),LANDING_PLAN_DESTINATION);
  assert.equal(consumeLandingPlanIntent(3000),null);
  markLandingPlanIntent(1000);
  assert.equal(consumeLandingPlanIntent(3701001),null);
  markLandingPlanIntent(1000);
  clearLandingPlanIntent();
  assert.equal(consumeLandingPlanIntent(1500),null);
});

test('invalid public plan intent cannot affect next login',()=>{
  storage.setItem('la:public-plan-intent:v1','malicious');
  assert.equal(consumeLandingPlanIntent(100000),null);
  storage.setItem('la:public-plan-intent:v1','-1');
  assert.equal(consumeLandingPlanIntent(100000),null);
});
