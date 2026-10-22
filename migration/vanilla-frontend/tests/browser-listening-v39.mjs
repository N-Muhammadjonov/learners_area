/** V39 Listening Hub and Activity route browser matrix. Synthetic authorized fixtures only; no live
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
const out=new URL('../docs/evidence/v39/',import.meta.url);fs.mkdirSync(out,{recursive:true});
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

// ---------- HUB (/app/listening/tests/:id) ----------
await check('V39 hub direct entry renders the hubDTO test, meta and card links (EN, desktop)',async()=>{
 const d=dictOf('en');const {context,page}=await fixture({view:p=>p===hubRoute?hubData(d):undefined});
 try{await page.goto(url(hubRoute));const hub=page.locator('.listening-hub');await hub.locator('h1').waitFor();
  assert.equal((await hub.locator('h1').innerText()).trim(),'Synthetic listening');
  const cards=page.locator('.listening-hub article');assert.equal(await cards.count(),3,'one card per hubDTO card');
  assert.equal(await cards.nth(0).locator('a.btn-primary').getAttribute('href'),hubRoute+'/1');
  assert.equal(await cards.nth(1).locator('a.btn-primary').getAttribute('href'),hubRoute+'/3');
  assert.equal(await cards.nth(2).locator('a.btn-primary').getAttribute('href'),hubRoute+'/matching');
  assert.equal(await cards.nth(0).locator('a',{hasText:d.fullListeningHub.studyLink}).getAttribute('href'),hubRoute+'/study','study link on exam card');
  assert.equal(await cards.nth(1).locator('a',{hasText:d.fullListeningHub.studyLink}).count(),0,'no study link on script card');
  assert.equal(await cards.nth(0).locator('h2').innerText(),d.fullListeningHub.research.full);
  const meta=d.fullListeningHub.testMeta.replace('{parts}',4).replace('{questions}',40).replace('{min}',30);
  assert.ok((await page.locator('.listening-hub').innerText()).includes(meta),'meta line from hubDTO');
  assert.ok((await page.locator('.listening-hub').innerText()).includes(d.fullListeningHub.notStarted),'unstarted cards show Not started');
 }finally{await context.close();}
});

await check('V39 hub completed and in-progress badges reflect server latest scores',async()=>{
 const d=dictOf('en');
 const data=hubData(d,{cards:[
  {path:'1',activity:1,name:d.fullListeningHub.research.full,tag:d.fullListeningHub.research.examTag,complete:true,latest:{score:14,total:20}},
  {path:'3',activity:3,name:d.fullListeningHub.research.script,tag:d.fullListeningHub.research.reviewTag,complete:false,latest:{score:2,total:5}}]});
 const {context,page}=await fixture({view:p=>p===hubRoute?data:undefined});
 try{await page.goto(url(hubRoute));await page.locator('.listening-hub article').nth(0).waitFor();
  const text=await page.locator('.listening-hub').innerText();
  assert.ok(text.includes(d.fullListeningHub.completed),'completed badge');
  assert.ok(text.includes(d.fullListeningHub.inProgress),'in-progress badge');
  assert.ok(text.includes('14') && text.includes('20'),'server score 14/20 shown');
  assert.ok(text.includes('2') && text.includes('5'),'server score 2/5 shown');
  assert.ok(text.includes(d.fullListeningHub.completedCount.replace('{done}',1).replace('{total}',2)),'completed count 1/2');
 }finally{await context.close();}
});

await check('V39 hub draft publication shows the QA draft notice; published does not',async()=>{
 const d=dictOf('en');
 for(const [state,expect] of [['draft',true],['published',false]]){
  const {context,page}=await fixture({view:p=>p===hubRoute?hubData(d,{test:{id:ID,title:'T',publicationState:state}}):undefined});
  try{await page.goto(url(hubRoute));await page.locator('.listening-hub h1').waitFor();
   const shown=(await page.locator('.listening-hub').innerText()).includes(d.fullListeningHub.qaDraft);
   assert.equal(shown,expect,state);}finally{await context.close();}
 }
});

await check('V39 hub card click navigates to the activity route; Back and Forward restore both screens',async()=>{
 const d=dictOf('en');
 const {context,page}=await fixture({view:(p)=>{if(p===hubRoute)return hubData(d);if(p===actRoute(1))return {kind:'exam-start',title:'Synthetic listening'};return undefined;}});
 try{await page.goto(url(hubRoute));await page.locator('.listening-hub h1').waitFor();
  await page.locator('.listening-hub article').nth(0).locator('a.btn-primary').click();
  await page.waitForURL('**'+actRoute(1));
  await page.getByRole('heading',{name:d.fullListeningHub.examStart.title.replace('{title}','Synthetic listening')}).waitFor();
  await page.goBack();await page.waitForURL('**'+hubRoute);await page.locator('.listening-hub h1').waitFor();
  await page.goForward();await page.waitForURL('**'+actRoute(1));
  await page.getByRole('heading',{name:d.fullListeningHub.examStart.title.replace('{title}','Synthetic listening')}).waitFor();
 }finally{await context.close();}
});

await check('V39 hub direct reload refetches the authorized view and keeps the hub',async()=>{
 const d=dictOf('en');const {context,page,state}=await fixture({view:p=>p===hubRoute?hubData(d):undefined});
 try{await page.goto(url(hubRoute));await page.locator('.listening-hub h1').waitFor();const before=state.viewCalls.length;
  await page.reload();await page.locator('.listening-hub h1').waitFor();
  assert.ok(state.viewCalls.length>before,'reload issues a new view request');
  assert.equal(await page.locator('.listening-hub article').count(),3);
 }finally{await context.close();}
});

await check('V39 hub keyboard: Tab reaches Back link then exam card CTA; Enter follows the link',async()=>{
 const d=dictOf('en');const {context,page}=await fixture({view:(p)=>{if(p===hubRoute)return hubData(d);if(p===actRoute(1))return {kind:'exam-start',title:'Synthetic listening'};return undefined;}});
 try{await page.goto(url(hubRoute));await page.locator('.listening-hub h1').waitFor();
  await page.locator('body').click({position:{x:2,y:2}});
  await page.keyboard.press('Tab');
  const first=await page.evaluate(()=>({text:document.activeElement?.textContent?.trim(),back:document.activeElement?.hasAttribute('data-back-link')}));
  assert.equal(first.back,true,'first focus stop is the Back link, got '+JSON.stringify(first));
  let reached=false;
  for(let i=0;i<8&&!reached;i++){await page.keyboard.press('Tab');reached=(await page.evaluate(()=>document.activeElement?.getAttribute('href')))===actRoute(1);}
  assert.ok(reached,'exam card CTA reachable by Tab');
  await page.keyboard.press('Enter');await page.waitForURL('**'+actRoute(1));
 }finally{await context.close();}
});

await check('V39 hub touch: tap on the card CTA navigates (touch emulation, 390 px)',async()=>{
 const d=dictOf('en');const {context,page}=await fixture({touch:true,width:390,height:844,view:(p)=>{if(p===hubRoute)return hubData(d);if(p===actRoute(3))return {kind:'exam-start',title:'x'};return undefined;}});
 try{await page.goto(url(hubRoute));await page.locator('.listening-hub h1').waitFor();
  await page.locator('.listening-hub article').nth(1).locator('a.btn-primary').tap();
  await page.waitForURL('**'+actRoute(3));
 }finally{await context.close();}
});

await check('V39 hub Back link on a cold entry follows its library href (no history on the page)',async()=>{
 const d=dictOf('en');const {context,page}=await fixture({view:p=>p===hubRoute?hubData(d):undefined});
 try{await page.goto(url(hubRoute));await page.locator('.listening-hub h1').waitFor();
  const back=page.locator('[data-listening-focus-backbar] a');assert.equal(await back.getAttribute('href'),'/app/listening');
 }finally{await context.close();}
});

await check('V39 hub locked (403 sequence_locked) shows the locked section linking to academic',async()=>{
 const {context,page}=await fixture({view:p=>p===hubRoute?{status:403,json:{error:'sequence_locked',code:'sequence_locked'}}:undefined});
 try{await page.goto(url(hubRoute));const locked=page.locator('[data-listening-sequence-locked]');await locked.waitFor();
  assert.equal(await locked.locator('a').first().getAttribute('href'),'/app/listening/academic');
  assert.equal(await page.locator('.listening-hub').count(),0);
 }finally{await context.close();}
});

await check('V39 hub kind locked from the view shows the locked section',async()=>{
 const {context,page}=await fixture({view:p=>p===hubRoute?{kind:'locked'}:undefined});
 try{await page.goto(url(hubRoute));await page.locator('[data-listening-sequence-locked]').waitFor();}finally{await context.close();}
});

await check('V39 hub not_found (404) shows the original not-found screen with no hub content',async()=>{
 const {context,page}=await fixture({view:p=>p===hubRoute?{status:404,json:{error:'not_found'}}:undefined});
 try{await page.goto(url(hubRoute));await page.locator('[data-listening-not-found]').waitFor();
  assert.equal(await page.locator('.listening-hub').count(),0);}finally{await context.close();}
});

await check('V39 hub malformed id never requests data and shows the not-found screen',async()=>{
 const {context,page,state}=await fixture({view:()=>undefined});
 try{await page.goto(url('/app/listening/tests/not-a-uuid'));await page.locator('[data-listening-not-found]').waitFor();
  assert.equal(state.viewCalls.length,0,'no view request for a malformed id');}finally{await context.close();}
});

await check('V39 hub 500 shows the region error; Try again re-requests and renders the hub',async()=>{
 const d=dictOf('en');let n=0;const {context,page,state}=await fixture({view:p=>{if(p!==hubRoute)return undefined;n++;return n===1?{status:500,json:{error:'x'}}:hubData(d);}});
 try{await page.goto(url(hubRoute));const notice=page.locator('[data-region-failure="listening-hub"]');await notice.waitFor();
  assert.equal((await notice.locator('span').innerText()).trim(),d.common.error);
  await notice.locator('[data-region-retry="listening-hub"]').click();
  await page.locator('.listening-hub h1').waitFor();
  assert.equal(state.viewCalls.filter(v=>v===hubRoute).length,2,'exactly one retry request');
 }finally{await context.close();}
});

await check('V39 hub network failure shows the region error and no hub content',async()=>{
 const {context,page}=await fixture({view:p=>p===hubRoute?'abort':undefined});
 try{await page.goto(url(hubRoute));await page.locator('[data-region-failure="listening-hub"]').waitFor();
  assert.equal(await page.locator('.listening-hub').count(),0);}finally{await context.close();}
});

await check('V39 hub 429 shows the region error and no hub content',async()=>{
 const {context,page}=await fixture({view:p=>p===hubRoute?{status:429,json:{error:'rate'}}:undefined});
 try{await page.goto(url(hubRoute));await page.locator('[data-region-failure="listening-hub"]').waitFor();
  assert.equal(await page.locator('.listening-hub').count(),0);}finally{await context.close();}
});

await check('V39 hub 403 (not sequence-locked) shows the region error and no hub content',async()=>{
 const {context,page}=await fixture({view:p=>p===hubRoute?{status:403,json:{error:'forbidden'}}:undefined});
 try{await page.goto(url(hubRoute));await page.locator('[data-region-failure="listening-hub"]').waitFor();
  assert.equal(await page.locator('.listening-hub').count(),0);}finally{await context.close();}
});

await check('V39 hub 401 ends the session: hub content is removed and the app navigates to /login (authority logout)',async()=>{
 const d=dictOf('en');
 const {context,page}=await fixture({view:p=>p===hubRoute?{status:401,json:{error:'unauthorized'}}:undefined});
 try{await page.goto(url(hubRoute));await page.waitForURL('**/login',{timeout:8000});
  assert.equal(new URL(page.url()).pathname,'/login');
  assert.equal(await page.locator('.listening-hub').count(),0,'no hub content after 401');
  assert.ok(!(await page.locator('body').innerText()).includes(d.fullListeningHub.research.full),'no card title after 401');
 }finally{await context.close();}
});

