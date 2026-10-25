/** V40 Listening Hub and Activity closure matrix (builds on the V39 harness, which is kept unchanged). Synthetic authorized fixtures only; no live
 * acceptance. Every case drives real input (click, tap, keyboard, history) and asserts on visible
 * behavior or on recorded request bodies. Contracts come from js/adapters/listening-v10.js,
 * listening-v7.js and listening-activity-v8.js; selectors come from generated components. */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {publicPolicy,fixtureSession,authoredFixture} from './fixtures.mjs';
import {activityFixture} from './listening-v8-fixtures.mjs';
import en from '../js/i18n/en.js';import uz from '../js/i18n/uz.js';

const deps=path.resolve(import.meta.dirname,'../node_modules');
if(process.platform==='linux'){const tar=path.join(deps,'al2023.tar');fs.writeFileSync(tar,brotliDecompressSync(fs.readFileSync(path.join(deps,'@sparticuz/chromium/bin/al2023.tar.br'))));execFileSync('tar',['xf',tar,'-C',deps]);process.env.LD_LIBRARY_PATH=path.join(deps,'lib')+':'+(process.env.LD_LIBRARY_PATH??'');}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('single-process')&&!a.includes('disable-web-security')&&!a.includes('allow-running-insecure-content')),headless:true});
const base=process.env.PREVIEW_URL??'http://127.0.0.1:4173';
const out=new URL('../docs/evidence/v40/',import.meta.url);fs.mkdirSync(out,{recursive:true});
const results=[];
async function check(name,fn){if(process.env.TEST_FILTER&&!name.includes(process.env.TEST_FILTER))return;try{await fn();results.push({name,status:'PASS'});console.log('PASS',name);}catch(e){results.push({name,status:'FAIL',error:String(e.message).slice(0,700)});console.error('FAIL',name,String(e.message).slice(0,700));}}

const ID='00000000-0000-4000-8000-000000000001';
const ID2='00000000-0000-4000-8000-000000000005';
const ATT='00000000-0000-4000-8000-000000000006';
const dictOf=locale=>locale==='uz'?uz:en;
const hubRoute='/app/listening/tests/'+ID;
const actRoute=n=>hubRoute+'/'+n;
const apiActivity='/api/listening/full/'+ID+'/activity';
// Activity 2 has no typed control on a first attempt (its write is the answers record, empty here); the
// typed-answer surface is activity 3's script gap input (aria-label 'PART n · q'). Fixtures are synthetic.
const firstAttemptAct2=()=>{const a=activityFixture(2,{lexical:false});a.id=ID;a.data.report=null;return a;};
const gapAct3=()=>{const a=activityFixture(3,{lexical:false,modern:true});a.id=ID;return a;};
const gapInput=page=>page.locator('input[aria-label^="PART"]').first();
const apiPractice='/api/listening/full/'+ID+'/practice';
const apiStart='/api/listening/full/'+ID+'/start';

/** Hub payload built to hubDTO's contract (same fields as the V37 visual fixture). */
export function hubData(d,over={}){return {kind:'hub',test:{id:ID,title:'Synthetic listening',publicationState:'published'},meta:{parts:4,questions:40,min:30},cards:[
 {path:'1',activity:1,name:d.fullListeningHub.research.full,tag:d.fullListeningHub.research.examTag,complete:false,latest:null},
 {path:'3',activity:3,name:d.fullListeningHub.research.script,tag:d.fullListeningHub.research.reviewTag,complete:false,latest:null},
 {path:'matching',activity:null,name:d.fullListeningHub.research.matching,tag:d.fullListeningHub.research.reviewTag,complete:false,latest:null}],...over};}

/** Authorized context. view(routeWithoutQuery, ctx) returns undefined (503 isolated), 'abort', {status,json}, or a view DTO.
 * post(path, body, ctx) returns undefined (503), {status,json} or {body}. Every API request is recorded. */
