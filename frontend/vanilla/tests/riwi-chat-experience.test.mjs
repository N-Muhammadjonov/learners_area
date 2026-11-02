import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mount} from '../modules/riwi/index.js';

test('native page loads chat styles after the shared campus palette',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(x=>x[1]);
 assert(styles.includes('/css/riwi.css'));
 assert(styles.indexOf('/css/riwi.css')>styles.indexOf('/css/campus.css'));
});

test('pending chat shows the user bubble, prevents duplicate sends, and renders safe multiline sources',async()=>{
 const h=setup({path:'/app/riwi',role:'owner',locale:'uz',theme:'night'});
 let release;const response=new Promise(r=>{release=r});
 try{
  h.stub({'/api/riwi/chat':()=>response});await mount(h.ctx);
  h.input(h.q('textarea'),'Misollar ber');h.submit(h.q('form'));h.submit(h.q('form'));
  assert.equal(h.calls.filter(x=>x.path==='/api/riwi/chat').length,1);
  assert(h.q('.riwi-msg--user'));assert(h.q('.riwi-typing'));assert(h.q('button[type=submit]').disabled);
  release({ok:true,conversationId:ID(2),answer:'Oddiy izoh 🙂\n\n1) First.\n2) Second.\n3) Third.\n<img src=x onerror=alert(1)>',provenance:'approved_knowledge',citations:[{ref:'K2',title:'Tasdiqlangan misollar'}]});
  await tick(7);
  assert.equal(h.qa('[data-riwi-role]').length,2);
  assert.equal(h.q('.riwi-typing'),null);assert.equal(h.q('button[type=submit]').disabled,false);
  assert(h.q('.riwi-msg__body').textContent.includes('Misollar ber'));
  assert(h.q('.riwi-msg--assistant .riwi-msg__body').textContent.includes('\n\n1)'));
  assert.equal(h.q('.riwi-msg img'),null);
  assert(h.q('.riwi-sources').textContent.includes('K2 · Tasdiqlangan misollar'));
  assert(!h.ctx.root.textContent.includes('[object Object]'));
  assert.equal(h.q('[data-route-usable]').hasAttribute('data-theme'),false);
 }finally{h.dispose()}
});

test('failed send preserves writing, announces the error and allows a retry',async()=>{
 const h=setup({path:'/app/riwi',locale:'uz'});
 try{
  let attempts=0;
  h.stub({'/api/riwi/chat':()=>{if(++attempts===1)throw Error('synthetic outage');return {ok:true,conversationId:ID(4),answer:'Yangi javob',provenance:'approved_knowledge',citations:[]}}});
  await mount(h.ctx);h.input(h.q('textarea'),'Shu gapni tushuntir');h.submit(h.q('form'));await tick(6);
  assert.equal(h.q('textarea').value,'Shu gapni tushuntir');
  assert.equal(h.q('[role=alert]').hidden,false);assert(!h.q('[role=alert]').textContent.includes('synthetic outage'));
  assert.equal(h.q('button[type=submit]').disabled,false);
  h.submit(h.q('form'));await tick(6);assert.equal(attempts,2);assert(h.ctx.root.textContent.includes('Yangi javob'));
 }finally{h.dispose()}
});

test('Enter sends, Shift+Enter and composition preserve editing, and clearing returns to the welcome state',async()=>{
 const h=setup({path:'/app/riwi',locale:'en'});
 try{
  h.stub({'/api/riwi/chat':{ok:true,conversationId:ID(5),answer:'Three examples',provenance:'approved_knowledge',citations:[]},'/api/riwi/conversations/*':{ok:true,deleted:true}});
  await mount(h.ctx);const input=h.q('textarea');h.input(input,'Explain articles');
  input.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}));
  input.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));
  assert.equal(h.calls.length,0);
  input.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick(6);
  assert.equal(h.calls.filter(x=>x.path==='/api/riwi/chat').length,1);
  h.click(h.q('.riwi-clear'));await tick(6);assert.equal(h.qa('[data-riwi-role]').length,0);assert(h.q('.riwi-welcome'));
 }finally{h.dispose()}
});
