import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import en from '../../src/lib/i18n/en';
const dom=new JSDOM('<div id="root"></div>',{url:'https://local.fixture/'});
for(const key of ['window','document','navigator','HTMLElement','Element','Event','MouseEvent','KeyboardEvent'] as const)Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,ResizeObserver:class{observe(){}disconnect(){}}});
const React=await import('react');Object.assign(globalThis,{React});const {act}=React;
const {createRoot}=await import('react-dom/client');
const {ClickableText}=await import('../../src/components/vocabulary/ClickableText');
for(const sourceType of ['reading','listening','retention'])test(`${sourceType}: single click does nothing; double click resolves and saves the whole authored phrase`,async()=>{
  const root=createRoot(document.getElementById('root')!),oldFetch=globalThis.fetch;
  const requests:{url:string;body?:Record<string,unknown>}[]=[];
  globalThis.fetch=async(input,init)=>{
    const url=String(input);requests.push({url,body:init?.body?JSON.parse(String(init.body)):undefined});
    return Response.json(url.includes('folders')?{folders:[]}:init?.method==='POST'?{ok:true}:{status:'resolved',contextual:{definitionEn:'discover information',translationUz:'bilib olmoq',verificationStatus:'unverified'}});
  };
  try{
    await act(async()=>root.render(<ClickableText dict={en} text="We find out answers." sourceType={sourceType} sourceId="source" occurrences={[{id:'phrase-id',startChar:3,endChar:11,surfaceForm:'find out'}]}/>));
    const word=document.querySelector('[data-word="out"]')!;
    await act(async()=>word.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,detail:1})));
    assert.equal(requests.length,0);assert.equal(document.querySelector('[role="dialog"]'),null);
    await act(async()=>word.dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true,detail:2})));
    assert.equal(document.querySelector('[role="dialog"]')?.getAttribute('aria-label'),'find out');
    assert.ok(requests.some(row=>row.url.includes('occurrenceId=phrase-id')));
    assert.ok(!requests.some(row=>row.url.includes('/search')));
    await act(async()=>document.querySelector<HTMLButtonElement>('[data-word-save]')!.click());
    const saved=requests.find(row=>row.body);
    assert.equal(saved?.body?.occurrenceId,'phrase-id');assert.equal(saved?.body?.sourceType,sourceType);
  }finally{await act(async()=>root.unmount());globalThis.fetch=oldFetch;}
});