async function fixture({width=1440,height=900,locale='en',theme='day',touch=false,view,post}={}){
 const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
 await context.addCookies([{name:'la_locale',value:locale,url:base},{name:'la_theme',value:theme,url:base}]);
 await context.addInitScript(()=>{window.open=()=>null;});
 const page=await context.newPage();page.setDefaultTimeout(8000);
 const state={requests:[],viewCalls:[]};
 await context.route('**/api/**',async route=>{const r=route.request(),u=new URL(r.url()),p=u.pathname;
  const ct=r.headers()['content-type']??'';
  const body=r.method()==='GET'||!ct.includes('application/json')?null:r.postDataJSON();
  state.requests.push({path:p,method:r.method(),body,query:u.search});
  const json=x=>route.fulfill({json:x});
  if(p==='/api/frontend/public')return json(publicPolicy);
  if(p==='/api/frontend/session')return json(fixtureSession('student'));
  if(p==='/api/notifications')return json({notifications:[],unread:0});
  if(p==='/api/frontend/view'){const key=u.searchParams.get('route')??'';const bare=key.split('?')[0];state.viewCalls.push(key);
   const v=view?await view(bare,{key,page,state}):undefined;
   if(v==='abort')return route.abort();
   if(v&&typeof v==='object'&&'status' in v)return route.fulfill({status:v.status,json:v.json??{error:'synthetic'}});
   if(v)return json({version:1,route:key,data:v});
   return route.fulfill({status:503,json:{error:'isolated_unconfigured'}});}
  if(post){const v=await post(p,r.method()==='GET'?null:body,{state});if(v&&v.raw)return route.fulfill({status:200,body:v.raw.body,contentType:v.raw.contentType,headers:v.raw.headers});if(v&&v.status)return route.fulfill({status:v.status,json:v.json??{error:'synthetic'}});if(v)return json(v.body);}
  return route.fulfill({status:503,json:{error:'isolated_unconfigured'}});});
 return {context,page,state};
}
const url=p=>base+p;
const countOf=(state,p)=>state.requests.filter(r=>r.path===p).length;

// ===================== V40 additions =====================
// Lexical, speech, write-error, stale-response and media lifecycle cases for the Activity route.
// Every case drives real input (click, keyboard, history) and asserts on visible text or recorded requests.
// Mocks: speechSynthesis (a JavaScript stub, not hardware), audio bytes (generated silent WAV), and
// lookup/folder responses (synthetic fixture data). No educational content is created here.
const occId='00000000-0000-4000-8000-0000000000a1';
const speechMock="(()=>{window.__speech={calls:[]};class U{constructor(t){this.text=t;this.lang='';}}window.SpeechSynthesisUtterance=U;window.speechSynthesis={cancel(){window.__speech.calls.push(['cancel']);},speak(u){window.__speech.calls.push(['speak',u.text,u.lang]);}};})();";
const noSpeech="Object.defineProperty(window,'speechSynthesis',{value:undefined,configurable:true});";
const actOf=(n,opts)=>{const a=activityFixture(n,opts);a.id=ID;return a;};
const occFor=text=>{const start=text.indexOf('lookup');return {id:occId,startChar:start,endChar:start+'lookup'.length,surfaceForm:'lookup'};};
const lexAct2=withOcc=>{const a=actOf(2,{lexical:true});if(withOcc)a.occurrences={1:[occFor(a.data.sections[0].transcript)]};return a;};
const silentWavSeconds=seconds=>{const rate=8000,n=rate*seconds,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);return b;};
const lookupOk={body:{status:'resolved',known:null,contextual:{definitionEn:'Synthetic meaning',translationUz:null,verificationStatus:'verified',partOfSpeech:'noun',sourceLabel:'Synthetic'}}};
const hubView=d=>p=>p===hubRoute?hubData(d):undefined;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Polls inside the page with page.evaluate (CDP, not eval-string); page CSP blocks Playwright's waitForFunction predicates.
async function pollPage(page,fn,timeoutMs){const end=Date.now()+timeoutMs;while(Date.now()<end){if(await page.evaluate(fn))return;await sleep(100);}throw new Error('pollPage timed out');}

// ---------- SPEECH (Activity 5 Say it; original FullListeningActivity.tsx lines 508-520) ----------
await check('V40 activity 5 Say it: each activation cancels then speaks the term in en-GB; focus stays on the button',async()=>{
 const d=dictOf('en');const act=actOf(5,{lexical:false});
 const {context,page}=await fixture({view:p=>p===actRoute(5)?{kind:'activity',activity:act}:undefined});
 try{await context.addInitScript(speechMock);await page.goto(url(actRoute(5)));
  const say=page.getByRole('button',{name:d.fullListeningHub.activity.sayIt}).first();await say.waitFor();
  await say.click();
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),d.fullListeningHub.activity.sayIt,'focus stays on Say it after activation');
  await say.click();
  const calls=await page.evaluate(()=>window.__speech.calls);
  assert.deepEqual(calls,[['cancel'],['speak','Synthetic','en-GB'],['cancel'],['speak','Synthetic','en-GB']],'cancel then speak on every activation');
  assert.equal(await say.isEnabled(),true,'Say it stays enabled after use');
 }finally{await context.close();}
});

await check('V40 activity 5 Say it on a browser without speech shows the original unavailable message and keeps the page',async()=>{
 const d=dictOf('en');const act=actOf(5,{lexical:false});
 const {context,page}=await fixture({view:p=>p===actRoute(5)?{kind:'activity',activity:act}:undefined});
 const pageErrors=[];
 try{await context.addInitScript(noSpeech);page.on('pageerror',e=>pageErrors.push(String(e.message)));await page.goto(url(actRoute(5)));
  const say=page.getByRole('button',{name:d.fullListeningHub.activity.sayIt}).first();await say.waitFor();
  await say.click();
  await page.getByText(d.fullListeningHub.activity.pronunciationUnavailable).waitFor();
  assert.equal(await say.isVisible(),true,'activity still rendered');
  assert.deepEqual(pageErrors,[],'no uncaught exception');
 }finally{await context.close();}
});

