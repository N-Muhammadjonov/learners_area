/** V46 Reading browser checks: General start failure, Retention phrase lookup, Retention completion (overview refresh,
 * single submit, no late draft write). Synthetic fixtures; real clicks and inputs; page errors collected. */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {publicPolicy,fixtureSession} from './fixtures.mjs';

const deps=path.resolve(import.meta.dirname,'../node_modules');
if(process.platform==='linux'){const tar=path.join(deps,'al2023.tar');fs.writeFileSync(tar,brotliDecompressSync(fs.readFileSync(path.join(deps,'@sparticuz/chromium/bin/al2023.tar.br'))));execFileSync('tar',['xf',tar,'-C',deps]);process.env.LD_LIBRARY_PATH=path.join(deps,'lib')+':'+(process.env.LD_LIBRARY_PATH??'');}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('single-process')&&!a.includes('disable-web-security')&&!a.includes('allow-running-insecure-content')),headless:true});
const base=process.env.PREVIEW_URL??'http://127.0.0.1:4173';
const out=new URL('../docs/evidence/v46/',import.meta.url);fs.mkdirSync(out,{recursive:true});
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
  const reply=x=>{if(x===undefined)return route.fulfill({status:503,json:{error:'unavailable'}});if(typeof x.status==='number')return route.fulfill({status:x.status,json:x.json});return route.fulfill({status:200,json:x});};
  if(p==='/api/frontend/public')return reply(publicPolicy);
  if(p==='/api/frontend/session')return reply(fixtureSession(role));
  if(p==='/api/notifications')return reply({notifications:[],unread:0});
  if(p==='/api/frontend/view'){const rt=u.searchParams.get('route');const data=view?await view(rt):undefined;return data===undefined?reply(undefined):reply({version:1,route:rt,data});}
  if(api){const answer=await api(p,{method:r.method(),body,u,state});if(answer!==undefined)return reply(answer);}
  return reply(undefined);
 });
 return {context,page,state,errors};
}
/** Shared ids (synthetic). */
const SET='00000000-0000-4000-8000-0000000000b1',P1='00000000-0000-4000-8000-0000000000c1',G1='00000000-0000-4000-8000-0000000000d1';
const Q1='00000000-0000-4000-8000-0000000000e1',Q2='00000000-0000-4000-8000-0000000000e2',Q3='00000000-0000-4000-8000-0000000000e3';
const GSET='00000000-0000-4000-8000-0000000000b9',OCC='00000000-0000-4000-8000-0000000000a5';
const RA1='00000000-0000-4000-8000-000000000001',RA2='00000000-0000-4000-8000-000000000002',RID='00000000-0000-4000-8000-0000000000a7';
const groups=[{id:G1,position:1,typeCode:'true_false_not_given',displayTitle:null,instructionsText:'Do the following statements agree with the information in the passage?',fromQuestionNo:1,toQuestionNo:3,sharedChoices:[]}];
const questions=[{id:Q1,questionNo:1,order:1,type:'true_false_not_given',typeCode:'true_false_not_given',groupId:G1,renderMode:'question_row',questionText:'Paragraph A is about boiling.',options:null,answerConstraint:null},{id:Q2,questionNo:2,order:2,type:'short_answer',typeCode:'short_answer',groupId:G1,renderMode:'question_row',questionText:'Water boils at ___ degrees.',options:null,answerConstraint:{max_words:2}},{id:Q3,questionNo:3,order:3,type:'multiple_choice',typeCode:'multiple_choice',groupId:G1,renderMode:'question_row',questionText:'Which option is right?',options:['A — Option one','B — Option two','C — Option three'],answerConstraint:null}];
const GBODY='The team had to look up the answer. Water boils at one hundred degrees.';
const generalSet=(progress={})=>({kind:'general_set',set:{id:GSET,title:'Synthetic general set'},passages:[{passageNo:1,passageId:P1,title:'Synthetic passage',body:GBODY,paragraphs:[],groups,questions,occurrences:[]}],initialProgress:progress});
const nowIso=()=>new Date().toISOString();
const hubData=(over={})=>({initial:null,sessionFailed:false,summary:{bestScore:72,completedCount:3,lastTenAverage:65,lastTenCount:3},history:{rows:[{attemptId:RA1,level:'B1',score:70,status:'completed',completedAt:nowIso(),createdAt:nowIso(),label:'Synthetic text',recallWordCount:120}],page:1,pageCount:1,total:1},...over});
const meta=(extra={})=>({attemptId:RID,level:'B1',label:'Synthetic text',readStartedAt:new Date(Date.now()).toISOString(),readEndsAt:new Date(Date.now()+120000).toISOString(),writeStartedAt:new Date(Date.now()+120000).toISOString(),writeEndsAt:new Date(Date.now()+300000).toISOString(),serverNow:nowIso(),...extra});
const lookupBody=(definition)=>({status:'resolved',contextual:{definitionEn:definition,translationUz:null,partOfSpeech:'phrasal verb',lexicalType:'phrasal_verb',ipa:null,verificationStatus:'verified'},known:null,synonyms:[],collocations:[],examples:[]});

