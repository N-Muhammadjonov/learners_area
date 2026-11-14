import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {api} from '../js/api-client.js';
import {renderExamRunnerScreen} from '../modules/mocks/runner.js';
import {renderObjectiveMaterial} from '../modules/mocks/objective-material.js';
import {MOCK_EXAM_CSS} from '../modules/mocks/exam-surface.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const material={layout:'ielts-native-v1',audioUrl:'/private/audio',passages:[{passageNo:1,title:'Passage',bodyText:'Original passage.'}],questions:[{id:'1',part:1,questionText:'First question?'},{id:'2',part:2,questionText:'Second question?'}]};
function setup(){
 const dom=new JSDOM('<html data-theme="night"><head></head><body><div id="root"></div></body></html>',{url:'https://fixture.invalid/app/mocks?attempt=fixture'});
 globalThis.document=dom.window.document;globalThis.window=dom.window;globalThis.Node=dom.window.Node;
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 let plays=0;dom.window.HTMLMediaElement.prototype.play=function(){plays++;return Promise.resolve();};dom.window.HTMLMediaElement.prototype.pause=function(){};dom.window.HTMLMediaElement.prototype.load=function(){};
 const controller=new AbortController(),root=document.querySelector('#root'),request=api.request;
 const context={root,url:new URL(dom.window.location.href),signal:controller.signal,locale:'en'};
 return {dom,root,context,get plays(){return plays;},close(){controller.abort();api.request=request;dom.window.close();}};
}
for(const theme of ['day','night'])test(theme+': exam inputs remain light and readable',()=>{
 const h=setup();try{
 document.documentElement.dataset.theme=theme;
 document.head.append(Object.assign(document.createElement('style'),{textContent:'html[data-theme="night"] input{background:#000!important;color:#fff!important}'+MOCK_EXAM_CSS}));
 const host=document.createElement('div');host.dataset.mockRunner='fixture';h.root.append(host);
 const field=document.createElement('input');host.append(field);
 const style=h.dom.window.getComputedStyle(field);
 assert.equal(style.backgroundColor,'rgb(255, 255, 255)');assert.equal(style.color,'rgb(17, 24, 39)');
 }finally{h.close();}
});
test('Listening autoplays once and changing part keeps the same attached audio',async()=>{
 const h=setup();try{
 api.request=async(path,opts)=>path.endsWith('/listening/playback')?{playback:{status:opts.body.action==='complete'?'completed':'playing',positionMs:opts.body.positionMs}}:{ok:true,attempt:{title:'Mock',sections:[{skill:'listening',position:1,status:'in_progress',questionCount:2,remainingSeconds:1800,material}]}};
 await renderExamRunnerScreen(h.context,h.root,'fixture');await tick();
 const audio=h.root.querySelector('[data-mock-audio-player]');assert(audio?.isConnected);assert.equal(h.plays,1);
 const tabs=h.root.querySelectorAll('[aria-label="Exam parts"] button');tabs[1].click();
 assert.equal(h.root.querySelector('[data-mock-audio-player]'),audio);assert.equal(h.plays,1);
 assert(h.root.querySelector('.mock-exam-header'));assert(h.root.querySelector('.mock-native-footer'));
 }finally{h.close();}
});
test('Academic Reading has a working divider and question navigation reveals the right passage',()=>{
 const h=setup();try{
 const node=renderObjectiveMaterial({material,skill:'reading',answers:{},onAnswer(){}});h.root.append(node);
 const divider=node.querySelector('[role="separator"]');assert(divider);
 divider.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'ArrowRight'}));assert.equal(divider.getAttribute('aria-valuenow'),'52');
 node.querySelector('[aria-label="Go to question 2"]').click();assert.equal(node.dataset.readingPane,'questions');assert.equal(node.querySelector('[data-native-part="1"]').hidden,true);
 }finally{h.close();}
});
test('Writing task switches preserve the saved essays and use a split exam surface',async()=>{
 const h=setup();try{
 api.request=async()=>({ok:true,attempt:{title:'Mock',sections:[{skill:'writing',position:3,status:'in_progress',remainingSeconds:3600}],writingTasks:[{taskType:'task1',prompt:'Describe the diagram.',content:'Saved Task 1'},{taskType:'task2',prompt:'Discuss the topic.',content:'Saved Task 2'}]}});
 await renderExamRunnerScreen(h.context,h.root,'fixture');
 assert(h.root.querySelector('[data-cd-exam="writing"] .cd-split'));
 assert.equal(h.root.querySelector('textarea').value,'Saved Task 1');
 h.root.querySelector('[data-mock-writing-tab="task2"]').click();assert.equal(h.root.querySelector('textarea').value,'Saved Task 2');
 h.root.querySelector('[data-mock-writing-tab="task1"]').click();assert.equal(h.root.querySelector('textarea').value,'Saved Task 1');
 }finally{h.close();}
});
test('Mock Speaking stays in its topic until its responses have been saved',async()=>{
 const h=setup();try{
 const parts=[{part:'P1',topic:'Home',questionId:'home',promptText:'Describe home.'},{part:'P1',topic:'Work',questionId:'work',promptText:'Describe work.'},{part:'P2',topic:'Travel',questionId:'trip',promptText:'Describe a trip.'},{part:'P3',topic:'Tourism',questionId:'tourism',promptText:'Discuss tourism.'}];
 api.request=async()=>({ok:true,attempt:{title:'Mock',speakingCaptureMode:'question',sections:[{skill:'speaking',position:4,status:'in_progress',remainingSeconds:840,material:{parts}}]}});
 await renderExamRunnerScreen(h.context,h.root,'fixture');
 assert.equal(h.root.querySelectorAll('[data-mock-speaking-question]').length,1);assert(h.root.querySelector('[data-mock-speaking-question="home"]'));
 h.root.querySelector('[data-mock-next-topic]').click();assert(h.root.querySelector('[data-mock-speaking-question="home"]'));assert.match(h.root.querySelector('[data-mock-save-status]').textContent,/Record and save/);
 }finally{h.close();}
});
