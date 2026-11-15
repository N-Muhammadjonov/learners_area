import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ApiError} from '../js/api-client.js';
import routes from '../js/routes.js';
import {mount,financeInProfile} from '../modules/staff-final30/academy-finance.js';
import {managementAreas} from '../modules/staff-final30/management-hub.js';
import {ID,dicts,setup,tick} from './staff-final30/harness.mjs';

const path='/app/management/finance';
const api='/api/staff/finance';
const id=ID(9);
const statement={position:{balanceDueMinor:100000,overdueMinor:0,advanceMinor:0,refundedMinor:0},
 charges:[],payments:[],refunds:[]};

test('finance management requires owner or admin and shows reconciliation from both server checks',async()=>{
 const route=routes.find(item=>item.pattern===path);
 assert.deepEqual(route.roles,['admin','owner']);assert(route.protected);
 assert(managementAreas(dicts.en,'owner').some(item=>item.href===path));
 assert(!managementAreas(dicts.en,'teacher').some(item=>item.href===path));
 const h=setup({path,role:'owner'});
 h.stub({[api+'/summary']:{collectedTotalMinor:550000},[api+'/reconciliation']:{journal:{balanced:true},summary:{ok:true}}});
 try{
  await mount(h.ctx);
  assert.match(h.ctx.root.textContent,/550,000 UZS/);
  h.click(h.qa('button').find(node=>node.textContent==='Reconcile accounts'));
  await tick();
  assert.match(h.ctx.root.textContent,/Accounts agree/);
  assert.match(h.calls[0].path,/start=\d{4}-\d{2}-01&end=\d{4}-\d{2}-\d{2}/);
 }finally{h.dispose();}
});

test('staff records cash only after confirmation and keeps the same idempotency key on retry',async()=>{
 const h=setup({path,role:'admin'});
 let writes=0;
 h.stub({
  [api+'/summary']:{collectedTotalMinor:0},
  ['/api/staff/academy/lookups/student']:{options:[{id,label:'Test Student'}]},
  [api+'/students/'+id+'/statement']:()=>({...statement,payments:writes===2?[
   {amount_minor:100000,status:'confirmed',method:'cash',receipt_no:'RC-1',occurred_at:'2026-11-15T01:00:00Z'},
   {amount_minor:100000,status:'pending_provider',method:'provider',receipt_no:null},
  ]:[]}),
  [api+'/payments']:()=>++writes===1?new ApiError(503,'unavailable'):{ok:true},
 });
 try{
  await mount(h.ctx);
  h.submit(h.q('[data-academy-student-search]'));await tick();
  h.click(h.qa('button').find(node=>node.textContent==='Open'));await tick();
  const payment=h.q('[data-academy-payment-form]');
  payment.querySelector('input[type=number]').value='100000';
  h.submit(payment);await tick();
  assert.equal(writes,0);
  payment.querySelector('input[type=checkbox]').checked=true;
  h.submit(payment);h.submit(payment);await tick();
  assert.equal(writes,1);
  h.submit(payment);await tick();
  assert.equal(writes,2);
  const requests=h.calls.filter(call=>call.method==='POST');
  assert.deepEqual(requests[0].body,requests[1].body);
  assert.equal(requests[1].body.amountMinor,100000);
  assert.match(h.ctx.root.textContent,/RC-1/);
  assert.match(h.ctx.root.textContent,/Awaiting provider confirmation/);
  assert.equal(h.qa('button').filter(node=>node.textContent==='Print').length,1);
 }finally{h.dispose();}
});

for(const role of ['teacher','student']){
 test(role+' profile fetches its limited finance endpoint only when opened',async()=>{
  const h=setup({path,role});
  const route=role==='teacher'?api+'/students/'+id+'/tuition-status':'/api/finance/me';
  h.stub({[route]:{balanceStatus:'outstanding',position:statement.position}});
  try{
   const panel=financeInProfile(h.ctx,id);
   h.ctx.root.append(panel);
   assert.equal(h.calls.length,0);
   panel.open=true;await tick();
   assert.equal(h.calls[0].path,route);
   assert.match(panel.textContent,role==='teacher'?/Outstanding balance/:/100,000 UZS/);
   assert.equal(panel.querySelector('form'),null);
  }finally{h.dispose();}
 });
}

