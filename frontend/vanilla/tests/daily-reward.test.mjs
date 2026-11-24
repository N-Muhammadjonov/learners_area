import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {dailyReward} from '../modules/shared/daily-reward.js';

const claimed=(date='2026-11-17',streak=3)=>({date,streak,cycle:7,claimed:true,todayCoins:streak,nextCoins:0,awarded:streak,wallet:{balance:19}});
const available=(date='2026-11-17',streak=2)=>({date,streak,cycle:7,claimed:false,todayCoins:0,nextCoins:streak%7+1});
function begin(h,{response=available(),claimResponse=claimed(),storage=h.dom.window.localStorage,client,session=h.ctx.session}={}){
 const calls=[];
 const rewards=dailyReward({session,signal:h.controller.signal,storage,client:client??{request:async(path,options)=>{
  calls.push({path,options});return path.endsWith('/claim')?claimResponse:
    path==='/api/coins/daily'?response:{balance:16};
 }}});
 return {rewards,calls};
}
test('daily popup never claims until the user presses Claim, then shows receipt',async()=>{
 const h=setup({role:'owner'});
 try{
  const {rewards,calls}=begin(h);rewards.update(h.ctx);await tick();
  const dialog=document.querySelector('[data-daily-reward]');assert(dialog?.open);
  assert.equal(dialog.querySelectorAll('li').length,7);
  assert.equal(dialog.querySelectorAll('.daily-reward-day--claimed').length,2);
  assert.match(dialog.textContent,/Claim \+3 coins today/);
  assert.match(dialog.textContent,/Balance: 16/);
  assert.equal(calls.filter(row=>row.path.endsWith('/claim')).length,0);
  assert.equal(calls.filter(row=>row.path==='/api/coins/daily').length,1);
  dialog.querySelector('[data-daily-reward-claim]').click();await tick();
  assert.equal(calls.filter(row=>row.path.endsWith('/claim')).length,1);
  assert.equal(calls.find(row=>row.path.endsWith('/claim')).options.method,'POST');
  assert.equal(document.querySelector('[data-daily-reward]'),null,
   'a verified daily claim must dismiss the modal without an X click');
  assert.equal(h.nav.length,0,'claim keeps the user on the current page');
  assert.equal(h.dom.window.localStorage.getItem('la:daily-reward-seen:v2:'+ID(1)+':2026-11-17'),'1');
  rewards.update(h.ctx);await tick();assert.equal(document.querySelector('[data-daily-reward]'),null);
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
test('closing unclaimed reward is not recorded as a claim and can reopen after reload',async()=>{
 const h=setup({role:'student'});
 const storage=h.dom.window.localStorage;
 try{
  const {rewards,calls}=begin(h,{storage});
  rewards.update(h.ctx);await tick();
  const dialog=document.querySelector('[data-daily-reward]');
  assert(dialog?.open);
  dialog.querySelector('.daily-reward-close').click();await tick();
  assert.equal(document.querySelector('[data-daily-reward]'),null);
  assert.equal(calls.filter(x=>x.path.endsWith('/claim')).length,0);
  assert.equal(storage.getItem('la:daily-reward-seen:v2:'+ID(1)+':2026-11-17'),null);
  h.controller.abort();
  const life=new h.dom.window.AbortController();
  const again=dailyReward({
   session:h.ctx.session,signal:life.signal,storage,
   client:{request:async path=>path==='/api/coins/daily'?available():{balance:0}},
  });
  again.update({...h.ctx,signal:life.signal});await tick();
  assert(document.querySelector('[data-daily-reward]')?.open);
  life.abort();
 }finally{h.dispose();}
});
test('blocked storage, failed transport and an aborted account never manufacture a reward',async()=>{
 const h=setup({role:'student'});let answer,requests=0;
 try{
  const {rewards}=begin(h,{storage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},client:{request:async path=>{
   if(path!=='/api/coins/daily')throw Error('wallet unavailable');
   if(++requests===1)throw Error('offline');return new Promise(resolve=>answer=resolve);
  }}});
  rewards.update(h.ctx);await tick();assert.equal(document.querySelector('[data-daily-reward]'),null);
  rewards.update(h.ctx);await tick();h.controller.abort();answer(claimed());await tick();
  assert.equal(document.querySelector('[data-daily-reward]'),null);
 }finally{h.dispose();}
});
test('seen markers are scoped to the current account and server date without hiding unclaimed rewards',async()=>{
 const h=setup({role:'student'});
 try{
  const storage=h.dom.window.localStorage;
  const currentKey='la:daily-reward-seen:v2:'+ID(1)+':2026-11-17';
  storage.setItem('la:daily-reward-seen:v2:'+ID(2)+':2026-11-17','1');
  storage.setItem('la:daily-reward-seen:v2:'+ID(1)+':2026-11-16','1');
  const {rewards}=begin(h);
  rewards.update(h.ctx);
  await tick();
  assert(document.querySelector('[data-daily-reward]')?.open,
   'another account and the previous day must not suppress this reward');
  assert.equal(storage.getItem(currentKey),null,
   'displaying an unclaimed reward must not mark it claimed or seen');
  h.controller.abort();

  const life=new h.dom.window.AbortController();
  try{
   const again=dailyReward({
    session:h.ctx.session,signal:life.signal,storage,
    client:{request:async()=>available()},
   });
   again.update({...h.ctx,signal:life.signal});
   await tick();
   assert(document.querySelector('[data-daily-reward]')?.open,
    'an unclaimed reward remains available after remounting');
  }finally{life.abort();}

  storage.setItem(currentKey,'1');
  const scopedLife=new h.dom.window.AbortController();
  try{
   const suppressed=dailyReward({
    session:h.ctx.session,signal:scopedLife.signal,storage,
    client:{request:async()=>available()},
   });
   suppressed.update({...h.ctx,signal:scopedLife.signal});
   await tick();
   assert.equal(document.querySelector('[data-daily-reward]'),null,
    'only a matching account and authoritative server-date marker suppresses the popup');
  }finally{scopedLife.abort();}
 }finally{h.dispose();}
});
test('visible tab crossing Tashkent midnight checks status without auto-claiming',async t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:new Date('2026-11-17T18:59:40Z')});
 const h=setup({role:'student'});let reads=0,claims=0;
 try{
  const {rewards}=begin(h,{client:{request:async path=>{
   if(path==='/api/coins/daily')return ++reads===1?
     available('2026-11-17',6):available('2026-11-18',0);
   if(path.endsWith('/claim')){claims++;return claimed('2026-11-17',7);}
   return {balance:20};
  }}});
  rewards.update(h.ctx);await tick();
  assert.match(document.querySelector('[data-daily-reward]').textContent,/Claim \+7 coins today/);
  t.mock.timers.tick(60000);await tick();
  assert.equal(reads,2);assert.equal(claims,0);
  assert.equal(document.querySelectorAll('[data-daily-reward]').length,1);
  assert.match(document.querySelector('[data-daily-reward]').textContent,/Claim \+1 coins today/);
 }finally{h.dispose();}
});
