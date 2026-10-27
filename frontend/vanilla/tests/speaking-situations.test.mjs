import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setup,tick} from './staff-final30/harness.mjs';
import {mount as practice} from '../modules/speaking/practice.js';
import {mountSituations,createSituationSupport} from '../modules/speaking/situations.js';
import shopping from '../modules/speaking/situations-shopping.js';

test('all 16 source stories retain their images, 177 vocabulary entries and full sample answers',()=>{
 assert.equal(shopping.title,'SHOPPING');
 assert.equal(shopping.source.sha256,'5055c5cb5ebe9baf8d26538bd444500ad568e19c8c04f436e904536d8b539697');
 assert.deepEqual(shopping.stories.map(s=>s.number),Array.from({length:16},(_,i)=>i+1));
 assert.equal(shopping.stories.reduce((n,s)=>n+s.vocabulary.length,0),177);
 for(const s of shopping.stories){
  assert.equal(s.id,`shopping-${String(s.number).padStart(2,'0')}`);
  assert(s.title&&s.instruction&&s.sampleAnswer.every(p=>p.length>500));
  assert(s.vocabulary.every(w=>w.term&&w.translationUz));
  const bytes=readFileSync(new URL('..'+s.image,import.meta.url));
  assert.equal(bytes[0],255);assert.equal(bytes[1],216);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),s.imageSha256);
 }
});
test('Explain situations is a fourth choice and stays available if IELTS facets fail',async()=>{
 const h=setup({path:'/app/speaking/practice',role:'student'});
 try{h.stub({});practice(h.ctx);await tick();
  assert.deepEqual(h.qa('[data-practice-part]').map(n=>n.dataset.practicePart),['part1','part2','part3','situations']);
  h.click(h.q('[data-practice-part=situations]'));assert.equal(h.nav[0].path,'/app/speaking/practice?part=situations');
 }finally{h.dispose();}
});
for(const locale of ['en','uz'])test(`${locale}: SHOPPING keeps every story selectable with picture, two tabs and recorder`,async()=>{
 const h=setup({locale,path:'/app/speaking/practice?part=situations&topic=shopping',role:'student'});
 try{await practice(h.ctx);
  assert.equal(h.qa('select option').length,16);
  for(const s of shopping.stories){
   h.change(h.q('select'),s.id);
   assert.equal(h.q('[data-situation-picture] img').getAttribute('src'),s.image);
   assert(h.q('[data-situation-picture]').textContent.includes(s.title));
   assert(h.q(`[data-local-recorder="${s.id}"]`));
   assert.deepEqual(h.qa('[data-situation-tab]').map(b=>b.dataset.situationTab),['vocabulary','sample']);
   assert(h.q('[data-situation-reveal]'));
   assert.equal(h.q('[data-situation-vocabulary],[data-situation-sample]'),null);
  }
  assert.equal(h.calls.length,0,'static owner-provided topic needs no question-bank or write API');
  h.click(h.q('[data-situation-back=topics]'));assert.equal(h.nav.at(-1).path,'/app/speaking/practice?part=situations');
 }finally{h.dispose();}
});
test('each section needs its own continuous three-second hold; cancellation and tab change reset it',t=>{
 const h=setup(),s=shopping.stories[0];
 t.mock.timers.enable({apis:['setTimeout']});
 const event=(node,type,attrs={})=>node.dispatchEvent(new window.MouseEvent(type,{bubbles:true,button:0,...attrs}));
 try{
  const panel=createSituationSupport({story:s,dict:h.ctx.dict,locale:'en',signal:h.ctx.signal});h.ctx.root.append(panel.node);
  let trigger=h.q('[data-situation-reveal]');event(trigger,'pointerdown');t.mock.timers.tick(2999);assert.equal(h.q('[data-situation-vocabulary]'),null);
  event(trigger,'pointerup');t.mock.timers.tick(100);assert(h.q('[data-situation-reveal]'));
  event(trigger,'pointerdown');t.mock.timers.tick(1500);h.click(h.q('[data-situation-tab=sample]'));t.mock.timers.tick(1500);assert.equal(h.q('[data-situation-sample]'),null);
  trigger=h.q('[data-situation-reveal]');event(trigger,'pointerdown');t.mock.timers.tick(2999);assert.equal(h.q('[data-situation-sample]'),null);t.mock.timers.tick(1);
  assert.deepEqual(h.qa('[data-situation-sample]').map(p=>p.textContent),s.sampleAnswer);
  h.click(h.q('[data-situation-tab=vocabulary]'));
  assert(h.q('[data-situation-reveal]'),'revealing sample does not reveal vocabulary');
  event(h.q('[data-situation-reveal]'),'pointerdown');t.mock.timers.tick(3000);
  assert.deepEqual(h.qa('dt').map(n=>n.textContent),s.vocabulary.map(w=>w.term));
  assert.deepEqual(h.qa('dd').map(n=>n.textContent),s.vocabulary.map(w=>w.translationUz));
 }finally{h.dispose();t.mock.timers.reset();}
});
test('keyboard holds cancel on release, page hide and route exit',t=>{
 const h=setup();t.mock.timers.enable({apis:['setTimeout']});
 try{
  h.ctx.root.append(createSituationSupport({story:shopping.stories[1],dict:h.ctx.dict,locale:'uz',signal:h.ctx.signal}).node);
  const trigger=h.q('[data-situation-reveal]'),key=type=>trigger.dispatchEvent(new window.KeyboardEvent(type,{key:' ',bubbles:true,cancelable:true}));
  key('keydown');t.mock.timers.tick(2000);key('keyup');t.mock.timers.tick(2000);assert(h.q('[data-situation-reveal]'));
  key('keydown');Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new window.Event('visibilitychange'));t.mock.timers.tick(3000);assert(h.q('[data-situation-reveal]'));
  key('keydown');h.controller.abort();t.mock.timers.tick(3000);assert.equal(h.q('[data-situation-vocabulary]'),null);
 }finally{h.dispose();t.mock.timers.reset();}
});
test('topic selection and unknown topic preserve a usable path back',async()=>{
 const h=setup({path:'/app/speaking/practice?part=situations'});
 try{
  await mountSituations(h.ctx);assert.equal(h.q('[data-situation-topic]').textContent,'SHOPPING16 picture stories');
  h.click(h.q('[data-situation-topic]'));assert.equal(h.nav.at(-1).path,'/app/speaking/practice?part=situations&topic=shopping');
  h.ctx.root.replaceChildren();h.ctx.url=new URL('https://fixture.invalid/app/speaking/practice?part=situations&topic=missing');await mountSituations(h.ctx);
  assert(h.q('[role=alert]'));assert.equal(h.q('img'),null);h.click(h.q('[data-situation-back=parts]'));assert.equal(h.nav.at(-1).path,'/app/speaking/practice');
 }finally{h.dispose();}
});
test('the existing recorder captures a two-minute story, blocks switching and releases microphone tracks',async t=>{
 const h=setup({path:'/app/speaking/practice?part=situations&topic=shopping',role:'student'});
 const old={fetch:globalThis.fetch,media:globalThis.MediaRecorder,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
 let stopped=0,captures=0;
 class Recorder extends window.EventTarget{
  static isTypeSupported(){return true;}
  constructor(){super();this.state='inactive';this.mimeType='audio/webm';}
  start(){this.state='recording';captures++;}
  stop(){this.state='inactive';const e=new window.Event('dataavailable');e.data=new Blob(['real fixture audio boundary']);this.dispatchEvent(e);this.dispatchEvent(new window.Event('stop'));}
 }
 globalThis.MediaRecorder=Recorder;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})}}});
 globalThis.fetch=async()=>new Response('{}',{status:200});
 window.HTMLMediaElement.prototype.load=function(){};window.HTMLMediaElement.prototype.pause=function(){};
 try{
  await practice(h.ctx);h.click(h.q('[data-local-recorder] button'));await tick(8);
  assert.equal(captures,1);assert.equal(h.q('select').disabled,true);assert.equal(h.q('[data-situation-back=parts]').disabled,true);
  assert(h.q('[data-record-count]').textContent.includes('/ 2:00'));
  h.change(h.q('select'),'shopping-02');assert.equal(h.q('[data-situation-columns]').dataset.story,'shopping-01');
  const stop=[...h.q('[data-local-recorder]').querySelectorAll('button')].find(b=>b.textContent.includes(h.ctx.dict.speakingStudy.stop));h.click(stop);await tick(8);
  assert.equal(stopped,1);assert.equal(h.q('select').disabled,false);assert(h.q('[data-local-recorder] audio'));
  h.change(h.q('select'),'shopping-02');assert.equal(h.q('[data-situation-columns]').dataset.story,'shopping-02');assert(h.q('[data-situation-reveal]'));
  h.click(h.q('[data-local-recorder] button'));await tick(8);assert.equal(captures,2);h.controller.abort();assert.equal(stopped,2);
 }finally{globalThis.fetch=old.fetch;globalThis.MediaRecorder=old.media;if(old.navigator)Object.defineProperty(globalThis,'navigator',old.navigator);else delete globalThis.navigator;h.dispose();}
});
