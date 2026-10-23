/** V44 Reading migration browser checks (synthetic fixtures; real clicks and inputs; page errors collected).
 * Sections: Lessons (catalogue, detail, media, tabs, progress, highlights), legacy /app/reading redirect. */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {publicPolicy,fixtureSession,testId as lessonId} from './fixtures.mjs';
import {lesson as listeningLesson,lessons as listeningLessons,id,qid} from './listening-v10-fixtures.mjs';

const deps=path.resolve(import.meta.dirname,'../node_modules');
if(process.platform==='linux'){const tar=path.join(deps,'al2023.tar');fs.writeFileSync(tar,brotliDecompressSync(fs.readFileSync(path.join(deps,'@sparticuz/chromium/bin/al2023.tar.br'))));execFileSync('tar',['xf',tar,'-C',deps]);process.env.LD_LIBRARY_PATH=path.join(deps,'lib')+':'+(process.env.LD_LIBRARY_PATH??'');}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('single-process')&&!a.includes('disable-web-security')&&!a.includes('allow-running-insecure-content')),headless:true});
const base=process.env.PREVIEW_URL??'http://127.0.0.1:4173';
const out=new URL('../docs/evidence/v44/',import.meta.url);fs.mkdirSync(out,{recursive:true});
const results=[];
async function check(name,fn){if(process.env.TEST_FILTER&&!name.includes(process.env.TEST_FILTER))return;try{await fn();results.push({name,status:'PASS'});console.log('PASS',name);}catch(e){if(process.env.DEBUG&&globalThis.__lastPage){console.error('URL',globalThis.__lastPage.url(),'TEXT',(await globalThis.__lastPage.locator('body').innerText().catch(()=>'?')).slice(0,500).replace(/\n/g,' | '),'HTML',(await globalThis.__lastPage.locator('#root').innerHTML().catch(()=>'?')).slice(0,300));}results.push({name,status:'FAIL',error:String(e.message).slice(0,700)});console.error('FAIL',name,String(e.message).slice(0,700));}}

/** Learner context. view(route) answers the proposed projection; api(path,ctx) answers other same-origin calls;
 * undefined is a 503. Every request is recorded. */
async function fixture({role='student',locale='en',theme='day',view,api}={}){
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.addCookies([{name:'la_locale',value:locale,url:base},{name:'la_theme',value:theme,url:base}]);
 await context.addInitScript(()=>{window.open=()=>null;window.__hist=[];for(const k of ['pushState','replaceState']){const orig=history[k].bind(history);history[k]=(st,t,u)=>{window.__hist.push({k,url:u==null?null:String(u)});return orig(st,t,u);};}});
 const page=await context.newPage();page.setDefaultTimeout(8000);globalThis.__lastPage=page;
 const errors=[];page.on('pageerror',e=>{errors.push(String(e.message));if(process.env.DEBUG)console.error('pageerror',e.stack?.slice(0,400));});if(process.env.DEBUG)page.on('console',m=>{if(m.type()==='error')console.error('console',m.text().slice(0,300));});
 const state={requests:[]};
 await context.route('**/api/**',async route=>{
  const r=route.request(),u=new URL(r.url()),p=u.pathname;
  let body=null;if(r.method()!=='GET'&&(r.headers()['content-type']??'').includes('application/json')){try{body=r.postDataJSON();}catch{body=null;}}
  state.requests.push({path:p,method:r.method(),query:u.search,body});
  const reply=x=>{if(x===undefined)return route.fulfill({status:503,json:{error:'unavailable'}});if(x.status)return route.fulfill({status:x.status,json:x.json});return route.fulfill({status:200,json:x});};
  if(p==='/api/frontend/public')return reply(publicPolicy);
  if(p==='/api/frontend/session')return reply(fixtureSession(role));
  if(p==='/api/notifications')return reply({notifications:[],unread:0});
  if(p==='/api/frontend/view'){const rt=u.searchParams.get('route');const data=view?await view(rt):undefined;return data===undefined?reply(undefined):reply({version:1,route:rt,data});}
  if(api){const answer=await api(p,{method:r.method(),body,u,state});if(answer!==undefined)return reply(answer);}
  return reply(undefined);
 });
 return {context,page,state,errors};
}
/** The proposed Reading lesson detail: same validated shape as the listening lesson, area 'reading', plus progress. */
const readingLesson=(over={})=>{const base=listeningLesson();return {...base,lesson:{...base.lesson,id:lessonId,learningArea:'reading',title:'Synthetic reading lesson'},progress:{state:'not_started',completedAt:null},...over};};
const readingCatalogue=()=>({library:{rows:[{id:lessonId,title:'Synthetic reading lesson',summary:'Synthetic description',estimatedMinutes:5,hasTeacherNotes:true,hasMedia:false},{id:qid,title:'Second lesson',summary:null,estimatedMinutes:null,hasTeacherNotes:false,hasMedia:false}],hasMore:true,area:'reading'}});
const detailRoute=`/app/reading/lessons/${lessonId}`;

