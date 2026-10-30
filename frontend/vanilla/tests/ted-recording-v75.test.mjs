import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {createRecordingPreview} from '../modules/shared/recording-preview.js';
import packs from '../modules/video/study-pack-data.js';
import {findTedStudyPack,createTedStudyPractice,readStudyAnswers} from '../modules/video/study-practice.js';
import {createVideoStudio} from '../modules/video/studio.js';
import {mount as library} from '../modules/video/library.js';

function audioHarness(){
 const h=setup(),events=[],sources=[];let resumeResolve,decodeResolve;
 const original=globalThis.AudioContext;
 window.HTMLMediaElement.prototype.load=function(){};window.HTMLMediaElement.prototype.pause=function(){};
 class Context{
  constructor(){this.state='suspended';this.currentTime=0;this.destination={};events.push('context');Context.last=this;}
  suspend(){return Promise.resolve();}
  decodeAudioData(){events.push('decode');return new Promise(r=>{decodeResolve=r;});}
  resume(){events.push('resume');return new Promise(r=>{resumeResolve=()=>{this.state='running';r();};});}
  createBufferSource(){const source={connect(){events.push('connect');},disconnect(){events.push('disconnect');},start(at,offset){events.push('start');source.offset=offset;},stop(){events.push('stop');}};sources.push(source);return source;}
  close(){events.push('close');this.state='closed';return Promise.resolve();}
 }
 globalThis.AudioContext=Context;
 return {h,events,sources,Context,decode:()=>decodeResolve({duration:3,getChannelData:()=>new Float32Array([0,.3,-.2])}),resume:()=>resumeResolve(),restore(){globalThis.AudioContext=original;h.dispose();}};
}
test('first Play waits for decoding and output resume, then starts the complete audible buffer once',async()=>{
 const a=audioHarness();let player;
 try{
  player=createRecordingPreview({blob:new Blob(['final recording']),url:'blob:local',dict:a.h.ctx.dict,label:'Recording'});a.h.ctx.root.append(player.node);
  await tick();const play=player.node.querySelector('button');assert.equal(play.disabled,true);assert.equal(a.sources.length,0);
  a.decode();await player.ready;assert.equal(play.disabled,false);assert.equal(a.events.includes('start'),false);
  a.h.click(play);assert.equal(a.events.at(-1),'resume');assert.equal(a.sources.length,0);
  a.resume();await tick();assert.equal(a.sources.length,1);assert.equal(a.sources[0].offset,0);assert.equal(a.sources[0].buffer.getChannelData(0)[1]>.2,true);assert.equal(a.events.filter(e=>e==='start').length,1);
  a.Context.last.currentTime=1;player.pause();assert.equal(play.getAttribute('aria-label'),'Play');
  a.h.click(play);a.resume();await tick();assert.equal(a.sources[1].offset,1);
  const seek=player.node.querySelector('input');a.h.input(seek,'2');a.resume();await tick();assert.equal(a.sources[2].offset,2,'seek preserves the newly selected value');
  player.destroy();assert.equal(a.events.at(-1),'close');assert.equal(a.sources[2].onended,null);
 }finally{player?.destroy();a.restore();}
});
test('discarding while decode is pending closes the context and never starts stale audio',async()=>{
 const a=audioHarness();try{const p=createRecordingPreview({blob:new Blob(['clip']),url:'blob:local',dict:a.h.ctx.dict,label:'Recording'});await tick();p.destroy();a.decode();await p.ready;assert.equal(a.sources.length,0);assert.equal(a.events.filter(e=>e==='close').length,1);}finally{a.restore();}
});
test('unsupported decoders retain native playback; a hidden page pauses an active buffer',async()=>{
 const a=audioHarness();let p;try{p=createRecordingPreview({blob:new Blob(['clip']),url:'blob:local',dict:a.h.ctx.dict,label:'Recording'});await tick();a.decode();await p.ready;a.h.click(p.node.querySelector('button'));a.resume();await tick();Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));assert(a.events.includes('stop'));p.destroy();globalThis.AudioContext=undefined;p=createRecordingPreview({blob:new Blob(['clip']),url:'blob:local',dict:a.h.ctx.dict,label:'Recording'});await p.ready;assert.equal(p.node.dataset.recordingPreview,'native');assert.equal(p.node.querySelector('audio').hidden,false);}finally{p?.destroy();a.restore();}
});
for(const locale of ['en','uz'])test(`${locale}: all ten TED packs retain nine stages, matching/gap inputs, guide, drafts and save envelope`,async()=>{
 const h=setup({locale});window.HTMLMediaElement.prototype.pause=function(){};window.HTMLMediaElement.prototype.load=function(){};
 try{for(const pack of packs){
  const ctl=new window.AbortController(),sent=[];const node=createTedStudyPractice({pack,initial:'',dict:h.ctx.dict,signal:ctl.signal,save:async text=>{sent.push(JSON.parse(text));return true;}});h.ctx.root.replaceChildren(node);
  assert.equal(findTedStudyPack(pack.title.toUpperCase()),pack);assert.equal(node.querySelector('[data-ted-task]').dataset.tedTask,'B');assert.equal(node.querySelectorAll('[data-ted-stage]').length,9);
  h.input(node.querySelector('textarea'),'My first response');h.click(node.querySelector('[data-ted-stage=D]'));const selects=[...node.querySelectorAll('select')];assert.equal(selects.length,pack.tasks.D.prompt.split('\n').filter(r=>/^\d+\./.test(r)).length);h.change(selects[0],'A');
  h.click(node.querySelector('[data-ted-stage=E]'));const input=node.querySelector('input');h.input(input,'attention');
  h.click(node.querySelector('button[aria-expanded]'));assert.equal(node.querySelector('button[aria-expanded]').getAttribute('aria-expanded'),'true');assert(node.textContent.includes(pack.tasks.E.key));
  h.click(node.querySelector('[data-ted-stage=B]'));assert.equal(node.querySelector('textarea').value,'My first response');assert.equal(node.querySelector('button[aria-expanded]').getAttribute('aria-expanded'),'false');
  const save=[...node.querySelectorAll('button')].find(n=>n.textContent===h.ctx.dict.videoLesson.save);h.click(save);await tick();assert.equal(sent.length,1);assert.equal(sent[0].kind,'ted-study-pack-v1');assert.equal(JSON.parse(sent[0].answers.D)[0],'A');assert.equal(JSON.parse(sent[0].answers.E)[0],'attention');assert.equal(sent[0].answers.B,'My first response');
  ctl.abort();
 }}finally{h.dispose();}
});
test('study response validation retains supported drafts; oversized payload never reaches the API',async()=>{
 assert.deepEqual(readStudyAnswers(JSON.stringify({kind:'ted-study-pack-v1',answers:{A:'yes',Z:'no',B:1,C:'x'.repeat(1001)}})),{A:'yes'});
 const h=setup();try{let count=0;const initial=JSON.stringify({kind:'ted-study-pack-v1',answers:{A:'a'.repeat(1000),B:'b'.repeat(1000),C:'c'.repeat(1000),F:'f'.repeat(1000)}});const n=createTedStudyPractice({pack:packs[0],initial,dict:h.ctx.dict,signal:h.ctx.signal,save:async()=>{count++;return true;}});h.ctx.root.append(n);h.click([...n.querySelectorAll('button')].find(b=>b.textContent===h.ctx.dict.videoLesson.save));await tick();assert.equal(count,0);assert(n.textContent.includes(h.ctx.dict.videoLesson.studyPack.tooLong));}finally{h.dispose();}
});
const video=(title='Custom lesson')=>({videoLesson:{id:ID(10),title,provider:'youtube',videoId:'abcdefghijk',beforeYouWatch:'Predict',notes:'Notes',transcript:[{startSeconds:0,text:'Transcript'}],transcriptText:null,transcriptAttribution:null,durationSeconds:100},questions:[{id:ID(11),stage:'comprehension',prompt:'Why?',atSeconds:5},{id:ID(12),stage:'gap_fill',prompt:'Fill ___',atSeconds:null}],progress:null,vocabulary:{ready:true,items:[]},embedOrigin:null,directMedia:null});
for(const locale of ['en','uz'])test(`${locale}: custom and built-in TED lessons open Description and show only the requested materials`,()=>{
 const h=setup({locale}),oldAbort=globalThis.AbortController;globalThis.AbortController=window.AbortController;let studio;
 try{for(const title of ['Custom lesson',...packs.map(p=>p.title)]){
  studio=createVideoStudio(h.ctx,{mode:'standalone',video:video(title)});h.ctx.root.append(studio.node);
  assert.deepEqual([...studio.node.querySelectorAll('[data-video-tab]')].map(b=>b.dataset.videoTab),['description','notes','vocabulary','ownNotes','transcript']);
  assert.equal(studio.node.querySelector('[data-video-tab-active]').dataset.videoTabActive,'description');
  assert.equal(studio.node.querySelector('[data-video-description]').textContent,'Predict');
  assert.equal(studio.node.querySelector('[data-video-transcript-button]').disabled,false);
  assert.equal(studio.node.querySelector('[data-ted-study-pack],[data-video-answer-input],[data-local-reflection]'),null);
  h.click(studio.node.querySelector('[data-video-tab=notes]'));assert.equal(studio.node.querySelector('[data-video-notes]').textContent,'Notes');
  h.click(studio.node.querySelector('[data-video-tab=vocabulary]'));assert(studio.node.querySelector('[data-video-vocabulary]'));if(title!=='Custom lesson')assert(studio.node.querySelector('[data-video-glossary]').textContent.includes(packs.find(p=>p.title===title).glossary));
  for(const b of studio.node.querySelectorAll('[data-video-tab]'))assert(b.textContent.trim());
  studio.destroy();studio=null;
 }}finally{studio?.destroy();globalThis.AbortController=oldAbort;h.dispose();}
});
test('published lesson vocabulary takes precedence over an older built-in glossary for the same talk',()=>{
 const h=setup(),oldAbort=globalThis.AbortController;globalThis.AbortController=window.AbortController;let studio;
 try{
  const data=video('How to Make Stress Your Friend');
  data.videoLesson.beforeYouWatch='UNDERSTANDING THE TALK / 4 QUESTIONS\n01. A question?\n02. Another?\n03. Why?\n04. How?';
  data.videoLesson.notes='Lesson focus\nStress and connection\n\nKey ideas to explain to learners\n• Reinterpret stress.';
  data.vocabulary.items=[{occurrenceId:ID(21),id:ID(22),term:'stress resilience',partOfSpeech:null,definitionEn:'the ability to adapt and recover under pressure',translationUz:null,exampleSentence:null}];
  studio=createVideoStudio(h.ctx,{mode:'standalone',video:data});h.ctx.root.append(studio.node);
  assert.equal(studio.node.querySelector('[data-video-description]').textContent,data.videoLesson.beforeYouWatch);
  h.click(studio.node.querySelector('[data-video-tab=notes]'));
  assert.equal(studio.node.querySelector('[data-video-notes]').textContent,data.videoLesson.notes);
  h.click(studio.node.querySelector('[data-video-tab=vocabulary]'));
  assert.equal(studio.node.querySelectorAll('[data-video-vocabulary] article').length,1);
  assert(studio.node.querySelector('[data-video-vocabulary]').textContent.includes('the ability to adapt and recover under pressure'));
  assert.equal(studio.node.querySelector('[data-video-glossary]'),null);
 }finally{studio?.destroy();globalThis.AbortController=oldAbort;h.dispose();}
});
test('standalone own notes restore existing text, retain drafts across tabs and save without overwriting older responses',async()=>{
 const h=setup(),oldAbort=globalThis.AbortController,oldFetch=globalThis.fetch;globalThis.AbortController=window.AbortController;let studio;
 try{
  const data=video();data.progress={state:'in_progress',watchedSeconds:10,summaryText:'Existing notes',responseText:'Older response'};
  let sent,resolve;globalThis.fetch=async(url,opts)=>{sent={url,body:JSON.parse(opts.body)};await new Promise(r=>{resolve=r;});return {ok:true,json:async()=>({state:'in_progress'})};};
  studio=createVideoStudio(h.ctx,{mode:'standalone',video:data});h.ctx.root.append(studio.node);
  h.click(studio.node.querySelector('[data-video-tab=ownNotes]'));assert.equal(studio.node.querySelector('textarea').value,'Existing notes');
  h.input(studio.node.querySelector('textarea'),'My own notes');h.click(studio.node.querySelector('[data-video-tab=description]'));h.click(studio.node.querySelector('[data-video-tab=ownNotes]'));assert.equal(studio.node.querySelector('textarea').value,'My own notes');
  h.click(studio.node.querySelector('[data-video-save-response]'));assert.equal(studio.node.querySelector('[data-video-save-response]').disabled,true);
  assert.deepEqual(sent,{url:`/api/video-lessons/${ID(10)}/response`,body:{summaryText:'My own notes'}});
  h.input(studio.node.querySelector('textarea'),'Newer unsaved edit');resolve();await tick();assert.equal(studio.node.querySelector('[data-video-response-state]').dataset.videoResponseState,'idle');
  h.click(studio.node.querySelector('[data-video-save-response]'));resolve();await tick();assert.equal(studio.node.querySelector('[data-video-response-state]').dataset.videoResponseState,'saved');
 }finally{studio?.destroy();globalThis.fetch=oldFetch;globalThis.AbortController=oldAbort;h.dispose();}
});
test('course materials preserve the existing external student-notes panel, and empty content has usable states',()=>{
 const h=setup(),oldAbort=globalThis.AbortController;globalThis.AbortController=window.AbortController;let studio;
 try{const data=video();Object.assign(data.videoLesson,{beforeYouWatch:null,notes:null,transcript:null,transcriptText:null});
  studio=createVideoStudio(h.ctx,{mode:'course',video:data});h.ctx.root.append(studio.node);
  assert.deepEqual([...studio.node.querySelectorAll('[data-video-tab]')].map(b=>b.dataset.videoTab),['description','notes','vocabulary']);
  assert.equal(studio.node.querySelector('[data-video-description]').textContent,h.ctx.dict.videoLesson.descriptionEmpty);
  assert.equal(studio.node.querySelector('[data-video-transcript-button]'),null);
  h.click(studio.node.querySelector('[data-video-tab=notes]'));assert.equal(studio.node.querySelector('[data-video-notes]').textContent,h.ctx.dict.videoLesson.notesEmpty);
 }finally{studio?.destroy();globalThis.AbortController=oldAbort;h.dispose();}
});
test('Transcript button opens one inline panel with Description and teardown removes it',async()=>{
 const h=setup(),oldAbort=globalThis.AbortController;globalThis.AbortController=window.AbortController;let studio;
 try{studio=createVideoStudio(h.ctx,{mode:'standalone',video:video()});h.ctx.root.append(studio.node);
  const button=studio.node.querySelector('[data-video-transcript-button]');h.click(button);h.click(button);await tick(12);
  assert.equal(document.querySelectorAll('dialog').length,0);assert(studio.node.querySelector('[data-video-inline-transcript]').textContent.includes('Transcript'));assert.equal(studio.node.querySelector('[data-video-tab-active]').dataset.videoTabActive,'transcript');assert(studio.node.querySelector('[data-video-description]'));
  studio.destroy();studio=null;assert.equal(document.querySelector('[data-video-inline-transcript]'),null);
 }finally{studio?.destroy();globalThis.AbortController=oldAbort;h.dispose();}
});
test('library keeps Main introduction and visible grouping headings, without invented local tabs',async()=>{
 const h=setup({path:'/app/video-lessons'});try{h.stub({'/api/frontend/view':{version:1,route:'/app/video-lessons',data:{standalone:[{id:ID(10),title:'A talk',provider:'youtube',videoId:'abcdefghijk',durationSeconds:120,progressState:'not_started'}],course:[]}}});await h.mount({mount:library});assert(h.q('[data-video-library-intro]'));assert.equal(h.q('h2').textContent,h.ctx.dict.videoLessons.standaloneHeading);assert.equal(h.q('h2').classList.contains('sr-only'),false);assert.equal(h.q('[data-video-header-sections]'),null);}finally{h.dispose();}
});