await check('V40 activity 5 leaving the route by the Test hub link cancels speech and shows the hub',async()=>{
 const d=dictOf('en');const act=actOf(5,{lexical:false});
 const {context,page}=await fixture({view:p=>p===actRoute(5)?{kind:'activity',activity:act}:hubView(d)(p)});
 try{await context.addInitScript(speechMock);await page.goto(url(actRoute(5)));
  const say=page.getByRole('button',{name:d.fullListeningHub.activity.sayIt}).first();await say.waitFor();
  await say.click();
  await page.getByRole('link',{name:'← Test hub',exact:true}).click();
  await page.locator('.listening-hub').waitFor();
  const calls=await page.evaluate(()=>window.__speech.calls);
  assert.deepEqual(calls.at(-1),['cancel'],'the last speech action is a cancel on leaving the route');
 }finally{await context.close();}
});

// ---------- LEXICAL (Activity 2 review control; policy in src/lib/listening/lexical-policy.ts) ----------
await check('V40 lexical: a word without a server occurrence opens spelling-only with no lookup request',async()=>{
 const d=dictOf('en');const act=lexAct2(false);
 const {context,page,state}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p==='/api/vocabulary/folders'?{body:{folders:[]}}:undefined});
 try{await page.goto(url(actRoute(2)));await page.locator('[data-word="lookup"]').first().click();
  const pop=page.locator('[data-word-popover]');await pop.waitFor();
  await page.getByText(d.vocabulary.meaningUnchecked).first().waitFor();
  const lookups=state.requests.filter(r=>/^\/api\/vocabulary\/(lookup|meaning|search)$/.test(r.path));
  assert.equal(lookups.length,0,'no meaning is requested for a word without an authorized occurrence');
 }finally{await context.close();}
});

await check('V40 lexical: a word with a server occurrence fetches its contextual meaning by occurrence identity',async()=>{
 const d=dictOf('en');const act=lexAct2(true);
 const {context,page,state}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p==='/api/vocabulary/lookup'?lookupOk:p==='/api/vocabulary/folders'?{body:{folders:[]}}:undefined});
 try{await page.goto(url(actRoute(2)));await page.locator('[data-word="lookup"]').first().click();
  await page.locator('[data-word-popover]').waitFor();
  await page.getByText('Synthetic meaning').first().waitFor();
  const lookups=state.requests.filter(r=>r.path==='/api/vocabulary/lookup');
  assert.equal(lookups.length,1,'exactly one authorized lookup');
  assert.ok(lookups[0].query.includes('occurrenceId='+occId),'lookup keyed by the server occurrence');
 }finally{await context.close();}
});

await check('V40 lexical refusal: a 403 lookup shows the generic error and never renders a meaning, with no retry',async()=>{
 const d=dictOf('en');const act=lexAct2(true);
 const {context,page,state}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p==='/api/vocabulary/lookup'?{status:403,json:{error:'forbidden'}}:p==='/api/vocabulary/folders'?{body:{folders:[]}}:undefined});
 try{await page.goto(url(actRoute(2)));await page.locator('[data-word="lookup"]').first().click();
  const pop=page.locator('[data-word-popover]');await pop.waitFor();
  await page.getByText(d.auth.errorServer).first().waitFor();
  assert.equal(await page.getByText('Synthetic meaning').count(),0,'no contextual meaning rendered after refusal');
  await sleep(600);
  assert.equal(state.requests.filter(r=>r.path==='/api/vocabulary/lookup').length,1,'refusal is not replayed');
 }finally{await context.close();}
});

await check('V40 lexical keyboard: Tab reaches the text region, End and Enter look up the last word, Escape returns focus',async()=>{
 const d=dictOf('en');const act=lexAct2(true);
 const {context,page,state}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p==='/api/vocabulary/lookup'?lookupOk:p==='/api/vocabulary/folders'?{body:{folders:[]}}:undefined});
 try{await page.goto(url(actRoute(2)));await page.locator('[data-clickable-text]').first().waitFor();
  // Question texts are lexical regions too and come first in Tab order; cycle until the transcript region is focused.
  let reached=false;
  for(let i=0;i<80&&!reached;i++){await page.keyboard.press('Tab');reached=await page.evaluate(()=>{const e=document.activeElement;return !!e&&e.hasAttribute('data-clickable-text')&&e.textContent.includes('for lookup');});}
  assert.equal(reached,true,'keyboard Tab reaches the transcript text region');
  await page.keyboard.press('End');await page.keyboard.press('Enter');
  await page.locator('[data-word-popover]').waitFor();
  await page.getByText('Synthetic meaning').first().waitFor();
  assert.equal(state.requests.filter(r=>r.path==='/api/vocabulary/lookup').length,1,'Enter on the last word makes one lookup');
  await page.keyboard.press('Escape');
  await page.locator('[data-word-popover]').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>document.activeElement?.hasAttribute('data-clickable-text')??false),true,'focus returns to the text region');
 }finally{await context.close();}
});

