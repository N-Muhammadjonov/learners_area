import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/reading'});
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','navigator'] as const) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react');Object.assign(globalThis,{React});
const {act}=React;const {createRoot}=await import('react-dom/client');
const {ReadingHighlightedText,useReadingHighlights}=await import('../../src/components/reading/ReadingHighlights');
function Surface({scope,text='first text'}:{scope:string;text?:string}) {
 const forText=useReadingHighlights(scope), controls=forText(text,text);
 return <><button id="add" onClick={()=>controls.onHighlightRange({start:0,end:5})}>Add</button><ReadingHighlightedText dict={en} sourceType="reading" sourceId={scope} text={text} lexicalAssistance={false} {...controls}/></>;
}
test('READ-HIGHLIGHT text/owner isolation, passage tabs retain, remount/reload clears; no storage contract invented',async()=>{
 const root=createRoot(document.querySelector('#root')!);
 const render=async(scope:string,text?:string)=>act(async()=>root.render(<Surface scope={scope} text={text}/>));
 try {
  await render('A:attempt1');await act(async()=>(document.querySelector('#add') as HTMLButtonElement).click());
  assert.equal(document.querySelector('mark')?.textContent,'first');
  await render('A:attempt1','other passage');assert.equal(document.querySelector('mark'),null);
  await render('A:attempt1');assert.equal(document.querySelector('mark')?.textContent,'first');
  await render('B:attempt1');assert.equal(document.querySelector('mark'),null);
  await render('A:attempt2');assert.equal(document.querySelector('mark'),null);
  await render('A:attempt1','edited text');assert.equal(document.querySelector('mark'),null);
 }finally{await act(async()=>root.unmount());}
 const fresh=createRoot(document.querySelector('#root')!);
 try{await act(async()=>fresh.render(<Surface scope="A:attempt1"/>));assert.equal(document.querySelector('mark'),null);}
 finally{await act(async()=>fresh.unmount());}
});
