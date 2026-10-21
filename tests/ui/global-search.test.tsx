import test from "node:test";
import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
import en from "../../src/lib/i18n/en";
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/app'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Element','Node','Event','MouseEvent','KeyboardEvent'] as const)Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,self:dom.window,requestAnimationFrame:()=>0});
const React=await import('react');Object.assign(globalThis,{React});const{act}=React;
const{createRoot}=await import('react-dom/client');
const{AppRouterContext}=await import('next/dist/shared/lib/app-router-context.shared-runtime.js');
const{PathnameContext,SearchParamsContext}=await import('next/dist/shared/lib/hooks-client-context.shared-runtime.js');
const{InstantInteractionProvider}=await import('../../src/components/interaction/InstantInteractionProvider');
const{GlobalSearch}=await import('../../src/components/shell/GlobalSearch');
const input=()=>document.querySelector<HTMLInputElement>('[data-global-search] input')!;
async function fill(value:string){await act(async()=>{input().focus();Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input(),value);input().dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>new Promise(resolve=>setTimeout(resolve,330)));}
async function mount(run:(paths:string[])=>Promise<void>,fetcher:typeof fetch){
 document.body.innerHTML='<div id="root"></div>';const root=createRoot(document.querySelector('#root')!);const old=globalThis.fetch;globalThis.fetch=fetcher;const paths:string[]=[];
 const router={push:(path:string)=>{paths.push(path);},replace(){},refresh(){},prefetch(){},back(){},forward(){}};
 try{await act(async()=>root.render(<AppRouterContext.Provider value={router}><PathnameContext.Provider value="/app"><SearchParamsContext.Provider value={new URLSearchParams()}><InstantInteractionProvider><GlobalSearch dict={en}/><button data-outside>Outside</button></InstantInteractionProvider></SearchParamsContext.Provider></PathnameContext.Provider></AppRouterContext.Provider>));await run(paths);}finally{await act(async()=>root.unmount());globalThis.fetch=old;}
}
const results=()=>Response.json({results:[{type:'reading',title:'Reading Test 1',context:'Academic Reading',href:'/app/reading/academic/test-one'}]});
test('global search opens its result once and restoring keyboard focus never reopens the dialog',async()=>{
 await mount(async(paths)=>{
  await fill('reading');const hit=document.querySelector<HTMLButtonElement>('[data-search-result]')!;assert.ok(hit);
  await act(async()=>{hit.focus();hit.click();});assert.deepEqual(paths,['/app/reading/academic/test-one']);assert.equal(document.querySelector('[data-global-search-dialog]'),null);
  await fill('reading');await act(async()=>{const close=document.querySelector<HTMLButtonElement>(`button[aria-label="${en.shell.closeSearch}"]`)!;close.focus();close.click();});
  assert.equal(document.activeElement,input());assert.equal(document.querySelector('[data-global-search-dialog]'),null);
  await fill('reading');await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(document.querySelector('[data-global-search-dialog]'),null);
 },async()=>results());
});
test('search exposes a recoverable failure; the first outside press dismisses it',async()=>{
 let attempts=0;
 await mount(async()=>{
  await fill('reading');assert.ok(document.querySelector('[role="alert"]'));
  await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===en.errorPage.retry)!.click());await act(async()=>new Promise(resolve=>setTimeout(resolve,330)));assert.ok(document.querySelector('[data-search-result]'));
  await act(async()=>document.querySelector('[data-outside]')!.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true})));assert.equal(document.querySelector('[data-global-search-dialog]'),null);
 },async()=>++attempts===1?Response.json({error:'search_unavailable'},{status:503}):results());
});
