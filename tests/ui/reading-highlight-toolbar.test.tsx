import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import en from '../../src/lib/i18n/en';
const dom=new JSDOM('<div id="root"></div>');for(const key of ['window','document','navigator','HTMLElement','Element','Node','NodeFilter','Event','MouseEvent'] as const)Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react');Object.assign(globalThis,{React});const {act}=React;const {createRoot}=await import('react-dom/client');const {ReadingHighlightedText}=await import('../../src/components/reading/ReadingHighlights');
test('Remove highlight exists only over a selected saved highlight; first outside press dismisses it',async()=>{
 const root=createRoot(document.querySelector('#root')!),removed:string[]=[];
 try{
  await act(async()=>root.render(<ReadingHighlightedText dict={en} text="first word" sourceType="reading" sourceId="x" lexicalAssistance={false} highlights={[{id:'saved',start:0,end:5}]} onHighlightRange={()=>{}} onRemoveHighlight={id=>removed.push(id)}/>));
  assert.equal(document.querySelector('[data-reading-remove-highlight]'),null);assert.equal(document.querySelector('button'),null);
  const text=document.querySelector('mark')!.firstChild!,range=document.createRange();range.setStart(text,0);range.setEnd(text,5);window.getSelection()!.addRange(range);
  Object.defineProperty(range,'getBoundingClientRect',{value:()=>({left:220,top:100,width:40})});
  await act(async()=>document.querySelector('[data-highlight-surface]')!.dispatchEvent(new dom.window.MouseEvent('mouseup',{bubbles:true})));
  const toolbar=document.querySelector<HTMLElement>('[data-highlight-control]')!;assert.ok(toolbar);assert.equal(toolbar.style.top,'56px');assert.equal(toolbar.querySelector('button')!.textContent,en.listening.general.clearHighlight);
  await act(async()=>toolbar.querySelector('button')!.click());assert.deepEqual(removed,['saved']);assert.equal(document.querySelector('[data-highlight-control]'),null);
 }finally{await act(async()=>root.unmount());}
});
