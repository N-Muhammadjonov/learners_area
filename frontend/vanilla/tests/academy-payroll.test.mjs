import assert from 'node:assert/strict';
import {test} from 'node:test';
import {academyPayroll} from '../modules/staff-final30/academy-payroll.js';
import {ID,setup,tick} from './staff-final30/harness.mjs';

const api='/api/staff/finance/payroll';
const teacher=ID(2);
const data={rules:[],canFinalize:true,calculationHash:'f'.repeat(64),
 estimate:{amountMinor:450000,fixedMinor:300000,sessionMinor:100000,revenueMinor:50000,pendingSessionIds:[]}};
const finalized={rules:[],position:{id:ID(3),accruedMinor:450000,paidMinor:0,
 adjustmentMinor:0,balanceMinor:450000,events:[]}};

async function selectTeacher(h){
 const panel=academyPayroll(h.ctx);
 h.ctx.root.append(panel);panel.open=true;
 h.submit(h.q('[data-payroll-lookup]'));await tick();
 h.submit(h.q('[data-payroll-query]'));await tick();
 return panel;
}

test('owner sees estimate and confirms accrual before payroll becomes payable',async()=>{
 const h=setup({role:'owner'});
 let writes=0;
 h.stub({
  [api+'/teachers']:{options:[{id:teacher,label:'Test Teacher'}]},
  [api]:()=>writes?finalized:data,[api+'/finalize']:()=>{writes++;return finalized.position;},
 });
 try{
  const panel=await selectTeacher(h);
  assert.match(panel.textContent,/Estimate450,000 UZS/);
  const finalize=h.qa('button').find(node=>node.textContent==='Finalize accrual').form;
  h.submit(finalize);await tick();
  assert.equal(writes,0);
  finalize.querySelector('input[type=checkbox]').checked=true;
  h.submit(finalize);h.submit(finalize);await tick();
  assert.equal(writes,1);
  const request=h.calls.find(call=>call.method==='POST');
  assert.equal(request.body.expectedCalculation,data.calculationHash);
  assert.equal(request.body.expectedAmountMinor,450000);
  assert.equal(request.body.teacherUserId,teacher);
  assert.match(panel.textContent,/Accrued450,000 UZS.*Paid0 UZS/);
 }finally{h.dispose();}
});

test('admin may view finalized payroll without changing accounting records',async()=>{
 const h=setup({role:'admin'});
 h.stub({[api+'/teachers']:{options:[{id:teacher,label:'Test Teacher'}]}, [api]:finalized});
 try{
  const panel=await selectTeacher(h);
  assert.match(panel.textContent,/Payable balance450,000 UZS/);
  assert.equal(h.qa('form').length,2);
 }finally{h.dispose();}
});

test('owner can assign eligible journal revenue from the held class and student picker',async()=>{
 const h=setup({role:'owner'});
 const source={session_id:ID(5),transaction_id:ID(6),starts_at:'2026-10-02T11:00:00Z',
  group_name:'Morning IELTS',student_name:'Test Student',amount_minor:400000};
 h.stub({
  [api+'/teachers']:{options:[{id:teacher,label:'Test Teacher'}]},
  [api]:{...data,rules:[{id:ID(4),starts_on:'2026-10-01',ends_on:null,
   monthly_minor:0,session_minor:0,hourly_minor:0,revenue_bps:1200}]},
  [api+'/revenue']:(_path,config)=>config.method==='POST'?{}:{options:[source],hasMore:false},
 });
 try{
  const panel=await selectTeacher(h);
  h.click(h.qa('button').find(n=>n.textContent==='Load eligible revenue'));await tick();
  assert.match(panel.textContent,/Morning IELTS.*Test Student.*400,000 UZS/);
  const assign=h.qa('button').find(n=>n.textContent==='Assign recognized revenue').form;
  assign.querySelector('input[type=checkbox]').checked=true;
  h.submit(assign);await tick();
  const call=h.calls.find(item=>item.method==='POST');
  assert.deepEqual(call.body,{teacherUserId:teacher,sessionId:ID(5),journalTransactionId:ID(6)});
 }finally{h.dispose();}
});
