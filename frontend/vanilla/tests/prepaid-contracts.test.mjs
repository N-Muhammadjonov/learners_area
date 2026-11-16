import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepaidContracts} from '../modules/staff-final30/prepaid-contracts.js';
import {setup,tick,ID} from './staff-final30/harness.mjs';

test('staff chooses arbitrary tariff amount and units without an example default',async()=>{
 const h=setup({path:'/app/management/finance',role:'admin'}),student=ID(10),course=ID(11);
 const url=`/api/staff/finance/students/${student}/service-policies`;
 h.stub({[url]:{policies:[],pauses:[],purchasesEnabled:true},
  '/api/staff/academy/lookups/courses':{options:[{id:course,label:'IELTS'}]},
  '/api/staff/finance/service-policies':{id:ID(12)}});
 try{
  h.ctx.root.append(prepaidContracts(h.ctx,student,'2026-11-16',async()=>{}));await tick();
  const form=h.q('[data-service-policy-form]');assert(form);
  assert.equal(form.querySelector('[name=priceAmountMinor]').value,'');assert.equal(form.querySelector('[name=priceUnits]').value,'');
  h.input(form.querySelector('input[maxlength="120"]'),'Chosen terms');
  const courseField=form.querySelector('fieldset');h.click([...courseField.querySelectorAll('button')].find(b=>b.textContent==='Search'));await tick();
  h.click([...courseField.querySelectorAll('button')].find(b=>b.textContent==='Select'));
  h.input(form.querySelector('[name=priceAmountMinor]'),'137531');h.input(form.querySelector('[name=priceUnits]'),'19');
  h.submit(form);h.submit(form);await tick();
  const writes=h.calls.filter(c=>c.path==='/api/staff/finance/service-policies'&&c.method==='POST');
  assert.equal(writes.length,1);assert.equal(writes[0].body.priceAmountMinor,137531);assert.equal(writes[0].body.priceUnits,19);
  assert.equal(writes[0].body.courseId,course);assert.deepEqual(writes[0].body.eligibleWeekdays,[0,1,2,3,4]);
 }finally{h.dispose();}
});

test('disabled new purchases keep existing balances visible and hide the create form',async()=>{
 const h=setup({role:'owner'}),student=ID(10);
 h.stub({[`/api/staff/finance/students/${student}/service-policies`]:{purchasesEnabled:false,pauses:[],policies:[{
  id:ID(12),label:'Prior terms',course:'IELTS',priceAmountMinor:26500,priceUnits:1,mode:'PREPAID_CALENDAR_DAYS',
  remainingUnits:7,unappliedCreditMinor:14500,active:true,approved:true}]}});
 try{h.ctx.root.append(prepaidContracts(h.ctx,student,'2026-11-16',async()=>{}));await tick();
  assert.match(h.ctx.root.textContent,/14,500 UZS/);assert(!h.q('[data-service-policy-form]'));
 }finally{h.dispose();}
});
