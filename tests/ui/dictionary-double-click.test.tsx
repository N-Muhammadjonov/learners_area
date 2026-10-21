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

test('a stationary 3-second word hold opens the phrase; release, movement, cancel and blank space never do',async(t)=>{
  const root=createRoot(document.getElementById('root')!),oldFetch=globalThis.fetch;
  t.mock.timers.enable({apis:['setTimeout']});
  const requests:string[]=[];
  globalThis.fetch=async input=>{requests.push(String(input));return Response.json(String(input).includes('folders')?{folders:[]}:{status:'resolved',contextual:{definitionEn:'discover information',translationUz:'bilib olmoq'}});};
  const pointer=(target:Element,type:string,x=10)=>target.dispatchEvent(new dom.window.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:10,relatedTarget:document.body}));
  try{
    await act(async()=>root.render(<ClickableText dict={en} text="We find out answers." sourceType="reading" sourceId="hold-source" occurrences={[{id:'hold-phrase',startChar:3,endChar:11,surfaceForm:'find out'}]}/>));
    const word=document.querySelector('[data-word="out"]')!,region=document.querySelector('[data-clickable-text]')!;
    for(const ending of ['pointerup','pointercancel','pointerout','pointermove']){
      await act(async()=>{pointer(word,'pointerdown');pointer(word,ending,30);t.mock.timers.tick(3001);});
      assert.equal(requests.length,0,ending);
    }
    await act(async()=>{pointer(region,'pointerdown');t.mock.timers.tick(3001);pointer(region,'pointerup');});
    assert.equal(requests.length,0,'blank area');
    await act(async()=>{pointer(word,'pointerdown');t.mock.timers.tick(2999);});
    assert.equal(requests.length,0,'not before three seconds');
    await act(async()=>{t.mock.timers.tick(1);});
    assert.equal(document.querySelector('[role="dialog"]')?.getAttribute('aria-label'),'find out');
    assert.ok(requests.some(url=>url.includes('occurrenceId=hold-phrase')));
  }finally{await act(async()=>root.unmount());t.mock.timers.reset();globalThis.fetch=oldFetch;}
});

test('unlinked content words cannot show dictionary choices or select a meaning by spelling',async()=>{
 const root=createRoot(document.getElementById('root')!),oldFetch=globalThis.fetch,calls:{url:string;body?:Record<string,unknown>}[]=[];
 // A stale server response must not restore the removed selector.
 globalThis.fetch=async(input,init)=>{const url=String(input);calls.push({url,body:init?.body?JSON.parse(String(init.body)):undefined});return Response.json(url.includes('folders')?{folders:[]}:{status:'dictionary',releaseId:'release',choices:[{lexemeId:'bank',senseId:'finance',term:'bank',definitionEn:'a financial institution'}]});};
 try{
  await act(async()=>root.render(<ClickableText dict={en} text="The bank borders the river." sourceType="reading" sourceId="source"/>));
  await act(async()=>document.querySelector('[data-word="bank"]')!.dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true,detail:2})));
  assert.ok(calls.some(c=>c.url.includes('/meaning?sourceType=reading')));
  assert.equal(document.querySelector('[data-dictionary-choices]'),null);
  assert.equal(document.querySelector('[data-word-popover] input'),null);
  assert.equal(document.querySelector('[data-word-save]'),null);
  assert.ok(!document.querySelector('[data-word-popover]')!.textContent!.includes('a financial institution'));
  assert.ok(!calls.some(c=>c.body));
  await act(async()=>document.body.dispatchEvent(new dom.window.MouseEvent('pointerdown',{bubbles:true})));
  assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(document.querySelector('[data-lookup-active]'),null);
 }finally{await act(async()=>root.unmount());globalThis.fetch=oldFetch;}
});

