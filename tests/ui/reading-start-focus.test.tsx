import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom=new JSDOM('<html lang="en"><body><div id="root"></div></body></html>',{url:'http://localhost/app/reading/academic/set'});
for(const key of ['window','document','HTMLElement','Element','Node','navigator'] as const)Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react');Object.assign(globalThis,{React});
const {act}=React;const {createRoot}=await import('react-dom/client');
const {AppRouterContext}=await import('next/dist/shared/lib/app-router-context.shared-runtime');
const {StartPassageButton}=await import('../../src/components/reading/StartPassageButton');
const ATTEMPT='11111111-1111-4111-8111-111111111111';
for(const success of [true,false])test(`Academic focus Start works without the shell provider: ${success?'server-owned navigation':'failed request releases the button'}`,async()=>{
  document.body.innerHTML='<div id="root"></div>';
  const root=createRoot(document.querySelector('#root')!);const pushed:string[]=[];const requests:{url:string;body:unknown}[]=[];
  const router={push:(url:string)=>pushed.push(url),back(){},forward(){},replace(){},refresh(){},prefetch(){}};
  const original=globalThis.fetch;
  globalThis.fetch=(async(url,options)=>{requests.push({url:String(url),body:JSON.parse(String(options?.body))});return new Response(JSON.stringify(success?{id:ATTEMPT}:{error:'unknown'}),{status:success?200:503,headers:{'Content-Type':'application/json'}});}) as typeof fetch;
  try{
    await act(async()=>root.render(<AppRouterContext.Provider value={router as never}><StartPassageButton setId="authored-set" label="Start" requestedType="matching_headings"/></AppRouterContext.Provider>));
    assert.equal(document.querySelector('button')?.textContent,'Start');
    await act(async()=>{document.querySelector<HTMLButtonElement>('button')!.click();});
    assert.deepEqual(requests,[{url:'/api/reading/academic',body:{setId:'authored-set'}}]);
    assert.deepEqual(pushed,success?[`/app/reading/attempts/${ATTEMPT}?type=matching_headings`]:[]);
    assert.equal(document.querySelector<HTMLButtonElement>('button')!.disabled,false);
    if(!success)assert.ok(document.querySelector('[data-passage-action-error]'));
  }finally{globalThis.fetch=original;await act(async()=>root.unmount());}
});
