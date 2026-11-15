import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup,tick,envelope} from './staff-final30/harness.mjs';
import {managementAreas} from '../modules/staff-final30/management-hub.js';
import {reportProblem} from '../modules/shared/report.js';
import * as supportPage from '../modules/support/page.js';

test('all staff roles have one canonical support destination',()=>{
 for(const role of ['teacher','admin','owner']){
  const h=setup({role,locale:'uz'});
  try{
   const areas=managementAreas(h.ctx.dict,role,false);
   assert.equal(areas.filter(x=>x.href==='/app/support').length,1);
   assert.equal(areas.some(x=>x.href==='/app/teacher/support'),false);
  }finally{h.dispose();}
 }
});

test('floating report form toggles open and closed reliably',()=>{
 const h=setup({path:'/app/reading',role:'student',locale:'uz'});
 try{
  const form=reportProblem(h.ctx,{floating:true});
  h.ctx.root.append(form);
  assert.equal(h.q('[data-report-form]'),null);
  h.click(h.q('[data-report-toggle]'));
  assert(h.q('[data-report-form]'));
  assert.equal(h.q('[data-report-toggle]').getAttribute('aria-expanded'),'true');
  h.click(h.q('[data-report-toggle]'));
  assert.equal(h.q('[data-report-form]'),null);
  assert.equal(h.q('[data-report-toggle]').getAttribute('aria-expanded'),'false');
 }finally{h.dispose();}
});

test('suggestion and encouragement use existing persisted report endpoint',async()=>{
 const h=setup({path:'/app/reading',role:'student',locale:'uz'});
 try{
  h.stub({'/api/support/reports':{ok:true}});
  h.ctx.root.append(reportProblem(h.ctx,{floating:true}));
  h.click(h.q('[data-report-toggle]'));
  h.change(h.q('[data-report-kind]'),'encouragement');
  h.input(h.q('[data-report-message]'),'Mashg‘ulotlar juda foydali');
  h.click(h.q('[data-report-send]'));
  await tick(5);
  assert.equal(h.calls.filter(x=>x.path==='/api/support/reports').length,1);
  const report=h.calls.find(x=>x.path==='/api/support/reports');
  assert.equal(report.body.message,'[encouragement] Mashg‘ulotlar juda foydali');
  assert.equal(report.body.route,'/app/reading');
  assert(h.q('[data-report-sent]'));
 }finally{h.dispose();}
});

test('unified support page keeps the staff inbox and original reports',async()=>{
 const h=setup({path:'/app/support',role:'admin',locale:'en'});
 try{
  h.stub({'/api/frontend/staff/support-inbox':envelope('support-inbox',{reports:[]})});
  await h.mount(supportPage);
  assert(h.q('[data-support-page]'));
  assert(h.q('[data-unified-support-inbox]'));
  assert(h.q('[data-management-support]')||h.q('[data-staff-view="management-support"]'));
  assert.equal(h.qa('[data-support-inbox]').length,0);
 }finally{h.dispose();}
});

test('statistics contrast is resolved through day/night workspace color tokens',()=>{
 const css=readFileSync(new URL('../modules/shared/design-system.css',import.meta.url),'utf8');
 assert.match(css,/\[data-management-statistics\] \[data-result-module\]/);
 assert.match(css,/color:rgb\(var\(--workspace-ink\)\)/);
 assert.match(css,/background-color:rgb\(var\(--workspace-raised\)\)/);
});