await check('General start failure: the mapped message is shown, typed answers survive, one start is sent, and a later save clears it',async()=>{
 let starts=0,failStart=true;
 const view=(rt)=>rt.split('?')[0]===`/app/reading/general/${GSET}`?generalSet({}):undefined;
 const {context,page,errors,state}=await fixture({view,api:async(p,{method,body})=>{
  if(p==='/api/reading/general/progress'&&method==='POST'){
   if(body.start){starts++;if(failStart)return {status:500,json:{error:'internal'}};return {ok:true,updatedAt:nowIso(),score:null,total:null,result:null};}
   return {ok:true,updatedAt:nowIso(),score:null,total:null,result:null};
  }
  return undefined;}});
 try{
  await page.goto(base+`/app/reading/general/${GSET}?passage=1`);
  await page.locator(`[data-answer-input="${Q2}"]`).waitFor();
  const alert=page.locator('[role="alert"]');
  await alert.waitFor({state:'visible'});
  assert.equal((await alert.innerText()).trim(),'The service is temporarily unavailable. Please try again in a moment.','the mapped server message');
  await page.locator(`[data-answer-input="${Q2}"]`).fill('90');
  assert.equal(await page.locator(`[data-answer-input="${Q2}"]`).inputValue(),'90','the typed answer is kept');
  failStart=false;
  await page.locator('[data-general-save-state="saved"]').waitFor({timeout:6000});
  assert.equal(await page.locator('[role="alert"]').count(),0,'a successful save clears the start failure');
  assert.equal(starts,1,'the start is sent once, not again per save');
  assert.ok(state.requests.some(r=>r.method==='POST'&&r.path==='/api/reading/general/progress'&&r.body?.check===false&&r.body.answers?.[Q2]==='90'),'the answer is saved');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Retention phrase lookup: double-click opens the authored meaning while copying stays blocked',async()=>{
 const RBODY='Synthetic source. The team had to look up the answer quickly.';
 const start=RBODY.indexOf('look up'),end=start+'look up'.length;
 let phase='none';
 const reading=()=>({phase:'reading',...meta(),wordCount:12,bodyText:RBODY,occurrences:[{id:OCC,startChar:start,endChar:end,surfaceForm:'look up'}]});
 const {context,page,errors,state}=await fixture({view:(rt)=>rt.split('?')[0]==='/app/reading/retention'?hubData():undefined,api:async(p,{method})=>{
  if(p==='/api/retention/attempts'&&method==='POST'){phase='reading';return reading();}
  if(p==='/api/retention/attempts'&&method==='GET')return {active:null};
  if(p==='/api/vocabulary/lookup')return lookupBody('to search for something');
  if(p==='/api/vocabulary/folders')return {folders:[]};
  return undefined;}});
 try{
  await page.goto(base+'/app/reading/retention');
  await page.locator('[data-retention-level="B1"]').click();
  await page.locator('[data-retention-start="B1"]').click();
  await page.locator('[data-retention-source] [data-word="look"]').first().waitFor();
  assert.equal(await page.locator('[data-retention-source]').evaluate(n=>getComputedStyle(n).userSelect),'none','the source remains non-selectable');
  const protectedEvents=await page.locator('[data-retention-source] [data-word="look"]').first().evaluate(n=>Object.fromEntries(['copy','cut','dragstart','contextmenu'].map(type=>{const event=new Event(type,{bubbles:true,cancelable:true});n.dispatchEvent(event);return [type,event.defaultPrevented];})));
  assert.deepEqual(protectedEvents,{copy:true,cut:true,dragstart:true,contextmenu:true},'dictionary access must not enable copying or dragging the source');
  await page.locator('[data-retention-source] [data-word="look"]').first().click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-word-popover]').count(),0,'a single click does not open the dictionary');
  await page.locator('[data-retention-source] [data-word="up"]').first().dblclick();
  await page.locator('[data-word-popover]').waitFor();
  assert.equal(await page.evaluate(()=>window.getSelection().toString()),'','double-click lookup works without selecting the source');
  assert.equal(await page.locator('[data-word-popover]').getAttribute('aria-label'),'look up','the popover names the phrase');
  assert.ok((await page.locator('[data-word-popover]').innerText()).includes('to search for something'),'the authored definition is shown');
  const look=state.requests.find(r=>r.path==='/api/vocabulary/lookup');
  assert.ok(look&&look.query.includes(`occurrenceId=${OCC}`),'the lookup carries the authored occurrence');
  assert.ok(look.query.includes('sourceType=retention')&&look.query.includes(`sourceId=${RID}`),'the lookup is scoped to this retention attempt');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Retention completion: the result shows, the summary and history refresh in place, and submit is sent once',async()=>{
 let phase='none',submits=0,completed=false;
 const resultPayload=()=>({phase:'completed',...meta(),submittedAt:nowIso(),completedAt:nowIso(),score:81,level:'B1',breakdown:{totals:{mainIdeasRemembered:2,mainIdeasPossible:3,matchedGroups:4,totalGroups:5,contradicted:0},claims:[{claimId:'c1',claimLabel:'Synthetic claim',status:'captured',awardedPoints:2,possiblePoints:2}]},recallWordCount:9});
 const view=(rt)=>{if(rt.split('?')[0]!=='/app/reading/retention')return undefined;
  return hubData(completed?{summary:{bestScore:81,completedCount:4,lastTenAverage:70,lastTenCount:4},history:{rows:[{attemptId:RID,level:'B1',score:81,status:'completed',completedAt:nowIso(),createdAt:nowIso(),label:'Synthetic text',recallWordCount:9},{attemptId:RA1,level:'B1',score:70,status:'completed',completedAt:nowIso(),createdAt:nowIso(),label:'Synthetic text',recallWordCount:120}],page:1,pageCount:1,total:2}}:{});};
 const {context,page,errors,state}=await fixture({view,api:async(p,{method})=>{
  if(p==='/api/retention/attempts'&&method==='POST'){phase='reading';return {phase:'reading',...meta(),wordCount:12,bodyText:'Synthetic source words about the topic.',occurrences:[]};}
  if(p===`/api/retention/attempts/${RID}/finish-reading`&&method==='POST'){phase='recall';return {phase:'recall',...meta({writeStartedAt:new Date(Date.now()-60000).toISOString()}),recallDraft:''};}
  if(p===`/api/retention/attempts/${RID}`&&method==='GET')return phase==='recall'?{phase:'recall',...meta({writeStartedAt:new Date(Date.now()-60000).toISOString()}),recallDraft:''}:{phase:'reading',...meta(),wordCount:12,bodyText:'Synthetic source words.',occurrences:[]};
  if(p===`/api/retention/attempts/${RID}/draft`&&method==='PATCH')return {ok:true};
  if(p===`/api/retention/attempts/${RID}/submit`&&method==='POST'){submits++;phase='completed';completed=true;return resultPayload();}
  return undefined;}});
 try{
  page.once('dialog',d=>d.accept());
  await page.goto(base+'/app/reading/retention');
  await page.locator('[data-retention-summary-completed]').waitFor();
  assert.equal((await page.locator('[data-retention-summary-completed]').innerText()).trim(),'3');
  await page.locator('[data-retention-level="B1"]').click();
  await page.locator('[data-retention-start="B1"]').click();
  await page.locator('[data-retention-source]').waitFor();
  await page.locator('[data-retention-finish-reading]').click();
  await page.locator('[data-retention-answer]').waitFor({timeout:6000});
  await page.locator('[data-retention-answer]').fill('Synthetic recall words here.');
  await page.locator('[data-retention-submit]').dblclick();
  await page.locator('[data-retention-result]').waitFor({timeout:8000});
  await page.locator('[data-retention-summary-completed]').filter({hasText:'4'}).waitFor({timeout:6000});
  assert.equal((await page.locator('[data-retention-summary-best]').innerText()).trim(),'81','best score refreshed');
  assert.equal(await page.locator('[data-retention-history-row]').count(),2,'the history shows the new attempt');
  assert.equal(await page.locator('[data-retention-result]').count(),1,'the result stays on screen');
  assert.equal(submits,1,'one submit');
  await page.waitForTimeout(1500);
  const after=state.requests.slice(state.requests.findIndex(r=>r.method==='POST'&&r.path===`/api/retention/attempts/${RID}/submit`)+1);
  assert.equal(after.filter(r=>r.method==='PATCH').length,0,'no draft save is sent after submit');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Mobile 390px: the General session and the Retention hub fit the screen without horizontal overflow',async()=>{
 const shots=process.env.V46_SHOTS;if(shots)fs.mkdirSync(shots,{recursive:true});
 const view=(rt)=>{const p=rt.split('?')[0];if(p===`/app/reading/general/${GSET}`)return generalSet({});if(p==='/app/reading/retention')return hubData();return undefined;};
 const {context,page,errors}=await fixture({view});
 try{
  await page.setViewportSize({width:390,height:844});
  for(const [name,url,ready] of [['general',`/app/reading/general/${GSET}?passage=1`,`[data-answer-input="${Q2}"]`],['retention','/app/reading/retention','[data-retention-summary-completed]']]){
   await page.goto(base+url);
   await page.locator(ready).first().waitFor({state:'attached'});
   if(name==='general'){await page.locator('[role=tab]').nth(1).click();await page.locator(ready).waitFor();}
   const m=await page.evaluate(()=>({doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,body:document.body.scrollWidth-document.body.clientWidth}));
   assert.ok(m.doc<=1&&m.body<=1,`${name}: no horizontal overflow (${JSON.stringify(m)})`);
   if(shots)await page.screenshot({path:`${shots}/${name}-390.png`,fullPage:false});
  }
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

fs.writeFileSync(new URL('browser-reading-v46-results.json',out),JSON.stringify({suite:'V46 Reading finish',date:new Date().toISOString(),results,counts:{PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length}},null,2));
await browser.close();
const fails=results.filter(r=>r.status==='FAIL').length;
console.log(`V46: ${results.length-fails} pass, ${fails} fail`);
process.exit(fails?1:0);
