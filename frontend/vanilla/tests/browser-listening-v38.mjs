/** V38 Listening route-parity browser journeys. Synthetic fixtures only; no live acceptance.
 * Chromium library setup matches the preserved V37 harness. */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
// Package-provided Linux shared libraries; no system installation or production access.
const deps=path.resolve(import.meta.dirname,'../node_modules');
if(process.platform==='linux'){const tar=path.join(deps,'al2023.tar');fs.writeFileSync(tar,brotliDecompressSync(fs.readFileSync(path.join(deps,'@sparticuz/chromium/bin/al2023.tar.br'))));execFileSync('tar',['xf',tar,'-C',deps]);process.env.LD_LIBRARY_PATH=path.join(deps,'lib')+':'+(process.env.LD_LIBRARY_PATH??'');}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('single-process')&&!a.includes('disable-web-security')&&!a.includes('allow-running-insecure-content')),headless:true});

import {publicPolicy,fixtureSession,viewFixture} from './fixtures.mjs';
import {legacyFixture,id,qid,runId} from './listening-v8-fixtures.mjs';
import en from '../js/i18n/en.js';import uz from '../js/i18n/uz.js';
const base=process.env.PREVIEW_URL??'http://127.0.0.1:4173',out=new URL('../docs/evidence/v38/',import.meta.url),results=[];fs.mkdirSync(out,{recursive:true});
async function check(name,fn){if(process.env.TEST_FILTER&&!name.includes(process.env.TEST_FILTER))return;try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});console.error('FAIL',name,e.stack);}}
async function fixture({width=1440,height=900,locale='en',theme='day',role='student',handler}={}){
 const context=await browser.newContext({viewport:{width,height}});await context.addCookies([{name:'la_locale',value:locale,url:base},{name:'la_theme',value:theme,url:base}]);await context.addInitScript(()=>{window.open=()=>null;});const page=await context.newPage();page.setDefaultTimeout(8000);const state={status:'active',onboarded:true,requests:[]};
 await context.route('**/api/**',async route=>{const r=route.request(),u=new URL(r.url()),p=u.pathname,body=r.method()==='GET'||!(r.headers()['content-type']??'').includes('application/json')?null:r.postDataJSON();state.requests.push({path:p,method:r.method(),body});if(handler&&await handler({route,r,u,path:p,body,state,context}))return;const json=value=>route.fulfill({json:value});
  if(p==='/api/frontend/public')return json(publicPolicy);
  if(p==='/api/frontend/session'){const value=fixtureSession(role);value.session.user.accountStatus=state.status;return json(value);}
  if(p==='/api/frontend/view'){const key=u.searchParams.get('route');return json({version:1,route:key,data:viewFixture(key.split('?')[0])});}
  if(p==='/api/notifications')return json({notifications:[],unread:0});
  return route.fulfill({status:503,json:{error:'isolated_unconfigured'}});
 });return {context,page,state};
}
const legacyView=()=>({version:1,route:'/app/listening/attempts/'+id,data:{kind:'legacy-exam',exam:legacyFixture()}});

// 1. Original ListeningExam calls useFocusEntry, but the original (focus) layout does not render ShellUtilities
// (only (shell)/layout.tsx does), so there is no subscriber and no visible Focus-mode entry. Native must match.
await check('V38 in-progress legacy attempt (focus group) does not auto-enter Focus mode; original (focus) layout has no ShellUtilities subscriber',async()=>{
 const {context,page}=await fixture({handler:async({route,path})=>{if(path==='/api/frontend/view'){await route.fulfill({json:legacyView()});return true;}return false;}});
 try{await page.goto(base+`/app/listening/attempts/${id}`);await page.getByText('Synthetic legacy question',{exact:true}).waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.focus),'off');
  assert.equal(await page.locator('[data-listening-focus-backbar]').count(),1);
 }finally{await context.close();}
});

// 2. Original ListeningExam failureMessage mapping for submit failures (not a generic server message).
for(const [label,respond,key] of [
 ['rate limited 429','429','errorRateLimited'],
 ['network failure','network','errorNetwork'],
 ['server 500','500','errorServer'],
]){
 await check(`V38 legacy submit ${label} shows the original failure category`,async()=>{
  const {context,page}=await fixture({handler:async({route,path,r})=>{if(path==='/api/frontend/view'){await route.fulfill({json:legacyView()});return true;}if(path===`/api/listening/attempts/${id}/submit`&&r.method()==='POST'){if(respond==='network')await route.abort('failed');else if(respond==='429')await route.fulfill({status:429,json:{error:'rate_limited'}});else await route.fulfill({status:500,json:{error:'boom'}});return true;}return false;}});
  try{await page.goto(base+`/app/listening/attempts/${id}`);await page.getByText('Synthetic legacy question',{exact:true}).waitFor();
   await page.locator('input').fill('own legacy response');page.once('dialog',d=>d.accept());
   await page.getByRole('button',{name:en.listening.submit,exact:true}).click();
   const alert=page.getByRole('alert').filter({hasText:en.auth[key]});await alert.waitFor();
   assert.equal((await alert.textContent()).trim(),en.auth[key]);
  }finally{await context.close();}
 });
}