await check('V40 lexical disposal: an open popover is removed when the learner leaves the route by the Test hub link',async()=>{
 const d=dictOf('en');const act=lexAct2(true);
 const {context,page}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:hubView(d)(p),
   post:(p)=>p==='/api/vocabulary/lookup'?lookupOk:p==='/api/vocabulary/folders'?{body:{folders:[]}}:undefined});
 try{await page.goto(url(actRoute(2)));await page.locator('[data-word="lookup"]').first().click();
  await page.locator('[data-word-popover]').waitFor();
  await page.getByRole('link',{name:'← Test hub',exact:true}).click();
  await page.locator('.listening-hub').waitFor();
  assert.equal(await page.locator('[data-word-popover]').count(),0,'no popover survives navigation');
 }finally{await context.close();}
});

await check('V40 lexical pronounce: the word popover Pronounce control speaks the occurrence word in en-GB',async()=>{
 const d=dictOf('en');const act=lexAct2(true);
 const {context,page}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p==='/api/vocabulary/lookup'?lookupOk:p==='/api/vocabulary/folders'?{body:{folders:[]}}:undefined});
 try{await context.addInitScript(speechMock);await page.goto(url(actRoute(2)));await page.locator('[data-word="lookup"]').first().click();
  await page.getByText('Synthetic meaning').first().waitFor();
  await page.getByRole('button',{name:d.vocabulary.games.pronounce}).first().click();
  const calls=await page.evaluate(()=>window.__speech.calls);
  assert.deepEqual(calls.at(-1),['speak','lookup','en-GB']);
 }finally{await context.close();}
});

await check('V40 lexical policy: with lexical assistance false the Activity 2 text is plain (no word targets, no lookup)',async()=>{
 const d=dictOf('en');const act=actOf(2,{lexical:false});
 const {context,page,state}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined});
 try{await page.goto(url(actRoute(2)));await page.locator('[data-plain-text]').first().waitFor();
  assert.equal(await page.locator('[data-word]').count(),0,'no word targets');
  assert.equal(await page.locator('[data-clickable-text]').count(),0,'no lookup surface');
  assert.equal(state.requests.filter(r=>/vocabulary\/(lookup|meaning|search)/.test(r.path)).length,0);
 }finally{await context.close();}
});

// ---------- WRITE ERRORS on Activity routes (original submit/start paths) ----------
await check('V40 activity 3 Save refused with 403: save-failed shown, typed answer kept, exactly one write, no replay',async()=>{
 const d=dictOf('en');const act=gapAct3();
 const {context,page,state}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p===apiActivity?{status:403,json:{error:'forbidden'}}:undefined});
 try{await page.goto(url(actRoute(3)));const save=page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress});await save.waitFor();
  const field=gapInput(page);await field.fill('refused answer');await save.click();
  await page.getByText(d.fullListeningHub.activity.saveFailed).waitFor();
  assert.equal(await field.inputValue(),'refused answer','pending learner text is kept');
  await sleep(1500);
  assert.equal(countOf(state,apiActivity),1,'a refused write is not replayed');
  assert.equal(await page.getByText('Completed').count(),0,'no completion shown');
 }finally{await context.close();}
});

await check('V40 activity 2 Complete with 409 conflict: save-failed shown and no score or completion is displayed',async()=>{
 const d=dictOf('en');const act=firstAttemptAct2();
 const {context,page,state}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p===apiActivity?{status:409,json:{error:'conflict'}}:undefined});
 try{await page.goto(url(actRoute(2)));const complete=page.getByRole('button',{name:d.fullListeningHub.activity.completeReviewed});await complete.waitFor();
  await complete.click();
  await page.getByText(d.fullListeningHub.activity.saveFailed).waitFor();
  assert.equal(await page.getByText(/ \/ \d+ · /).count(),0,'no score line is fabricated');
  assert.equal(await page.getByText('Completed').count(),0,'no completion state is fabricated');
  assert.equal(countOf(state,apiActivity),1,'exactly one Complete write');
 }finally{await context.close();}
});