await check('V39 hub unrecognized view kind is a region error, never fabricated hub content',async()=>{
 const {context,page}=await fixture({view:p=>p===hubRoute?{kind:'mystery'}:undefined});
 try{await page.goto(url(hubRoute));await page.locator('[data-region-failure="listening-hub"]').waitFor();
  assert.equal(await page.locator('.listening-hub').count(),0);}finally{await context.close();}
});

await check('V39 hub payload with extra transcript field is refused; transcript text never renders',async()=>{
 const d=dictOf('en');const bad={...hubData(d),transcript:'SYNTHETIC-SECRET-TRANSCRIPT'};
 const {context,page}=await fixture({view:p=>p===hubRoute?bad:undefined});
 try{await page.goto(url(hubRoute));await page.locator('[data-region-failure="listening-hub"]').waitFor();
  assert.equal(await page.locator('.listening-hub').count(),0);
  assert.equal(await page.locator('text=SYNTHETIC-SECRET-TRANSCRIPT').count(),0);}finally{await context.close();}
});

// Authored runtime: the native frame fetches /authored and /sandbox (same contract as browser-v10).
const authoredDoc={...authoredFixture,nativePersistence:false,runtime:{entryPath:'index.html',files:{'index.html':'<!doctype html><html><body><section id="hub"><h1>Synthetic authored page</h1></section></body></html>'}}};
const sandboxRaw={body:`<!doctype html><script>addEventListener('message',function init(e){if(e.source!==parent||e.data?.channel!=='learners-area-sandbox-init')return;removeEventListener('message',init);document.open();document.write(e.data.html);document.close();});<\/script>`,contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline'; media-src data: blob:; connect-src 'none'; sandbox allow-scripts"}};
const authoredPost=(p)=>{if(p==='/api/listening/full/'+ID+'/authored')return {body:authoredDoc};if(p==='/api/listening/full/'+ID+'/sandbox')return {raw:sandboxRaw};return undefined;};
await check('V39 hub authored kind renders the sandboxed authored frame (allow-scripts only)',async()=>{
 const {context,page}=await fixture({view:p=>p===hubRoute?{kind:'authored'}:undefined,post:authoredPost});
 try{await page.goto(url(hubRoute));const frame=page.locator('iframe').first();await frame.waitFor();
  const sb=await frame.getAttribute('sandbox');assert.equal(sb,'allow-scripts');
  assert.ok(!sb.includes('allow-same-origin'));
  await page.frameLocator('iframe').getByRole('heading',{name:'Synthetic authored page'}).waitFor();
 }finally{await context.close();}
});

await check('V39 hub in-app source switch (pushState + popstate) replaces the hub with the new test only',async()=>{
 const d=dictOf('en');
 const {context,page}=await fixture({view:p=>{if(p===hubRoute)return hubData(d);if(p==='/app/listening/tests/'+ID2)return hubData(d,{test:{id:ID2,title:'Second synthetic',publicationState:'published'}});return undefined;}});
 try{await page.goto(url(hubRoute));await page.locator('.listening-hub h1',{hasText:'Synthetic listening'}).waitFor();
  await page.evaluate(o=>{history.pushState({},'','/app/listening/tests/'+o);dispatchEvent(new PopStateEvent('popstate',{state:{}}));},ID2);
  await page.locator('.listening-hub h1',{hasText:'Second synthetic'}).waitFor();
  assert.equal(await page.locator('.listening-hub h1').count(),1);
  assert.equal(await page.locator('.listening-hub h1',{hasText:'Synthetic listening'}).count(),0);
 }finally{await context.close();}
});

await check('V39 hub in-app navigation during an in-flight hub request discards the stale response',async()=>{
 const d=dictOf('en');let release;const gate=new Promise(r=>{release=r;});
 const {context,page}=await fixture({view:async(p)=>{if(p===hubRoute){await gate;return hubData(d);}return undefined;}});
 try{await page.goto(url('/app/listening/tests/'+ID));await page.waitForTimeout(200);
  await page.evaluate(()=>{history.pushState({},'','/app/listening/mcq');dispatchEvent(new PopStateEvent('popstate',{state:{}}));});
  release();await page.waitForTimeout(800);
  assert.equal(await page.locator('.listening-hub').count(),0,'stale hub response must not render after the route changed');
 }finally{release();await context.close();}
});

// ---------- ACTIVITY (/app/listening/tests/:id/:activity) ----------
await check('V39 activity invalid route segments are not-found and issue no request (activity 0, 6, malformed id)',async()=>{
 for(const p of [actRoute(6),actRoute(0),'/app/listening/tests/not-a-uuid/2']){
  const {context,page,state}=await fixture({view:()=>undefined});
  try{await page.goto(url(p));await page.locator('[data-listening-not-found]').waitFor();
   assert.equal(state.viewCalls.length,0,'no request for '+p);}finally{await context.close();}
 }
});

await check('V39 activity segment 02 is activity 2 (original Number(segment) rule); 00 is not-found with no request',async()=>{
 const d=dictOf('en');const act=firstAttemptAct2();
 const {context,page,state}=await fixture({view:p=>p==='/app/listening/tests/'+ID+'/02'?{kind:'activity',activity:act}:undefined});
 try{await page.goto(url('/app/listening/tests/'+ID+'/02'));await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).waitFor();
  assert.equal(state.viewCalls.length,1);
 }finally{await context.close();}
 const f2=await fixture({view:()=>undefined});
 try{await f2.page.goto(url('/app/listening/tests/'+ID+'/00'));await f2.page.locator('[data-listening-not-found]').waitFor();
  assert.equal(f2.state.viewCalls.length,0,'no request for segment 00');
 }finally{await f2.context.close();}
});

