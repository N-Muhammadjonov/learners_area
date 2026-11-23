import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './staff-final30/harness.mjs';
import {microphoneTest} from '../modules/speaking/microphone.js';

test('aborting an idle microphone closes cleanly without an animation frame API',()=>{
 const h=setup({role:'student'});
 const previous=Object.getOwnPropertyDescriptor(globalThis,'cancelAnimationFrame');
 try{
  if(!previous||previous.configurable)delete globalThis.cancelAnimationFrame;
  const panel=microphoneTest({dict:h.ctx.dict,signal:h.controller.signal});
  h.ctx.root.append(panel);
  assert(panel.querySelector('button'));
  assert.doesNotThrow(()=>h.controller.abort());
  assert.equal(panel.querySelector('button').disabled,false);
 }finally{
  if(previous)Object.defineProperty(globalThis,'cancelAnimationFrame',previous);
  else delete globalThis.cancelAnimationFrame;
  h.dispose();
 }
});
