/** V42 Listening learner sections: Lessons detail/tabs/catalogue, the module landing, and the Test MCQ page
 * (`/app/listening/tests/:id/mcq`). Synthetic fixtures only; every case drives real clicks/inputs and asserts
 * visible behaviour or recorded requests. Page errors are collected on every case. */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {publicPolicy,fixtureSession} from './fixtures.mjs';
import {lesson,lessons,testId,qid} from './listening-v10-fixtures.mjs';
import en from '../js/i18n/en.js';

const deps=path.resolve(import.meta.dirname,'../node_modules');
if(process.platform==='linux'){const tar=path.join(deps,'al2023.tar');fs.writeFileSync(tar,brotliDecompressSync(fs.readFileSync(path.join(deps,'@sparticuz/chromium/bin/al2023.tar.br'))));execFileSync('tar',['xf',tar,'-C',deps]);process.env.LD_LIBRARY_PATH=path.join(deps,'lib')+':'+(process.env.LD_LIBRARY_PATH??'');}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('single-process')&&!a.includes('disable-web-security')&&!a.includes('allow-running-insecure-content')),headless:true});
const base=process.env.PREVIEW_URL??'http://127.0.0.1:4173';
const out=new URL('../docs/evidence/v42/',import.meta.url);fs.mkdirSync(out,{recursive:true});
const results=[];
async function check(name,fn){if(process.env.TEST_FILTER&&!name.includes(process.env.TEST_FILTER))return;try{await fn();results.push({name,status:'PASS'});console.log('PASS',name);}catch(e){results.push({name,status:'FAIL',error:String(e.message).slice(0,700)});console.error('FAIL',name,String(e.message).slice(0,700));}}

/** Learner context. view(route) returns projection data, {status,json}, or undefined (503). api(path,ctx) answers
 * other same-origin calls; undefined falls through to 503. Every request is recorded. */
async function fixture({role='student',locale='en',theme='day',view,api}={}){
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.addCookies([{name:'la_locale',value:locale,url:base},{name:'la_theme',value:theme,url:base}]);
 await context.addInitScript(()=>{window.open=()=>null;window.__hist=[];for(const k of ['pushState','replaceState']){const orig=history[k].bind(history);history[k]=(st,t,u)=>{window.__hist.push({k,url:u==null?null:String(u)});return orig(st,t,u);};}});
 const page=await context.newPage();page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e.message)));
 const state={requests:[]};
 await context.route('**/api/**',async route=>{
  const r=route.request(),u=new URL(r.url()),p=u.pathname;
  let body=null;if(r.method()!=='GET'&&(r.headers()['content-type']??'').includes('application/json')){try{body=r.postDataJSON();}catch{body=null;}}
  state.requests.push({path:p,method:r.method(),query:u.search,body});
  const reply=x=>{if(x===undefined)return route.fulfill({status:503,json:{error:'unavailable'}});if(x.status)return route.fulfill({status:x.status,json:x.json});return route.fulfill({status:200,json:x});};
  if(p==='/api/frontend/public')return reply(publicPolicy);
  if(p==='/api/frontend/session')return reply(fixtureSession(role));
  if(p==='/api/notifications')return reply({notifications:[],unread:0});
  if(p==='/api/frontend/view'){const rt=u.searchParams.get('route');const data=view?await view(rt.split('?')[0]):undefined;return data===undefined?reply(undefined):reply({version:1,route:rt,data});}
  if(api){const answer=await api(p,{method:r.method(),body,u,state});if(answer!==undefined)return reply(answer);}
  return reply(undefined);
 });
 return {context,page,state,errors};
}
const LESSON=testId;
const DEFAULT_TEST={id:testId,title:'Synthetic Academic',audioUrl:'/api/resources/synthetic.mp3',questions:[{id:qid,order:1,questionText:'Synthetic question one',stage:'listen',at:12.5}]};
const drillPayload=(stage)=>({session:{id:'v42-session',stage,notes:null,ownAnswer:null,chosenAnswer:null,reasoning:null},question:{id:qid,order:1,questionText:'Synthetic question one'},options:null,multiple:null,correctAnswer:null,explanation:null,outcome:null,next:{to:'notes',field:'notes',minLength:3}});
const mcqApi=(onOpen)=>async(p,{method})=>{if(p==='/api/listening/mcq'&&method==='POST'){onOpen();return drillPayload('listen');}return undefined;};
const testMcqView=(rt,test=DEFAULT_TEST)=>rt==='/app/listening/tests/'+testId+'/mcq'?{kind:'mcq',mcq:test}:undefined;
const lessonRoute='/app/listening/lessons/'+LESSON;

