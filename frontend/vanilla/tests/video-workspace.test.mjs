import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {createVideoStudio} from '../modules/video/studio.js';
import {createVideoVocabulary} from '../modules/video/vocabulary.js';
import {progressRatio,videoProgressText} from '../modules/shared/progress.js';
import {videoLibraryDTO,videoStudioDTO} from '../js/adapters/video-v47.js';
import {render as listeningCatalogue} from '../js/generated/views/listening-academic.js';

const fixture=()=>({videoLesson:{id:ID(2),provider:'youtube',videoId:'abcdefghijk',title:'A TED talk',beforeYouWatch:'Description',durationSeconds:600,transcript:[],transcriptText:'A useful word.',notes:'Teacher notes'},questions:[],progress:{state:'in_progress',watchedSeconds:120,summaryText:'Saved summary'},vocabulary:{ready:true,items:[]},embedOrigin:'http://fixture.invalid'});

test('video progress never changes course availability or hides a completed video in an open lesson',()=>{
 const row={id:ID(2),title:'Talk',provider:'youtube',videoId:'abcdefghijk',durationSeconds:600,state:'available',progressState:'completed',watchedSeconds:600,lessonId:ID(3),courseSlug:'ielts',courseTitle:'IELTS',unitTitle:'Unit'};
 const data=videoLibraryDTO({standalone:[],course:[row]});
 assert.equal(data.course[0].state,'available');assert.equal(data.course[0].progressState,'completed');
});

test('Listening Tests show saved answer percentage without a contradictory Not started label',()=>{
 const h=setup({role:'student'});
 try{
  const cards=[{testId:ID(2),title:'Listening test',parts:4,questions:40,minutes:30,completed:0,activityCount:5,started:true,locked:false,exam:null,answerProgress:{state:'in_progress',answeredCount:9,totalQuestions:40}}];
  h.ctx.root.append(listeningCatalogue({context:h.ctx,dict:h.ctx.dict,user:h.ctx.session.user,cards,total:1}));
  assert.equal(h.q('[data-listening-answer-progress]').textContent,'9/40 · 23%');
  assert(!h.ctx.root.textContent.includes(h.ctx.dict.listening.academic.noProgress));
 }finally{h.dispose();}
});

test('progress shows saved counts/time only in progress, and never guesses an unknown percentage',()=>{
 assert.equal(progressRatio('in_progress',9,13),'9/13 · 69%');
 for(const state of ['not_started','completed'])assert.equal(progressRatio(state,9,13),'');
 assert.equal(progressRatio('in_progress',2,0),'');
 assert.equal(videoProgressText('in_progress',282,600,'In progress'),'In progress · 4:42 / 47%');
 assert.equal(videoProgressText('not_started',0,600,'Not started'),'Not started');
 assert.equal(videoProgressText('completed',600,600,'Finished'),'Finished');
 assert.equal(videoProgressText('in_progress',30,null,'In progress'),'In progress · 0:30');
});

test('a saved provider duration restores missing metadata without changing authored duration',()=>{
 const data=fixture();data.videoLesson.durationSeconds=null;data.progress.playbackDurationSeconds=1000;
 assert.equal(videoStudioDTO(data).videoLesson.durationSeconds,1000);
 data.videoLesson.durationSeconds=600;assert.equal(videoStudioDTO(data).videoLesson.durationSeconds,600);
 data.progress.playbackDurationSeconds='untrusted';assert.throws(()=>videoStudioDTO(data));
});

test('trusted provider duration supplies percent and is sent as display telemetry for unknown video length',async()=>{
 const h=setup({role:'student'});globalThis.AbortController=window.AbortController;
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async(p,o)=>{if(!String(p).startsWith('/api/coins/'))requests.push(JSON.parse(o.body));return {ok:true,json:async()=>({state:'in_progress',watchedSeconds:200,durationSeconds:1000})};};
 let studio;
 try{
  const data=fixture();data.videoLesson.durationSeconds=null;
  studio=createVideoStudio(h.ctx,{mode:'standalone',video:data});h.ctx.root.append(studio.node);
  const frame=h.q('iframe');
  window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,origin:'https://www.youtube-nocookie.com',data:JSON.stringify({event:'infoDelivery',info:{duration:1000,currentTime:200,playerState:1}})}));
  await tick();assert.deepEqual(requests[0],{watchedSeconds:200,durationSeconds:1000});
  assert(h.q('[data-video-progress-state]').textContent.endsWith('20%'));assert.equal(data.videoLesson.durationSeconds,null);
 }finally{studio?.destroy();globalThis.fetch=original;h.dispose();}
});

