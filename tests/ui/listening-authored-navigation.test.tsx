import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import en from '../../src/lib/i18n/en';
import { adaptOriginalTestOne } from '../../src/lib/listening/original-test-one-hooks';
import {originalCourseSpec,readCourseWork,mergeCourseAnswers,courseStatus} from '../../src/lib/listening/course-progress';

const dom = new JSDOM('<!doctype html><div id="root"></div>', {url:'https://parent.fixture/app'});
for(const key of ['window','document','navigator','localStorage','HTMLElement','Element','Event','MouseEvent','MessageEvent'] as const)
  Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,Audio:dom.window.Audio});
dom.window.HTMLMediaElement.prototype.pause=()=>{};dom.window.HTMLMediaElement.prototype.load=()=>{};dom.window.HTMLMediaElement.prototype.play=()=>Promise.resolve();
const React = await import('react');
const {act} = React;
const {createRoot} = await import('react-dom/client');
const {AuthoredListeningFrame} = await import('../../src/components/listening/AuthoredListeningFrame');
const source = adaptOriginalTestOne(readFileSync('content/listening/academic/test-01/source.html','utf8'));
const content = {nativePersistence:true,runtime:{entryPath:'source.html',files:{'source.html':source}},audioUrl:'/api/resources/fixture.mp3',audioPath:'audio/full.mp3',imageUrl:null,imagePath:null,vocabulary:[]};

test('activity progress changes only after a server acknowledgement; a foreign frame/token cannot submit coursework',async()=>{
 const previousFetch=globalThis.fetch,previousCreate=URL.createObjectURL,previousRevoke=URL.revokeObjectURL;
 const spec=originalCourseSpec('listening-test-1')!;let work=readCourseWork({},spec);
 let initial:{html:string}|undefined,child:JSDOM|undefined,requests=0,release:(()=>void)|undefined;
 const wait=new Promise<void>(resolve=>{release=resolve;});
 const root=createRoot(document.getElementById('root')!);
 globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(url.endsWith('/authored'))return {ok:true,json:async()=>({...content,course:courseStatus(spec,work)})} as Response;
  if(url.endsWith('/authored-state'))return {ok:true,json:async()=>({values:{}})} as Response;
  if(url.endsWith('/progress')){requests++;const body=JSON.parse(String(init?.body));await wait;work=mergeCourseAnswers(spec,work,body.activity,body.answers);return {ok:true,json:async()=>courseStatus(spec,work)} as Response;}
  if(url.includes('capability=1'))return {ok:true,json:async()=>({url:'https://media.fixture/audio',key:'fixture.mp3',expiresAt:Date.now()+60000})} as Response;
  return {ok:true,blob:async()=>new Blob(['fixture audio'])} as Response;
 };
 URL.createObjectURL=()=> 'blob:https://parent.fixture/course';URL.revokeObjectURL=()=>{};
 try{
  await act(async()=>root.render(<AuthoredListeningFrame id="course" userId="course-student" dict={en}/>));
  const iframe=document.querySelector('iframe')!,sourceWindow=iframe.contentWindow!;
  const host={postMessage(data:unknown){dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data,source:sourceWindow}));}};
  sourceWindow.postMessage=data=>{if(data.channel==='learners-area-sandbox-init')initial=data;else child?.window.dispatchEvent(new child.window.MessageEvent('message',{data,source:host as unknown as Window}));};
  await act(async()=>iframe.dispatchEvent(new dom.window.Event('load')));
  await act(async()=>{child=new JSDOM(initial!.html,{runScripts:'dangerously',url:'https://opaque.fixture',beforeParse(w){Object.defineProperty(w,'parent',{value:host});w.scrollTo=()=>{};w.requestAnimationFrame=callback=>{queueMicrotask(()=>callback(0));return 1;};w.HTMLMediaElement.prototype.pause=()=>{};}});await Promise.resolve();});
  const d=child!.window.document;
  await act(async()=>{window.dispatchEvent(new dom.window.MessageEvent('message',{source:sourceWindow,data:{channel:'learners-area-authored-v1',token:'foreign',op:'course',activity:'completion',answers:{fake:'answer'}}}));});
  assert.equal(requests,0);
  await act(async()=>{d.querySelector<HTMLButtonElement>('[data-open="completion"]')!.click();d.querySelector<HTMLInputElement>('#completionAnswer')!.value='an attempted answer';d.querySelector<HTMLButtonElement>('#completionCheck')!.click();await Promise.resolve();});
  assert.equal(requests,1);
  assert.equal(d.querySelector('[data-open="completion"] [data-course-status]')!.textContent,'0 / 27','a client Check does not award completion before the server responds');
  await act(async()=>{release!();await wait;await new Promise(resolve=>setTimeout(resolve,0));});
  assert.equal(d.querySelector('[data-open="completion"] [data-course-status]')!.textContent,'1 / 27');
  assert.equal(courseStatus(spec,work).complete,false,'one answer is never the entire test');
 }finally{release?.();child?.window.close();await act(async()=>root.unmount());globalThis.fetch=previousFetch;URL.createObjectURL=previousCreate;URL.revokeObjectURL=previousRevoke;}
});

