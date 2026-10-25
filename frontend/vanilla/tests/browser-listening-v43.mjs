/** V43 Listening Activity 3 script completion (two parts). Derived from the V39 harness. Synthetic authorized fixtures only; no live
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
import {lesson,testId as LESSON_ID} from './listening-v10-fixtures.mjs';
import en from '../js/i18n/en.js';import uz from '../js/i18n/uz.js';

const deps=path.resolve(import.meta.dirname,'../node_modules');
if(process.platform==='linux'){const tar=path.join(deps,'al2023.tar');fs.writeFileSync(tar,brotliDecompressSync(fs.readFileSync(path.join(deps,'@sparticuz/chromium/bin/al2023.tar.br'))));execFileSync('tar',['xf',tar,'-C',deps]);process.env.LD_LIBRARY_PATH=path.join(deps,'lib')+':'+(process.env.LD_LIBRARY_PATH??'');}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('single-process')&&!a.includes('disable-web-security')&&!a.includes('allow-running-insecure-content')),headless:true});
const base=process.env.PREVIEW_URL??'http://127.0.0.1:4173';
const out=new URL('../docs/evidence/v43/',import.meta.url);fs.mkdirSync(out,{recursive:true});
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


// Two-part script: part 1 has two gaps, part 2 one gap. Transcripts are synthetic.
// The server sends script parts OR the keyword drill for Activity 3, never both (activities.ts: keyword1 && !script).
// The package schema keeps keyword1 as an array (min 0), so a script package carries keyword1: [].
const scriptAct3=()=>{const a=gapAct3();a.data.keyword1=[];a.data.studyPack.scriptParts=[
 {part:1,transcript:'Synthetic alpha gap one and second clue here.',gaps:[{q:1,match:'gap one',answer:'alpha-one'},{q:2,match:'second clue',answer:'alpha-two'}]},
 {part:2,transcript:'Synthetic beta gap three here.',gaps:[{q:3,match:'gap three',answer:'beta-three'}]}];return a;};
const partButtons=(page,d)=>page.locator('nav[aria-label="'+d.fullListeningHub.research.script+'"] button');
const gapField=(page,part,q)=>page.locator('input[aria-label="PART '+part+' · '+q+'"]');
// The script block's own Check all (save false + reveal). The footer carries the same label for the complete write, so scope to the script section.
const checkAll=(page,d)=>page.locator('section').filter({has:page.locator('nav[aria-label="'+d.fullListeningHub.research.script+'"]')}).getByRole('button',{name:d.fullListeningHub.activity.checkAll});

await check('V43 activity 3 script: PART tabs switch gap fields and transcript; typed answers survive switching',async()=>{
 const d=dictOf('en');const act=scriptAct3();
 const {context,page,state}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:undefined,
  post:(p)=>{if(p===apiActivity)return {body:{ok:true,id:ATT,score:null,total:3}};return undefined;}});
 try{
  await page.goto(url(actRoute(3)));
  await gapField(page,1,1).waitFor();
  assert.equal(await gapField(page,2,3).count(),0,'part 2 gap not visible on part 1');
  await gapField(page,1,1).fill('my first answer');
  await partButtons(page,d).nth(1).click();
  await gapField(page,2,3).waitFor();
  assert.equal(await gapField(page,1,1).count(),0,'part 1 gap hidden on part 2');
  assert.ok((await page.locator('.card.p-5').filter({hasText:'Synthetic beta'}).count())>=1,'part 2 transcript shown');
  await partButtons(page,d).nth(0).click();
  await gapField(page,1,1).waitFor();
  assert.equal(await gapField(page,1,1).inputValue(),'my first answer','typed answer kept across part switch');
  assert.deepEqual(state.requests.filter(r=>r.method==='POST'),[],'part switching writes nothing');
  assert.deepEqual(page.url().endsWith('/3'),true,'part switching stays on the activity route');
 }finally{await context.close();}
});

await check('V43 activity 3 script: Check all is disabled until every gap of the part is answered',async()=>{
 const d=dictOf('en');const act=scriptAct3();
 const {context,page,state}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:undefined,
  post:(p)=>{if(p===apiActivity)return {body:{ok:true,id:ATT,score:null,total:3}};return undefined;}});
 try{
  await page.goto(url(actRoute(3)));
  await gapField(page,1,1).waitFor();
  assert.equal(await checkAll(page,d).isDisabled(),true,'disabled with no answers');
  await gapField(page,1,1).fill('x');
  assert.equal(await checkAll(page,d).isDisabled(),true,'still disabled with gap 2 empty');
  await gapField(page,1,2).fill('y');
  assert.equal(await checkAll(page,d).isDisabled(),false,'enabled when all part 1 gaps are answered');
  assert.equal(state.requests.filter(r=>r.method==='POST').length,0,'no write before Check all');
 }finally{await context.close();}
});

await check('V43 activity 3 script: Check all reveals each gap (correct label or key), saves once with the answers',async()=>{
 const d=dictOf('en');const act=scriptAct3();
 const {context,page,state}=await fixture({view:p=>p===actRoute(3)?{kind:'activity',activity:act}:undefined,
  post:(p)=>{if(p===apiActivity)return {body:{ok:true,id:ATT,score:null,total:3}};return undefined;}});
 try{
  await page.goto(url(actRoute(3)));
  await gapField(page,1,1).waitFor();
  await gapField(page,1,1).fill('alpha-one');
  await gapField(page,1,2).fill('not it');
  await checkAll(page,d).click();
  await page.waitForTimeout(400);
  const posts=state.requests.filter(r=>r.method==='POST'&&r.path===apiActivity);
  assert.equal(posts.length,1,'exactly one write');
  assert.equal(posts[0].body.activity,3);
  assert.equal(posts[0].body.complete,false);
  assert.equal(posts[0].body.answers['1'],'alpha-one');
  assert.equal(posts[0].body.answers['2'],'not it');
  const scriptBox=page.locator('.card.p-5').filter({hasText:'Synthetic alpha'});
  const txt=await scriptBox.innerText();
  assert.ok(txt.includes(d.fullListeningHub.activity.correct),'correct gap shows the correct label');
  assert.ok(txt.includes('alpha-two'),'wrong gap reveals the key');
 }finally{await context.close();}
});


// ---------- LESSONS (/app/listening/lessons/:id) : media and description ----------
const lessonRoute='/app/listening/lessons/'+LESSON_ID;
await check('V43 lesson: direct audio media plays from its resource, and the description shows the media focus and minutes',async()=>{
 const d=dictOf('en');const L=lesson();L.lesson.estimatedMinutes=7;
 L.media={id:'00000000-0000-4000-8000-00000000ee01',title:'Synthetic media',mediaKind:'audio',provider:'direct',videoId:null,durationSeconds:300,focus:'Synthetic focus text',notes:null};
 L.mediaUrl='/api/resources/synthetic.mp3';
 const {context,page}=await fixture({view:p=>p===lessonRoute?{kind:'lesson',detail:L}:undefined});const errors=[];page.on('pageerror',e=>errors.push(String(e.message)));
 try{
  await page.goto(url(lessonRoute));
  const audio=page.locator('[data-listening-lesson-audio]');await audio.waitFor();
  assert.equal(await audio.getAttribute('src'),'/api/resources/synthetic.mp3');
  assert.equal(await audio.getAttribute('preload'),'none');
  assert.equal(await page.locator('[data-listening-lesson-media-elsewhere]').count(),0,'no provider link for direct audio');
  await page.locator('[data-listening-lesson-tab="description"]').click();
  await page.locator('[data-listening-description-focus]').waitFor();
  assert.equal((await page.locator('[data-listening-description-focus]').innerText()).trim(),'Synthetic focus text');
  assert.ok((await page.locator('[data-listening-lesson-panel="description"]').innerText()).includes('7'),'estimated minutes shown');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('V43 lesson: provider-hosted media is not played here; it links to the video-lesson studio',async()=>{
 const L=lesson();
 L.media={id:'00000000-0000-4000-8000-00000000ee02',title:'Synthetic provider video',mediaKind:'video',provider:'youtube',videoId:'abc123',durationSeconds:null,focus:null,notes:null};
 L.mediaUrl=null;
 const {context,page}=await fixture({view:p=>p===lessonRoute?{kind:'lesson',detail:L}:undefined});const errors=[];page.on('pageerror',e=>errors.push(String(e.message)));
 try{
  await page.goto(url(lessonRoute));
  const link=page.locator('[data-listening-lesson-media-link]');await link.waitFor();
  assert.equal(await link.getAttribute('href'),'/app/video-lessons/00000000-0000-4000-8000-00000000ee02');
  assert.equal((await link.innerText()).trim(),'Synthetic provider video');
  assert.equal(await page.locator('[data-listening-lesson-audio],[data-listening-lesson-video]').count(),0,'no player for provider media');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(new URL('browser-listening-v43-results.json',out),JSON.stringify({suite:'V43 Activity 3 script completion',date:new Date().toISOString(),results,counts:{PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length}},null,2));
await browser.close();
const fails=results.filter(r=>r.status==='FAIL').length;
console.log(`V43: ${results.length-fails} pass, ${fails} fail`);
process.exit(fails?1:0);
