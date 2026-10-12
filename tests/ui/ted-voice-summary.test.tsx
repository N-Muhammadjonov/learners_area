import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import uz from "../../src/lib/i18n/uz";
import packs from "../../src/lib/video/ted-study-pack.json";
const dom = new JSDOM('<div id="root"></div>', {url:"http://localhost/app/video-lessons/qa"});
for(const key of ["window","document","navigator","HTMLElement","HTMLInputElement","HTMLTextAreaElement","HTMLSelectElement","HTMLAnchorElement","Element","Node","Event","MouseEvent","KeyboardEvent"] as const)
 Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,self:dom.window});
let pauses=0, tracks=0, requests=0, urls=0;
const revoked:string[]=[], blobs:Blob[]=[], writes:{url:string;body:unknown}[]=[];
dom.window.HTMLMediaElement.prototype.pause=()=>{pauses++;};
dom.window.HTMLMediaElement.prototype.play=async()=>{};
URL.createObjectURL=(blob:Blob)=>{blobs.push(blob);return `blob:qa-${++urls}`;};
URL.revokeObjectURL=(url:string)=>{revoked.push(url);};
let delayedStop=false;const finishes:(()=>void)[]=[];
class MediaMock extends dom.window.EventTarget {
 static isTypeSupported(){return true;}
 static instances:MediaMock[]=[];
 state="inactive";mimeType="audio/webm";
 constructor(_stream:unknown){super();MediaMock.instances.push(this);}
 start(){this.state="recording";}
 stop(){this.state="inactive";const finish=()=>{
   const data=new dom.window.Event("dataavailable");Object.assign(data,{data:new Blob(["temporary voice"],{type:this.mimeType})});
   this.dispatchEvent(data);this.dispatchEvent(new dom.window.Event("stop"));
 }; if(delayedStop)finishes.push(finish);else finish();}
}
Object.defineProperty(window,"MediaRecorder",{value:MediaMock,configurable:true});
Object.defineProperty(globalThis,"MediaRecorder",{value:MediaMock,configurable:true});
const stream=()=>({getTracks:()=>[{stop(){tracks++;}}]}) as unknown as MediaStream;
let getMedia:()=>Promise<MediaStream>=async()=>stream();
Object.defineProperty(navigator,"mediaDevices",{value:{getUserMedia:()=>{requests++;return getMedia();}},configurable:true});
globalThis.fetch=async(url,init)=>{writes.push({url:String(url),body:init?.body ? JSON.parse(String(init.body)):null});return Response.json({state:"in_progress"});};
const React=await import("react");Object.assign(globalThis,{React});const {act}=React;
const {createRoot}=await import("react-dom/client");
const {AppRouterContext}=await import("next/dist/shared/lib/app-router-context.shared-runtime");
const {VideoLessonStudio}=await import("../../src/components/courses/VideoLessonStudio");
const {LocalReflectionRecorder,REFLECTION_LIMIT_MS}=await import("../../src/components/audio/LocalReflectionRecorder");
const router={push(){},refresh(){},back(){},forward(){},replace(){},prefetch(){}};
function studio(id="qa",title="Generic QA talk",summary="Saved written summary") {
 return <VideoLessonStudio mode="standalone" dict={en} lessonId={id} videoLesson={{id,provider:"youtube",videoId:"dQw4w9WgXcQ",title,beforeYouWatch:null,durationSeconds:null,transcript:null,transcriptSource:null,transcriptAttribution:null,transcriptText:"Authored transcript",notes:null}} questions={[]} vocabulary={[{id:"word",occurrenceId:"occ",term:"idea",partOfSpeech:"noun",definitionEn:"a thought",translationUz:null,exampleSentence:null}]} initialProgress={{state:"in_progress",watchedSeconds:0,answers:{},responseText:null,summaryText:summary}}/>;
}
async function mount(element:React.ReactNode){
 const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
 const render=async(el:React.ReactNode)=>{await act(async()=>root.render(<AppRouterContext.Provider value={router}>{el}</AppRouterContext.Provider>));};
 await render(element);
 return {container,render,unmount:async()=>{await act(async()=>root.unmount());container.remove();}};
}
async function click(c:HTMLElement,selector:string){const button=c.querySelector<HTMLButtonElement>(selector);assert.ok(button,selector);await act(async()=>button.click());}
async function label(c:HTMLElement,text:string){const button=[...c.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.trim()===text);assert.ok(button,text);await act(async()=>button.click());}
const audio=(c:HTMLElement)=>c.querySelector<HTMLAudioElement>("[data-local-reflection] audio");
const visible=(c:HTMLElement)=>c.querySelector<HTMLElement>("[data-local-reflection]")?.hidden===false;
async function recording(c:HTMLElement){await label(c,en.videoLesson.voiceSummary.record);assert.ok(c.querySelector('[data-local-reflection] [role=status]'));}
async function recordStop(c:HTMLElement){await recording(c);await label(c,en.videoLesson.voiceSummary.stop);assert.ok(audio(c)?.src.startsWith("blob:"));return audio(c)!.getAttribute("src")!;}

