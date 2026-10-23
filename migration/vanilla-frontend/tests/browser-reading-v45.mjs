/** V45 Reading browser checks: phrase-aware lookup, start error mapping, completion refresh without duplicate writes,
 * and passage/answer/scroll/focus preservation during autosave. Synthetic fixtures; real clicks and inputs. */
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
const out=new URL('../docs/evidence/v45/',import.meta.url);fs.mkdirSync(out,{recursive:true});
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
const SET='00000000-0000-4000-8000-0000000000b1',ATT='00000000-0000-4000-8000-0000000000a1',P1='00000000-0000-4000-8000-0000000000c1',G1='00000000-0000-4000-8000-0000000000d1';
const Q1='00000000-0000-4000-8000-0000000000e1',Q2='00000000-0000-4000-8000-0000000000e2',Q3='00000000-0000-4000-8000-0000000000e3',PA='00000000-0000-4000-8000-0000000000f1';
const GP='00000000-0000-4000-8000-0000000000c9',GSET='00000000-0000-4000-8000-0000000000b9';
const OCC1='00000000-0000-4000-8000-0000000000a5',OCC2='00000000-0000-4000-8000-0000000000a6';
const passages3=[{passageNo:1,title:'Synthetic passage one'},{passageNo:2,title:'Synthetic passage two'},{passageNo:3,title:'Synthetic passage three'}];
const PHRASE_BODY='The team had to look up the answer quickly. Water boils at one hundred degrees.';
const PHRASE_START=PHRASE_BODY.indexOf('look up'),PHRASE_END=PHRASE_START+'look up'.length;
const groups=[{id:G1,position:1,typeCode:'true_false_not_given',displayTitle:null,instructionsText:'Do the following statements agree with the information in the passage?',fromQuestionNo:1,toQuestionNo:3,sharedChoices:[]}];
const questions=[{id:Q1,questionNo:1,order:1,type:'true_false_not_given',typeCode:'true_false_not_given',groupId:G1,renderMode:'question_row',questionText:'Paragraph A is about boiling.',options:null,answerConstraint:null},{id:Q2,questionNo:2,order:2,type:'short_answer',typeCode:'short_answer',groupId:G1,renderMode:'question_row',questionText:'Water boils at ___ degrees.',options:null,answerConstraint:{max_words:2}},{id:Q3,questionNo:3,order:3,type:'multiple_choice',typeCode:'multiple_choice',groupId:G1,renderMode:'question_row',questionText:'Which option is right?',options:['A — Option one','B — Option two','C — Option three'],answerConstraint:null}];
const generalSet=({body=PHRASE_BODY,occurrences=[],progress={}}={})=>({kind:'general_set',set:{id:GSET,title:'Synthetic general set'},passages:[{passageNo:1,passageId:P1,title:'Synthetic passage',body,paragraphs:[],groups,questions,occurrences},],initialProgress:progress});
const libraryData=(over={})=>({filter:{query:'',topic:'',type:'',status:'',page:1},facets:{topics:[],types:[]},library:{items:[{id:GP,title:'Synthetic general passage',setId:null,questionTypes:['true_false_not_given'],topicCode:'science',questionCount:3,suggestedMinutes:20,status:'not_started',lastScore:null,lastAttemptId:null,passageNo:null,testNo:null}],total:1,page:1,pageCount:1},...over});
const attemptBase=(status)=>({attempt:{id:ATT,status,startedAt:new Date(Date.now()-60000).toISOString(),score:null,totalQuestions:null},passage:{title:'Synthetic passage',bodyText:'Paragraph A text. Water boils at one hundred degrees.',suggestedMinutes:20,testNo:null,passageNo:null,difficultyLevel:'B2'},sections:[],groups,paragraphs:[{id:PA,position:0,label:'A',text:'Paragraph A text.',isFootnote:false}],questions,answers:[],occurrences:[]});
const lookupBody=(definition)=>({status:'resolved',contextual:{definitionEn:definition,translationUz:null,partOfSpeech:'phrasal verb',lexicalType:'phrasal_verb',ipa:null,verificationStatus:'verified'},known:null,synonyms:[],collocations:[],examples:[]});
const sessionPassage=(body,occ=[])=>generalSet({body,occurrences:occ});

