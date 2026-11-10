import test from 'node:test';import assert from 'node:assert/strict';
import {setup,ID} from './staff-final30/harness.mjs';
import {listeningExam} from '../modules/listening/exam.js';
const fixture=()=>({attemptId:ID(88),testId:ID(1),title:'Synthetic listening',audioUrl:'/api/resources/synthetic.wav',imageUrl:null,questions:[{id:ID(87),number:1,section:1,text:'Synthetic question',instruction:'Choose',options:['A one','B two'],input:'select'}],initial:{},audioPosition:0,audioStartedAt:null,duration:60});
function media(h){window.HTMLMediaElement.prototype.pause=function(){};window.HTMLMediaElement.prototype.load=function(){};h.stub({'/api/listening/attempts/':{}});}
test('notes and section layout changes never detach or reconstruct the playing audio',()=>{
 const h=setup();media(h);try{window.HTMLMediaElement.prototype.play=function(){return Promise.resolve();};const host=listeningExam(h.ctx,{...fixture(),sectionMode:true});h.ctx.root.append(host);const audio=host.querySelector('audio'),observer=new window.MutationObserver(()=>{});observer.observe(host,{childList:true,subtree:true});
 h.click([...host.querySelectorAll('button')].find(n=>n.textContent===h.ctx.dict.fullListeningHub.examScreen.noteTaking));
 const records=observer.takeRecords();assert.equal(records.flatMap(r=>[...r.removedNodes]).filter(n=>n===audio).length,0);assert.equal(host.querySelector('audio'),audio);assert.equal(host.querySelectorAll('audio').length,1);observer.disconnect();
 }finally{h.dispose();}
});
test('pending play is single-flight and successful full-exam playback hides the recovery CTA',async()=>{
 const h=setup();media(h);try{let resolve,calls=0;window.HTMLMediaElement.prototype.play=function(){calls++;return new Promise(r=>resolve=r);};const host=listeningExam(h.ctx,fixture());h.ctx.root.append(host);const start=host.querySelector('[data-listening-start-audio]');h.click(start);h.click(start);assert.equal(calls,1);assert.equal(start.getAttribute('aria-busy'),'true');resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(start.hidden,true);host.querySelector('audio').dispatchEvent(new window.Event('pause'));assert.equal(start.hidden,false);
 }finally{h.dispose();}
});
test('autoplay rejection keeps an enabled labelled recovery control without claiming playback',async()=>{
 const h=setup();media(h);try{window.HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException('Synthetic autoplay denial','NotAllowedError'));};const host=listeningExam(h.ctx,fixture());h.ctx.root.append(host);await Promise.resolve();await Promise.resolve();await Promise.resolve();const b=host.querySelector('[data-listening-start-audio]');assert(!b.hidden);assert(!b.disabled);assert(host.querySelector('[data-listening-error]'));assert.notEqual(host.dataset.listeningPlayback,'playing');
 }finally{h.dispose();}
});

test('authored Listening shell uses one audio node and restores a part answer and flag',async()=>{
 const h=setup({theme:'night'});media(h);
 const initialStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:window.localStorage});
 try{
  let plays=0;window.HTMLMediaElement.prototype.play=function(){plays++;return Promise.resolve();};
  const questions=Array.from({length:40},(_,i)=>({id:ID(i+100),number:i+1,section:Math.ceil((i+1)/10),text:'Question '+(i+1),instruction:'',options:[],input:'text'}));
  const cdExam={
   shell:`<div id="examRoot"><div id="loadingScreen"></div><div id="startScreen"><button id="startTestBtn">Start Test</button></div>
    <div id="examInterface"><div class="exam-header"><div id="examStatus"></div><div id="timerDisplay"></div><input id="volumeSlider" type="range">
    <button id="flagBtn"></button><button id="notesBtn"></button><button id="fullscreenBtn"></button><button id="optionsBtn"></button></div>
    <h1 id="examPartTitle"></h1><p id="examPartDesc"></p><main id="examQuestionHost"></main><button id="submitTest"></button>
    <div id="bottomNav"></div><button id="highlightBtn"></button><button id="removeHighlightBtn"></button></div>
    <div id="noteModal" class="hidden"><span id="noteQuestionLabel"></span><textarea id="noteTextarea"></textarea><p id="noteSaved"></p>
    <button id="clearNoteBtn"></button><button id="closeNotesBtn"></button><button id="doneNotesBtn"></button></div></div>`,
   style:':root{--ink:#151515}.hidden{display:none}',
   parts:[1,11,21,31].map(number=>`<input id="q${number}" type="text">`),sections:['One','Two','Three','Four'],
  };
  const host=listeningExam(h.ctx,{...fixture(),questions,cdExam});h.ctx.root.append(host);
  const surface=host.querySelector('[data-listening-cd-exam]'),shadow=surface.shadowRoot,byId=id=>shadow.getElementById(id);
  const audio=host.querySelector('audio');
  assert.equal(plays,0);
  h.click(byId('startTestBtn'));await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(plays,1);assert(!byId('examInterface').classList.contains('hidden'));
  h.input(byId('q1'),'sample');h.click(byId('flagBtn'));
  h.click(shadow.querySelector('[data-part="2"]'));
  h.click(shadow.querySelector('[data-part="1"]'));
  assert.equal(byId('q1').value,'sample');
  assert.equal(byId('flagBtn').getAttribute('aria-pressed'),'true');
  assert.equal(host.querySelector('audio'),audio);
  audio.dispatchEvent(new window.Event('ended'));
  assert.equal(byId('examStatus').textContent,'Final review');
  assert.equal(byId('timerDisplay').textContent,'2:00');
 }finally{
  h.dispose();
  if(initialStorage)Object.defineProperty(globalThis,'localStorage',initialStorage);
  else delete globalThis.localStorage;
 }
});
