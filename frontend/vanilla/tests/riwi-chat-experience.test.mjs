import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mount,createRiwiWorkspaceController} from '../modules/riwi/index.js';
import {RIWI_I18N} from '../js/i18n/riwi_i18n.js';

test('native page loads chat styles after the shared campus palette',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(x=>x[1]);
 assert(styles.includes('/css/riwi.css'));
 assert(styles.indexOf('/css/riwi.css')>styles.indexOf('/css/campus.css'));
});

test('pending chat prevents duplicate sends and renders safe multiline replies without source branding',async()=>{
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
  assert.equal(h.q('.riwi-sources'),null);
  assert(!h.ctx.root.textContent.includes('Tasdiqlangan misollar'));
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

test('slash commands reset context, preserve reply language and never delete or send control commands',async()=>{
 const calls=[];let count=0;
 const c=createRiwiWorkspaceController({locale:'uz',role:'owner',adapter:{
  sendChat:async payload=>{calls.push(payload);return {conversationId:ID(++count),answer:'Approved lesson'};},
  deleteConversation:async()=>{throw Error('control commands must not delete records');}
 }});
 await c.sendMessage('Present perfect');const first=c.state.conversationId;
 await c.sendMessage('/ language eng');assert.equal(c.state.replyLocale,'en');assert.equal(c.state.locale,'uz');
 await c.sendMessage('/examples');assert.equal(calls[1].conversationId,first);assert.equal(calls[1].replyLocale,'en');assert(calls[1].message.includes('three more examples'));
 await c.sendMessage('/clear');assert.equal(c.state.conversationId,null);assert.equal(c.state.messages.length,1);assert(!c.state.messages[0].content.includes('Approved lesson'));
 await c.sendMessage('/examples');assert.equal(calls.length,2);assert(c.state.messages.at(-1).content.includes('first'));
 await c.sendMessage('Articles');assert.equal(calls[2].conversationId,undefined);assert.equal(calls[2].replyLocale,'en');
 await c.sendMessage('/new chat');assert.equal(c.state.conversationId,null);assert.equal(c.state.replyLocale,'en');
 await c.sendMessage('/ language uz');assert.equal(c.state.replyLocale,'uz');
 await c.sendMessage('/language ru');assert.equal(c.state.replyLocale,'uz');assert.equal(c.state.messages.at(-1).localActions.length,2);
 await c.sendMessage('/clear extra');assert(c.state.messages.at(-1).content.includes('/help'));
 await c.sendMessage('/help');assert(c.state.messages.at(-1).content.includes('/new chat'));
 assert.equal(calls.length,3);
 assert.deepEqual(Object.keys(RIWI_I18N.en).sort(),Object.keys(RIWI_I18N.uz).sort());
});

test('language chooser and command menu work in the mounted chat while the site locale stays Uzbek',async()=>{
 const h=setup({path:'/app/riwi',role:'owner',locale:'uz'});
 try{
  h.stub({'/api/riwi/chat':{ok:true,conversationId:ID(9),answer:'English explanation',citations:[]}});
  await mount(h.ctx);
  h.click(h.q('.riwi-reply-language'));await tick(3);
  h.click(h.qa('.riwi-command-actions button').find(x=>x.textContent==='English'));await tick(3);
  assert(h.q('.riwi-reply-language').textContent.endsWith('EN'));
  assert(h.q('h1').textContent==='RIWI');assert(h.q('textarea').getAttribute('placeholder').includes('yozing'));
  h.input(h.q('textarea'),'Explain articles');h.submit(h.q('form'));await tick(5);
  const call=h.calls.find(x=>x.path==='/api/riwi/chat');assert.equal(call.body.replyLocale,'en');
  h.click(h.qa('.riwi-command-menu button').find(x=>x.textContent==='/clear'));await tick(3);
  assert(!h.ctx.root.textContent.includes('English explanation'));assert(h.ctx.root.textContent.includes('Chat cleared'));
  assert.equal(h.calls.filter(x=>x.method==='DELETE').length,0);
 }finally{h.dispose()}
});

test('material picker sends only its scoped reference and clear forgets the material',async()=>{
 const h=setup({path:'/app/riwi',role:'owner',locale:'uz'});
 try{
  h.stub({'/api/riwi/materials*':{items:[{id:ID(21),kind:'reading',title:'Source <img src=x>'}],hasMore:false},
   '/api/riwi/chat':{ok:true,conversationId:ID(22),answer:'Source-backed study',citations:[]}});
  await mount(h.ctx);
  h.click(h.q('.riwi-material-picker button'));await tick(6);
  assert(h.q('.riwi-material-picker select[aria-label="Topilgan materiallar"]'));
  const use=h.qa('.riwi-material-picker button').find(b=>b.textContent==='Shu material bilan ishlash');
  h.click(use);await tick(2);
  assert(h.q('.riwi-material-selected').textContent.includes('Source <img src=x>'));
  assert.equal(h.q('.riwi-material-picker img'),null);
  h.input(h.q('textarea'),'Mavzuni tushuntir');h.submit(h.q('form'));await tick(6);
  const sent=h.calls.find(x=>x.path==='/api/riwi/chat');
  assert.deepEqual(sent.body.material,{kind:'reading',id:ID(21)});
  assert.equal(sent.body.conversationId,undefined);
  h.input(h.q('textarea'),'/clear');h.submit(h.q('form'));await tick(3);
  assert(h.q('.riwi-material-selected').hidden);
  h.input(h.q('textarea'),'Explain articles');h.submit(h.q('form'));await tick(6);
  const next=h.calls.filter(x=>x.path==='/api/riwi/chat')[1];
  assert.equal(next.body.material,undefined);assert.equal(next.body.conversationId,undefined);
 }finally{h.dispose()}
});