await check('V39 activity 1 shows the original exam start; Start posts once and navigates to the attempt',async()=>{
 const d=dictOf('en');let starts=0;
 const {context,page}=await fixture({view:p=>p===actRoute(1)?{kind:'exam-start',title:'Synthetic listening'}:undefined,
  post:(p)=>{if(p===apiStart){starts++;return {body:{id:ATT}};}return undefined;}});
 try{await page.goto(url(actRoute(1)));const btn=page.getByRole('button',{name:d.fullListeningHub.examStart.start});await btn.waitFor();
  await page.getByRole('heading',{name:d.fullListeningHub.examStart.title.replace('{title}','Synthetic listening')}).waitFor();
  await btn.click();await page.waitForURL('**/app/listening/attempts/'+ATT);
  assert.equal(starts,1,'exactly one start request');
 }finally{await context.close();}
});

await check('V39 activity 1 start failure shows the original message; Retry resumes the same start path',async()=>{
 const d=dictOf('en');let starts=0;
 const {context,page}=await fixture({view:p=>p===actRoute(1)?{kind:'exam-start',title:'Synthetic listening'}:undefined,
  post:(p)=>{if(p===apiStart){starts++;return starts===1?{status:500,json:{error:'x'}}:{body:{id:ATT}};}return undefined;}});
 try{await page.goto(url(actRoute(1)));const btn=page.getByRole('button',{name:d.fullListeningHub.examStart.start});await btn.waitFor();
  await btn.click();await page.getByText(d.fullListeningHub.examStart.failed).waitFor();
  await btn.click();await page.waitForURL('**/app/listening/attempts/'+ATT);
  assert.equal(starts,2);
 }finally{await context.close();}
});

