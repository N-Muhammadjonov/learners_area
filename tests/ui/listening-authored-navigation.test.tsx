import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import en from '../../src/lib/i18n/en';
import { adaptOriginalTestOne } from '../../src/lib/listening/original-test-one-hooks';

const dom = new JSDOM('<!doctype html><div id="root"></div>', {url:'https://parent.fixture/app'});
for(const key of ['window','document','navigator','localStorage','HTMLElement','Element','Event','MouseEvent','MessageEvent'] as const)
  Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const React = await import('react');
const {act} = React;
const {createRoot} = await import('react-dom/client');
const {AuthoredListeningFrame} = await import('../../src/components/listening/AuthoredListeningFrame');
const {privateResources} = await import('../../src/lib/client/private-resource');
const source = adaptOriginalTestOne(readFileSync('content/listening/academic/test-01/source.html','utf8'));
const content = {nativePersistence:true,runtime:{entryPath:'source.html',files:{'source.html':source}},audioUrl:'/api/resources/fixture.mp3',audioPath:'audio/full.mp3',imageUrl:null,imagePath:null,vocabulary:[]};

test('all nine authored activities hide the library bar, returning to the hub restores it; foreign messages cannot change it',async()=>{
  const oldFetch=globalThis.fetch,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
  let child:JSDOM|undefined,initial:{html:string}|undefined;
  const root=createRoot(document.getElementById('root')!);
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url.endsWith('/authored-state'))return {ok:true,json:async()=>({values:{}})} as Response;
    if(url.endsWith('/authored'))return {ok:true,json:async()=>content} as Response;
    return {ok:true,blob:async()=>new Blob(['fixture audio'])} as Response;
  };
  URL.createObjectURL=()=> 'blob:https://parent.fixture/fixture';URL.revokeObjectURL=()=>{};
  try{
    await act(async()=>{root.render(<AuthoredListeningFrame id="fixture" userId="student" dict={en}/>);});
    const iframe=document.querySelector('iframe')!;
    assert.ok(iframe,document.body.innerHTML);
    const sourceWindow=iframe.contentWindow!;
    sourceWindow.postMessage=(data)=>{initial=data;};
    await act(async()=>{iframe.dispatchEvent(new dom.window.Event('load'));});
    assert.ok(initial);
    const host={postMessage(data:unknown){dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data,source:sourceWindow}));}};
    await act(async()=>{
      child=new JSDOM(initial!.html,{runScripts:'dangerously',url:'https://opaque.fixture',beforeParse(w){
        Object.defineProperty(w,'parent',{value:host});w.scrollTo=()=>{};w.HTMLMediaElement.prototype.pause=()=>{};
      }});
      await new Promise(resolve=>setTimeout(resolve,0));
    });
    const section=document.querySelector('[data-authored-listening]')!;
    assert.equal(section.hasAttribute('data-activity-active'),false,'hub keeps the Listening control');
    for(const id of ['exam','review','script','mcq','map','multi','completion','vocab','retry']){
      await act(async()=>{child!.window.document.querySelector<HTMLButtonElement>(`[data-open="${id}"]`)!.click();await Promise.resolve();});
      assert.equal(section.getAttribute('data-activity-active'),'true',id);
      await act(async()=>{child!.window.document.querySelector<HTMLButtonElement>(`#activity-${id} .activity-top button`)!.click();await Promise.resolve();});
      assert.equal(section.hasAttribute('data-activity-active'),false,`${id} returns to hub`);
    }
    await act(async()=>{window.dispatchEvent(new dom.window.MessageEvent('message',{source:sourceWindow,data:{channel:'learners-area-authored-v1',token:'foreign-token',op:'view',hub:false}}));});
    assert.equal(section.hasAttribute('data-activity-active'),false);
  }finally{
    child?.window.close();await act(async()=>root.unmount());globalThis.fetch=oldFetch;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;
  }
});