await check('Phrase lookup: a double-click on a word of an authored phrase looks up the whole phrase by its occurrence; a single click only selects',async()=>{
 const occurrences=[{id:OCC1,startChar:PHRASE_START,endChar:PHRASE_END,surfaceForm:'look up'}];
 const view=(rt)=>rt.split('?')[0]===`/app/reading/general/${GSET}`?{kind:'general_set',...generalSet({occurrences})}:undefined;
 const {context,page,errors,state}=await fixture({view,api:async(p,{u})=>{if(p==='/api/vocabulary/lookup')return lookupBody('to search for something');if(p==='/api/vocabulary/folders')return {folders:[]};return undefined;}});
 try{
  await page.goto(base+`/app/reading/general/${GSET}?passage=1`);
  await page.locator('[data-passage-body] [data-word="look"]').first().waitFor();
  await page.locator('[data-passage-body] [data-word="look"]').first().click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-word-popover]').count(),0,'single click opens nothing');
  await page.locator('[data-passage-body] [data-word="up"]').first().dblclick();
  await page.locator('[data-word-popover]').waitFor();
  assert.equal(await page.locator('[data-word-popover]').getAttribute('aria-label'),'look up','the popover names the phrase');
  assert.ok((await page.locator('[data-word-popover]').innerText()).includes('to search for something'),'the authored definition is shown');
  const look=state.requests.find(r=>r.path==='/api/vocabulary/lookup');
  assert.ok(look,'a lookup was requested');
  assert.ok(look.query.includes(`occurrenceId=${OCC1}`),'the lookup carries the authored occurrence id');
  assert.ok(look.query.includes('sourceType=reading'),'the lookup is scoped to the reading source');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Phrase lookup: ambiguous authored phrases stay unresolved, with no invented meaning and no save',async()=>{
 const occurrences=[{id:OCC1,startChar:PHRASE_START,endChar:PHRASE_END,surfaceForm:'look up'},{id:OCC2,startChar:PHRASE_START,endChar:PHRASE_END,surfaceForm:'look up'}];
 const view=(rt)=>rt.split('?')[0]===`/app/reading/general/${GSET}`?{kind:'general_set',...generalSet({occurrences})}:undefined;
 const {context,page,errors,state}=await fixture({view,api:async(p,{u})=>{if(p==='/api/vocabulary/meaning')return {status:'unresolved',contextual:null,known:null};if(p==='/api/vocabulary/folders')return {folders:[]};return undefined;}});
 try{
  await page.goto(base+`/app/reading/general/${GSET}?passage=1`);
  await page.locator('[data-passage-body] [data-word="up"]').first().waitFor();
  await page.locator('[data-passage-body] [data-word="up"]').first().dblclick();
  await page.locator('[data-word-unresolved]').waitFor();
  assert.ok((await page.locator('[data-word-unresolved]').innerText()).length>0,'an unresolved note is shown');
  assert.equal(await page.locator('[data-word-save]').count(),0,'nothing can be saved for an unresolved place');
  assert.equal(state.requests.filter(r=>r.method==='POST'&&r.path==='/api/vocabulary').length,0,'no vocabulary write');
  assert.ok(!state.requests.some(r=>r.path==='/api/vocabulary/lookup'),'no occurrence lookup is made when the phrase is ambiguous');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Start errors: an Academic start failure shows the mapped server message, not the generic unknown message',async()=>{
 const catalogueView=(rt)=>rt.split('?')[0]===`/app/reading/academic/${SET}`?{set:{id:SET,title:'Synthetic Academic test'},passages:passages3}:undefined;
 const {context,page,errors,state}=await fixture({view:catalogueView,api:async(p,{method})=>{if(p==='/api/reading/academic'&&method==='POST')return {status:500,json:{error:'internal'}};return undefined;}});
 try{
  await page.goto(base+`/app/reading/academic/${SET}`);
  await page.locator('[data-academic-reading-start]').waitFor();
  await page.locator('[data-passage-action=start]').click();
  assert.equal(state.requests.filter(r=>r.method==='POST'&&r.path==='/api/reading/academic').length,1,'one start POST');
  const msg=page.locator('[data-passage-action-error]:not([hidden])');
  await msg.waitFor({state:'visible'});
  assert.equal((await msg.innerText()).trim(),'The service is temporarily unavailable. Please try again in a moment.','mapped server message (not the generic unknown message)');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Start errors: a rate-limited General start shows the mapped rate-limit message',async()=>{
 const view=(rt)=>rt.startsWith('/app/reading/general')?libraryData():undefined;
 const {context,page,errors}=await fixture({view,api:async(p,{method})=>{if(p==='/api/reading/attempts'&&method==='POST')return {status:429,json:{error:'rate_limited'}};return undefined;}});
 try{
  await page.goto(base+'/app/reading/general');
  await page.locator(`[data-passage="${GP}"] [data-passage-action=start]`).click();
  const msg=page.locator('[data-passage-action-error]:not([hidden])');
  await msg.waitFor({state:'visible'});
  assert.equal((await msg.innerText()).trim(),'Too many attempts. Please wait a few minutes and try again.','mapped rate-limit message');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Completion refresh: a double-click on Check sends one check, keeps answers, shows the result, and the overview reflects it',async()=>{
 let checked=false;
 const rows=[{questionId:Q1,isCorrect:true,correctAnswer:'TRUE',acceptedAnswers:[],evidenceQuote:'Paragraph A text.',explanation:'Synthetic explanation'},{questionId:Q2,isCorrect:false,correctAnswer:'90',acceptedAnswers:[],evidenceQuote:null,explanation:null},{questionId:Q3,isCorrect:true,correctAnswer:'B — Option two',acceptedAnswers:[],evidenceQuote:null,explanation:null}];
 const view=(rt)=>{const path=rt.split('?')[0];if(path===`/app/reading/general/${GSET}`){const progress=checked?{[P1]:{answers:{[Q2]:'90'},score:2,total:3,checked:true,result:rows}}:{};return {kind:'general_set',...generalSet({progress})};}if(rt.startsWith('/app/reading/general'))return libraryData(checked?{library:{items:[{id:GP,title:'Synthetic general passage',setId:null,questionTypes:['true_false_not_given'],topicCode:'science',questionCount:3,suggestedMinutes:20,status:'completed',lastScore:2,lastAttemptId:null,passageNo:null,testNo:null}],total:1,page:1,pageCount:1}}:{});return undefined;};
 const {context,page,errors,state}=await fixture({view,api:async(p,{method,body})=>{if(p==='/api/reading/general/progress'&&method==='POST'){if(body.check){checked=true;return {ok:true,score:2,total:3,result:rows};}return {ok:true,updatedAt:new Date().toISOString(),score:null,total:null,result:null};}return undefined;}});
 try{
  await page.goto(base+`/app/reading/general/${GSET}?passage=1`);
  await page.locator(`[data-answer-input="${Q2}"]`).waitFor();
  await page.locator(`[data-answer-input="${Q2}"]`).fill('90');
  await page.locator('[data-general-save-state="saved"]').waitFor({timeout:6000});
  await page.locator('[data-general-check]').dblclick();
  await page.locator('[data-general-result]').first().waitFor({timeout:6000});
  await page.waitForTimeout(300);
  assert.equal(state.requests.filter(r=>r.method==='POST'&&r.path==='/api/reading/general/progress'&&r.body?.check===true).length,1,'exactly one check write');
  assert.equal(await page.locator(`[data-answer-input="${Q2}"]`).inputValue(),'90','the answer is kept after the check');
  assert.equal(await page.locator('[data-general-result]').count(),3);
  assert.ok((await page.locator('[data-general-score]').innerText()).includes('2'),'the latest score is shown');
  await page.locator('[data-general-back]').click();
  await page.waitForURL(/\/app\/reading\/general$/,{timeout:6000});
  await page.locator(`[data-passage="${GP}"] [data-passage-state]`).waitFor({timeout:6000});
  assert.equal(await page.locator(`[data-passage="${GP}"] [data-passage-state]`).getAttribute('data-passage-state'),'completed','the overview shows the completed state');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Autosave keeps the passage node, the scroll position and the input focus while typing',async()=>{
 const long=Array.from({length:120},(_,i)=>`Paragraph ${i+1} says water boils at one hundred degrees under normal pressure.`).join(' ');
 const view=(rt)=>rt.split('?')[0]===`/app/reading/general/${GSET}`?{kind:'general_set',...generalSet({body:long})}:undefined;
 const {context,page,errors,state}=await fixture({view,api:async(p,{method})=>{if(p==='/api/reading/general/progress'&&method==='POST')return {ok:true,updatedAt:new Date().toISOString(),score:null,total:null,result:null};return undefined;}});
 try{
  await page.goto(base+`/app/reading/general/${GSET}?passage=1`);
  await page.locator(`[data-answer-input="${Q2}"]`).waitFor();
  await page.evaluate(()=>{window.__pn=document.querySelector('[data-passage-body]');const p=document.querySelector('#reading-passage-pane')??[...document.querySelectorAll('*')].find(n=>n.scrollHeight>n.clientHeight+50&&getComputedStyle(n).overflowY.match(/auto|scroll/));window.__sp=p;p.scrollTop=400;});
  const before=await page.evaluate(()=>window.__sp.scrollTop);
  assert.ok(before>0,'the passage pane scrolls inside the focus screen');
  await page.locator(`[data-answer-input="${Q2}"]`).click();
  await page.keyboard.type('90 degrees',{delay:30});
  await page.locator('[data-general-save-state="saved"]').waitFor({timeout:6000});
  const after=await page.evaluate(()=>({same:document.querySelector('[data-passage-body]')===window.__pn,top:window.__sp.scrollTop,focus:document.activeElement?.getAttribute('data-answer-input')}));
  assert.equal(after.same,true,'the passage text node is not rebuilt on save');
  assert.ok(Math.abs(after.top-before)<=2,`scroll kept (${before} -> ${after.top})`);
  assert.equal(after.focus,Q2,'focus stays in the answer input');
  assert.equal(await page.locator(`[data-answer-input="${Q2}"]`).inputValue(),'90 degrees','typed text is not lost');
  const saves=state.requests.filter(r=>r.method==='POST'&&r.path==='/api/reading/general/progress'&&r.body?.check===false);
  assert.ok(saves.length>=1&&saves.length<=3,`debounced autosave (${saves.length} writes for 11 keystrokes)`);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Academic exam: typing keeps the passage node and the answer input, with one autosave in flight',async()=>{
 const patches=[];
 const view=(rt)=>rt.split('?')[0]===`/app/reading/attempts/${ATT}`?{kind:'attempt',detail:attemptBase('in_progress')}:undefined;
 const {context,page,errors,state}=await fixture({view,api:async(p,{method,body})=>{if(p===`/api/reading/attempts/${ATT}`&&method==='PATCH'){patches.push(body);return {ok:true,updatedAt:new Date().toISOString()};}return undefined;}});
 try{
  await page.goto(base+`/app/reading/attempts/${ATT}`);
  await page.locator(`#answer-${Q2}`).waitFor();
  await page.evaluate(()=>{window.__pn=document.querySelector('[data-exam-passage-text]')??document.querySelector('[data-passage-body]');});
  await page.locator(`#answer-${Q2}`).click();
  await page.keyboard.type('90 deg',{delay:30});
  await page.waitForTimeout(1500);
  assert.equal(await page.locator(`#answer-${Q2}`).inputValue(),'90 deg','typed text kept');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),`answer-${Q2}`,'focus kept');
  assert.equal(await page.evaluate(()=>(document.querySelector('[data-exam-passage-text]')??document.querySelector('[data-passage-body]'))===window.__pn),true,'passage node kept');
  assert.ok(patches.length>=1,'autosave sent');
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

fs.writeFileSync(new URL('browser-reading-v45-results.json',out),JSON.stringify({suite:'V45 Reading frontend',date:new Date().toISOString(),results,counts:{PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length}},null,2));
await browser.close();
const fails=results.filter(r=>r.status==='FAIL').length;
console.log(`V45: ${results.length-fails} pass, ${fails} fail`);
process.exit(fails?1:0);