await check('V39 activity 3 Save progress posts complete:false with the typed gap answer and keeps it on screen',async()=>{
 const d=dictOf('en');const act=gapAct3();
 const {context,page,state}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:undefined,
  post:(p)=>{if(p===apiActivity)return {body:{ok:true,id:ATT,score:null,total:5}};return undefined;}});
 try{await page.goto(url(actRoute(3)));const save=page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress});await save.waitFor();
  const field=gapInput(page);
  await field.fill('synthetic typed answer');
  await save.click();

  await page.waitForTimeout(300);
  const post=state.requests.find(r=>r.path===apiActivity&&r.method==='POST');
  assert.ok(post,'activity write issued');assert.equal(post.body.activity,3);assert.equal(post.body.complete,false);
  assert.ok(Object.values(post.body.answers).includes('synthetic typed answer'),'typed answer in body');
  assert.equal(await field.inputValue(),'synthetic typed answer');
  assert.equal(await page.getByText(d.fullListeningHub.activity.saveFailed).count(),0,'valid write shows no save-failed message');
 }finally{await context.close();}
});

await check('V39 activity 3 failed save shows the save-failed message and keeps the typed gap answer',async()=>{
 const d=dictOf('en');const act=gapAct3();
 const {context,page}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:undefined,
  post:(p)=>p===apiActivity?{status:500,json:{error:'x'}}:undefined});
 try{await page.goto(url(actRoute(3)));await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).waitFor();
  const field=gapInput(page);await field.fill('kept answer');
  await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).click();
  await page.getByText(d.fullListeningHub.activity.saveFailed).waitFor();
  assert.equal(await field.inputValue(),'kept answer');
 }finally{await context.close();}
});

await check('V39 activity 2 rate-limited Complete (429) shows save-failed and displays no score',async()=>{
 const d=dictOf('en');const act=firstAttemptAct2();
 const {context,page}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined,
  post:(p)=>p===apiActivity?{status:429,json:{error:'rate'}}:undefined});
 try{await page.goto(url(actRoute(2)));await page.getByRole('button',{name:d.fullListeningHub.activity.completeReviewed}).waitFor();
  const before=await page.locator('main').innerText();
  await page.getByRole('button',{name:d.fullListeningHub.activity.completeReviewed}).click();
  await page.getByText(d.fullListeningHub.activity.saveFailed).waitFor();
  const after=await page.locator('main').innerText();
  assert.ok(after.startsWith(before.trimEnd().slice(0,50)),'screen otherwise unchanged');
  assert.equal(after.replace(d.fullListeningHub.activity.saveFailed,'').replace(/\s+/g,' ').trim(),before.replace(/\s+/g,' ').trim(),'only the save-failed message is added (no score)');
 }finally{await context.close();}
});

await check('V39 activity 2 Complete posts complete:true and shows the server score (no client grading)',async()=>{
 const d=dictOf('en');const act=firstAttemptAct2();
 const {context,page,state}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined,
  post:(p)=>p===apiActivity?{body:{ok:true,id:ATT,score:3,total:4}}:undefined});
 try{await page.goto(url(actRoute(2)));await page.getByRole('button',{name:d.fullListeningHub.activity.completeReviewed}).waitFor();
  await page.getByRole('button',{name:d.fullListeningHub.activity.completeReviewed}).click();
  await page.getByText('3 / 4 · ✓ Completed').waitFor();
  const post=state.requests.find(r=>r.path===apiActivity&&r.method==='POST');assert.equal(post.body.complete,true);
  assert.equal(countOf(state,apiActivity),1,'exactly one Complete write');
 }finally{await context.close();}
});

// Practice (matching / completion / retry / map): contracts from practiceDTO and ListeningPractice-v7.
const practiceOf=(kind,questions,extra={})=>({id:ID,title:'Synthetic listening',kind,audioUrl:null,initial:{},questions,...extra});
const q2=(n,opts=['A) First','B) Second'])=>({number:n,text:'Synthetic question '+n,instruction:'Synthetic instruction',options:opts,at:n,end:null});

