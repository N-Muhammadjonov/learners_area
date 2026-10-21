import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM}from'jsdom';
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/qa'});
for(const key of ['window','document','navigator','HTMLElement','Element','Node','Event','HTMLMediaElement']as const)Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react');Object.assign(globalThis,{React});const{act}=React,{createRoot}=await import('react-dom/client');
const{LocalReflectionRecorder}=await import('../../src/components/audio/LocalReflectionRecorder');
const{VocabRevisionPanel}=await import('../../src/components/vocabulary/VocabRevisionPanel');
const dict=(await import('../../src/lib/i18n/en')).default;
class Recorder extends dom.window.EventTarget{state='inactive';mimeType='audio/mp4';static isTypeSupported(mime:string){return mime==='audio/mp4';}start(){this.state='recording';}stop(){this.state='inactive';const event=new dom.window.Event('dataavailable');Object.defineProperty(event,'data',{value:new Blob(['local summary'],{type:this.mimeType})});this.dispatchEvent(event);this.dispatchEvent(new dom.window.Event('stop'));}}
Object.defineProperty(window,'MediaRecorder',{value:Recorder,configurable:true});Object.defineProperty(globalThis,'MediaRecorder',{value:Recorder,configurable:true});
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!;

test('TED recording supports replay/delete/re-record and releases microphone/blob when leaving the video without uploading audio',async()=>{
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL,fetch=globalThis.fetch;let tracks=0,made=0,requests=0;const revoked:string[]=[];
 URL.createObjectURL=()=>`blob:summary-${++made}`;URL.revokeObjectURL=url=>revoked.push(url);dom.window.HTMLMediaElement.prototype.pause=function(){};Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{let stopped=false;return {getTracks:()=>[{stop:()=>{if(!stopped){tracks++;stopped=true;}}}]};}}});globalThis.fetch=async()=>{requests++;return new Response('{}');};
 document.body.innerHTML='<div id="root"></div>';const root=createRoot(document.querySelector('#root')!);
 try{
  await act(async()=>root.render(<LocalReflectionRecorder key="video-a" dict={dict} active/>));
  await act(async()=>button(dict.videoLesson.voiceSummary.record).click());await act(async()=>button(dict.videoLesson.voiceSummary.stop).click());assert.equal(document.querySelector('audio')?.getAttribute('src'),'blob:summary-1');
  await act(async()=>button(dict.common.delete).click());assert.equal(document.querySelector('audio'),null);assert.ok(revoked.includes('blob:summary-1'));
  await act(async()=>button(dict.videoLesson.voiceSummary.record).click());await act(async()=>button(dict.videoLesson.voiceSummary.stop).click());assert.equal(document.querySelector('audio')?.getAttribute('src'),'blob:summary-2');
  await act(async()=>root.render(<LocalReflectionRecorder key="video-b" dict={dict} active/>));assert.equal(document.querySelector('audio'),null);assert.ok(revoked.includes('blob:summary-2'));assert.equal(tracks,2);assert.equal(requests,0);
 }finally{await act(async()=>root.unmount());URL.createObjectURL=create;URL.revokeObjectURL=revoke;globalThis.fetch=fetch;}
});

test('Revision reveal flips the same 3D card while keeping scoring controls behind the reveal',async()=>{
 const item={id:'one',term:'side effect',partOfSpeech:'phrase',definitionEn:'An unwanted result',translationUz:'nojo‘ya ta’sir',exampleSentence:'This medicine has a side effect.',collocations:null,mastery:'new' as const,srsStage:0,intervalDays:1,nextReviewAt:new Date().toISOString(),correctCount:0,incorrectCount:0,activeUseCount:0,folderId:null,topicPack:null,sourceType:null,createdAt:new Date().toISOString()};
 document.body.innerHTML='<div id="root"></div>';const root=createRoot(document.querySelector('#root')!);try{await act(async()=>root.render(<VocabRevisionPanel dict={dict} initialDue={[item]} onFinished={()=>{}}/>));const card=document.querySelector('.revision-flip-card')!;assert.equal(card.getAttribute('data-flipped'),'false');assert.equal(document.querySelector('[data-outcome]'),null);await act(async()=>document.querySelector<HTMLButtonElement>('[data-reveal]')!.click());assert.equal(document.querySelector('.revision-flip-card'),card);assert.equal(card.getAttribute('data-flipped'),'true');assert.equal(document.querySelector('.revision-flip-back')?.getAttribute('aria-hidden'),'false');assert.ok(document.querySelector('[data-outcome="correct"]'));}finally{await act(async()=>root.unmount());}
});
