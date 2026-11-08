import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {activityBack,authoredHeader} from '../modules/listening/authored-ui.js';
import {reviewNavigationBridge} from '../modules/listening/review-navigation-v21.js';
import {studyFocus,supportsStudyFocus} from '../modules/shell/study-focus.js';
import {returnPolicy} from '../modules/campus/return-policy.js';

const root='https://learnersarea.uz',id='11111111-1111-4111-8111-111111111111';
test('Focus follows the actual topbar Back policy and its shortcut cannot enable it on a test',()=>{
 const dom=new JSDOM('<main></main>',{url:root});globalThis.document=dom.window.document;
 const abort=new AbortController(),focus=studyFocus({signal:abort.signal});
 try{
  for(const path of ['/app/listening/tests/'+id,'/app/listening/tests/'+id+'/mcq','/app/reading/attempts/'+id,'/app/video-lessons/'+id]){
   const u=new URL(path,root);assert.equal(returnPolicy(u).mode,'back');assert.equal(supportsStudyFocus(u),false);
   focus.update(u);focus.toggle();assert.equal(focus.on,false);
   document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'f',bubbles:true}));assert.equal(document.documentElement.dataset.studyFocus,'off');
  }
  focus.update(new URL('/app/listening/tests',root));focus.toggle();assert.equal(focus.on,true);
  focus.update(new URL('/app/listening/tests/'+id,root));assert.equal(focus.on,false);
 }finally{abort.abort();dom.window.close();}
});

test('topbar Back returns only the active exercise, preserves modified clicks and releases its route listener',()=>{
 const dom=new JSDOM('<a href="/app/listening/tests" data-campus-back-link>Back</a><section id="host"></section>',{url:root});globalThis.document=dom.window.document;
 const abort=new AbortController(),a=document.querySelector('a'),host=document.getElementById('host');let active=true,called=0;
 activityBack({host,signal:abort.signal,active:()=>active,back:()=>called++});
 const click=(options={})=>{const event=new dom.window.MouseEvent('click',{bubbles:true,cancelable:true,button:0,...options});a.dispatchEvent(event);return event;};
 // Keep jsdom from following real fallback links after this assertion helper.
 a.addEventListener('click',e=>e.preventDefault());
 try{assert.equal(click().defaultPrevented,true);assert.equal(called,1);click({ctrlKey:true});assert.equal(called,1);active=false;click();assert.equal(called,1);active=true;abort.abort();click();assert.equal(called,1);}finally{dom.window.close();}
});

test('source Back keeps exit confirmation, returns to the hub and restores the chosen card and scroll',async()=>{
 const dom=new JSDOM('<section id="hub"><button data-open="mcq">MCQ</button></section><section class="activity" id="activity-mcq"></section>',{runScripts:'outside-only',pretendToBeVisual:true,url:root});const w=dom.window;
 await new Promise(r=>w.addEventListener('load',r,{once:true}));let y=340;Object.defineProperty(w,'scrollY',{get:()=>y});w.scrollTo=(x,next)=>y=next;const sent=[];w.postMessage=data=>sent.push(data);
 w.eval("var exitConfirmed=false,exits=0;window.openActivity=function(id){document.getElementById('hub').hidden=true;document.getElementById('activity-'+id).classList.add('active');scrollTo(0,0)};window.backHub=function(){if(!exitConfirmed)return;exits++;document.querySelector('.activity.active').classList.remove('active');document.getElementById('hub').hidden=false;scrollTo(0,0)};");
 w.eval(reviewNavigationBridge('own'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 const back=token=>w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data:{channel:'learners-area-activity-back',token}}));
 try{
  w.openActivity('mcq');back('foreign');assert.equal(w.exits,0);back('own');assert.equal(w.exits,0);assert(w.document.getElementById('hub').hidden);
  w.exitConfirmed=true;back('own');await new Promise(r=>w.requestAnimationFrame(r));
  assert.equal(w.exits,1);assert.equal(w.document.getElementById('hub').hidden,false);assert.equal(y,340);
  assert.equal(w.document.activeElement.dataset.open,'mcq');assert.equal(sent.at(-1).navigation.activity,'hub');
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});

test('exam header moves the original Telegram brand left and removes IELTS and test-taker labels',async()=>{
 const dom=new JSDOM('<header class="exam-header"><div><div class="exam-logo">IELTS</div><div class="test-id">Listening Test 1 · Test taker ID</div></div><div class="exam-right"><a class="exam-telegram-brand" href="https://t.me/LEARNERS_AREA">Learners Area<svg></svg></a><span id="timer">27:25</span></div></header>',{runScripts:'outside-only'});const w=dom.window;
 await new Promise(r=>w.addEventListener('load',r,{once:true}));
 try{const brand=w.document.querySelector('a');w.eval(authoredHeader());w.document.dispatchEvent(new w.Event('DOMContentLoaded'));assert.equal(w.document.querySelector('.exam-header').firstElementChild,brand);assert.equal(w.document.querySelector('.exam-logo,.test-id'),null);assert(w.document.querySelector('#timer'));assert(brand.querySelector('svg'));}finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