await check('V40 activity 4 Save refused with 404: save-failed shown, chosen meaning kept, one write',async()=>{
 const d=dictOf('en');const act=actOf(4,{lexical:false,modern:true});
 const {context,page,state}=await fixture({view:p=>p===actRoute(4)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p===apiActivity?{status:404,json:{error:'not_found'}}:undefined});
 try{await page.goto(url(actRoute(4)));const commit=page.getByRole('button',{name:d.fullListeningHub.activity.commitReveal});await commit.waitFor();
  const choose=page.locator('select').filter({hasText:d.fullListeningHub.activity.chooseMeaning}).first();
  await choose.selectOption('0');await commit.click();await page.getByText('Synthetic link').first().waitFor();
  await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).click();
  await page.getByText(d.fullListeningHub.activity.saveFailed).waitFor();
  assert.equal(await choose.inputValue(),'0','chosen meaning kept after a refused write');
  await sleep(1000);
  assert.equal(countOf(state,apiActivity),1,'one write, no replay');
 }finally{await context.close();}
});

await check('V40 activity 1 start refused with 403: failure shown, no navigation to an attempt, no automatic replay',async()=>{
 const d=dictOf('en');let starts=0;
 const {context,page}=await fixture({view:p=>p===actRoute(1)?{kind:'exam-start',title:'Synthetic listening'}:undefined,
   post:(p)=>{if(p===apiStart){starts++;return {status:403,json:{error:'forbidden'}};}return undefined;}});
 try{await page.goto(url(actRoute(1)));const btn=page.getByRole('button',{name:d.fullListeningHub.examStart.start});await btn.waitFor();
  await btn.click();await page.getByText(d.fullListeningHub.examStart.failed).waitFor();
  await sleep(800);
  assert.equal(starts,1,'no automatic replay of a refused start');
  assert.ok(page.url().endsWith(actRoute(1)),'remains on the Exam Start screen');
 }finally{await context.close();}
});

await check('V40 stale response: a save answered after leaving the activity is ignored and writes nothing on the hub',async()=>{
 const d=dictOf('en');const act=gapAct3();
 const {context,page,state}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:hubView(d)(p),
   post:async(p)=>{if(p===apiActivity){await sleep(1500);return {body:{ok:true,id:ATT,score:null,total:5}};}return undefined;}});
 try{await page.goto(url(actRoute(3)));const save=page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress});await save.waitFor();
  await gapInput(page).fill('late answer');await save.click();
  await page.getByRole('link',{name:'← Test hub',exact:true}).click();
  await page.locator('.listening-hub').waitFor();
  await sleep(2200);
  assert.equal(await page.locator('.listening-hub').count(),1,'hub remains');
  assert.equal(await page.getByText(d.fullListeningHub.activity.saveFailed).count(),0,'no stale failure on the hub');
  assert.equal(await page.locator('input[aria-label^="PART"]').count(),0,'no activity control reappears');
  assert.equal(countOf(state,apiActivity),1,'the single in-flight write is not replayed');
 }finally{await context.close();}
});

// ---------- MEDIA lifecycle (original FullListeningActivity.tsx lines 90-100, 167-175, 252-268) ----------
const audioRaw=seconds=>({raw:{body:silentWavSeconds(seconds),contentType:'audio/wav'}});
await check('V40 media: a clip plays from its start and pauses at its end boundary (original timeupdate rule)',async()=>{
 const d=dictOf('en');const act=gapAct3();
 const {context,page,state}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p==='/api/resources/synthetic.mp3'?audioRaw(6):undefined});
 try{await page.goto(url(actRoute(3)));await page.locator('audio').first().waitFor({state:'attached'});
  const clipBtn=page.getByRole('button',{name:/Listen to this Part|Play moment/}).first();await clipBtn.waitFor();
  await clipBtn.click();
  await pollPage(page,()=>{const a=document.querySelector('audio');return !!a&&!a.paused;},8000);
  await pollPage(page,()=>{const a=document.querySelector('audio');return !!a&&a.paused&&a.currentTime>=2.9;},10000);
  const t=await page.evaluate(()=>document.querySelector('audio').currentTime);
  assert.ok(t>=2.9&&t<4.5,'paused near the clip end, got '+t);
  assert.ok(state.requests.some(r=>r.path==='/api/resources/synthetic.mp3'),'the authorized audio request was made');
 }finally{await context.close();}
});

await check('V40 media: leaving the route mid-clip pauses the element (no playback continues in the background)',async()=>{
 const d=dictOf('en');const act=gapAct3();
 const {context,page}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:hubView(d)(p),
   post:(p)=>p==='/api/resources/synthetic.mp3'?audioRaw(6):undefined});
 try{await page.goto(url(actRoute(3)));await page.locator('audio').first().waitFor({state:'attached'});
  await page.evaluate(()=>{window.__audioHandle=document.querySelector('audio');});
  const clipBtn=page.getByRole('button',{name:/Listen to this Part|Play moment/}).first();await clipBtn.click();
  await pollPage(page,()=>!window.__audioHandle.paused,8000);
  await page.getByRole('link',{name:'← Test hub',exact:true}).click();
  await page.locator('.listening-hub').waitFor();
  assert.equal(await page.evaluate(()=>window.__audioHandle.paused),true,'the detached element is paused');
  assert.equal(await page.locator('audio').count(),0,'the activity audio element is gone from the hub');
 }finally{await context.close();}
});