// 3. Original McqMastery after reasoned: router.replace + router.refresh (no heading focus steal).
await check('V38 MCQ Day reasoned completion refreshes day progress without moving focus to the heading',async()=>{
 let stage=0,opens=0,patches=[],requests=0;const flow=[{to:'notes',field:'notes',minLength:3},{to:'committed',field:'ownAnswer',minLength:1},{to:'revealed',field:null,minLength:0},{to:'chosen',field:'chosenAnswer',minLength:1},{to:'reasoned',field:'reasoning',minLength:10}],stages=['listen','notes','committed','revealed','chosen','reasoned'],options=['A. Synthetic','B. Synthetic','C. Synthetic','D. Synthetic','E. Synthetic'];
 const payload=()=>({session:{id:'isolated-six-stage',stage:stages[stage],chosenAnswer:stage>=4?JSON.stringify([options[0],options[4]]):null},question:{id:'isolated-question-0',order:1,questionText:'Synthetic workflow'},options:stage>=3?options:null,multiple:true,correctAnswer:stage>=4?'A;E':null,explanation:stage>=4?'Synthetic server explanation':null,outcome:stage>=4?'incorrect':null,next:flow[stage]??null});
 const {context,page}=await fixture({handler:async({route,path,r,u})=>{
  if(path==='/api/listening/mcq'){if(++opens===1){await route.fulfill({status:503,json:{error:'PRIVATE_TRACE'}});return true;}await route.fulfill({json:payload()});return true;}
  if(path==='/api/listening/mcq/isolated-six-stage'){patches.push(r.postDataJSON());stage++;await route.fulfill({json:payload()});return true;}
  if(path==='/api/frontend/view'&&u.searchParams.get('route').startsWith('/app/listening/mcq/day/8')){requests++;const data=viewFixture('/app/listening/mcq/day/8');data.day.questions[0].stage=stage?stages[stage]:null;data.day.status={state:stage===0?'not_started':'in_progress',completed:stage===5?1:0,total:5};await route.fulfill({json:{version:1,route:u.searchParams.get('route'),data}});return true;}
  return false;}});
 try{await page.goto(base+'/app/listening/mcq/day/8?q=1');await page.locator('[data-mcq-open]').click();await page.getByRole('alert').filter({hasText:en.common.error}).waitFor();await page.locator('[data-mcq-open]').click();await page.locator('[data-mcq-input]').waitFor();
  await page.locator('[data-mcq-input]').fill('Synthetic notes');await page.locator('[data-mcq-advance]').click();await page.locator('[data-mcq-advance=committed]').waitFor();
  await page.locator('[data-mcq-input]').fill('My own synthetic answer');await page.locator('[data-mcq-advance]').click();await page.locator('[data-mcq-advance=revealed]').waitFor();
  await page.locator('[data-mcq-advance]').click();await page.locator('input[type=checkbox]').nth(4).waitFor();
  await page.locator('input[type=checkbox]').nth(0).check();await page.locator('input[type=checkbox]').nth(4).check();await page.locator('[data-mcq-advance]').click();await page.locator('[data-mcq-outcome=incorrect]').waitFor();
  await page.evaluate(()=>{window.__v38FocusIn=[];document.addEventListener('focusin',e=>window.__v38FocusIn.push(e.target.tagName),true);});
  await page.locator('[data-mcq-input]').fill('Synthetic reasoning that explains the choice');await page.locator('[data-mcq-advance]').click();
  await page.locator('[data-listening-mcq-day-progress="1/5"]').waitFor();
  // Transient heading focus (router navigate focuses h1/[data-shell-main]) would be recorded here even if focus later moves away.
  const focusIn=await page.evaluate(()=>window.__v38FocusIn.slice());
  assert.ok(!focusIn.some(t=>['MAIN','H1'].includes(t)),'reasoned completion must not focus the route heading or main, focusin='+focusIn.join(','));
  assert.equal(requests,2);assert.equal(new URL(page.url()).search,'?q=1');
  // Original router.replace + router.refresh never moves focus; the route container and heading must not receive it.
  const focused=await page.evaluate(()=>document.activeElement?.tagName??'');
  assert.ok(!['MAIN','H1'].includes(focused),'route navigation must not move focus after refresh, got '+focused);
 }finally{await context.close();}
});

fs.writeFileSync(new URL('v38-browser-results.json',out),JSON.stringify({generated:new Date().toISOString(),results},null,2));
await browser.close();
const failed=results.filter(r=>r.status!=='PASS');console.log(JSON.stringify({pass:results.length-failed.length,fail:failed.length}));
if(failed.length)process.exit(1);
