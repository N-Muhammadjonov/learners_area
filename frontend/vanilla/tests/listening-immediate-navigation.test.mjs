import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {reviewNavigationBridge} from '../modules/listening/review-navigation-v21.js';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../modules/listening/authored.js',import.meta.url),'utf8');

test('Listening navigation does not conceal an already authorized test iframe',()=>{
 assert.doesNotMatch(source,/navigationPending=\+\+navigationSequence;frame\.style\.visibility='hidden'/);
 assert.doesNotMatch(source,/navigationExpired=true;navigationPending=0;selectionClose\(\);for\(const node of protectedViews\(\)\)/);
 assert.match(source,/data-listening-navigation-retry/);
});
test('Non-Review Listening navigation keeps source interface interactive',async()=>{
 const dom=new JSDOM('<body><section id="hub"></section><section class="activity active" id="activity-exam"><button id="exam-action">Continue</button></section></body>',{runScripts:'dangerously',pretendToBeVisual:true});
 try{
  const w=dom.window;
  await new Promise(resolve=>w.addEventListener('load',resolve,{once:true}));
  w.eval('window.openActivity=function(id){document.querySelector(".activity.active")?.classList.remove("active");document.getElementById("activity-"+id)?.classList.add("active");};window.backHub=function(){};');
  w.eval(reviewNavigationBridge('owned'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data:{channel:'learners-area-review-location',token:'owned',sequence:1,activity:'exam'}}));
  assert.notEqual(w.document.body.inert,true);
  assert.notEqual(w.document.body.style.visibility,'hidden');
  assert.equal(w.document.getElementById('exam-action').disabled,false);
 }finally{dom.window.close();}
});

test('Review navigation stays gated until a matching focus acknowledgement',async()=>{
 const dom=new JSDOM('<body><section id="hub"></section><section class="activity active" id="activity-exam"></section><section id="activity-review"><button data-rpart="1">Part 1</button></section></body>',{runScripts:'dangerously',pretendToBeVisual:true});
 try{
  const w=dom.window;await new Promise(resolve=>w.addEventListener('load',resolve,{once:true}));
  const sent=[];w.postMessage=data=>sent.push(data);
  w.eval('var reviewPart=1;window.openActivity=function(id){document.querySelector(".activity.active")?.classList.remove("active");document.getElementById("activity-"+id).classList.add("active")};window.backHub=function(){}');
  w.eval(reviewNavigationBridge('owned'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const message=(token,sequence,activity)=>w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data:{channel:'learners-area-review-location',token,sequence,activity,part:1}}));
  message('foreign',1,'review');assert.equal(sent.length,0);
  message('owned',2,'review');assert.equal(w.document.body.inert,true);
  assert.equal(sent.at(-1).navigationSequence,2);
  w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data:{channel:'learners-area-review-location-focus',token:'owned',sequence:1,activity:'review',part:1}}));
  assert.equal(w.document.body.inert,true);
  w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data:{channel:'learners-area-review-location-focus',token:'owned',sequence:2,activity:'review',part:1}}));
  assert.equal(w.document.body.inert,false);
  assert.equal(sent.at(-1).navigationFocused,true);
 }finally{dom.window.close();}
});
test('Academic, General, Full Test and Review dispatch use the correct registered paths',async()=>{
 const {default:routes}=await import('../js/routes.js');
 for(const path of ['/app/listening/academic','/app/listening/general','/app/listening/tests','/app/listening/tests/:id','/app/listening/tests/:id/:activity','/app/listening/attempts/:id','/app/listening/history']){
  const route=routes.find(r=>r.pattern===path);assert(route?.protected, 'Protected Listening route missing: '+path);
 }
});
test('Retry, navigation failure and initial iframe failure do not manufacture a server 503',()=>{
 assert.match(source,/data-listening-frame-retry/);
 assert.match(source,/data-listening-navigation-retry/);
 assert.doesNotMatch(source,/navigationNotice\.textContent=recoveryText\('Navigation did not respond[^;]+checkpointFailure\(\{status:503\}\)/);
 assert.match(source,/if\(d\.op==='hub-ready'&&content&&!hubReady\)/);
});