await check('V40 media: an unavailable recording shows an original media message and does not advance',async()=>{
 const d=dictOf('en');const act=gapAct3();
 const {context,page}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p==='/api/resources/synthetic.mp3'?{status:500,json:{error:'x'}}:undefined});
 try{await page.goto(url(actRoute(3)));await page.locator('audio').first().waitFor({state:'attached'});
  const clipBtn=page.getByRole('button',{name:/Listen to this Part|Play moment/}).first();await clipBtn.click();
  await page.getByText(new RegExp(d.fullListeningHub.activity.recordingUnavailable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'|'+d.fullListeningHub.activity.momentUnavailable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))).first().waitFor();
  assert.equal(await page.evaluate(()=>document.querySelector('audio').paused),true,'paused');
  assert.equal(await page.evaluate(()=>document.querySelector('audio').currentTime),0,'did not advance');
 }finally{await context.close();}
});

await check('V40 media: after a failed recording, the next clip press reloads the source (native load-on-error addition) and plays',async()=>{
 const d=dictOf('en');const act=gapAct3();let resourceCalls=0;
 const {context,page}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:undefined,
   post:(p)=>{if(p==='/api/resources/synthetic.mp3'){resourceCalls++;return resourceCalls===1?{status:500,json:{error:'x'}}:audioRaw(6);}return undefined;}});
 try{await page.goto(url(actRoute(3)));await page.locator('audio').first().waitFor({state:'attached'});
  const clipBtn=page.getByRole('button',{name:/Listen to this Part|Play moment/}).first();await clipBtn.click();
  await page.getByText(new RegExp(d.fullListeningHub.activity.recordingUnavailable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'|'+d.fullListeningHub.activity.momentUnavailable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))).first().waitFor();
  await clipBtn.click();
  await pollPage(page,()=>{const a=document.querySelector('audio');return !!a&&!a.paused;},8000);
  assert.ok(resourceCalls>=2,'the recording was requested again after the failure, got '+resourceCalls);
 }finally{await context.close();}
});

// ---------- FIRST-ATTEMPT Activity 2 (original FullListeningActivity.tsx: answer() at line 123 is local state plus sessionStorage; Mark reviewed at line 334; no typed control) ----------
await check('V40 activity 2 first attempt: Mark reviewed records a local draft only (no server write)',async()=>{
 const d=dictOf('en');const act=firstAttemptAct2();
 const {context,page,state}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined});
 try{await page.goto(url(actRoute(2)));await page.getByRole('button',{name:d.fullListeningHub.activity.completeReviewed}).waitFor();
  const mark=page.getByRole('button',{name:d.fullListeningHub.activity.markReviewed}).first();await mark.waitFor();
  await mark.click();
  await sleep(300);
  const draft=await page.evaluate(()=>Object.keys(sessionStorage).map(k=>sessionStorage.getItem(k)||'').join(' '));
  assert.ok(draft.includes('"reviewed"'),'the reviewed state is kept as a local draft');
  assert.equal(countOf(state,apiActivity),0,'Mark reviewed is not a server write');
 }finally{await context.close();}
});
// ---------- ACTIVITY 2 speed/rate and Check (original ListeningSpeedPractice.tsx: typed answers + speed rate; mounted when data.questions exists, FullListeningActivity.tsx line 369) ----------
const speedSelect=page=>page.locator('select.input').filter({has:page.locator('option[value="1.25"]')}).first();
const speedAudioRate=page=>page.evaluate(()=>{const s=document.querySelector('select.input');let n=s;while(n&&!n.querySelector('audio'))n=n.parentElement;return n?.querySelector('audio')?.playbackRate??null;});
await check('V40 activity 2 speed control: only allowed rates are selectable and the chosen rate sets the audio playbackRate',async()=>{
 const d=dictOf('en');const act=firstAttemptAct2();
 const {context,page}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p==='/api/resources/synthetic.mp3'?audioRaw(6):undefined});
 try{await page.goto(url(actRoute(2)));await page.locator('summary').filter({hasText:d.fullListeningHub.speed.summary}).first().click();const sel=speedSelect(page);await sel.waitFor();
  assert.equal(await sel.locator('option[value="1.25"]').evaluate(o=>o.disabled),false,'1.25 is allowed by the fixture');
  assert.equal(await sel.locator('option[value="1.5"]').evaluate(o=>o.disabled),true,'1.5 is locked (not in allowed)');
  assert.equal(await sel.locator('option[value="2"]').evaluate(o=>o.disabled),true,'2 is locked');
  await sel.selectOption('1.25');
  assert.equal(await speedAudioRate(page),1.25,'the speed practice audio plays at the chosen rate');
 }finally{await context.close();}
});