test('transcript is inline and exclusive, player and draft survive tab switches, microphone is restored',async()=>{
 const h=setup({role:'student'});globalThis.AbortController=window.AbortController;
 let studio;
 try{
  studio=createVideoStudio(h.ctx,{mode:'standalone',video:fixture()});h.ctx.root.append(studio.node);
  const frame=h.q('iframe');assert(frame);assert.equal(h.q('[data-video-ended]'),null);
  assert.equal(new URL(frame.src).searchParams.get('origin'),window.location.origin);
  h.click(h.q('[data-video-tab=ownNotes]'));await tick(15);
  const input=h.q('textarea');h.input(input,'Keep this draft');
  assert(h.q('[data-local-reflection]'));assert.equal(h.q('[data-local-reflection]').hidden,false);
  h.click(h.q('[data-video-tab=transcript]'));await tick(15);
  assert.equal(h.q('[data-video-transcript-region]').hidden,false);
  assert(h.q('[data-video-inline-transcript]'));assert.equal(document.querySelector('dialog'),null);
  assert.equal(h.qa('[role=tab][aria-selected=true]').length,1);
  assert.equal(h.q('[data-video-tabpanel]').dataset.videoTabActive,'transcript');
  assert(h.q('[data-video-description]'));
  h.click(h.q('[data-video-tab=vocabulary]'));
  assert.equal(h.q('[data-video-transcript-region]').hidden,true);
  h.click(h.q('[data-video-tab=ownNotes]'));
  assert.equal(h.q('textarea'),input);assert.equal(input.value,'Keep this draft');assert.equal(h.q('iframe'),frame);
 }finally{studio?.destroy();h.dispose();}
});

test('initial/spoofed end never writes completion; trusted playing then end keeps native player replay',async()=>{
 const h=setup({role:'student'});globalThis.AbortController=window.AbortController;
 const original=globalThis.fetch,requests=[];globalThis.fetch=async(p,o)=>{if(!String(p).startsWith('/api/coins/'))requests.push(JSON.parse(o.body));return {ok:true,json:async()=>({state:'completed',watchedSeconds:600})};};
 let studio;
 try{
  studio=createVideoStudio(h.ctx,{mode:'standalone',video:fixture()});h.ctx.root.append(studio.node);
  const frame=h.q('iframe');
  const emit=(data,source=frame.contentWindow,origin='https://www.youtube-nocookie.com')=>window.dispatchEvent(new window.MessageEvent('message',{data:JSON.stringify(data),source,origin}));
  emit({event:'onStateChange',info:0});emit({event:'onStateChange',info:1},null);emit({event:'onStateChange',info:0});assert.equal(requests.length,0);
  emit({event:'onStateChange',info:1});emit({event:'onStateChange',info:0});await tick();
  assert.equal(requests.length,1);assert.equal(requests[0].ended,true);assert.equal(h.q('iframe'),frame);assert.equal(h.q('[data-video-ended]'),null);
 }finally{studio?.destroy();globalThis.fetch=original;h.dispose();}
});

for(const locale of ['en','uz'])test(`vocabulary folder picker waits for confirmation, sends chosen folder and keeps exact occurrence (${locale})`,async()=>{
 const h=setup({role:'student',locale});globalThis.AbortController=window.AbortController;
 try{
  h.stub({'/api/vocabulary/folders':{ok:true,folders:[{id:ID(9),name:'My folder',count:0}]},[`/api/video-lessons/${ID(2)}/vocabulary`]:{ok:true,added:1}});
  const words=[{id:ID(3),occurrenceId:ID(4),term:'word',definitionEn:'Exact meaning',translationUz:'so‘z',exampleSentence:'A word.'}];
  h.ctx.root.append(createVideoVocabulary({context:h.ctx,id:ID(2),title:'A TED talk',words,dict:h.ctx.dict}));
  h.click(h.q('[data-video-vocabulary] article button'));await tick();
  const dialog=document.querySelector('dialog');assert(dialog.open);assert(dialog.textContent.includes('TED : A TED talk'));
  assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
  const radio=dialog.querySelector(`input[value="${ID(9)}"]`);radio.checked=true;radio.dispatchEvent(new window.Event('change',{bubbles:true}));
  h.click(dialog.querySelector('[data-dictionary-confirm-folder]'));await tick();
  assert.deepEqual(h.calls.find(c=>c.path.endsWith('/vocabulary')).body,{occurrenceId:ID(4),folderId:ID(9)});
  assert.equal(document.querySelector('dialog'),null);assert.equal(h.q('article button').textContent,h.ctx.dict.videoLesson.vocabularySaved);
 }finally{h.dispose();}
});

test('folder dialog cancellation does not save and false success remains an error',async()=>{
 const h=setup({role:'student'});globalThis.AbortController=window.AbortController;
 try{
  h.stub({'/api/vocabulary/folders':{ok:true,folders:[]},[`/api/video-lessons/${ID(2)}/vocabulary`]:{ok:false}});
  h.ctx.root.append(createVideoVocabulary({context:h.ctx,id:ID(2),title:'Talk',words:[{id:ID(3),occurrenceId:ID(4),term:'word',definitionEn:'Meaning'}],dict:h.ctx.dict}));
  h.click(h.q('article button'));await tick();let dialog=document.querySelector('dialog');
  dialog.dispatchEvent(new window.Event('cancel',{cancelable:true}));assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
  h.click(h.q('article button'));await tick();dialog=document.querySelector('dialog');
  h.click(dialog.querySelector('[data-dictionary-confirm-folder]'));await tick();
  assert.equal(h.calls.at(-1).body.folderId,null);assert(dialog.open);assert.equal(dialog.querySelector('[role=alert]').hidden,false);
  assert.notEqual(h.q('article button').textContent,h.ctx.dict.videoLesson.vocabularySaved);
 }finally{h.dispose();}
});
