import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {url:'http://localhost/listening'});
for (const k of ['window','document','navigator','HTMLElement','HTMLButtonElement','HTMLInputElement','HTMLSelectElement','HTMLAnchorElement','HTMLFormElement','Element','Node','Event','MouseEvent','KeyboardEvent'] as const) Object.defineProperty(globalThis,k,{value:dom.window[k],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,self:globalThis});
const React=await import('react'); Object.assign(globalThis,{React});
const {act}=React; const {createRoot}=await import('react-dom/client');
const {AppRouterContext}=await import('next/dist/shared/lib/app-router-context.shared-runtime');
const {PathnameContext,SearchParamsContext}=await import('next/dist/shared/lib/hooks-client-context.shared-runtime');
const {InstantInteractionProvider}=await import('../../src/components/interaction/InstantInteractionProvider');
const {StartTestButton}=await import('../../src/components/listening/StartTestButton');
async function mount(run:()=>Promise<void>){
 document.body.innerHTML='<div id="root"></div>'; const root=createRoot(document.querySelector('#root')!);
 const router={back(){},forward(){},refresh(){},push(){},replace(){},prefetch(){}};
 try{ await act(async()=>root.render(React.createElement(AppRouterContext.Provider,{value:router as never},React.createElement(PathnameContext.Provider,{value:'/app/listening'},React.createElement(SearchParamsContext.Provider,{value:new URLSearchParams()},React.createElement(InstantInteractionProvider,null,React.createElement(StartTestButton,{testId:'a',label:'Start',messages:en.auth}))))))); await run(); }
 finally{await act(async()=>root.unmount());}
}
test('Listening start survives offline and HTML 503 responses, re-enables button and shows a real failure',async()=>{
 const original=globalThis.fetch;
 try{for(const respond of [async()=>{throw new Error('offline')},async()=>new Response('<html>Unavailable</html>',{status:503})]){
  globalThis.fetch=respond;
  await mount(async()=>{ await act(async()=>document.querySelector<HTMLButtonElement>('button')!.click()); assert.equal(document.querySelector<HTMLButtonElement>('button')!.disabled,false); assert.ok(document.querySelector('[role=alert]')?.textContent); });
 }}finally{globalThis.fetch=original;}
});
test('Listening start sends one write and aborts it when the screen leaves',async()=>{
 const original=globalThis.fetch;let calls=0;let signal:AbortSignal|undefined;
 globalThis.fetch=async(_url,init)=>{calls++;signal=init?.signal as AbortSignal;return new Promise<Response>((_r,reject)=>signal!.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));};
 try{await mount(async()=>{await act(async()=>{document.querySelector<HTMLButtonElement>('button')!.click();document.querySelector<HTMLButtonElement>('button')!.click();}); assert.equal(calls,1);assert.equal(signal?.aborted,false);});assert.equal(signal?.aborted,true);}finally{globalThis.fetch=original;}
});