await check('V40 activity 2 typed answers: Check sends one complete write with the typed answer and the speed rate; the server score is shown',async()=>{
 const d=dictOf('en');const act=firstAttemptAct2();
 const {context,page,state}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p===apiActivity?{body:{ok:true,id:ATT,score:1,total:1}}:undefined});
 try{await page.goto(url(actRoute(2)));await page.locator('summary').filter({hasText:d.fullListeningHub.speed.summary}).first().click();const field=page.locator('input[maxlength="500"]').first();await field.waitFor();
  await field.fill('typed answer');
  await page.getByRole('button',{name:d.fullListeningHub.speed.check}).click();
  await page.getByText('1 / 1',{exact:true}).waitFor();
  const posts=state.requests.filter(r=>r.path===apiActivity&&r.method==='POST');
  assert.equal(posts.length,1,'exactly one Check write');
  assert.deepEqual(posts[0].body,{activity:2,speedRate:1.25,answers:{'1':'typed answer'},complete:true},'the body is the original speed-check shape; rate defaults to the highest allowed (original allowed.at(-1))');
  assert.equal(await field.inputValue(),'typed answer','typed answer survives the post-success refresh (original router.refresh keeps client state)');
  assert.equal(await page.locator('details').first().evaluate(d=>d.open),true,'the speed panel stays open after the refresh');
 }finally{await context.close();}
});

await check('V40 activity 2 Check failure (500) keeps the typed answer, shows the speed failure and no score',async()=>{
 const d=dictOf('en');const act=firstAttemptAct2();
 const {context,page,state}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p===apiActivity?{status:500,json:{error:'x'}}:undefined});
 try{await page.goto(url(actRoute(2)));await page.locator('summary').filter({hasText:d.fullListeningHub.speed.summary}).first().click();const field=page.locator('input[maxlength="500"]').first();await field.waitFor();
  await field.fill('kept answer');
  await page.getByRole('button',{name:d.fullListeningHub.speed.check}).click();
  await page.getByText(d.fullListeningHub.speed.failed).waitFor();
  assert.equal(await field.inputValue(),'kept answer','typed answer kept');
  assert.equal(await page.getByText('1 / 1',{exact:true}).count(),0,'no score fabricated');
  assert.equal(countOf(state,apiActivity),1,'one write, no replay');
 }finally{await context.close();}
});

await check('V40 activity 2 speed state is kept across the post-Check refresh but dropped when the learner leaves and returns (original unmounts)',async()=>{
 const d=dictOf('en');const act=firstAttemptAct2();
 const {context,page}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:hubView(d)(p),
   post:(p)=>p===apiActivity?{body:{ok:true,id:ATT,score:1,total:1}}:undefined});
 try{await page.goto(url(actRoute(2)));await page.locator('summary').filter({hasText:d.fullListeningHub.speed.summary}).first().click();
  const field=page.locator('input[maxlength="500"]').first();await field.fill('typed answer');
  await page.getByRole('button',{name:d.fullListeningHub.speed.check}).click();
  await page.getByText('1 / 1',{exact:true}).waitFor();
  await page.getByRole('link',{name:'← Test hub',exact:true}).click();
  await page.locator('.listening-hub').waitFor();
  await page.goBack();
  await page.getByRole('button',{name:d.fullListeningHub.activity.completeReviewed}).waitFor();
  assert.equal(await page.getByText('1 / 1',{exact:true}).count(),0,'the earlier score is not carried into a new visit');
  assert.equal(await page.locator('input[maxlength="500"]').first().inputValue(),'','the earlier typed answer is not carried into a new visit');
 }finally{await context.close();}
});

// ---------- MORE LEXICAL / SPEECH coverage ----------
await check('V40 lexical stale response: a lookup answered after leaving the activity renders nothing on the hub',async()=>{
 const d=dictOf('en');const act=lexAct2(true);
 const {context,page,state}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:hubView(d)(p),
   post:async(p)=>{if(p==='/api/vocabulary/lookup'){await sleep(1200);return lookupOk;}return p==='/api/vocabulary/folders'?{body:{folders:[]}}:undefined;}});
 try{await page.goto(url(actRoute(2)));await page.locator('[data-word="lookup"]').first().click();
  await page.locator('[data-word-popover]').waitFor();
  await page.getByRole('link',{name:'← Test hub',exact:true}).click();
  await page.locator('.listening-hub').waitFor();
  await sleep(1600);
  assert.equal(await page.locator('[data-word-popover]').count(),0,'no late popover');
  assert.equal(await page.getByText('Synthetic meaning').count(),0,'no late meaning');
  assert.equal(state.requests.filter(r=>r.path==='/api/vocabulary/lookup').length,1,'one lookup, not replayed');
 }finally{await context.close();}
});

