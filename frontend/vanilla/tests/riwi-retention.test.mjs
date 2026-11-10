import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRiwiWorkspaceController,mount,RIWI_MESSAGE_TTL_MS} from '../modules/riwi/index.js';
import {setup,tick,ID} from './staff-final30/harness.mjs';
const START=Date.parse('2026-11-01T22:00:00Z');

test('active messages and extracted attachment context expire individually at exactly seven days',async()=>{
 let now=START;const c=createRiwiWorkspaceController({now:()=>now,adapter:{sendChat:async()=>({conversationId:ID(2),answer:'Answer'})}});
 c.state.attachments=[{name:'old.txt',kind:'txt',text:'Old text'}];await c.sendMessage('Old question');
 now+=6*86400000;await c.sendMessage('Recent question');
 now=START+RIWI_MESSAGE_TTL_MS-1;assert(!c.expireMessages());assert.equal(c.state.messages.length,4);
 now++;assert(c.expireMessages());assert.equal(c.state.messages.length,3);assert.equal(c.state.messages[0].role,'assistant');assert.equal(c.state.attachments.length,0);
 now++;c.expireMessages();assert.equal(c.state.messages.length,2);assert.equal(c.state.messages[0].content,'Recent question');assert.equal(c.state.conversationId,ID(2));
});

test('New Chat archives only the old ID; old deadlines do not delete the new current conversation',async()=>{
 let now=START,n=1;const archived=[],c=createRiwiWorkspaceController({now:()=>now,adapter:{sendChat:async()=>({conversationId:ID(n++),answer:'Answer'}),archiveConversation:async id=>archived.push(id)}});
 await c.sendMessage('Old');const old=c.state.conversationId;now+=2*86400000;await c.newConversation();assert.deepEqual(archived,[old]);await c.sendMessage('New');
 const fresh=c.state.conversationId;now=START+RIWI_MESSAGE_TTL_MS;c.expireMessages();assert.equal(c.state.messages.length,2);assert.equal(c.state.messages[0].content,'New');assert.equal(c.state.conversationId,fresh);
});

test('returning to a long-open chat hides expired bubbles and clears their context',async()=>{
 const h=setup({path:'/app/riwi',role:'owner',locale:'uz'});let now=START;
 try{
  h.stub({'/api/riwi/chat':{ok:true,conversationId:ID(2),answer:'Old answer'}});await mount(h.ctx,{now:()=>now});
  h.input(h.q('.riwi-chat-input'),'Old question');h.submit(h.q('form'));await tick(7);assert.equal(h.qa('[data-riwi-role]').length,2);
  now=START+RIWI_MESSAGE_TTL_MS+1;document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(h.qa('[data-riwi-role]').length,0);assert(h.q('.riwi-welcome'));
 }finally{h.dispose()}
});
