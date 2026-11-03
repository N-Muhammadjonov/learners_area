import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick} from './staff-final30/harness.mjs';
import {mount} from '../modules/riwi/index.js';

test('slash opens filtered commands above the composer; keyboard/click selection does not execute',async()=>{
 const h=setup({path:'/app/riwi',role:'owner',locale:'uz'});
 try{
  await mount(h.ctx);const input=h.q('.riwi-chat-input'),key=value=>input.dispatchEvent(new window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
  h.input(input,'/');assert(!h.q('.riwi-slash-suggestions').hidden);assert.equal(h.qa('[role=option]').length,5);
  assert(!h.ctx.root.textContent.includes('/language'));
  h.input(input,'/ex');assert.equal(h.qa('[role=option]').length,1);key('Enter');
  assert.equal(input.value,'/examples');assert(h.q('.riwi-slash-suggestions').hidden);assert.equal(h.calls.length,0);assert.equal(h.qa('[data-riwi-role]').length,0);
  h.input(input,'/');key('ArrowDown');key('Tab');assert.equal(input.value,'/clear');assert.equal(h.qa('[data-riwi-role]').length,0);
  h.input(input,'/');key('Escape');assert(h.q('.riwi-slash-suggestions').hidden);
  h.input(input,'/he');h.click(h.q('[role=option]'));assert.equal(input.value,'/help');assert.equal(h.qa('[data-riwi-role]').length,0);
  key('Enter');await tick(4);assert(h.q('.riwi-msg--assistant'));assert.equal(h.calls.length,0);
 }finally{h.dispose()}
});

test('@ opens the local attachment picker without hijacking email addresses or submitting',async()=>{
 const h=setup({path:'/app/riwi',role:'owner',locale:'uz'});let opened=0,reads=0;
 try{
  await mount(h.ctx,{readAttachment:async()=>{reads++;throw Error('unexpected_read');}});
  const file=h.q('input[type=file]');file.click=()=>{opened++;};const input=h.q('.riwi-chat-input');
  input.value='';input.setSelectionRange(0,0);input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'@',bubbles:true,cancelable:true}));assert.equal(opened,1);assert.equal(input.value,'');
  h.input(input,'Fayl @');assert.equal(opened,2);assert.equal(input.value,'Fayl ');
  h.input(input,'person@example.com');assert.equal(opened,2);
  input.setSelectionRange(6,6);input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'@',bubbles:true,cancelable:true}));assert.equal(opened,2);
  assert.equal(reads,0);assert.equal(h.calls.length,0);assert.equal(h.qa('[data-riwi-role]').length,0);
 }finally{h.dispose()}
});
