/** Test-only Main/native control comparison. React is used only to inspect the
 * independent reference; deployed assets remain plain browser JavaScript. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
import packs from '../frontend/vanilla/modules/video/study-pack-data.js';
import {createTedStudyPractice} from '../frontend/vanilla/modules/video/study-practice.js';
import * as nativeAdmin from '../frontend/vanilla/modules/staff-final30/video-lessons.js';
import {api} from '../frontend/vanilla/js/api-client.js';
import en from '../frontend/vanilla/js/i18n/en.js';
import uz from '../frontend/vanilla/js/i18n/uz.js';
const reference=process.env.MAIN_REFERENCE_ROOT;
if(!reference)throw Error('Set MAIN_REFERENCE_ROOT to the pinned independent Main checkout');
assert.deepEqual(packs,JSON.parse(fs.readFileSync(path.join(reference,'src/lib/video/ted-study-pack.json'),'utf8')));
const dom=new JSDOM('<div id="reference"></div><div id="native"></div>',{url:'https://fixture.invalid/app/admin/video-lessons',pretendToBeVisual:true});
for(const key of ['window','document','Node','HTMLElement','Event','MouseEvent','navigator'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
window.HTMLMediaElement.prototype.pause=function(){};window.HTMLMediaElement.prototype.load=function(){};
const require=createRequire(path.join(reference,'package.json')),React=require('react');globalThis.React=React;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=require('react-dom/client'),{AppRouterContext}=require('next/dist/shared/lib/app-router-context.shared-runtime');
const {TedStudyPractice}=await import(pathToFileURL(path.join(reference,'src/components/courses/TedStudyPractice.tsx')).href);
const {NewVideoLessonForm}=await import(pathToFileURL(path.join(reference,'src/components/admin/NewVideoLessonForm.tsx')).href);
const root=createRoot(document.querySelector('#reference')),native=document.querySelector('#native');
const clean=text=>text.replace(/\s+/g,' ').trim();
const controls=node=>[...node.querySelectorAll('button,input,select,textarea')].filter(n=>!n.closest('[hidden]')).map(n=>({tag:n.tagName,type:n.type,label:clean(n.tagName==='BUTTON'?n.textContent:n.closest('label')?.textContent??''),placeholder:n.getAttribute('placeholder'),required:n.required??false,min:n.getAttribute('min'),maxLength:n.getAttribute('maxlength'),pressed:n.getAttribute('aria-pressed'),options:n.tagName==='SELECT'?[...n.options].map(o=>[o.value,clean(o.textContent)]):null}));
const tick=()=>new Promise(r=>setTimeout(r,0));let states=0;
const originalApi=api.request;
try{
 for(const dict of [en,uz])for(const pack of packs){
  const controller=new window.AbortController();
  await React.act(async()=>root.render(React.createElement(TedStudyPractice,{key:pack.title+dict.videoLessons.intro,title:pack.title,initial:'',dict,save:async()=>true})));
  native.replaceChildren(createTedStudyPractice({pack,initial:'',dict,signal:controller.signal,save:async()=>true}));
  for(const key of 'ABCDEFGHI'){
   await React.act(async()=>{[...document.querySelectorAll('#reference nav button')].find(b=>b.textContent===pack.tasks[key].name).click();await tick();});
   native.querySelector(`[data-ted-stage=${key}]`).click();await tick();
   assert.deepEqual(controls(native),controls(document.querySelector('#reference')),`${pack.title}: ${key}`);states++;
  }
  controller.abort();
 }
 for(const dict of [en,uz]){
  const lessons=[{id:'00000000-0000-4000-8000-000000000001',title:'Lesson 1'}],controller=new window.AbortController();
  const router={refresh(){},push(){},replace(){},prefetch(){},back(){},forward(){}};
  await React.act(async()=>root.render(React.createElement(AppRouterContext.Provider,{value:router},React.createElement(NewVideoLessonForm,{key:dict.videoLessons.intro,dict,lessons}))));
  api.request=async()=>({version:1,kind:'video-admin',data:{lessons,authored:[]}});
  native.replaceChildren();await nativeAdmin.mount({root:native,dict,locale:dict===en?'en':'uz',signal:controller.signal,state:{},url:new URL(window.location.href),navigate(){},session:{user:{id:lessons[0].id,role:'owner'}}});await tick();
  assert.deepEqual(controls(native.querySelector('form')),controls(document.querySelector('#reference form')));states++;
  controller.abort();
 }
 console.log(JSON.stringify({mainControlStates:states,studyPackLessons:packs.length,locales:2,differences:0}));
}finally{api.request=originalApi;await React.act(async()=>root.unmount());dom.window.close();}
