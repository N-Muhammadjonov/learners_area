import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {dailyReward} from '../modules/shared/daily-reward.js';

const claimed=(date='2026-11-17',streak=3)=>({date,streak,cycle:7,claimed:true,todayCoins:streak,nextCoins:0,awarded:streak});
function begin(h,{response=claimed(),storage=h.dom.window.localStorage,client,session=h.ctx.session}={}){
 const calls=[];
 const rewards=dailyReward({session,signal:h.controller.signal,storage,client:client??{request:async(path,options)=>{
  calls.push({path,options});return path.endsWith('/claim')?response:{balance:19};
 }}});
 return {rewards,calls};
}
test('daily server receipt opens seven days once and links to the actual earn panel',async()=>{
 const h=setup({role:'owner'});
 try{
  const {rewards,calls}=begin(h);rewards.update(h.ctx);await tick();
  const dialog=document.querySelector('[data-daily-reward]');assert(dialog?.open);
  assert.equal(dialog.querySelectorAll('li').length,7);
  assert.equal(dialog.querySelectorAll('.daily-reward-day--claimed').length,3);
  assert.match(dialog.textContent,/tomorrow for \+4/);assert.match(dialog.textContent,/Balance: 19/);
  dialog.querySelector('a').click();await tick();assert.equal(document.querySelector('[data-daily-reward]'),null);
  assert.equal(h.nav[0].path,'/app/study-plan/rewards?view=earn');
  rewards.update(h.ctx);await tick();assert.equal(document.querySelector('[data-daily-reward]'),null);
  assert.equal(calls.filter(row=>row.path.endsWith('/claim')).length,1);
 }finally{h.dispose();}
});
test('focus exams and other modals defer the reward until the ordinary workspace is available',async()=>{
 const h=setup({role:'student'});
 try{
  const {rewards}=begin(h);rewards.update(h.ctx,{ordinary:false});await tick();
  assert.equal(document.querySelector('[data-daily-reward]'),null);
  const other=document.createElement('dialog');document.body.append(other);other.showModal();
  rewards.update(h.ctx);await tick();assert.equal(document.querySelector('[data-daily-reward]'),null);
  other.close();await tick();assert(document.querySelector('[data-daily-reward]')?.open);
 }finally{h.dispose();}
});
test('blocked storage, failed transport and an aborted account never manufacture a reward',async()=>{
 const h=setup({role:'student'});let answer,requests=0;
 try{
  const {rewards}=begin(h,{storage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},client:{request:async path=>{
   if(!path.endsWith('/claim'))throw Error('wallet unavailable');
   if(++requests===1)throw Error('offline');return new Promise(resolve=>answer=resolve);
  }}});
  rewards.update(h.ctx);await tick();assert.equal(document.querySelector('[data-daily-reward]'),null);
  rewards.update(h.ctx);await tick();h.controller.abort();answer(claimed());await tick();
  assert.equal(document.querySelector('[data-daily-reward]'),null);
 }finally{h.dispose();}
});
test('seen markers are scoped to the account and authoritative server date',async()=>{
 const h=setup({role:'student'});
 try{
  const storage=h.dom.window.localStorage;
  storage.setItem('la:daily-reward-seen:v1:'+ID(2)+':2026-11-17','1');
  storage.setItem('la:daily-reward-seen:v1:'+ID(1)+':2026-11-16','1');
  const {rewards}=begin(h);rewards.update(h.ctx);await tick();assert(document.querySelector('[data-daily-reward]'));
  h.controller.abort();
  const life=new h.dom.window.AbortController();
  const again=dailyReward({session:h.ctx.session,signal:life.signal,storage,client:{request:async()=>claimed()}});
  again.update(h.ctx);await tick();assert.equal(document.querySelector('[data-daily-reward]'),null);life.abort();
 }finally{h.dispose();}
});
test('a visible tab crossing Tashkent midnight starts the next seven-day cycle',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:new Date('2026-11-17T18:59:40Z')});
 const h=setup({role:'student'});let claims=0;
 try{
  const {rewards}=begin(h,{client:{request:async path=>path.endsWith('/claim')?
   (++claims===1?claimed('2026-11-17',7):claimed('2026-11-18',1)):{balance:20}}});
  rewards.update(h.ctx);await tick();assert.match(document.querySelector('[data-daily-reward]').textContent,/tomorrow for \+1/);
  t.mock.timers.tick(60000);await tick();
  assert.equal(claims,2);assert.equal(document.querySelectorAll('[data-daily-reward]').length,1);
  assert.equal(document.querySelectorAll('.daily-reward-day--claimed').length,1);
  assert.match(document.querySelector('[data-daily-reward]').textContent,/tomorrow for \+2/);
 }finally{h.dispose();}
});
