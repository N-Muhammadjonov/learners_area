import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mount} from '../modules/speaking/practice.js';
import {questionRecorder} from '../modules/speaking/ai.js';
import {mountBoard} from '../modules/vocabulary/board.js';
import {failure} from '../js/request-errors.js';
const id=ID(401);
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

for(const part of ['part1','part2','part3'])test(`${part}: each support tab requires its own hold; saving confirms source word and folder`,async t=>{
 const h=setup({path:'/app/speaking/practice?part='+part+'&topic=test',role:'student'}),parser=globalThis.DOMParser;
 globalThis.DOMParser=window.DOMParser;
 try{
  h.stub({'/api/speaking/practice/questions':{prompts:[{id,part,promptText:'Describe a place.'}]},
   '/api/vocabulary/folders':{folders:[]},
   ['/api/speaking/prompts/'+id+'/support']:{promptId:id,support:{vocabulary:[{term:'free time',definitionEn:'free time',translationUz:'bo‘sh vaqt'}],modelAnswerHtml:'<p>Source answer</p>',ideasHtml:'<p>Source ideas</p>'}},
   '/api/speaking/prompts/vocabulary':{ok:true,added:1,duplicates:0,ids:[ID(402)],folder:{id:ID(403),name:'Describe a place.'}}});
  mount(h.ctx);await tick(6);t.mock.timers.enable({apis:['setTimeout']});
  const hold=ms=>{h.q('[data-practice-reveal]').dispatchEvent(new window.MouseEvent('pointerdown',{button:0}));t.mock.timers.tick(ms);};
  hold(3000);assert(h.q('[data-practice-save=all]'));
  h.click(h.q('[data-practice-support-tab=modelAnswer]'));assert(h.q('[data-practice-reveal=modelAnswer]'));
  hold(1500);h.click(h.q('[data-practice-support-tab=ideas]'));t.mock.timers.tick(1500);assert(h.q('[data-practice-reveal=ideas]'));
  hold(3000);assert(h.q('[role=tabpanel]').textContent.includes('Source ideas'));
  h.click(h.q('[data-practice-support-tab=modelAnswer]'));assert(h.q('[data-practice-reveal=modelAnswer]'));hold(3000);
  assert(h.q('[role=tabpanel]').textContent.includes('Source answer'));
  h.click(h.q('[data-practice-support-tab=vocabulary]'));assert.equal(h.q('[data-practice-reveal]'),null);
  h.click(h.q('[data-practice-save=all]'));await flush();
  h.click(h.q('[data-practice-save-confirm]'));await flush();
  const save=h.calls.find(c=>c.method==='POST');assert.deepEqual(save.body,{promptId:id,indices:[0]});
  assert(h.q('[role=tabpanel]').textContent.includes('Describe a place.'));
 }finally{t.mock.timers.reset();h.dispose();globalThis.DOMParser=parser;}
});

for(const part of ['part1','part2','part3'])test(`${part} topic search keeps the same focused input and ignores stale results`,async()=>{
 const h=setup({path:'/app/speaking/practice?part='+part,role:'student'});let release;
 try{
  h.stub({'/api/speaking/practice/facets':path=>{const q=new URL(path,'https://fixture.invalid').searchParams.get('q');if(q==='a')return new Promise(r=>release=r);return {topics:[{key:q||'first',title:q||'First',count:1}]};}});
  mount(h.ctx);await tick(6);const input=h.q('[data-practice-search]');input.focus();h.input(input,'a');await new Promise(r=>setTimeout(r,270));
  h.input(input,'ab');await new Promise(r=>setTimeout(r,270));release({topics:[{key:'stale',title:'Stale',count:1}]});await tick();
  assert.equal(h.q('[data-practice-search]'),input);assert.equal(document.activeElement,input);assert.equal(input.value,'ab');assert.equal(h.q('[data-practice-topic]').dataset.practiceTopic,'ab');
 }finally{h.dispose();}
});

test('AI review can delete its recording and draft attempt without submitting',async()=>{
 const h=setup({role:'student'}),old={fetch:globalThis.fetch,media:globalThis.MediaRecorder,nav:Object.getOwnPropertyDescriptor(globalThis,'navigator')};let stopped=0;
 class Recorder extends window.EventTarget{static isTypeSupported(){return true;}constructor(){super();this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';const e=new window.Event('dataavailable');e.data=new Blob(['audio fixture']);this.dispatchEvent(e);this.dispatchEvent(new window.Event('stop'));}}
 globalThis.MediaRecorder=Recorder;globalThis.fetch=async()=>new Response('{}',{status:200});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})}}});
 window.HTMLMediaElement.prototype.pause=function(){};window.HTMLMediaElement.prototype.load=function(){};
 try{h.stub({'/api/speaking/attempts':{attempt:{id:ID(404)}},['/api/speaking/attempts/'+ID(404)]:{ok:true}});
  const rec=questionRecorder(h.ctx,{prompt:{id,part:'part3',promptText:'Why?',prepSeconds:0},index:1});h.ctx.root.append(rec.node);
  h.click(h.q('[data-speak-start]'));await tick(8);h.click(h.q('[data-speak-stop]'));await tick(8);assert(h.q('audio'));
  h.click(h.q('[data-speak-delete-recording]'));await tick();assert.equal(h.q('audio'),null);assert(h.q('[data-speak-start]'));assert.equal(stopped,1);
  assert(h.calls.some(c=>c.method==='DELETE'&&c.path.endsWith(ID(404))));assert(!h.calls.some(c=>c.path.endsWith('/submit')));
 }finally{globalThis.fetch=old.fetch;globalThis.MediaRecorder=old.media;if(old.nav)Object.defineProperty(globalThis,'navigator',old.nav);else delete globalThis.navigator;h.dispose();}
});

test('vocabulary ranking hides the B2 level badge',async()=>{
 const h=setup({role:'student'});try{h.stub({'/api/vocabulary/leaderboard':{points:4,rank:1,level:'B2',top:[{isMe:true,name:'Learner',level:'B2',points:4,rank:1}]}});mountBoard(h.ctx,h.ctx.root);await tick();assert(!h.ctx.root.textContent.includes('B2'));}finally{h.dispose();}
});

for(const locale of ['uz','en'])test(`${locale} membership error uses a translated instruction instead of generic unavailable`,()=>{
 const h=setup({locale});try{assert.equal(failure({status:403,code:'not_subscribed'},h.ctx.dict,{not_subscribed:h.ctx.dict.auth.telegramNotSubscribed}),h.ctx.dict.auth.telegramNotSubscribed);assert(h.ctx.dict.auth.telegramNotSubscribed.includes('Telegram'));}finally{h.dispose();}
});
