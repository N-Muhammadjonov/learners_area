import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ApiError} from '../js/api-client.js';
import {financeDebtors} from '../modules/staff-final30/finance-debtors.js';
import {academyToday} from '../modules/staff-final30/academy-today.js';
import {academyAiPanel} from '../modules/shared/academy-ai.js';
import {setup,tick,ID} from './staff-final30/harness.mjs';

test('debt queue filters on server and opens the named student without showing an ID',async()=>{
 const h=setup(),selected=[];
 h.stub({'/api/staff/finance/debtors':{asOf:'2026-11-16',total:1,items:[{studentId:ID(3),name:'QA Student',balanceDueMinor:800000,overdueMinor:0}],pagination:{hasMore:false}}});
 try{
  const node=financeDebtors(h.ctx,(...args)=>selected.push(args));h.ctx.root.append(node);node.dispatchEvent(new Event('academy-load'));await tick();
  assert.match(node.textContent,/QA Student/);assert.doesNotMatch(node.textContent,/00000000-/);
  h.click([...node.querySelectorAll('button')].find(b=>b.textContent==='Open account'));assert.deepEqual(selected,[[ID(3),'QA Student']]);
  node.querySelector('input[type=search]').value='QA';h.submit(node.querySelector('form'));await tick();
  assert.match(h.calls.at(-1).path,/q=QA/);
 }finally{h.dispose();}
});
test('teacher Today failure never invents zero counts and retry uses only assigned facts',async()=>{
 const h=setup({role:'teacher'});let attempt=0;
 h.stub({'/api/staff/academy/today':()=>++attempt===1?new ApiError(503,'unavailable'):{observedAt:'2026-11-16T00:00:00Z',classes:{count:1,items:[{name:'Assigned class',startsAt:'2026-11-16T06:00:00Z',branch:'A',href:'/app/management/groups?group='+ID(2)}]},parents:{count:2,href:'/app/management/guardians'}}});
 try{
  const node=academyToday(h.ctx);h.ctx.root.append(node);await tick();assert.match(node.textContent,/Could not load priorities/);assert(!node.querySelector('h2'));
  h.click(node.querySelector('button'));await tick();assert.match(node.textContent,/Assigned class/);assert.doesNotMatch(node.textContent,/Outstanding accounts/);
 }finally{h.dispose();}
});
test('RIWI draft requires an explicit apply and cannot execute a model command',async()=>{
 const h=setup({role:'teacher'});h.ctx.session.assistantEnabled=true;const applied=[];
 h.stub({'/api/staff/academy/assistant/proposals':{brand:'RIWI',canExecute:false,approvalRequired:true,observedAt:'2026-11-16T00:00:00Z',evidence:[{kind:'verified_student',value:1,unit:'count',sourceHref:'/app/management/guardians'}],draftText:'Review learning together.'}});
 try{
  const node=academyAiPanel(h.ctx,{endpoint:'/api/staff/academy/assistant/proposals',action:'parent_message_draft',studentId:ID(2),onDraft:value=>applied.push(value)});h.ctx.root.append(node);
  h.click(node.querySelector('button'));await tick();assert.deepEqual(applied,[]);assert.equal(node.querySelector('textarea').value,'Review learning together.');
  h.click([...node.querySelectorAll('button')].find(b=>b.textContent==='Use draft in composer'));assert.deepEqual(applied,['Review learning together.']);
  assert.equal(h.calls.some(c=>c.path.includes('guardian-messages/send')),false);
 }finally{h.dispose();}
});

test('Today shows the count behind a bounded list and keeps pagination open for keyboard use',async()=>{
 const h=setup();
 h.stub({'/api/staff/academy/today':path=>{
  const offset=Number(new URL(path,'https://fixture.invalid').searchParams.get('classesOffset'));
  return {observedAt:'2026-11-16T00:00:00Z',classes:{count:11,items:[{name:offset?'Last class':'First class',startsAt:'2026-11-16T06:00:00Z',branch:'A',href:'/app/management/groups?group='+ID(2)}],pagination:{offset,hasMore:!offset}}};
 }});
 try{
  const node=academyToday(h.ctx);h.ctx.root.append(node);await tick();
  const first=node.querySelector('#today-classes');assert.match(first.textContent,/Showing: 1 \/ 11/);
  h.click([...first.querySelectorAll('button')].find(b=>b.textContent==='Next'));await tick();
  const second=node.querySelector('#today-classes');assert(second.open);assert.match(second.textContent,/Last class/);
  assert.equal(document.activeElement,second.querySelector('summary'));assert.match(h.calls.at(-1).path,/classesOffset=10/);
 }finally{h.dispose();}
});