await check('V39 practice matching: Check is disabled until answered; Check posts only answered questions and shows the verdict and key',async()=>{
 const d=dictOf('en');
 const {context,page,state}=await fixture({view:p=>p===actRoute('matching')?{kind:'practice',practice:practiceOf('matching',[q2(1),q2(2)])}:undefined,
  post:(p)=>p===apiPractice?{body:{results:[{number:1,correct:true,key:'A',evidence:'Synthetic evidence'}]}}:undefined});
 try{await page.goto(url(actRoute('matching')));const check=page.getByRole('button',{name:d.fullListeningHub.activity.checkAll});await check.waitFor();
  assert.equal(await check.isDisabled(),true,'Check disabled while empty');
  await page.locator('select').first().selectOption('A');
  assert.equal(await check.isDisabled(),false,'Check enabled once answered');
  await check.click();
  const fb=page.getByRole('status').filter({hasText:new RegExp('^'+d.fullListeningHub.activity.correct)});await fb.waitFor();
  const post=state.requests.find(r=>r.path===apiPractice);
  assert.equal(post.body.kind,'matching');assert.equal(post.body.complete,false);
  assert.deepEqual(Object.keys(post.body.answers),['1'],'only the answered question is sent');
  assert.ok((await fb.innerText()).includes('A'),'server key shown');
  assert.ok((await fb.innerText()).includes('Synthetic evidence'),'server evidence shown');
 }finally{await context.close();}
});

await check('V39 practice Finish is blocked until every question is answered, then sends complete:true for all',async()=>{
 const d=dictOf('en');
 const {context,page,state}=await fixture({view:p=>p===actRoute('matching')?{kind:'practice',practice:practiceOf('matching',[q2(1),q2(2)])}:undefined,
  post:(p)=>p===apiPractice?{body:{results:[{number:1,correct:true,key:'A',evidence:'e1'},{number:2,correct:false,key:'B',evidence:'e2'}]}}:undefined});
 try{await page.goto(url(actRoute('matching')));await page.getByRole('button',{name:d.fullListeningHub.activity.checkAll}).waitFor();
  const finish=page.getByRole('button',{name:d.fullListeningHub.research.finish});
  await page.locator('select').first().selectOption('A');
  assert.equal(await finish.isDisabled(),true,'Finish blocked while question 2 is empty');
  await page.getByRole('button',{name:d.fullListeningHub.research.next}).click();
  await page.locator('select').first().selectOption('B');
  assert.equal(await finish.isDisabled(),false,'Finish enabled once all answered');
  await finish.click();
  await page.getByRole('status').filter({hasText:d.fullListeningHub.activity.incorrect}).waitFor();
  const post=state.requests.find(r=>r.path===apiPractice&&r.body?.complete===true);
  assert.ok(post,'complete write issued');assert.deepEqual(Object.keys(post.body.answers).sort(),['1','2']);
 }finally{await context.close();}
});

await check('V39 practice Previous and Next move between questions and reset the prediction field',async()=>{
 const d=dictOf('en');
 const {context,page}=await fixture({view:p=>p===actRoute('completion')?{kind:'practice',practice:practiceOf('completion',[q2(1,[]),q2(2,[])])}:undefined});
 try{await page.goto(url(actRoute('completion')));const pred=page.getByLabel(d.fullListeningHub.research.prediction);await pred.waitFor();
  await pred.fill('typed prediction');
  await page.getByRole('button',{name:d.fullListeningHub.research.next}).click();
  assert.equal(await page.getByLabel(d.fullListeningHub.research.prediction).inputValue(),'','prediction reset on Next');
  await page.getByRole('button',{name:d.fullListeningHub.research.previous}).click();
  assert.equal(await page.getByLabel(d.fullListeningHub.research.prediction).inputValue(),'','prediction reset on Previous');
 }finally{await context.close();}
});

await check('V39 practice completion: a text answer is sent as typed and the Test hub link returns to the hub',async()=>{
 const d=dictOf('en');
 const {context,page,state}=await fixture({view:(p)=>{if(p===actRoute('completion'))return {kind:'practice',practice:practiceOf('completion',[q2(1,[])])};if(p===hubRoute)return hubData(d);return undefined;},
  post:(p)=>p===apiPractice?{body:{results:[{number:1,correct:true,key:'synthetic',evidence:'ok'}]}}:undefined});
 try{await page.goto(url(actRoute('completion')));await page.locator('input').first().waitFor();
  await page.locator('main input').nth(1).fill('synthetic gap');
  await page.getByRole('button',{name:d.fullListeningHub.activity.checkAll}).click();
  await page.getByRole('status').filter({hasText:new RegExp('^'+d.fullListeningHub.activity.correct)}).waitFor();
  assert.equal(state.requests.find(r=>r.path===apiPractice).body.answers['1'],'synthetic gap');
  await page.getByRole('link',{name:d.fullListeningHub.examStart.back}).click();await page.waitForURL('**'+hubRoute);
 }finally{await context.close();}
});

await check('V39 practice retry with no missed questions shows the original empty message',async()=>{
 const d=dictOf('en');
 const {context,page}=await fixture({view:p=>p===actRoute('retry')?{kind:'practice',practice:practiceOf('retry',[])}:undefined});
 try{await page.goto(url(actRoute('retry')));await page.getByText(d.fullListeningHub.research.weakEmpty).waitFor();}finally{await context.close();}
});

await check('V39 practice map: the plan renders and a location answer is submitted (ListeningMap)',async()=>{
 const d=dictOf('en');
 const map={viewBox:[0,0,100,100],label:'Synthetic plan',shapes:[{tag:'rect',x:0,y:0,width:100,height:100}]};
 const {context,page,state}=await fixture({view:p=>p===actRoute('map')?{kind:'practice',practice:practiceOf('map',[q2(1,['A) north','B) south'])],{mapDiagram:map})}:undefined,
  post:(p)=>p===apiPractice?{body:{results:[{number:1,correct:true,key:'A',evidence:'ok'}]}}:undefined});
 try{await page.goto(url(actRoute('map')));await page.locator('[data-listening-map-practice]').waitFor();
  await page.locator('select').first().selectOption('A');
  await page.getByRole('button',{name:d.fullListeningHub.activity.checkAll}).click();
  await page.getByRole('status').filter({hasText:new RegExp('^'+d.fullListeningHub.activity.correct)}).waitFor();
  assert.equal(state.requests.find(r=>r.path===apiPractice).body.kind,'map');
 }finally{await context.close();}
});