await check('Listening landing: /app/listening lands on Lessons through a replaced history entry, as the original redirect() does',async()=>{
 const {context,page,errors}=await fixture({role:'student',view:(rt)=>rt==='/app/listening/lessons'?lessons():undefined});
 try{
  await page.goto(base+'/app');
  await page.goto(base+'/app/listening');
  await page.waitForURL(/\/app\/listening\/lessons$/,{timeout:8000});
  await page.locator('[data-listening-lesson-card]').first().waitFor();
  // The original redirect() leaves no entry for /app/listening: the router's canonicalPath() rewrites it with replaceState.
  const hist=await page.evaluate(()=>window.__hist);
  assert.ok(hist.some(h=>h.k==='replaceState'&&h.url&&h.url.endsWith('/app/listening/lessons')),'landing used replaceState: '+JSON.stringify(hist));
  assert.ok(!hist.some(h=>h.k==='pushState'&&h.url&&h.url.endsWith('/app/listening/lessons')),'landing did not push an entry');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Lesson detail: tabs keep the chosen panel across reload; the back link returns to Lessons',async()=>{
 const {context,page,errors}=await fixture({role:'student',view:(rt)=>rt===lessonRoute?{kind:'lesson',detail:lesson()}:undefined});
 try{
  await page.goto(base+lessonRoute);
  await page.locator('[data-listening-lesson-panel="description"]').waitFor();
  assert.equal((await page.locator('[data-listening-description]').innerText()).trim(),'Synthetic description');
  assert.equal(await page.locator('[data-listening-lesson-tab="description"]').getAttribute('data-active'),'true');
  assert.equal(await page.locator('[data-listening-lesson-tab="description"]').getAttribute('role'),'tab');
  assert.equal(await page.locator('[data-listening-lesson-tab="description"]').getAttribute('aria-selected'),'true');
  await page.locator('[data-listening-lesson-tab="teacher-notes"]').click();
  await page.waitForURL(/\?tab=teacher-notes$/);
  assert.equal((await page.locator('[data-listening-teacher-notes]').innerText()).trim(),'Synthetic teacher notes');
  await page.reload();
  await page.locator('[data-listening-lesson-panel="teacher-notes"]').waitFor();
  assert.equal(await page.locator('[data-listening-lesson-tab="teacher-notes"]').getAttribute('data-active'),'true','reload keeps the tab');
  await page.locator('[data-listening-lesson-tab="xulosangiz"]').click();
  await page.locator('[data-listening-lesson-panel="xulosangiz"]').waitFor();
  assert.equal(await page.locator('[data-listening-description]').count(),0,'the description panel is replaced');
  await page.locator('[data-listening-lesson-back]').click();
  await page.waitForURL(/\/app\/listening\/lessons$/);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Lesson detail: the body shows the authored text and quiz block before the three approved panels',async()=>{
 const {context,page,errors}=await fixture({role:'student',view:(rt)=>rt===lessonRoute?{kind:'lesson',detail:lesson()}:undefined});
 try{
  await page.goto(base+lessonRoute);
  await page.locator('[data-listening-lesson-body-card]').waitFor();
  const body=await page.locator('[data-listening-lesson-body-card]').boundingBox();
  const tabs=await page.locator('[data-listening-lesson-tabs]').boundingBox();
  assert.ok(body.y<tabs.y,'body is before the tab bar');
  assert.equal(await page.locator('[data-listening-lesson-tab]').count(),3);
  assert.ok((await page.locator('[data-listening-lesson-body-card]').innerText()).includes('Synthetic plain body <not markup>'),'authored text shows as plain text');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Lesson detail: an unknown lesson shows the not-found state, not a service error',async()=>{
 const {context,page,errors}=await fixture({role:'student',view:(rt)=>rt.startsWith('/app/listening/lessons/')?{kind:'not_found'}:undefined});
 try{
  await page.goto(base+lessonRoute);
  await page.locator('[data-listening-not-found]').waitFor();
  assert.equal(await page.locator('[data-region-failure]').count(),0);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Lessons catalogue card opens its detail page',async()=>{
 const {context,page,errors}=await fixture({role:'student',view:(rt)=>{if(rt==='/app/listening/lessons')return lessons();if(rt===lessonRoute)return {kind:'lesson',detail:lesson()};return undefined;}});
 try{
  await page.goto(base+'/app/listening/lessons');
  await page.locator('[data-listening-lesson-open]').first().click();
  await page.waitForURL(new RegExp('/app/listening/lessons/'+LESSON+'$'));
  await page.locator('[data-listening-lesson-panel="description"]').waitFor();
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Test MCQ page: heading, back link to the test hub, and the original per-question audio offset',async()=>{
 const {context,page,errors}=await fixture({role:'student',view:(rt)=>testMcqView(rt),api:mcqApi(()=>{})});
 try{
  await page.goto(base+'/app/listening/tests/'+testId+'/mcq');
  await page.locator('[data-mcq-open]').waitFor();
  assert.ok((await page.locator('h1').innerText()).includes(en.fullListeningHub.research.mcq));
  assert.equal(await page.locator('a[href="/app/listening/tests/'+testId+'"]').count(),1,'the page links back to its test hub');
  await page.locator('[data-mcq-open]').click();
  const audio=page.locator('audio').first();
  await audio.waitFor();
  assert.ok((await audio.getAttribute('src')).endsWith('#t=12.5'),'audio starts at the question evidence time');
  assert.equal(await audio.getAttribute('preload'),'none');
  assert.equal(await audio.getAttribute('aria-label'),en.fullListeningHub.research.listenPart+' · 1');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Test MCQ page: opening a question shows the note field and the start-to-resume label change',async()=>{
 let opened=0;
 const {context,page,errors}=await fixture({role:'student',view:(rt)=>testMcqView(rt),api:mcqApi(()=>opened++)});
 try{
  await page.goto(base+'/app/listening/tests/'+testId+'/mcq');
  const open=page.locator('[data-mcq-open]');
  assert.equal((await open.innerText()).trim(),en.listening.mcqStart);
  await open.click();
  await page.locator('[data-mcq-input]').waitFor();
  assert.equal(opened,1);
  assert.equal(await page.locator('[data-mcq-advance]').isDisabled(),true,'the notes gate needs text');
  await page.locator('[data-mcq-input]').fill('abc');
  assert.equal(await page.locator('[data-mcq-advance]').isDisabled(),false);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Test MCQ page: a learner with an exam in progress gets the locked notice and a way back, not the drill',async()=>{
 const {context,page}=await fixture({role:'student',view:(rt)=>rt==='/app/listening/tests/'+testId+'/mcq'?{kind:'exam-locked'}:undefined});
 try{
  await page.goto(base+'/app/listening/tests/'+testId+'/mcq');
  await page.getByRole('status').filter({hasText:en.fullListeningHub.research.examLocked}).waitFor();
  assert.equal(await page.locator('[data-mcq-open]').count(),0);
  assert.equal(await page.locator('a[href="/app/listening/tests/'+testId+'"]').count(),1,'the locked page keeps its way back');
 }finally{await context.close();}
});

fs.writeFileSync(new URL('browser-listening-v42-results.json',out),JSON.stringify({suite:'V42 Listening learner sections',date:new Date().toISOString(),results,counts:{PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length}},null,2));
await browser.close();
const fails=results.filter(r=>r.status==='FAIL').length;
console.log(`V42: ${results.length-fails} pass, ${fails} fail`);
process.exit(fails?1:0);
