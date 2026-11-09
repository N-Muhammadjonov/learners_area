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