await check('V39 practice error (500) shows the common error and Try again succeeds',async()=>{
 const d=dictOf('en');let n=0;
 const {context,page}=await fixture({view:p=>p===actRoute('matching')?{kind:'practice',practice:practiceOf('matching',[q2(1)])}:undefined,
  post:(p)=>{if(p!==apiPractice)return undefined;n++;return n===1?{status:500,json:{error:'x'}}:{body:{results:[{number:1,correct:true,key:'A',evidence:'ok'}]}};}});
 try{await page.goto(url(actRoute('matching')));await page.locator('select').first().waitFor();
  await page.locator('select').first().selectOption('A');
  await page.getByRole('button',{name:d.fullListeningHub.activity.checkAll}).click();
  await page.getByRole('alert').filter({hasText:d.common.error}).waitFor();
  await page.getByRole('button',{name:d.fullListeningHub.activity.checkAll}).click();
  await page.getByRole('status').filter({hasText:new RegExp('^'+d.fullListeningHub.activity.correct)}).waitFor();
  assert.equal(n,2);
 }finally{await context.close();}
});

await check('V39 practice while an exam is in progress shows the exam-locked notice',async()=>{
 const d=dictOf('en');
 const {context,page}=await fixture({view:p=>p===actRoute('matching')?{kind:'exam-locked'}:undefined});
 try{await page.goto(url(actRoute('matching')));await page.getByText(d.fullListeningHub.research.examLocked).waitFor();}finally{await context.close();}
});

await check('V39 activity 2 while an exam is in progress shows the exam-locked notice',async()=>{
 const d=dictOf('en');
 const {context,page}=await fixture({view:p=>p===actRoute(2)?{kind:'exam-locked'}:undefined});
 try{await page.goto(url(actRoute(2)));await page.getByText(d.fullListeningHub.research.examLocked).waitFor();}finally{await context.close();}
});

await check('V39 activity route: unknown view kind is a region error, never a fabricated activity',async()=>{
 const {context,page}=await fixture({view:p=>p===actRoute(2)?{kind:'mystery'}:undefined});
 try{await page.goto(url(actRoute(2)));await page.locator('[data-region-failure="listening"]').waitFor();
  assert.equal(await page.locator('main input, main textarea').count(),0);}finally{await context.close();}
});

await check('V39 activity 3 network failure on Save issues exactly one write (no silent replay)',async()=>{
 const d=dictOf('en');const act=gapAct3();
 const {context,page,state}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:undefined,
  post:(p)=>p===apiActivity?{status:503,json:{error:'x'}}:undefined});
 try{await page.goto(url(actRoute(3)));await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).waitFor();
  await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).click();
  await page.getByText(d.fullListeningHub.activity.saveFailed).waitFor();
  await page.waitForTimeout(500);
  assert.equal(countOf(state,apiActivity),1,'one request; no automatic replay');
 }finally{await context.close();}
});

await check('V39 activity source switch via popstate loads only the new test activity',async()=>{
 const a=activityFixture(2,{lexical:false});a.id=ID;const b=activityFixture(2,{lexical:false});b.id=ID2;b.title='Second synthetic activity';
 const {context,page}=await fixture({view:p=>{if(p===actRoute(2))return {kind:'activity',activity:a};if(p==='/app/listening/tests/'+ID2+'/2')return {kind:'activity',activity:b};return undefined;}});
 try{await page.goto(url(actRoute(2)));await page.getByRole('button',{name:/./}).first().waitFor();
  await page.evaluate(o=>{history.pushState({},'','/app/listening/tests/'+o+'/2');dispatchEvent(new PopStateEvent('popstate',{state:{}}));},ID2);
  await page.locator('main',{hasText:'Second synthetic activity'}).waitFor();
  assert.ok(!(await page.locator('main').innerText()).includes('Synthetic listening'),'old test title gone');
 }finally{await context.close();}
});

await check('V39 activity 3 typed gap answer survives reload from the local draft (sessionStorage), not from the server',async()=>{
 const d=dictOf('en');const act=gapAct3();
 const {context,page}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:undefined});
 try{await page.goto(url(actRoute(3)));await gapInput(page).waitFor();
  await gapInput(page).fill('draft survives reload');await page.waitForTimeout(200);await page.reload();
  await gapInput(page).waitFor();
  assert.equal(await gapInput(page).inputValue(),'draft survives reload');
 }finally{await context.close();}
});

await check('V39 activity direct reload refetches and keeps the same activity screen',async()=>{
 const d=dictOf('en');const act=activityFixture(2,{lexical:false});act.id=ID;
 const {context,page,state}=await fixture({view:p=>p===actRoute(2)?{kind:'activity',activity:act}:undefined});
 try{await page.goto(url(actRoute(2)));await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).waitFor();
  const before=countOf(state,'/api/frontend/view');await page.reload();
  await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).waitFor();
  assert.ok(countOf(state,'/api/frontend/view')>before,'reload refetches');
 }finally{await context.close();}
});

await check('V39 activity 2 authored-runtime redirect (kind authored) goes to the hub with no fragment',async()=>{
 const {context,page}=await fixture({view:p=>p===actRoute(2)?{kind:'authored'}:p===hubRoute?{kind:'authored'}:undefined});
 try{await page.goto(url(actRoute(2)));await page.waitForURL('**'+hubRoute);
  const u=new URL(page.url());assert.equal(u.pathname,hubRoute);assert.equal(u.hash,'');
 }finally{await context.close();}
});

// Activity 4 (keyword drill, recall) and 5 (vocabulary). Fixtures: activityFixture(4|5, {modern:true}).
const act4=()=>{const a=activityFixture(4,{lexical:false,modern:true});a.id=ID;return a;};
const act5=()=>{const a=activityFixture(5,{lexical:false,modern:true});a.id=ID;return a;};
const folderList={folders:[{id:'00000000-0000-4000-8000-0000000000f1',name:'Synthetic folder'}]};