test("TED-MIC-01/05/06/12/15/19/20 generic Summary records locally, survives tabs, saves ONLY writing",async()=>{
 const m=await mount(studio());const startWrites=writes.length;
 try{
  assert.equal(visible(m.container),false);await click(m.container,'[data-video-tab="summary"]');assert.equal(visible(m.container),true);
  assert.equal(m.container.querySelector<HTMLTextAreaElement>("[data-video-summary-input]")!.value,"Saved written summary");
  const url=await recordStop(m.container);assert.ok(audio(m.container)!.controls);assert.equal(audio(m.container)!.getAttribute("aria-label"),en.videoLesson.voiceSummary.listen);assert.ok(blobs.at(-1)!.size);
  for(const tab of ["vocabulary","transcript","summary"])await click(m.container,`[data-video-tab="${tab}"]`);
  assert.equal(audio(m.container)!.getAttribute("src"),url);assert.equal(writes.length,startWrites,"recording sends no network requests");
  await click(m.container,"[data-video-save-response]");assert.equal(writes.at(-1)!.url,"/api/video-lessons/qa/response");
  assert.deepEqual(writes.at(-1)!.body,{responseText:"",summaryText:"Saved written summary"});
 }finally{await m.unmount();}
});
test("TED-MIC-02/03 study-pack semantic Summary only; task switching retains recording",async()=>{
 const m=await mount(studio("pack",packs[0]!.title));
 try{
  assert.equal(visible(m.container),false);await label(m.container,"Summary writing");assert.ok(visible(m.container));
  const url=await recordStop(m.container);
  for(const name of ["Vocabulary matching","Transcript noticing","Detailed comprehension"]){await label(m.container,name);assert.equal(visible(m.container),false);}
  await label(m.container,"Summary writing");assert.equal(audio(m.container)!.getAttribute("src"),url);
  const before=writes.length;await label(m.container,en.videoLesson.save);assert.equal(writes.length,before+1);assert.equal(writes.at(-1)!.url,"/api/video-lessons/pack/response");assert.doesNotMatch(JSON.stringify(writes.at(-1)!.body),/blob:|audio/);
 }finally{await m.unmount();}
});
test("TED-MIC-07/08/09 re-record discards A before requesting B; unmount revokes B",async()=>{
 const m=await mount(<LocalReflectionRecorder dict={en} active/>);let b="";
 try{
  const a=await recordStop(m.container);const before=pauses;
  await label(m.container,en.videoLesson.voiceSummary.again);assert.ok(revoked.includes(a));assert.equal(audio(m.container),null);assert.ok(pauses>before);
  await label(m.container,en.videoLesson.voiceSummary.stop);b=audio(m.container)!.getAttribute("src")!;assert.notEqual(a,b);
 }finally{await m.unmount();}assert.ok(revoked.includes(b));
});
test("TED-MIC-10/11 unmount cancels active recorder and stops microphone tracks",async()=>{
 const before=tracks;const m=await mount(<LocalReflectionRecorder dict={en} active/>);await recording(m.container);await m.unmount();assert.ok(tracks>before);assert.equal(MediaMock.instances.at(-1)!.state,"inactive");
});
test("TED-MIC-13/14 route exit and new lesson lose audio while stored writing survives",async()=>{
 const m=await mount(studio());
 try{
  await click(m.container,'[data-video-tab="summary"]');const url=await recordStop(m.container);
  await m.render(<p>Reading route</p>);assert.ok(revoked.includes(url));
  await m.render(studio());await click(m.container,'[data-video-tab="summary"]');assert.equal(audio(m.container),null);assert.equal(m.container.querySelector<HTMLTextAreaElement>("[data-video-summary-input]")!.value,"Saved written summary");
  const next=await recordStop(m.container);await m.render(studio("other"));assert.ok(revoked.includes(next));assert.equal(audio(m.container),null);
 }finally{await m.unmount();}
});
test("TED-MIC-21 permission denial leaves writing and its existing Save usable",async()=>{
 const m=await mount(studio());const original=getMedia;getMedia=async()=>{throw {name:"NotAllowedError"};};
 try{
  await click(m.container,'[data-video-tab="summary"]');await label(m.container,en.videoLesson.voiceSummary.record);
  assert.equal(m.container.querySelector('[data-local-reflection] [role=alert]')!.textContent,en.videoLesson.voiceSummary.permissionDenied);
  assert.equal(m.container.querySelector<HTMLTextAreaElement>("[data-video-summary-input]")!.disabled,false);
  await click(m.container,"[data-video-save-response]");assert.equal(writes.at(-1)!.url,"/api/video-lessons/qa/response");
 }finally{getMedia=original;await m.unmount();}
});
test("TED-MIC pending permission cancelled on unmount; late microphone stream released",async()=>{
 let grant!:(s:MediaStream)=>void;const original=getMedia;getMedia=()=>new Promise(resolve=>{grant=resolve;});
 const m=await mount(<LocalReflectionRecorder dict={en} active/>);const before=tracks;
 try{await label(m.container,en.videoLesson.voiceSummary.record);await m.unmount();await act(async()=>grant(stream()));assert.ok(tracks>before);}finally{getMedia=original;}
});
test("TED-MIC stop racing with unmount never creates a late playback URL",async()=>{
 const m=await mount(<LocalReflectionRecorder dict={en} active/>);await recording(m.container);delayedStop=true;const before=urls;
 try{await label(m.container,en.videoLesson.voiceSummary.stop);await m.unmount();await act(async()=>{finishes.splice(0).forEach(f=>f());});assert.equal(urls,before);}finally{delayedStop=false;}
});
test("TED-MIC bounded reflection stops at three minutes without uploading",async t=>{
 const m=await mount(<LocalReflectionRecorder dict={en} active/>);t.mock.timers.enable({apis:["setTimeout","setInterval","Date"]});
 try{await recording(m.container);await act(async()=>t.mock.timers.tick(REFLECTION_LIMIT_MS));assert.ok(audio(m.container));assert.equal(MediaMock.instances.at(-1)!.state,"inactive");}finally{t.mock.timers.reset();await m.unmount();}
});
test("TED-MIC request timeout is localized; a late permission grant is stopped",async t=>{
 let grant!:(s:MediaStream)=>void;const original=getMedia;getMedia=()=>new Promise(resolve=>{grant=resolve;});const before=tracks;
 const m=await mount(<LocalReflectionRecorder dict={en} active/>);t.mock.timers.enable({apis:["setTimeout"]});
 try{await label(m.container,en.videoLesson.voiceSummary.record);await act(async()=>t.mock.timers.tick(15_001));assert.ok(m.container.querySelector('[role=alert]'));await act(async()=>grant(stream()));assert.ok(tracks>before);}finally{getMedia=original;t.mock.timers.reset();await m.unmount();}
});
test("TED-MIC runtime recorder failure releases stream and displays an error",async()=>{
 const m=await mount(<LocalReflectionRecorder dict={en} active/>);const before=tracks;
 try{await recording(m.container);await act(async()=>MediaMock.instances.at(-1)!.dispatchEvent(new dom.window.Event("error")));assert.ok(tracks>before);assert.ok(m.container.querySelector('[role=alert]'));}finally{await m.unmount();}
});
test("TED-MIC pagehide destroys audio even for back-forward cache",async()=>{
 const m=await mount(<LocalReflectionRecorder dict={en} active/>);
 try{const url=await recordStop(m.container);await act(async()=>window.dispatchEvent(new dom.window.Event("pagehide")));assert.ok(revoked.includes(url));assert.equal(audio(m.container),null);}finally{await m.unmount();}
});
test("TED-MIC internal tab change while recording stops microphone but retains playback",async()=>{
 const m=await mount(<LocalReflectionRecorder dict={en} active/>);
 try{await recording(m.container);await m.render(<LocalReflectionRecorder dict={en} active={false}/>);assert.equal(MediaMock.instances.at(-1)!.state,"inactive");const url=audio(m.container)!.getAttribute("src");await m.render(<LocalReflectionRecorder dict={en} active/>);assert.equal(audio(m.container)!.getAttribute("src"),url);}finally{await m.unmount();}
});
test("TED-MIC-22/23 localized controls and errors are complete in EN and UZ",async()=>{
 for(const dict of [en,uz]){
  for(const text of Object.values(dict.videoLesson.voiceSummary))assert.ok(text.length>2);
  const m=await mount(<LocalReflectionRecorder dict={dict} active/>);try{assert.match(m.container.textContent!,new RegExp(dict.videoLesson.voiceSummary.record));}finally{await m.unmount();}
 }
 assert.notEqual(en.videoLesson.voiceSummary.record,uz.videoLesson.voiceSummary.record);
});