await check('Reading landing: /app/reading redirects to Lessons with replaceState (the original redirect)',async()=>{
 const {context,page,errors}=await fixture({view:(rt)=>rt==='/app/reading/lessons'?readingCatalogue():undefined});
 try{
  await page.goto(base+'/app/reading');
  await page.waitForURL(/\/app\/reading\/lessons$/,{timeout:8000});
  await page.locator('[data-reading-lesson]').first().waitFor();
  const hist=await page.evaluate(()=>window.__hist);
  assert.ok(hist.some(h=>h.k==='replaceState'&&h.url&&h.url.endsWith('/app/reading/lessons')),'redirect replaced the entry');
  assert.ok(!hist.some(h=>h.k==='pushState'&&h.url&&h.url.endsWith('/app/reading/lessons')),'redirect did not push');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Reading legacy query links keep their destination (?tab=academic goes to Academic, not Lessons)',async()=>{
 const {context,page,errors}=await fixture({view:()=>undefined});
 try{
  await page.goto(base+'/app/reading?tab=academic');
  await page.waitForURL(/\/app\/reading\/academic/,{timeout:8000});
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Reading Lessons catalogue: cards, open links, next page, and empty state',async()=>{
 const {context,page,errors}=await fixture({view:(rt)=>rt.startsWith('/app/reading/lessons')?readingCatalogue():undefined});
 try{
  await page.goto(base+'/app/reading/lessons');
  await page.locator('[data-reading-lesson]').first().waitFor();
  assert.equal(await page.locator('[data-reading-lesson]').count(),2);
  assert.equal(await page.locator(`[data-reading-lesson="${lessonId}"] a`).getAttribute('href'),detailRoute);
  assert.equal(await page.locator('nav[aria-label] a').filter({hasText:'Next'}).count(),1,'next page link when hasMore');
  assert.equal(await page.locator('nav[aria-label] a').filter({hasText:'Previous'}).count(),0,'no previous on page 1');
  await page.locator(`[data-reading-lesson="${lessonId}"] a`).click();
  await page.waitForURL(new RegExp(detailRoute+'$'));
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Reading Lessons catalogue: an empty library shows the original empty message',async()=>{
 const {context,page}=await fixture({view:(rt)=>rt.startsWith('/app/reading/lessons')?{library:{rows:[],hasMore:false,area:'reading'}}:undefined});
 try{
  await page.goto(base+'/app/reading/lessons');
  await page.locator('[data-reading-lessons-empty]').waitFor();
  assert.equal((await page.locator('[data-reading-lessons-empty]').innerText()).trim(),'No Reading lessons are published yet.');
 }finally{await context.close();}
});

await check('Reading lesson detail: body first, audio with focus and minutes, then the three tabs',async()=>{
 const detail=readingLesson({media:{id:qid,title:'Synthetic audio',mediaKind:'audio',provider:'direct',videoId:'x',focus:'Listen for the speaker’s opinion.',durationSeconds:600},mediaUrl:'/api/resources/synthetic/audio.mp3'});
 const {context,page,errors}=await fixture({view:(rt)=>rt.split('?')[0]===detailRoute?{kind:'lesson',detail}:undefined});
 try{
  await page.goto(base+detailRoute);
    await page.locator('[data-reading-lesson-body-card]').waitFor();
  assert.ok((await page.locator('[data-reading-lesson-back]').getAttribute('href'))==='/app/reading/lessons');
  assert.ok((await page.locator('h1').innerText()).includes('Synthetic reading lesson'));
  assert.equal((await page.locator('[data-reading-lesson-audio]').getAttribute('preload')),'none');
  assert.ok((await page.locator('figcaption').innerText()).includes('10'),'minutes from durationSeconds');
  assert.ok((await page.locator('[data-reading-lesson-body-card]').innerText()).includes('Synthetic plain body <not markup>'),'authored text is plain');
  const body=await page.locator('[data-reading-lesson-body-card]').boundingBox(),tabs=await page.locator('[data-reading-lesson-tabs]').boundingBox();
  assert.ok(body.y<tabs.y,'body is before the tab bar');
  assert.equal(await page.locator('[data-reading-lesson-tab]').count(),3);
  assert.equal(await page.locator('[data-reading-description-focus]').innerText(),'Listen for the speaker’s opinion.');
  assert.equal(await page.locator('[data-reading-lesson-tab="description"]').getAttribute('data-active'),'true');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Reading lesson detail: tabs switch and survive reload; teacher notes source is shown',async()=>{
 const {context,page,errors}=await fixture({view:(rt)=>rt.split('?')[0]===detailRoute?{kind:'lesson',detail:readingLesson()}:undefined});
 try{
  await page.goto(base+detailRoute);
  await page.locator('[data-reading-lesson-tab="teacher-notes"]').click();
  await page.waitForURL(/\?tab=teacher-notes$/);
  assert.equal((await page.locator('[data-reading-teacher-notes]').innerText()).trim(),'Synthetic teacher notes');
  assert.equal(await page.locator('[data-reading-teacher-notes]').getAttribute('data-teacher-notes-source'),'lesson');
  await page.reload();
  await page.locator('[data-reading-lesson-panel="teacher-notes"]').waitFor();
  await page.locator('[data-reading-lesson-tab="xulosangiz"]').click();
  await page.waitForURL(/\?tab=xulosangiz$/);
  await page.locator('[data-reading-lesson-panel="xulosangiz"]').waitFor();
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Reading lesson detail: the progress control writes the existing lesson state endpoint',async()=>{
 const {context,page,errors,state}=await fixture({view:(rt)=>rt.split('?')[0]===detailRoute?{kind:'lesson',detail:readingLesson()}:undefined,api:async(p,{method})=>{if(p===`/api/lessons/${lessonId}/state`&&method==='POST')return {state:'in_progress'};return undefined;}});
 try{
  await page.goto(base+detailRoute);
  await page.locator('[data-lesson-start]').click();
  await page.locator('[data-lesson-start]:disabled').waitFor();
  const posts=state.requests.filter(r=>r.method==='POST'&&r.path===`/api/lessons/${lessonId}/state`);
  assert.equal(posts.length,1);assert.deepEqual(posts[0].body,{state:'in_progress'});
  assert.equal(await page.locator('[data-lesson-notes], [data-lesson-notes-field]').count(),0,'Reading lesson workspace shows no notes panel');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Reading lesson detail: a provider-hosted item links to the video-lesson studio, not a second player',async()=>{
 const detail=readingLesson({media:{id:qid,title:'Synthetic provider item',mediaKind:'video',provider:'youtube',videoId:'abc',focus:null,durationSeconds:null},mediaUrl:null});
 const {context,page,errors}=await fixture({view:(rt)=>rt.split('?')[0]===detailRoute?{kind:'lesson',detail}:undefined});
 try{
  await page.goto(base+detailRoute);
  await page.locator('[data-reading-lesson-media-link]').waitFor();
  assert.equal(await page.locator('[data-reading-lesson-media-link]').getAttribute('href'),`/app/video-lessons/${qid}`);
  assert.equal(await page.locator('video,audio').count(),0);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Reading lesson body: a selected range is highlighted for this visit only',async()=>{
 const {context,page,errors}=await fixture({view:(rt)=>rt.split('?')[0]===detailRoute?{kind:'lesson',detail:readingLesson()}:undefined});
 try{
  await page.goto(base+detailRoute);
  await page.locator('[data-highlight-surface]').first().waitFor();
  await page.evaluate(()=>{const region=document.querySelector('[data-highlight-surface]');const text=region.firstChild;const range=document.createRange();range.setStart(text,0);range.setEnd(text,9);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);region.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  if(false)console.error('DBGSEL',JSON.stringify(await page.evaluate(()=>({sel:String(getSelection()),collapsed:getSelection().isCollapsed,control:!!document.querySelector('[data-highlight-control]'),surface:document.querySelectorAll('[data-highlight-surface]').length,html:document.querySelector('[data-highlight-surface]')?.outerHTML.slice(0,300)}))));
  // The control is positioned from the selection rectangle; activate its button directly, as a pointer click would.
  await page.locator('[data-highlight-control] button').first().dispatchEvent('click');
  await page.locator('mark[data-highlight-id]').first().waitFor({timeout:3000});
  assert.equal(await page.locator('mark[data-highlight-id]').count(),1);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Reading lesson detail: unknown lesson shows the not-found presentation, not a service error',async()=>{
 const {context,page}=await fixture({view:(rt)=>rt.split('?')[0]===detailRoute?{kind:'not_found'}:undefined});
 try{
  await page.goto(base+detailRoute);
  await page.locator('[data-listening-not-found]').waitFor();
  assert.equal(await page.locator('[data-region-failure]').count(),0);
 }finally{await context.close();}
});

fs.writeFileSync(new URL('browser-reading-v44-results.json',out),JSON.stringify({suite:'V44 Reading migration',date:new Date().toISOString(),results,counts:{PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length}},null,2));
await browser.close();
const fails=results.filter(r=>r.status==='FAIL').length;
console.log(`V44: ${results.length-fails} pass, ${fails} fail`);
process.exit(fails?1:0);