test('cash close requires a confirmed count and displays the server variance',async()=>{
 const h=setup({path,role:'admin'});
 h.stub({[api+'/summary']:{},[api+'/days/close']:{close:{expected_minor:550000,counted_minor:500000,variance_minor:-50000}}});
 try{
  await mount(h.ctx);
  const form=h.q('[data-academy-cash-close]');
  form.querySelectorAll('[type=number]')[1].value='500000';
  h.submit(form);await tick();
  assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
  form.querySelector('[type=checkbox]').checked=true;
  h.submit(form);await tick();
  const write=h.calls.find(call=>call.method==='POST');
  assert.equal(write.path,api+'/days/close');
  assert.equal(write.body.countedMinor,500000);
  assert.equal(write.body.openingMinor,0);
  assert.match(form.textContent,/-50,000 UZS/);
 }finally{h.dispose();}
});

test('finance document controls follow staff authority and retry a draft with one command ID',async()=>{
 const {financeDocuments}=await import('../modules/staff-final30/finance-documents.js');
 const h=setup({path,role:'admin'});
 let calls=0,saved=0;
 h.stub({[api+'/contracts']:()=>++calls===1?new ApiError(503,'unavailable'):{ok:true}});
 try{
  const panel=financeDocuments(h.ctx,id,{contracts:[{id:ID(12),status:'draft',monthly_amount_minor:600000}],
   sandboxProviderEnabled:false},String,'2026-11-15',()=>{saved++;});
  h.ctx.root.append(panel);
  assert.equal(panel.querySelector('[data-finance-command$="/approve"]'),null);
  assert.equal(panel.querySelector('[data-finance-command="/payments"]'),null);
  const form=panel.querySelector('[data-finance-command="/contracts"]');
  form.querySelector('[type=number]').value='600000';
  h.submit(form);await tick();
  assert.equal(calls,0);
  form.querySelector('[type=checkbox]').checked=true;
  h.submit(form);h.submit(form);await tick();
  assert.equal(calls,1);
  h.submit(form);await tick();
  assert.equal(calls,2);assert.equal(saved,1);
  assert.deepEqual(h.calls[0].body,h.calls[1].body);
  assert.match(h.calls[0].body.commandId,/^[a-f\d-]{36}$/);
 }finally{h.dispose();}
});

test('owner can approve another author’s refund and sandbox intents never confirm funds',async()=>{
 const {financeDocuments}=await import('../modules/staff-final30/finance-documents.js');
 const h=setup({path,role:'owner'});
 h.stub({[api+'/payments']:{ok:true}});
 try{
  const panel=financeDocuments(h.ctx,id,{
   refunds:[{id:ID(20),status:'requested',authorized_by:ID(2),amount_minor:8000},
            {id:ID(21),status:'requested',authorized_by:ID(1),amount_minor:8000},
            {id:ID(22),status:'approved',method:'cash',amount_minor:8000},
            {id:ID(23),status:'approved',method:'provider',amount_minor:8000}],
   sandboxProviderEnabled:true,
  },String,'2026-11-15',()=>{});
  h.ctx.root.append(panel);
  const action=route=>panel.querySelector('[data-finance-command="'+route+'"]');
  assert(action('/refunds/'+ID(20)+'/approve'));
  assert.equal(action('/refunds/'+ID(21)+'/approve'),null);
  assert(action('/refunds/'+ID(22)+'/settle'));
  assert.equal(action('/refunds/'+ID(23)+'/settle'),null);
  const form=action('/payments');
  form.querySelector('[type=text]').value='sandbox-fixture';
  form.querySelector('[type=number]').value='8000';
  form.querySelector('[type=checkbox]').checked=true;
  h.submit(form);await tick();
  assert.equal(h.calls[0].body.confirm,false);
  assert.equal(h.calls[0].body.method,'provider');
 }finally{h.dispose();}
});