test("TED-MIC unsupported browser and missing microphone give localized errors",async()=>{
 for(const kind of ["unsupported","missing"]){
  const original=getMedia;
  if(kind==="unsupported")Object.defineProperty(window,"MediaRecorder",{value:undefined,configurable:true});
  else getMedia=async()=>{throw {name:"NotFoundError"};};
  const m=await mount(<LocalReflectionRecorder dict={en} active/>);
  try{await label(m.container,en.videoLesson.voiceSummary.record);assert.equal(m.container.querySelector('[role=alert]')!.textContent,en.videoLesson.voiceSummary.unavailable);}finally{getMedia=original;Object.defineProperty(window,"MediaRecorder",{value:MediaMock,configurable:true});await m.unmount();}
 }
});
test("TED-MIC rapid record clicks acquire only one microphone",async()=>{
 const m=await mount(<LocalReflectionRecorder dict={en} active/>);const before=requests;
 try{const button=m.container.querySelector<HTMLButtonElement>("button")!;await act(async()=>{button.click();button.click();});assert.equal(requests,before+1);}finally{await m.unmount();}
});
test("TED-MIC study-pack lesson change clears audio even when source title is identical",async()=>{
 const m=await mount(studio("pack-one",packs[0]!.title));
 try{await label(m.container,"Summary writing");const url=await recordStop(m.container);await m.render(studio("pack-two",packs[0]!.title));await label(m.container,"Summary writing");assert.equal(audio(m.container),null);assert.ok(revoked.includes(url));}finally{await m.unmount();}
});
