import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost/app/listening/mcq/day/1"});
for(const key of ["window","document","navigator","HTMLElement","Element","Node","Event","MouseEvent"] as const)Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,self:dom.window});
const React=await import("react");Object.assign(globalThis,{React});const {act}=React;
const {createRoot}=await import("react-dom/client");const {AppRouterContext}=await import("next/dist/shared/lib/app-router-context.shared-runtime");
const {McqMastery}=await import("../../src/components/listening/McqMastery");
for(const multiple of [false,true])test(`MCQ DOM ${multiple ? "checkbox" : "radio"} selection and completed Day next action`,async()=>{
 let body:Record<string,unknown>={};let refreshed=0;let replaced="";
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{body=JSON.parse(String(init?.body));return Response.json({session:{id:"s",stage:init?.method==="PATCH"?"reasoned":"revealed"},question:{id:"q",order:1,questionText:"Prompt"},options:["A) One","B) Two"],multiple,next:init?.method==="PATCH"?null:{to:"chosen",field:"chosenAnswer",minLength:1}});};
 const root=createRoot(document.getElementById("root")!);
 try{
  await act(async()=>root.render(<AppRouterContext.Provider value={{back(){},forward(){},refresh(){refreshed++;},push(){},replace(href){replaced=href;},prefetch(){}}}><McqMastery dict={en} questions={[{id:"q",order:1,questionText:"Prompt",stage:"revealed"}]} dayNavigation={{currentHref:"/app/listening/mcq/day/1?q=1",nextHref:"/app/listening/mcq/day/1?q=2"}}/></AppRouterContext.Provider>));
  assert.equal(document.querySelector("[data-mcq-options]"),null);
  await act(async()=>document.querySelector<HTMLButtonElement>("[data-mcq-open]")!.click());
  const choices=[...document.querySelectorAll<HTMLInputElement>(`input[type=${multiple?"checkbox":"radio"}]`)];assert.equal(choices.length,2);
  await act(async()=>choices[0]!.click());if(multiple)await act(async()=>choices[1]!.click());
  await act(async()=>document.querySelector<HTMLButtonElement>("[data-mcq-advance]")!.click());
  assert.equal(body.text,multiple?'["A) One","B) Two"]':"A) One");assert.equal(refreshed,1);assert.match(replaced,/q=1$/);
  assert.equal(document.querySelector("[data-mcq-next]")?.getAttribute("href"),"/app/listening/mcq/day/1?q=2");
 }finally{await act(async()=>root.unmount());globalThis.fetch=original;}
});