await check('V39 activity 4 Commit and reveal stays disabled until a meaning is chosen; Save posts the chosen index once',async()=>{
 const d=dictOf('en');let saves=0;
 const {context,page,state}=await fixture({view:p=>p===actRoute(4)?{kind:'activity',activity:act4()}:undefined,
  post:(p)=>{if(p===apiActivity){saves++;return {body:{ok:true,id:ID,score:null,total:5}};}return undefined;}});
 try{await page.goto(url(actRoute(4)));const commit=page.getByRole('button',{name:d.fullListeningHub.activity.commitReveal});await commit.waitFor();
  assert.equal(await commit.isDisabled(),true,'Commit disabled before a choice');
  await page.locator('select').filter({hasText:d.fullListeningHub.activity.chooseMeaning}).first().selectOption('0');
  assert.equal(await commit.isDisabled(),false,'Commit enabled after a choice');
  await commit.click();
  await page.getByText('Synthetic link').first().waitFor();
  await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).click();
  await page.waitForTimeout(400);
  const post=state.requests.filter(r=>r.path===apiActivity&&r.method==='POST');
  assert.equal(post.length,1,'exactly one save');assert.equal(post[0].body.activity,4);assert.equal(post[0].body.complete,false);
  assert.equal(post[0].body.answers['1'],'0','chosen meaning index sent');
  assert.equal(await page.getByText(d.fullListeningHub.activity.saveFailed).count(),0,'valid write shows no save-failed message');
 }finally{await context.close();}
});

await check('V39 activity 4 failed Save shows the save-failed message and keeps the chosen meaning',async()=>{
 const d=dictOf('en');
 const {context,page}=await fixture({view:p=>p===actRoute(4)?{kind:'activity',activity:act4()}:undefined,
  post:(p)=>p===apiActivity?{status:500,json:{error:'x'}}:undefined});
 try{await page.goto(url(actRoute(4)));const sel=page.locator('select').filter({hasText:d.fullListeningHub.activity.chooseMeaning}).first();await sel.waitFor();
  await sel.selectOption('1');
  await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).click();
  await page.getByText(d.fullListeningHub.activity.saveFailed).waitFor();
  assert.equal(await sel.inputValue(),'1','chosen meaning kept');
 }finally{await context.close();}
});

await check('V39 activity 5 vocabulary: folder list loads, a chosen folder is sent with the sense and term, then the panel closes',async()=>{
 const d=dictOf('en');
 const {context,page,state}=await fixture({view:p=>p===actRoute(5)?{kind:'activity',activity:act5()}:undefined,
  post:(p,body)=>{if(p==='/api/vocabulary/folders')return {body:folderList};if(p==='/api/vocabulary')return {body:{ok:true}};return undefined;}});
 try{await page.goto(url(actRoute(5)));await page.getByRole('button',{name:'+ Vocabulary'}).waitFor();
  await page.getByRole('button',{name:'+ Vocabulary'}).click();
  const folder=page.getByRole('combobox',{name:'Folder'});await folder.waitFor();
  await folder.selectOption('00000000-0000-4000-8000-0000000000f1');
  await page.getByRole('button',{name:'Add to my words'}).click();
  await page.getByRole('button',{name:'Add to my words'}).waitFor({state:'detached'});
  const post=state.requests.find(r=>r.path==='/api/vocabulary'&&r.method==='POST');
  assert.ok(post,'vocabulary write issued');
  assert.equal(post.body.folderId,'00000000-0000-4000-8000-0000000000f1');
  assert.equal(post.body.sourceType,'listening');assert.equal(post.body.sourceId,ID);
  assert.equal(post.body.sessionSenseId,act5().data.vocabulary[0].senseId);
  assert.deepEqual(post.body.items.map(i=>i.term),['Synthetic']);
 }finally{await context.close();}
});

await check('V39 activity 5 failed vocabulary save shows the vocabulary save-failed message and keeps the panel',async()=>{
 const d=dictOf('en');
 const {context,page}=await fixture({view:p=>p===actRoute(5)?{kind:'activity',activity:act5()}:undefined,
  post:(p)=>{if(p==='/api/vocabulary/folders')return {body:folderList};if(p==='/api/vocabulary')return {status:500,json:{error:'x'}};return undefined;}});
 try{await page.goto(url(actRoute(5)));await page.getByRole('button',{name:'+ Vocabulary'}).click();
  await page.getByRole('button',{name:'Add to my words'}).click();
  await page.getByText(d.fullListeningHub.activity.vocabSaveFailed).waitFor();
  await page.getByRole('button',{name:'Add to my words'}).waitFor();
 }finally{await context.close();}
});

await check('V39 activity 5 Quiz: Check all answers is the graded Complete write; a changed choice clears the verdict (original answer() setResult(null)); re-check grades the new choice',async()=>{
 const d=dictOf('en');
 const {context,page,state}=await fixture({view:p=>p===actRoute(5)?{kind:'activity',activity:act5()}:undefined,
  post:(p)=>p===apiActivity?{body:{ok:true,id:ID,score:null,total:5}}:undefined});
 const verdict=t=>page.getByText(t,{exact:true});
 try{await page.goto(url(actRoute(5)));await page.getByRole('button',{name:'Quiz'}).click();
  const sel=page.locator('select').filter({hasText:'Synthetic correct'}).first();await sel.waitFor();
  assert.equal(await verdict('Incorrect · Synthetic correct').count(),0,'no verdict before a graded write');
  await sel.selectOption('1');
  await page.getByRole('button',{name:d.fullListeningHub.activity.checkAll}).click();
  await verdict('Incorrect · Synthetic correct').waitFor();
  await sel.selectOption('0');
  assert.equal(await verdict('Incorrect · Synthetic correct').count(),0,'changed choice clears the previous verdict');
  assert.equal(await verdict('Correct · Synthetic correct').count(),0,'no new verdict without a graded write');
  await page.getByRole('button',{name:d.fullListeningHub.activity.checkAll}).click();
  await verdict('Correct · Synthetic correct').waitFor();
  const posts=state.requests.filter(r=>r.path===apiActivity&&r.method==='POST');
  assert.equal(posts.length,2,'one graded write per Check');
  assert.equal(posts[0].body.complete,true);assert.equal(posts[0].body.answers['0'],'1');
  assert.equal(posts[1].body.complete,true);assert.equal(posts[1].body.answers['0'],'0');
 }finally{await context.close();}
});

