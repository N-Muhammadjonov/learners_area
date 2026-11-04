import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRiwiWorkspaceController,mount,RIWI_CONVERSATION_MAX_CHARS} from '../modules/riwi/index.js';
import {setup,tick,ID} from './staff-final30/harness.mjs';

test('conversation cap counts Unicode characters and New Chat restores capacity',async()=>{
 let requests=0;const c=createRiwiWorkspaceController({adapter:{sendChat:async()=>{requests++;return {conversationId:ID(2),answer:'Ready'};}}});
 c.state.messages=[{role:'assistant',content:'🙂'.repeat(RIWI_CONVERSATION_MAX_CHARS-1),createdAt:new Date().toISOString()}];
 await assert.rejects(()=>c.sendMessage('Hi'),/conversation_limit_reached/);assert.equal(requests,0);assert(c.getChatSizing().full);
 await c.newConversation();assert(!c.getChatSizing().full);await c.sendMessage('Hi');assert.equal(requests,1);
});

test('server limit keeps the draft and New Chat remains usable without resending it',async()=>{
 const h=setup({path:'/app/riwi',role:'owner',locale:'uz'});
 try{
  h.stub({'/api/riwi/chat':()=>{const e=new Error('conversation_limit_reached');e.code=e.message;e.status=409;throw e;}});
  await mount(h.ctx);h.input(h.q('.riwi-chat-input'),'Savolim qoladi');h.submit(h.q('form'));await tick(6);
  assert.equal(h.q('.riwi-chat-input').value,'Savolim qoladi');assert(h.q('.riwi-send').disabled);
  assert(!h.q('.riwi-clear').disabled);assert(h.q('[role=alert]').textContent.includes('yangi suhbat'));
  h.click(h.q('.riwi-clear'));await tick(4);assert.equal(h.q('.riwi-chat-input').value,'Savolim qoladi');assert(!h.q('.riwi-send').disabled);
  assert.equal(h.calls.filter(x=>x.path==='/api/riwi/chat').length,1);
 }finally{h.dispose()}
});
