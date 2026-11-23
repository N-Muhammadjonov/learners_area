import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import b2Units from '../modules/grammar/book-content-b2.js';
import {renderInteractiveBook} from '../modules/grammar/book-runtime.js';

test('a completed Grammar block can be rechecked without resetting other scores, then records canonical server evidence',async()=>{
 const dom=new JSDOM('<!doctype html><div id="host"></div>',{
  url:'https://example.test/app/grammar/lessons?book=b2-1'
 });
 const names=['window','document','navigator','localStorage','Option','fetch'];
 const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));
 const requests=[];
 try{
  for(const name of names.slice(0,-1))globalThis[name]=dom.window[name];
  globalThis.fetch=async (url,options)=>{
   requests.push({url,body:JSON.parse(options.body)});
   return {ok:true,json:async()=>({ok:true,awarded:false,reason:'already_rewarded'})};
  };
  const unit=b2Units.find(item=>item.id==='b2-1');
  assert(unit);
  const store='grammar:evidence:retry';
  localStorage.setItem(store,JSON.stringify({
   [unit.id]:{'0':{'0':8,'1':6,'2':6},'1':{'0':10}}
  }));
  const shadow=document.getElementById('host').attachShadow({mode:'open'});
  shadow.innerHTML='<div id="nav"></div><div id="units"></div>';
  renderInteractiveBook(shadow,[unit],new AbortController().signal,store,'b2');

  const card=shadow.querySelector('[data-grammar-exercise="0:1"]');
  const retry=card.querySelector('[data-grammar-exercise-retry="0:1"]');
  assert(retry);
  assert.equal(retry.hidden,false,'previously checked block can be retried after reloading');
  assert.equal(requests.length,0,'local progress is not silently accepted as server proof');

  retry.click();
  const before=JSON.parse(localStorage.getItem(store))[unit.id];
  assert.equal(before[0][0],8,'block A must retain its score');
  assert.equal(before[0][1],undefined,'only the selected block is cleared');
  assert.equal(before[0][2],6,'block C must retain its score');
  assert.equal(before[1][0],10,'other stages must retain their scores');

  const fresh=shadow.querySelector('[data-grammar-exercise="0:1"]');
  const check=[...fresh.querySelectorAll('button.btn')].find(button=>button.textContent==='Tekshirish');
  assert(check);
  assert.equal(check.disabled,true);
  const rows=fresh.querySelectorAll('.item');
  rows.forEach((row,i)=>{
   const expected=unit.stages[0].ex[1].items[i].t?"To'g'ri":"Noto'g'ri";
   const selected=[...row.querySelectorAll('button.opt')].find(button=>button.textContent===expected);
   assert(selected);
   selected.click();
  });
  assert.equal(check.disabled,false,'all questions must be answered before Check');
  assert.equal(requests.length,0,'choosing answers must not automatically grade or submit');
  check.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'/api/coins/grammar-book/complete');
  assert.deepEqual(requests[0].body,{
   level:'b2',unitId:'b2-1',stage:0,exercise:1,
   answers:unit.stages[0].ex[1].items.map(item=>item.t?"To'g'ri":"Noto'g'ri")
  });
  assert.match(fresh.querySelector('[role="status"]').textContent,/Serverda tasdiqlandi/);
  assert.equal(fresh.querySelector('[data-grammar-exercise-retry]').hidden,false);
  const after=JSON.parse(localStorage.getItem(store))[unit.id];
  assert.equal(after[0][1],6);
  assert.equal(after[0][0],8);
  assert.equal(after[0][2],6);
 }finally{
  dom.window.close();
  for(const name of names){
   if(previous[name]===undefined)delete globalThis[name];
   else globalThis[name]=previous[name];
  }
 }
});

test('server-rejected grammar evidence is never shown as verified',async()=>{
 const dom=new JSDOM('<!doctype html><div id="host"></div>',{
  url:'https://example.test/app/grammar/lessons?book=b2-1'
 });
 const names=['window','document','navigator','localStorage','Option','fetch'];
 const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));
 try{
  for(const name of names.slice(0,-1))globalThis[name]=dom.window[name];
  globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,awarded:false,reason:'incomplete'})});
  const unit=b2Units.find(item=>item.id==='b2-1');
  const shadow=document.getElementById('host').attachShadow({mode:'open'});
  shadow.innerHTML='<div id="nav"></div><div id="units"></div>';
  renderInteractiveBook(shadow,[unit],new AbortController().signal,'grammar:rejected','b2');
  const match=shadow.querySelector('[data-grammar-exercise="0:2"]');
  const entries=unit.stages[0].ex[2].items;
  [...match.querySelectorAll('select')].forEach((select,index)=>{select.value=entries[index].r;});
  match.querySelector('button.btn').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(match.querySelector('[role="status"]').textContent,/Serverda saqlanmadi/);
  assert.equal(match.querySelector('[data-grammar-exercise-retry]').hidden,false);
 }finally{
  dom.window.close();
  for(const name of names){
   if(previous[name]===undefined)delete globalThis[name];
   else globalThis[name]=previous[name];
  }
 }
});
