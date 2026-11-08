import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {originalExamWorkflow} from '../modules/listening/original-exam-v13.js';

async function fixture(){
 const dom=new JSDOM('<button id="startTestBtn">Start Test</button><audio id="sharedAudio"></audio><div id="examQuestionHost"></div><div id="examStatus"></div><div id="timerDisplay">100</div>',{runScripts:'outside-only',url:'https://learnersarea.uz'}),w=dom.window;
 await new Promise(r=>w.addEventListener('load',r,{once:true}));
 let resolve,reject,plays=0,clock=100000;
 w.HTMLMediaElement.prototype.play=function(){plays++;return new Promise((yes,no)=>{resolve=yes;reject=no;});};
 w.HTMLMediaElement.prototype.pause=function(){};w.Date.now=()=>clock;
 w.eval(`var state={examStarted:false,submitted:false,currentQ:1,examRemaining:100,reviewPhase:false},timerStarts=0,startCalls=0,STORAGE_KEY='k',laAttemptKey='own';
 function getStored(){return {attemptKey:'own'};}function saveStored(){}
 function beginExamTimer(){timerStarts++;}function tickExam(){}function submitExam(){}function snapshotAttempt(){}
 function startExam(){startCalls++;state.examStarted=true;state.examRemaining=100;window.laStartExamAudio(document.getElementById('sharedAudio'));}
 function focusQuestion(){}function renderExamPart(){}function updateNav(){}function restoreExamInputs(){}
 function showModal(){}function closeModal(){}function toast(){}function fmt(n){return String(Math.ceil(n));}
 var $=s=>document.querySelector(s);`);
 w.eval(originalExamWorkflow());w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 return {w,resolve:()=>resolve(),reject:()=>reject(Error('Network unavailable')),plays:()=>plays,advance:ms=>clock+=ms,
 close:()=>{w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}
const turn=()=>new Promise(r=>setImmediate(r));

test('timer begins with successful audio playback and never while audio is pending',async()=>{
 const f=await fixture(),{w}=f;
 try{
  w.document.getElementById('startTestBtn').click();assert.equal(w.timerStarts,0);assert.equal(w.document.getElementById('examStatus').textContent,'Loading audio…');
  f.resolve();await turn();assert.equal(w.timerStarts,1);assert.equal(w.document.getElementById('examStatus').textContent,'Audio plays once');
  f.advance(1200);w.tickExam();assert(w.state.examRemaining<100);assert.notEqual(w.document.getElementById('timerDisplay').textContent,'100');
 }finally{f.close();}
});

test('audio failure has a working retry that starts the same attempt and its timer',async()=>{
 const f=await fixture(),{w}=f;
 try{
  w.document.getElementById('startTestBtn').click();f.reject();await turn();
  assert.equal(w.timerStarts,0);assert.equal(w.startCalls,1);
  const retry=w.document.querySelector('#examStatus button');assert(retry);assert.equal(retry.textContent,'Retry audio');
  retry.click();assert.equal(f.plays(),2);f.resolve();await turn();
  assert.equal(w.timerStarts,1);assert.equal(w.startCalls,1);assert.equal(w.laAttemptKey,'own');
 }finally{f.close();}
});

test('leaving a pending exam prevents late audio completion from starting its timer',async()=>{
 const f=await fixture(),{w}=f;
 try{
  w.document.getElementById('startTestBtn').click();w.dispatchEvent(new w.Event('pagehide'));f.resolve();await turn();assert.equal(w.timerStarts,0);
 }finally{w.close();}
});
