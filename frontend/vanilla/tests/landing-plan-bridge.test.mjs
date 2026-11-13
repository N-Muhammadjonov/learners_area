import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LANDING_HTML} from '../modules/landing-inline.js';
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

test('current public landing no longer depends on the deleted premium entry',()=>{
  const source=readFileSync(new URL('../modules/landing-inline.js',import.meta.url),'utf8');
  const publicAuth=readFileSync(new URL('../modules/auth/public.js',import.meta.url),'utf8');
  assert(source.includes('LANDING_HTML'));
  assert(publicAuth.includes("import {LANDING_HTML} from '../landing-inline.js'"));
  assert(LANDING_HTML.includes('href="/register"'));
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