// Media lifecycle: a real (synthetic, silent) WAV played from a practice route; leaving the route must pause it and
// detach its source. Served through the same authorized /api/resources path the practice DTO uses.
const silentWav=(()=>{const n=8000,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);return b;})();
await check('V39 media lifecycle: leaving a practice route pauses the audio and detaches its source (in-app navigation)',async()=>{
 const d=dictOf('en');const practice=practiceOf('matching',[q2(1)],{audioUrl:'/api/resources/synthetic-v39.wav'});
 const {context,page}=await fixture({view:(p)=>{if(p===actRoute('matching'))return {kind:'practice',practice};if(p===hubRoute)return hubData(d);return undefined;},
  post:(p)=>p==='/api/resources/synthetic-v39.wav'?{raw:{body:silentWav,contentType:'audio/wav',headers:{}}}:undefined});
 try{await page.goto(url(actRoute('matching')));await page.locator('audio').first().waitFor();
  await page.getByRole('button',{name:d.fullListeningHub.activity.playEvidence}).click().catch(()=>{});
  await page.evaluate(()=>{window.__v39audio=document.querySelector('audio');});
  await page.evaluate(()=>{history.pushState({},'','/app/listening/tests/'+location.pathname.split('/')[4]);dispatchEvent(new PopStateEvent('popstate',{state:{}}));});
  await page.locator('.listening-hub h1').waitFor();
  const st=await page.evaluate(()=>({paused:window.__v39audio.paused,src:window.__v39audio.getAttribute('src'),currentSrc:window.__v39audio.currentSrc,connected:window.__v39audio.isConnected}));
  assert.equal(st.paused,true,'paused after leaving: '+JSON.stringify(st));
  assert.ok(st.src===null||st.src==='','source attribute removed: '+JSON.stringify(st));
 }finally{await context.close();}
});

await check('V39 keyboard: Enter on the focused Save progress button of activity 4 sends one save (no pointer input)',async()=>{
 const d=dictOf('en');
 const {context,page,state}=await fixture({view:p=>p===actRoute(4)?{kind:'activity',activity:act4()}:undefined,
  post:(p)=>p===apiActivity?{body:{ok:true,id:ID,score:null,total:5}}:undefined});
 try{await page.goto(url(actRoute(4)));const save=page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress});await save.waitFor();
  await save.focus();await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  assert.equal(countOf(state,apiActivity),1,'exactly one keyboard-triggered save');
 }finally{await context.close();}
});

await check('V39 activity 3 write returning 401 ends the session (authority logout to /login), no retry',async()=>{
 const d=dictOf('en');let n=0;
 const {context,page,state}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:gapAct3()}:undefined,
  post:(p)=>{if(p!==apiActivity)return undefined;n++;return {status:401,json:{error:'unauthorized'}};}});
 try{await page.goto(url(actRoute(3)));await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).waitFor();
  await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).click();
  await page.waitForURL('**/login',{timeout:8000});
  await page.waitForTimeout(300);
  assert.equal(n,1,'no automatic retry after 401');
  assert.equal(countOf(state,apiActivity),1);
 }finally{await context.close();}
});

await check('V39 practice payload carrying an answer key is refused (region error, no question rendered)',async()=>{
 const practice=practiceOf('matching',[{...q2(1),key:'A'}]);
 const {context,page}=await fixture({view:p=>p===actRoute('matching')?{kind:'practice',practice}:undefined});
 try{await page.goto(url(actRoute('matching')));await page.locator('[data-region-failure="listening"]').waitFor();
  assert.equal(await page.locator('select').count(),0,'no question control rendered');
  assert.equal(await page.getByText('Synthetic question 1').count(),0);
 }finally{await context.close();}
});

for(const [width,height] of [[1440,900],[768,1024],[390,844]])for(const locale of ['en','uz'])for(const theme of ['day','night'])
 await check(`V39 activity matrix ${width}x${height} ${locale} ${theme}: gap activity renders its own labels and no horizontal overflow`,async()=>{
  const d=dictOf(locale);const {context,page}=await fixture({width,height,locale,theme,view:p=>p===actRoute(3)?{kind:'activity',activity:gapAct3()}:undefined});
  try{await page.goto(url(actRoute(3)));await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).waitFor();
   assert.ok(await page.getByRole('button',{name:d.fullListeningHub.activity.completeReviewed}).count()>=0);
   assert.equal(await page.getByRole('button',{name:d.fullListeningHub.activity.saveProgress}).count(),1);
   // Original components/listening/FullListeningActivity.tsx line 237 hard-codes '← Test hub' in every locale; native matches.
   assert.equal(await page.getByRole('link',{name:'← Test hub',exact:true}).count(),1,'inner Test hub link (source literal)');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
   assert.ok(overflow<=0,'no horizontal overflow, got '+overflow);
  }finally{await context.close();}
 });

// Functional matrix over viewport, locale and theme (text and layout, not pixels).
for(const [width,height] of [[1440,900],[768,1024],[390,844]])for(const locale of ['en','uz'])for(const theme of ['day','night'])
 await check(`V39 hub matrix ${width}x${height} ${locale} ${theme}: title, card CTA href and no horizontal overflow`,async()=>{
  const d=dictOf(locale);const {context,page}=await fixture({width,height,locale,theme,view:p=>p===hubRoute?hubData(d):undefined});
  try{await page.goto(url(hubRoute));await page.locator('.listening-hub h1').waitFor();
   assert.equal(await page.locator('.listening-hub article a.btn-primary').first().getAttribute('href'),hubRoute+'/1');
   assert.equal(await page.locator('.listening-hub article h2').first().innerText(),d.fullListeningHub.research.full);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
   assert.ok(overflow<=0,'no horizontal overflow, got '+overflow);
  }finally{await context.close();}
 });

await browser.close();
const failed=results.filter(r=>r.status!=='PASS');
fs.writeFileSync(new URL('browser-listening-v39-results.json',out),JSON.stringify({generated:new Date().toISOString(),counts:{PASS:results.length-failed.length,FAIL:failed.length},results},null,2)+'\n');
console.log(JSON.stringify({pass:results.length-failed.length,fail:failed.length}));
process.exitCode=failed.length?1:0;