test('an authored lookup that is locked never falls through to dictionary choices',async()=>{
 const root=createRoot(document.getElementById('root')!),oldFetch=globalThis.fetch,calls:string[]=[];
 globalThis.fetch=async input=>{const url=String(input);calls.push(url);return url.includes('folders')?Response.json({folders:[]}):Response.json({error:'lexical_assistance_locked'},{status:403});};
 try{
  await act(async()=>root.render(<ClickableText dict={en} text="The bank lends money." sourceType="reading" sourceId="source" occurrences={[{id:'occ',startChar:4,endChar:8,surfaceForm:'bank'}]}/>));
  await act(async()=>document.querySelector('[data-word="bank"]')!.dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true,detail:2})));
  assert.ok(!calls.some(c=>c.includes('/meaning')));assert.equal(document.querySelector('[data-dictionary-choices]'),null);
 }finally{await act(async()=>root.unmount());globalThis.fetch=oldFetch;}
});


test('contextual study material stays visible for saved words and belongs to the selected exact meaning',async()=>{
 const root=createRoot(document.getElementById('root')!),oldFetch=globalThis.fetch;
 const study={synonyms:[{text:'forecast',lexemeId:'forecast-entry',senseId:'forecast-sense'}],collocations:[{text:'accurately predict'}],examples:[{example_id:'example',text_en:'We can predict the weather.',text_uz:'Ob-havoni oldindan ayta olamiz.'}]};
 globalThis.fetch=async input=>Response.json(String(input).includes('folders')?{folders:[]}:{status:'resolved',contextual:{definitionEn:'tell in advance',translationUz:'oldindan aytmoq',study},known:{id:'saved',mastery:'new'}});
 try{
  await act(async()=>root.render(<ClickableText dict={en} text="We predict the weather." sourceType="reading" sourceId="source" occurrences={[{id:'occ',startChar:3,endChar:10,surfaceForm:'predict'}]}/>));
  await act(async()=>document.querySelector('[data-word="predict"]')!.dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true,detail:2})));
  assert.match(document.querySelector('[data-word-synonyms]')!.textContent!,/forecast/);
  assert.match(document.querySelector('[data-word-collocations]')!.textContent!,/accurately predict/);
  assert.match(document.querySelector('[data-word-examples]')!.textContent!,/We can predict the weather/);
  assert.equal(document.querySelector('[data-related-sense]')!.getAttribute('data-related-sense'),'forecast-sense');
 }finally{await act(async()=>root.unmount());globalThis.fetch=oldFetch;}
});

test('two occurrences of bank open their authored meanings and study material automatically without a selector',async()=>{
 const root=createRoot(document.getElementById('root')!),oldFetch=globalThis.fetch;
 const calls:string[]=[];
 globalThis.fetch=async input=>{const url=String(input);calls.push(url);const river=url.includes('occurrenceId=river');return Response.json(url.includes('folders')?{folders:[]}:{status:'resolved',contextual:{definitionEn:river?'Land beside a river':'A financial institution',translationUz:river?'qirg‘oq':'bank',study:{synonyms:[],collocations:[{text:river?'river bank':'bank loan'}],examples:[]}}});};
 try{
  await act(async()=>root.render(<ClickableText dict={en} text="bank bank" sourceType="reading" sourceId="source" occurrences={[{id:'finance',startChar:0,endChar:4,surfaceForm:'bank'},{id:'river',startChar:5,endChar:9,surfaceForm:'bank'}]}/>));
  await act(async()=>document.querySelector('[data-token="0"]')!.dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true,detail:2})));
  assert.match(document.querySelector('[data-word-study]')!.textContent!,/bank loan/);
  assert.match(document.querySelector('[data-word-popover]')!.textContent!,/A financial institution/);
  await act(async()=>document.querySelector('[data-token="2"]')!.dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true,detail:2})));
  assert.match(document.querySelector('[data-word-study]')!.textContent!,/river bank/);
  assert.match(document.querySelector('[data-word-popover]')!.textContent!,/Land beside a river/);
  assert.ok(!document.querySelector('[data-word-study]')!.textContent!.includes('bank loan'));
  assert.equal(document.querySelector('input[type="radio"]'),null);
  assert.equal(document.querySelector('[data-dictionary-choices]'),null);
  assert.ok(calls.some(url=>url.includes('occurrenceId=river')));
  assert.ok(!calls.some(url=>url.includes('/meaning')||url.includes('/search')));
 }finally{await act(async()=>root.unmount());globalThis.fetch=oldFetch;}
});
