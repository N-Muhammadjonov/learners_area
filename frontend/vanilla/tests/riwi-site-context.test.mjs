import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,ID} from './staff-final30/harness.mjs';
import {captureSiteSurface,rememberSiteSurface,siteContext,siteQuestion} from '../js/riwi-site-context.js';
import {privateScope} from '../js/private-scope.js';
import {createRiwiWorkspaceController} from '../modules/riwi/index.js';
import {h as element} from '../js/native.js';
import {listen} from '../js/dom.js';
import {createRouter,compilePattern} from '../js/router.js';

test('surface capture excludes values, transcripts, private IDs and cross-origin destinations',()=>{
 const h=setup({path:'/app/reading/academic/123?token=private',role:'owner',theme:'night'});
 try{
  document.documentElement.dataset.theme='night';
  h.ctx.root.innerHTML='<a href="/app">Main</a><button>Start</button><a href="https://other.invalid">External</a><textarea>private draft</textarea><input type="search" aria-label="Search" value="private query"><div class="riwi-transcript"><button>private conversation text</button></div>';
  h.dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:90,height:30,left:12,top:10,bottom:40});
  const c=captureSiteSurface(document,window);
  assert.equal(c.path,'/app/reading/academic/:setId');assert.equal(c.theme,'night');
  assert(c.controls.some(x=>x.label==='Main'&&x.href==='/app'&&x.zone==='top-left'));
  const text=JSON.stringify(c);assert(!text.includes('private'));assert(!text.includes('123'));assert(!text.includes('other.invalid'));
 }finally{h.dispose()}
});

test('previous visible page survives SPA navigation but is cleared on identity invalidation',()=>{
 const h=setup({path:'/app/reading/lessons',role:'owner'});
 try{
  privateScope.setScope(ID(1));h.ctx.root.innerHTML='<a href="/app">Main</a>';
  h.q('a').getBoundingClientRect=()=>({width:90,height:30,left:12,top:10,bottom:40});
  window.history.pushState({},'', '/app/riwi');
  rememberSiteSurface(h.ctx.root,window,'/app/reading/lessons');
  assert(siteContext(document,window).some(x=>x.path==='/app/reading/lessons'));
  privateScope.clear('authority-change');
  assert(!siteContext(document,window).some(x=>x.path==='/app/reading/lessons'));
 }finally{h.dispose()}
});

test('only unscoped site questions carry observations; normal tutoring and files keep their contracts',async()=>{
 const calls=[],ctrl=createRiwiWorkspaceController({role:'owner',readSiteContext:()=>[{path:'/app/riwi',theme:'day',controls:[]}],adapter:{sendChat:async body=>{calls.push(body);return {conversationId:ID(2),answer:'Help',citations:[]};}}});
 await ctrl.sendMessage('Main tugmasi nima qiladi?');assert(calls[0].siteContext);
 await ctrl.sendMessage('Present perfectni tushuntir');assert(!calls[1].siteContext);
 ctrl.state.attachments=[{name:'file.txt',kind:'txt',text:'A useful lesson.'}];
 await ctrl.sendMessage('Faylni yuklash tugmasi');assert(!calls[2].siteContext);assert(calls[2].attachments);
 assert(siteQuestion('Saytni search qilish tugmasi'));assert(!siteQuestion('Past simple misollar ber'));
});

test('Owner action metadata reports static handler source without running code or exposing closure values',()=>{
 const h=setup({path:'/app/riwi',role:'owner'});
 try{
  const closureSecret='PRIVATE_RUNTIME_VALUE';let invoked=false;
  const b=element('button',{type:'button',onClick:()=>{invoked=true;return closureSecret;}},'Synthetic action');
  h.ctx.root.append(b);b.getBoundingClientRect=()=>({width:90,height:30,left:12,top:10,bottom:40});
  const form=document.createElement('form'),submit=document.createElement('button');submit.type='submit';form.append(submit);h.ctx.root.append(form);
  listen(form,'submit',()=>{invoked=true;});
  const owner=captureSiteSurface(document,window,undefined,true);
  assert(owner.controls[0].action.includes('closureSecret'));assert(!JSON.stringify(owner).includes(closureSecret));assert(!invoked);
  assert(!captureSiteSurface(document,window).controls[0].action);
 }finally{h.dispose()}
});

test('navigation observes the outgoing page before abort removes its controls',async()=>{
 const h=setup({path:'/app/reading/lessons',role:'owner'}),seen=[];
 const routes=['/app/reading/lessons','/app/riwi'].map(pattern=>({pattern,match:compilePattern(pattern),load:async()=>({mount:({root,signal})=>{const node=document.createElement('button');node.textContent=pattern;root.append(node);signal.addEventListener('abort',()=>node.remove());}})}));
 const router=createRouter({root:h.ctx.root,window,routes,onBeforeNavigate:context=>{if(context)seen.push({path:context.url.pathname,text:h.ctx.root.textContent});},onError:e=>{throw e;}});
 try{await router.start();await router.go('/app/riwi');assert.deepEqual(seen,[{path:'/app/reading/lessons',text:'/app/reading/lessons'}]);}
 finally{router.destroy();h.dispose()}
});

test('module questions recognize mixed Uzbek/English and show safe clickable section links',async()=>{
 const h=setup({path:'/app/riwi',role:'owner',locale:'uz'});
 try{
  assert(siteQuestion('Vocabulary tizimi qanday ishlaydi?'));assert(siteQuestion('How does Vocabulary work?'));
  assert(!siteQuestion('Readingda true false qanday yechiladi?'));
  h.stub({'/api/riwi/chat':{ok:true,conversationId:ID(2),answer:'Vocabulary izohi.',navigationLinks:[
   {href:'/app/vocabulary',label:'Vocabulary'}, {href:'javascript:alert(1)',label:'Unsafe'},
   {href:'https://outside.invalid/app',label:'Outside'}, {href:'/api/secrets',label:'Private endpoint'},
   {href:'/app/vocabulary/games',label:'Vocabulary · Games'}]}});
  const {mount}=await import('../modules/riwi/index.js');await mount(h.ctx);
  h.input(h.q('.riwi-chat-input'),'Vocabulary tizimi qanday ishlaydi?');h.submit(h.q('form'));await new Promise(r=>setTimeout(r,20));
  assert.deepEqual(h.qa('.riwi-navigation a').map(x=>[x.textContent,x.getAttribute('href')]),[
   ['Vocabulary','/app/vocabulary'],['Vocabulary · Games','/app/vocabulary/games']]);
  assert(!h.q('.riwi-msg--assistant').textContent.includes('/app/'));assert(!h.q('.riwi-msg--assistant').textContent.includes('Unsafe'));
 }finally{h.dispose()}
});

test('a previously sent image cannot hijack a later module question, but remains available for file followups',async()=>{
 const calls=[],ctrl=createRiwiWorkspaceController({role:'owner',readSiteContext:()=>[{path:'/app/riwi',theme:'day',controls:[]}],adapter:{sendChat:async body=>{calls.push(body);return {conversationId:ID(2),answer:'Answer'};}}});
 ctrl.state.attachments=[{name:'image.png',kind:'image',text:'',sent:true,sentAt:new Date().toISOString()}];
 await ctrl.sendMessage('Vocabulary tizimi qanday ishlaydi?');assert(calls[0].siteContext);assert(!calls[0].attachments);
 await ctrl.sendMessage('Rasmdagi yozuvni tushuntir');assert(calls[1].attachments);assert(!calls[1].siteContext);
});