test('all nine authored activities hide the library bar, returning to the hub restores it; foreign messages cannot change it',async()=>{
  const oldFetch=globalThis.fetch,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
  let child:JSDOM|undefined,initial:{html:string}|undefined;
  const root=createRoot(document.getElementById('root')!);
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url.endsWith('/authored-state'))return {ok:true,json:async()=>({values:{}})} as Response;
    if(url.endsWith('/authored'))return {ok:true,json:async()=>content} as Response;
    if(url.includes('capability=1'))return {ok:true,json:async()=>({url:'https://media.fixture/audio',key:'fixture.mp3',expiresAt:Date.now()+60000})} as Response;
  return {ok:true,blob:async()=>new Blob(['fixture audio'])} as Response;
  };
  URL.createObjectURL=()=> 'blob:https://parent.fixture/fixture';URL.revokeObjectURL=()=>{};
  try{
    await act(async()=>{root.render(<AuthoredListeningFrame id="fixture" userId="student" dict={en}/>);});
    const iframe=document.querySelector('iframe')!;
    assert.ok(iframe,document.body.innerHTML);
    const sourceWindow=iframe.contentWindow!;
    sourceWindow.postMessage=(data)=>{if(data.channel==='learners-area-sandbox-init')initial=data;else child?.window.dispatchEvent(new child.window.MessageEvent('message',{data,source:host as unknown as Window}));};
    await act(async()=>{iframe.dispatchEvent(new dom.window.Event('load'));});
    assert.ok(initial);
    const host={postMessage(data:unknown){dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data,source:sourceWindow}));}};
    await act(async()=>{
      child=new JSDOM(initial!.html,{runScripts:'dangerously',url:'https://opaque.fixture',beforeParse(w){
        Object.defineProperty(w,'parent',{value:host});w.scrollTo=()=>{};w.requestAnimationFrame=callback=>{queueMicrotask(()=>callback(0));return 1;};w.HTMLMediaElement.prototype.pause=()=>{};
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

test('original hub renders before media or saved state; controls wait for authoritative hydration and media starts only after paint',async()=>{
 const oldFetch=globalThis.fetch,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
 let initial:{html:string;assets:Record<string,Blob>}|undefined,child:JSDOM|undefined,stateRelease:((value:unknown)=>void)|undefined;
 const requests:string[]=[];const checkpoint=new Promise(resolve=>{stateRelease=resolve;});
 const root=createRoot(document.getElementById('root')!);
 globalThis.fetch=async input=>{const url=String(input);requests.push(url);if(url.endsWith('/authored'))return {ok:true,json:async()=>content} as Response;if(url.endsWith('/authored-state'))return {ok:true,json:()=>checkpoint} as Response;if(url.includes('capability=1'))return {ok:true,json:async()=>({url:'https://media.fixture/audio',key:'fixture.mp3',expiresAt:Date.now()+60000})} as Response;throw Error('Unexpected full media download');};
 URL.createObjectURL=()=> 'blob:https://parent.fixture/fixture';URL.revokeObjectURL=()=>{};
 try {
  await act(async()=>root.render(<AuthoredListeningFrame id="hub-first" userId="student" dict={en}/>));
  const iframe=document.querySelector('iframe')!;assert.ok(iframe,'authorized hub does not wait for the checkpoint or audio');
  assert.equal(requests.some(url=>url.includes('capability=')),false,'no media preparation before the hub paints');
  const sourceWindow=iframe.contentWindow!,paintCallbacks:FrameRequestCallback[]=[];
  const host={postMessage(data:unknown){dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data,source:sourceWindow}));}};
  sourceWindow.postMessage=data=>{if(data.channel==='learners-area-sandbox-init')initial=data;else child?.window.dispatchEvent(new child.window.MessageEvent('message',{data,source:host as unknown as Window}));};
  await act(async()=>iframe.dispatchEvent(new dom.window.Event('load')));
  assert.equal(Object.keys(initial!.assets).length,0,'original audio bytes are never copied into the opaque frame');
  assert.doesNotMatch(initial!.html,/https:\/\/media\.fixture/);
  await act(async()=>{child=new JSDOM(initial!.html,{runScripts:'dangerously',url:'https://opaque.fixture',beforeParse(w){Object.defineProperty(w,'parent',{value:host});w.scrollTo=()=>{};w.requestAnimationFrame=callback=>{paintCallbacks.push(callback);return paintCallbacks.length;};}});await Promise.resolve();});
  const d=child!.window.document;
  assert.equal(d.querySelectorAll('[data-open]').length,9);
  d.querySelector<HTMLButtonElement>('[data-open="exam"]')!.click();
  assert.equal(d.querySelector('.activity.active'),null,'an unresolved checkpoint cannot start a fresh/stale attempt');
  assert.equal(requests.some(url=>url.includes('capability=')),false);
  await act(async()=>{paintCallbacks.shift()!(0);paintCallbacks.shift()!(0);await Promise.resolve();});
  assert.equal(requests.filter(url=>url.includes('capability=1')).length,1,'background native media preparation begins after the paint handshake');
  await act(async()=>{stateRelease!({values:{la_listening_test_1_v2:JSON.stringify({attemptStatus:'in_progress',answers:{1:'saved answer'},audioPosition:12,attemptKey:'saved-attempt'})}});await checkpoint;await new Promise(resolve=>setTimeout(resolve,0));});
  assert.equal(document.querySelector('iframe'),iframe,'hydration never remounts the original document');
  await act(async()=>d.querySelector<HTMLButtonElement>('[data-open="exam"]')!.click());
  assert.equal(d.querySelector('#startTestBtn')!.textContent,'Resume Test','server checkpoint is reconciled before controls become usable');
  assert.equal(child!.window.eval('state.answers[1]'),'saved answer');
  assert.equal(requests.some(url=>url.includes('download=')),false);
 }finally{child?.window.close();await act(async()=>root.unmount());globalThis.fetch=oldFetch;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
});

test('generic authored compatibility still waits for its inert media Blobs',async()=>{
 const oldFetch=globalThis.fetch,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
 let finish:(()=>void)|undefined;const blob=new Promise<Blob>(resolve=>{finish=()=>resolve(new Blob(['legacy audio']));});
 const root=createRoot(document.getElementById('root')!);
 globalThis.fetch=async input=>String(input).endsWith('/authored')?{ok:true,json:async()=>({...content,nativePersistence:false})} as Response:{ok:true,blob:()=>blob} as Response;
 URL.createObjectURL=()=> 'blob:https://parent.fixture/legacy';URL.revokeObjectURL=()=>{};
 try{await act(async()=>root.render(<AuthoredListeningFrame id="legacy" userId="student" dict={en}/>));assert.equal(document.querySelector('iframe'),null);await act(async()=>finish!());assert.ok(document.querySelector('iframe'));}
 finally{await act(async()=>root.unmount());globalThis.fetch=oldFetch;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
});

test('a stale offline outbox hydrates the newer saved attempt, keeps an exportable copy, and allows later practice saves',async()=>{
 const oldFetch=globalThis.fetch,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
 const storageKey='la_listening_test_1_v2',stateKey='la-authored-listening:conflict-student:conflict';
 const offline={[storageKey]:JSON.stringify({attemptKey:'11111111-1111-4111-8111-111111111111',attemptStatus:'exited',answers:{1:'unsent answer'},submitted:false})};
 const canonical={[storageKey]:JSON.stringify({attemptKey:'22222222-2222-4222-8222-222222222222',attemptStatus:'exited',answers:{1:'saved answer'},submitted:false})};
 localStorage.setItem(stateKey+':pending',JSON.stringify(offline));
 let initial:{html:string}|undefined,child:JSDOM|undefined;
 const writes:Record<string,string>[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(url.endsWith('/authored'))return Response.json(content);
  if(url.endsWith('/authored-state')){
   if(init?.method==='PUT'){
    const values=JSON.parse(String(init.body));writes.push(values);
    return writes.length===1?Response.json({error:'stale_checkpoint',values:canonical},{status:409}):Response.json({values});
   }
   return Response.json({values:canonical});
  }
  if(url.includes('capability=1'))return Response.json({url:'https://media.fixture/audio',key:'fixture.mp3',expiresAt:Date.now()+60000});
  return new Response(new Blob(['fixture audio']));
 };
 URL.createObjectURL=()=> 'blob:https://parent.fixture/conflict';URL.revokeObjectURL=()=>{};
 const root=createRoot(document.getElementById('root')!);
 try{
  await act(async()=>root.render(<AuthoredListeningFrame id="conflict" userId="conflict-student" dict={en}/>));
  const iframe=document.querySelector('iframe')!,sourceWindow=iframe.contentWindow!;
  const host={postMessage(data:unknown){dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data,source:sourceWindow}));}};
  sourceWindow.postMessage=data=>{if(data.channel==='learners-area-sandbox-init')initial=data;else child?.window.dispatchEvent(new child.window.MessageEvent('message',{data,source:host as unknown as Window}));};
  await act(async()=>iframe.dispatchEvent(new dom.window.Event('load')));
  await act(async()=>{child=new JSDOM(initial!.html,{runScripts:'dangerously',url:'https://opaque.fixture',beforeParse(w){Object.defineProperty(w,'parent',{value:host});w.scrollTo=()=>{};w.requestAnimationFrame=callback=>{queueMicrotask(()=>callback(0));return 1;};w.HTMLMediaElement.prototype.pause=()=>{};}});await new Promise(resolve=>setTimeout(resolve,0));});
  assert.equal(document.querySelector('[role="alert"]'),null);
  assert.match(document.querySelector('[data-checkpoint-recovered]')!.textContent!,/latest saved test/);
  assert.equal(localStorage.getItem(stateKey+':pending'),null);
  const archives=Object.keys(localStorage).filter(key=>key.startsWith(stateKey+':conflict:'));
  assert.equal(archives.length,1);
  assert.deepEqual(JSON.parse(localStorage.getItem(archives[0]!)!).drafts,[offline]);
  assert.deepEqual(JSON.parse(child!.window.localStorage.getItem(storageKey)!),JSON.parse(canonical[storageKey]));
  assert.equal(document.querySelector('[data-checkpoint-recovered] button')!.textContent,en.fullListeningHub.downloadUnsentWork);
  const d=child!.window.document;
  await act(async()=>{d.querySelector<HTMLButtonElement>('[data-open="script"]')!.click();await new Promise(resolve=>setTimeout(resolve,500));});
  assert.ok(writes.length>=2,'a practice update saves after conflict recovery');
  assert.equal(JSON.parse(writes.at(-1)![storageKey]!).attemptKey,JSON.parse(canonical[storageKey]).attemptKey,'subsequent writes use the saved attempt, not the stale offline key');
 }finally{
  child?.window.close();await act(async()=>root.unmount());globalThis.fetch=oldFetch;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;
  for(const key of Object.keys(localStorage))if(key.startsWith(stateKey))localStorage.removeItem(key);
 }
});

test('an in-flight conflict archives later queued work and remounts once without replaying stale writes',async()=>{
 const oldFetch=globalThis.fetch,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
 const key='la_listening_test_1_v2',stateKey='la-authored-listening:queued-student:queued';
 const old={attemptKey:'11111111-1111-4111-8111-111111111111',attemptStatus:'exited',answers:{1:'first offline'}};
 const first={[key]:JSON.stringify(old)},last={[key]:JSON.stringify({...old,answers:{1:'later offline'}})};
 const saved={[key]:JSON.stringify({...old,attemptKey:'22222222-2222-4222-8222-222222222222',answers:{1:'newer saved'}})};
 let initial:{html:string}|undefined,contentReads=0,writeCount=0,release:((response:Response)=>void)|undefined;
 const blocked=new Promise<Response>(resolve=>{release=resolve;});
 globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(url.endsWith('/authored')){contentReads++;return Response.json(content);}
  if(url.endsWith('/authored-state')){if(init?.method==='PUT'){writeCount++;return blocked;}return Response.json({values:contentReads>1?saved:first});}
  if(url.includes('capability=1'))return Response.json({url:'https://media.fixture/audio',key:'fixture.mp3',expiresAt:Date.now()+60000});
  return new Response(new Blob(['fixture']));
 };
 URL.createObjectURL=()=> 'blob:https://parent.fixture/queued';URL.revokeObjectURL=()=>{};
 const root=createRoot(document.getElementById('root')!);
 try{
  await act(async()=>root.render(<AuthoredListeningFrame id="queued" userId="queued-student" dict={en}/>));
  const iframe=document.querySelector('iframe')!,sourceWindow=iframe.contentWindow!;
  sourceWindow.postMessage=data=>{if(data.channel==='learners-area-sandbox-init')initial=data;};
  await act(async()=>iframe.dispatchEvent(new dom.window.Event('load')));
  const token=JSON.parse(/const token=("[^"]+"), initial=/.exec(initial!.html)![1]!);
  const send=(op:string,rest={})=>window.dispatchEvent(new dom.window.MessageEvent('message',{source:sourceWindow,data:{channel:'learners-area-authored-v1',token,op,...rest}}));
  await act(async()=>{send('hub-ready');send('hydrated');send('storage',{values:first});send('storage',{values:last});await Promise.resolve();});
  assert.equal(writeCount,1);
  await act(async()=>{release!(Response.json({error:'stale_checkpoint',values:saved},{status:409}));await new Promise(resolve=>setTimeout(resolve,0));});
  assert.equal(writeCount,1,'the queued stale snapshot must never reach the server');
  assert.equal(contentReads,2,'only one fresh hydration is needed');
  assert.notEqual(document.querySelector('iframe'),iframe,'the old in-memory attempt cannot keep writing after recovery');
  assert.equal(localStorage.getItem(stateKey+':pending'),null);
  const backupKey=Object.keys(localStorage).find(k=>k.startsWith(stateKey+':conflict:'))!;
  assert.deepEqual(JSON.parse(localStorage.getItem(backupKey)!).drafts,[first,last]);
  assert.ok(document.querySelector('[data-checkpoint-recovered]'));
  assert.equal(document.querySelector('[role="alert"]'),null);
 }finally{
  release?.(Response.json({values:saved}));await act(async()=>root.unmount());globalThis.fetch=oldFetch;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;
  for(const item of Object.keys(localStorage))if(item.startsWith(stateKey))localStorage.removeItem(item);
 }
});