await check('V40 lexical touch (390 px, touch emulation): a tap on a word with an occurrence opens its authorized meaning once',async()=>{
 const d=dictOf('en');const act=lexAct2(true);
 const {context,page,state}=await fixture({width:390,height:844,touch:true,view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined,
   post:(p)=>p==='/api/vocabulary/lookup'?lookupOk:p==='/api/vocabulary/folders'?{body:{folders:[]}}:undefined});
 try{await page.goto(url(actRoute(2)));await page.locator('[data-word="lookup"]').first().tap();
  await page.getByText('Synthetic meaning').first().waitFor();
  assert.equal(state.requests.filter(r=>r.path==='/api/vocabulary/lookup').length,1,'one tap, one lookup');
  assert.equal(await page.evaluate(()=>window.innerWidth),390,'390 px viewport');
 }finally{await context.close();}
});

await check('V40 activity 5 Say it keyboard: Enter and Space each activate once and keep focus on the button (UZ labels, Night theme)',async()=>{
 const d=dictOf('uz');const act=actOf(5,{lexical:false});
 const {context,page}=await fixture({locale:'uz',theme:'night',view:p=>p===actRoute(5)?{kind:'activity',activity:act}:undefined});
 try{await context.addInitScript(speechMock);await page.goto(url(actRoute(5)));
  const say=page.getByRole('button',{name:d.fullListeningHub.activity.sayIt}).first();await say.waitFor();
  await say.focus();
  await page.keyboard.press('Enter');await sleep(150);
  await page.keyboard.press(' ');await sleep(150);
  const calls=await page.evaluate(()=>window.__speech.calls);
  const speaks=calls.filter(c=>c[0]==='speak');
  assert.equal(speaks.length,2,'one speak per key activation');
  assert.ok(speaks.every(c=>c[2]==='en-GB'),'term spoken in en-GB regardless of UI locale (original constant)');
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),d.fullListeningHub.activity.sayIt,'focus stays on Say it');
 }finally{await context.close();}
});


// ---------- ACTIVITY responsive branch matrix (768x1024 and 390x844; original branches 1-5 with their primary control) ----------
const primaryFor={1:()=>null,2:d=>d.fullListeningHub.activity.completeReviewed,3:d=>d.fullListeningHub.activity.saveProgress,4:d=>d.fullListeningHub.activity.commitReveal,5:d=>d.fullListeningHub.activity.sayIt};
const viewportCases=[[768,1024,'en','day'],[768,1024,'uz','day'],[390,844,'en','night'],[390,844,'uz','night']];
const actFixtureFor=n=>n===1?null:(n===2?firstAttemptAct2():n===3?gapAct3():n===4?actOf(4,{lexical:false,modern:true}):actOf(5,{lexical:false,modern:true}));
for(const n of [1,2,3,4,5]){for(const [w,h,loc,th] of viewportCases){
 await check(`V40 activity ${n} responsive ${w}x${h} ${loc.toUpperCase()} ${th}: branch renders in viewport, no horizontal overflow, primary control visible`,async()=>{
  const d=dictOf(loc);const act=actFixtureFor(n);
  const view=n===1?(p=>p===actRoute(1)?{kind:'exam-start',title:'Synthetic listening'}:undefined):(p=>p===actRoute(n)?{kind:'activity',activity:act}:undefined);
  const {context,page}=await fixture({width:w,height:h,locale:loc,theme:th,view});
  try{await page.goto(url(actRoute(n)));
   const label=n===1?d.fullListeningHub.examStart.start:primaryFor[n](d);
   const control=page.getByRole('button',{name:label}).first();
   await control.waitFor();
   assert.equal(await control.isVisible(),true,'primary control visible');
   const box=await control.boundingBox();
   assert.ok(box&&box.x>=0&&box.x+box.width<=w+1,'primary control inside the viewport width');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
   assert.ok(overflow<=0,'no horizontal overflow, got '+overflow);
  }finally{await context.close();}
 });
}}


await browser.close();
const failed=results.filter(r=>r.status!=='PASS');
fs.writeFileSync(new URL('browser-listening-v40-results.json',out),JSON.stringify({generated:new Date().toISOString(),counts:{PASS:results.length-failed.length,FAIL:failed.length},results},null,2)+'\n');
console.log(JSON.stringify({pass:results.length-failed.length,fail:failed.length}));
process.exitCode=failed.length?1:0;