test('split audio and map load together; frame receives every Blob only after all are ready; another test evicts reuse',async()=>{
 const oldFetch=globalThis.fetch,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
 const pending:{url:string;finish:()=>void}[]=[];
 const split={...content,storageKey:'la_listening_test_8_v2',audioUrl:'/api/resources/part-1.mp3',audioPath:'audio/part-1.mp3',additionalAudio:[{path:'audio/part-2.mp3',url:'/api/resources/part-2.mp3'},{path:'audio/part-3.mp3',url:'/api/resources/part-3.mp3'}],imagePath:'images/map.png',imageUrl:'/api/resources/map.png',runtime:{entryPath:'source.html',files:{'source.html':'<!doctype html><html><head></head><body><audio src="[embedded:audio/part-1.mp3]"></audio><script>const parts=["[embedded:audio/part-2.mp3]","[embedded:audio/part-3.mp3]"];</script><img src="[embedded:images/map.png]"></body></html>'}}};
 let current=split as typeof content|typeof split,created=0;
 globalThis.fetch=async input=>{const url=String(input);if(url.endsWith('/authored'))return {ok:true,json:async()=>current} as Response;if(url.endsWith('/authored-state'))return {ok:true,json:async()=>({values:{}})} as Response;return {ok:true,blob:()=>new Promise<Blob>(resolve=>pending.push({url,finish:()=>resolve(new Blob(['media']))}))} as Response;};
 URL.createObjectURL=()=>`blob:https://parent.fixture/${++created}`;URL.revokeObjectURL=()=>{};
 let root=createRoot(document.getElementById('root')!);
 try{
  privateResources.setScope('student');
  await act(async()=>root.render(<AuthoredListeningFrame id="split" userId="student" dict={en}/>));
  assert.equal(pending.length,4,'all three audio requests and map start before any finishes');assert.equal(document.querySelector('iframe'),null,'existing all-assets-before-init contract remains');
  await act(async()=>{pending.forEach(p=>p.finish());});
  const iframe=document.querySelector('iframe')!;assert.ok(iframe);
  let initial:{html:string;assets:Record<string,Blob>}|undefined;
  iframe.contentWindow!.postMessage=data=>{initial=data;};
  await act(async()=>iframe.dispatchEvent(new dom.window.Event('load')));
  assert.equal(Object.keys(initial!.assets).length,4);assert.doesNotMatch(initial!.html,/\[embedded:/);
  assert.match(initial!.html,/la_listening_test_8_v2/);assert.equal(privateResources.size(),3,'only this test audio is retained');
  await act(async()=>root.unmount());current=content;root=createRoot(document.getElementById('root')!);
  await act(async()=>root.render(<AuthoredListeningFrame id="next" userId="student" dict={en}/>));
  await act(async()=>pending.at(-1)!.finish());
  assert.equal(privateResources.size(),1,'moving to another test does not accumulate recordings');
 }finally{await act(async()=>root.unmount());privateResources.setScope(null);globalThis.fetch=oldFetch;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
});

test('repeat opening reuses only the original audio, rechecks auth/state, and clears reuse on account change',async()=>{
  const oldFetch=globalThis.fetch,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
  let audioReads=0,metadataReads=0,stateReads=0,denied=false;
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url.endsWith('/authored-state')){stateReads++;return {ok:true,json:async()=>({values:{}})} as Response;}
    if(url.endsWith('/authored')){metadataReads++;return {ok:!denied,json:async()=>content} as Response;}
    audioReads++;return {ok:true,blob:async()=>new Blob(['fixture audio'])} as Response;
  };
  URL.createObjectURL=()=> 'blob:https://parent.fixture/fixture';URL.revokeObjectURL=()=>{};
  async function visit(userId:string,allowed=true){
    const root=createRoot(document.getElementById('root')!);
    try{
      await act(async()=>{root.render(<AuthoredListeningFrame id="fixture" userId={userId} dict={en}/>);});
      assert.equal(!!document.querySelector('iframe'),allowed);
    }finally{await act(async()=>root.unmount());}
  }
  try{
    privateResources.setScope('student');
    await visit('student');await visit('student');
    assert.equal(audioReads,1,'full MP3 is not downloaded again for a repeat visit');
    assert.equal(metadataReads,2,'authorization/publication and source are read fresh');
    assert.equal(stateReads,2,'checkpoint is never reused from memory');
    assert.equal(privateResources.size(),1,'only the audio Blob is cached');
    denied=true;await visit('student',false);assert.equal(audioReads,1,'denied metadata does not deliver cached audio into a frame');
    denied=false;privateResources.setScope('other');await visit('other');assert.equal(audioReads,2,'another account cannot reuse the previous account audio');
    privateResources.setScope(null);assert.equal(privateResources.size(),0,'logout clears the Blob');
  }finally{privateResources.setScope(null);globalThis.fetch=oldFetch;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
});
