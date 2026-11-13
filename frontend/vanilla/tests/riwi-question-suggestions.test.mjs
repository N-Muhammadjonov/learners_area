import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick} from './staff-final30/harness.mjs';
import {mount,safeQuestionSuggestions,createRiwiWorkspaceController} from '../modules/riwi/index.js';

test('suggestions are real question buttons; choosing one sends one normal question and receives an answer',async()=>{
 const h=setup({path:'/app/riwi',role:'student',locale:'uz'});
 try{
  h.stub({'/api/riwi/chat':{ok:true,conversationId:'11111111-1111-4111-8111-111111111111',answer:'Savolni tushunmadim',questionSuggestions:[
   {id:'mcq',question:'MCQ qanday ishlaydi?'},{id:'reading',question:'Reading mashqlarini qanday bajaraman?'},{id:'grammar',question:'Grammar darslarini qanday ishlayman?'}]}});
  await mount(h.ctx);h.input(h.q('.riwi-chat-input'),'Tushunarsiz savol');h.submit(h.q('form.riwi-composer'));await tick(4);
  assert.equal(h.qa('.riwi-question-suggestion').length,3);
  h.stub({'/api/riwi/chat':{ok:true,conversationId:'11111111-1111-4111-8111-111111111111',answer:'MCQ yo‘riqnomasini o‘qing.'}});
  h.click(h.q('.riwi-question-suggestion'));await tick(4);
  const calls=h.calls.filter(x=>x.path==='/api/riwi/chat');assert.equal(calls.length,2);assert.equal(calls[1].body.message,'MCQ qanday ishlaydi?');
  assert(h.ctx.root.textContent.includes('MCQ yo‘riqnomasini o‘qing.'));
 }finally{h.dispose()}
});

test('suggestion help does not submit attached drafts or private target scope',async()=>{
 let payload;const ctrl=createRiwiWorkspaceController({role:'owner',adapter:{sendChat:async value=>(payload=value,{answer:'Help'})}});
 ctrl.state.attachments=[{name:'private.txt',kind:'txt',text:'PRIVATE',sent:false}];ctrl.state.targetUserId='private';ctrl.state.material={kind:'reading',id:'private'};
 await ctrl.sendMessage('MCQ qanday ishlaydi?',{standaloneHelp:true});
 assert(!payload.attachments&&!payload.targetUserId&&!payload.material);assert.equal(ctrl.state.attachments[0].sent,false);
 assert.deepEqual(ctrl.state.messages[0].files,[]);
 assert.deepEqual(safeQuestionSuggestions([{id:'chat',question:'/clear'},{id:'bad',question:'@file'}]),[]);
});
