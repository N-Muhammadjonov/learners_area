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
