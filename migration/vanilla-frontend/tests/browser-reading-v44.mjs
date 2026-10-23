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
 const {context,page,errors,state}=await fixture({view:(rt)=>rt.split('?')[0]===detailRoute?{kind:'lesson',detail:readingLesson()}:undefined,api:async(p,{method})=>{if(p===`/api/lessons/${lessonId}/state`&&method==='POST')return {ok:true,state:'in_progress'};return undefined;}});
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


// ---- Academic Reading ----
const SET='00000000-0000-4000-8000-0000000000b1',ATT='00000000-0000-4000-8000-0000000000a1',P1='00000000-0000-4000-8000-0000000000c1',G1='00000000-0000-4000-8000-0000000000d1';
const Q1='00000000-0000-4000-8000-0000000000e1',Q2='00000000-0000-4000-8000-0000000000e2',Q3='00000000-0000-4000-8000-0000000000e3',PA='00000000-0000-4000-8000-0000000000f1';
const passages3=[{passageNo:1,title:'Synthetic passage one'},{passageNo:2,title:'Synthetic passage two'},{passageNo:3,title:'Synthetic passage three'}];
const catalogue=()=>({sets:[{id:SET,title:'Synthetic Academic test',locked:false,assessmentStatus:'not_started',attemptId:null,passages:passages3},{id:'00000000-0000-4000-8000-0000000000b2',title:'Locked test',locked:true,assessmentStatus:'not_started',attemptId:null,passages:passages3}]});
const attemptBase=(status)=>({attempt:{id:ATT,status,startedAt:new Date(Date.now()-60000).toISOString(),score:status==='completed'?2:null,totalQuestions:status==='completed'?3:null},passage:{title:'Synthetic passage',bodyText:'Paragraph A text. Water boils at one hundred degrees.',suggestedMinutes:20,testNo:null,passageNo:null,difficultyLevel:'B2'},
 sections:[],groups:[{id:G1,position:1,typeCode:'true_false_not_given',displayTitle:null,instructionsText:'Do the following statements agree with the information in the passage?',fromQuestionNo:1,toQuestionNo:3,sharedChoices:[]}],
 paragraphs:[{id:PA,position:0,label:'A',text:'Paragraph A text.',isFootnote:false}],
 questions:[{id:Q1,order:1,questionNo:1,sourceQuestionNo:1,type:'true_false_not_given',typeCode:'true_false_not_given',groupId:G1,renderMode:'question_row',questionText:'Paragraph A is about boiling.',options:null,answerConstraint:null},
  {id:Q2,order:2,questionNo:2,sourceQuestionNo:2,type:'short_answer',typeCode:'short_answer',groupId:G1,renderMode:'question_row',questionText:'Water boils at ___ degrees.',options:null,answerConstraint:{max_words:2}},
  {id:Q3,order:3,questionNo:3,sourceQuestionNo:3,type:'multiple_choice',typeCode:'multiple_choice',groupId:G1,renderMode:'question_row',questionText:'Which option is right?',options:['A — Option one','B — Option two','C — Option three'],answerConstraint:null}],
 answers:status==='completed'?[{questionId:Q1,userAnswer:'TRUE',isCorrect:true},{questionId:Q2,userAnswer:'90',isCorrect:false},{questionId:Q3,userAnswer:'B — Option two',isCorrect:true}]:[],occurrences:[]});
const examDetail=(status)=>{const d=attemptBase(status);if(status==='completed'){d.questions=d.questions.map((q,i)=>({...q,correctAnswer:['TRUE','100','B — Option two'][i],acceptedAnswers:[],explanation:'Synthetic explanation',evidenceQuote:'Paragraph A text.',evidenceType:'quoted',passageId:P1}));d.passages=undefined;d.sections=[{passage:{id:P1,title:'Synthetic passage',bodyText:'Paragraph A text. Water boils at one hundred degrees.'},paragraphs:[],questions:[],groups:[]}];}return d;};

await check('Academic catalogue: open and locked sets, the set link, and the original hints',async()=>{
 const {context,page,errors}=await fixture({view:(rt)=>rt.startsWith('/app/reading/academic')?catalogue():undefined});
 try{
  await page.goto(base+'/app/reading/academic');
  await page.locator('[data-academic-set]').first().waitFor();
  assert.equal(await page.locator('[data-academic-set]').count(),2);
  assert.equal(await page.locator(`[data-academic-set="${SET}"] a`).getAttribute('href'),`/app/reading/academic/${SET}`);
  assert.equal(await page.locator('[data-academic-locked="true"] [data-academic-locked-hint]').count(),1,'locked set shows its hint, not a link');
  assert.equal(await page.locator('[data-academic-locked="true"] a').count(),0);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Academic set page: three passages, then Start posts the set and opens the attempt',async()=>{
 let started=false;
 const {context,page,errors,state}=await fixture({view:(rt)=>rt.split('?')[0]===`/app/reading/academic/${SET}`?{set:{id:SET,title:'Synthetic Academic test'},passages:passages3}:rt.split('?')[0]===`/app/reading/attempts/${ATT}`?{kind:'attempt',detail:attemptBase(started?'in_progress':'in_progress')}:undefined,api:async(p,{method})=>{if(p==='/api/reading/academic'&&method==='POST'){started=true;return {id:ATT};}return undefined;}});
 try{
  await page.goto(base+`/app/reading/academic/${SET}`);
  await page.locator('[data-academic-reading-start]').waitFor();
  assert.equal(await page.locator('ol li').count(),3);
  await page.locator('[data-passage-action=start]').click();
  await page.waitForURL(new RegExp(`/app/reading/attempts/${ATT}$`));
  const posts=state.requests.filter(r=>r.method==='POST'&&r.path==='/api/reading/academic');
  assert.deepEqual(posts[0].body,{setId:SET});
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Academic exam: focus screen, questions by type, autosave, submit, then the analysis',async()=>{
 let submitted=false;
 const {context,page,errors,state}=await fixture({view:(rt)=>rt.split('?')[0]===`/app/reading/attempts/${ATT}`?{kind:'attempt',detail:examDetail(submitted?'completed':'in_progress')}:undefined,api:async(p,{method})=>{if(p===`/api/reading/attempts/${ATT}`&&method==='PATCH')return {saved:1,at:new Date().toISOString()};if(p===`/api/reading/attempts/${ATT}/submit`&&method==='POST'){submitted=true;return {ok:true,score:2,totalQuestions:3};}return undefined;}});
 try{
  page.once('dialog',d=>d.accept());
  await page.goto(base+`/app/reading/attempts/${ATT}`);
  await page.locator('[data-reading-practice]').waitFor();
  assert.equal(await page.locator('main#main-content.reading-focus[data-reading-full-focus]').count(),1,'focus shell');
  assert.equal(await page.locator('link[data-reading-focus-css]').count(),1,'focus stylesheet loaded');
  assert.equal(await page.locator('[data-reading-workspace]').count(),1);
  assert.equal(await page.locator('[data-passage-body]').count(),1);
  assert.equal(await page.locator('[data-question]').count(),3);
  assert.notEqual(await page.locator('[data-time-remaining]').getAttribute('data-time-remaining'),null);
  // inline blank (Q2) autosaves after the debounce
  await page.locator(`[data-answer-input="${Q2}"]`).fill('100');
  await page.locator('[data-save-state="saved"]').waitFor({timeout:6000});
  // ternary choice and a letter choice
  await page.locator(`[data-question="${Q1}"] [data-answer-option="true"]`).click();
  await page.locator(`[data-question="${Q3}"] [data-answer-option="B"]`).click();
  await page.waitForTimeout(1200);
  const patches=state.requests.filter(r=>r.method==='PATCH');
  const last=patches.at(-1).body.answers;
  assert.ok(last.some(a=>a.questionId===Q2&&a.answer==='100'),'short answer saved');
  assert.ok(last.some(a=>a.questionId===Q1&&a.answer==='true'),'ternary saved');
  assert.ok(last.some(a=>a.questionId===Q3&&a.answer==='B — Option two'),'letter choice saved as the authored option');
  assert.equal(await page.locator(`[data-question="${Q1}"]`).getAttribute('data-answered'),'true');
  await page.locator('[data-submit-attempt]').click();
  await page.locator('[data-type-mastery]').waitFor({timeout:8000});
  assert.ok(state.requests.some(r=>r.method==='POST'&&r.path===`/api/reading/attempts/${ATT}/submit`),'submit posted');
  assert.ok((await page.locator('[data-reading-analysis]').innerText()).includes('2/3'),'score shown');
  assert.equal(await page.locator('[data-evidence]').count(),3);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('Academic exam: a malformed attempt id shows the not-found presentation',async()=>{
 const {context,page}=await fixture({view:()=>undefined});
 try{
  await page.goto(base+'/app/reading/attempts/not-a-uuid');
  await page.locator('[data-listening-not-found]').waitFor();
 }finally{await context.close();}
});


// ---- General Reading ----
const GP='00000000-0000-4000-8000-0000000000g1'.replace('g','0');
const GSET='00000000-0000-4000-8000-0000000000b9';
const libraryData=(over={})=>({filter:{query:'',topic:'',type:'',status:'',page:1},facets:{topics:[{code:'science',count:2}],types:[{code:'true_false_not_given',count:1}]},library:{items:[{id:GP,title:'Synthetic general passage',setId:null,questionTypes:['true_false_not_given'],topicCode:'science',questionCount:3,suggestedMinutes:20,status:'not_started',lastScore:null,lastAttemptId:null,passageNo:null,testNo:null},{id:'00000000-0000-4000-8000-0000000000g2'.replace('g','0'),title:'Finished passage',setId:null,questionTypes:[],topicCode:null,questionCount:3,suggestedMinutes:15,status:'completed',lastScore:2,lastAttemptId:null,passageNo:null,testNo:null}],total:2,page:1,pageCount:1},...over});
const generalSet=(progress={})=>({set:{id:GSET,title:'Synthetic general set'},passages:[{passageNo:1,passageId:P1,title:'Synthetic passage',body:'Paragraph A text. Water boils at one hundred degrees.',paragraphs:[{id:PA,label:'A',text:'Paragraph A text.',isFootnote:false}],groups:[{id:G1,position:1,typeCode:'true_false_not_given',displayTitle:null,instructionsText:'Do the following statements agree with the information in the passage?',fromQuestionNo:1,toQuestionNo:3,sharedChoices:[]}],questions:[{id:Q1,questionNo:1,order:1,type:'true_false_not_given',typeCode:'true_false_not_given',groupId:G1,renderMode:'question_row',questionText:'Paragraph A is about boiling.',options:null,answerConstraint:null},{id:Q2,questionNo:2,order:2,type:'short_answer',typeCode:'short_answer',groupId:G1,renderMode:'question_row',questionText:'Water boils at ___ degrees.',options:null,answerConstraint:{max_words:2}},{id:Q3,questionNo:3,order:3,type:'multiple_choice',typeCode:'multiple_choice',groupId:G1,renderMode:'question_row',questionText:'Which option is right?',options:['A — Option one','B — Option two','C — Option three'],answerConstraint:null}],occurrences:[]}],initialProgress:progress});

await check('General catalogue: cards by status, the count, filter links and the search that updates the URL',async()=>{
 const {context,page,errors}=await fixture({view:(rt)=>rt.startsWith('/app/reading/general')?libraryData():undefined});
 try{
  await page.goto(base+'/app/reading/general');
  await page.locator('[data-passage]').first().waitFor();
  assert.equal(await page.locator('[data-passage]').count(),2);
  assert.equal(await page.locator(`[data-passage="${GP}"] [data-passage-state]`).getAttribute('data-passage-state'),'not_started');
  assert.equal(await page.locator('[data-passage-score]').count(),1,'finished passage shows its score');
  assert.equal(await page.locator('[data-reading-status]').count(),7);
  assert.ok((await page.locator('[data-reading-count]').innerText()).includes('2'));
  await page.locator('[data-reading-search]').fill('boil');
  await page.waitForURL(/[?&]q=boil/,{timeout:6000});
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('General catalogue: a legacy page link is normalised to the first page, and Start opens an attempt',async()=>{
 let started=false;
 const {context,page,errors,state}=await fixture({view:(rt)=>rt.startsWith('/app/reading/general')?libraryData():undefined,api:async(p,{method})=>{if(p==='/api/reading/attempts'&&method==='POST'){started=true;return {id:ATT};}return undefined;}});
 try{
  await page.goto(base+'/app/reading/general?page=2&topic=science');
  await page.waitForURL(url=>!url.search.includes('page='),{timeout:6000});
  assert.ok(page.url().includes('topic=science'),'filters kept');
  await page.locator(`[data-passage="${GP}"] [data-passage-action=start]`).click();
  await page.waitForURL(new RegExp(`/app/reading/attempts/${ATT}$`));
  assert.deepEqual(state.requests.find(r=>r.method==='POST'&&r.path==='/api/reading/attempts').body,{passageId:GP});
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

await check('General session: passage redirect, questions, autosave, explicit check with feedback, then back to the library',async()=>{
 let checked=false,started=false;
 const rows=[{questionId:Q1,isCorrect:true,correctAnswer:'TRUE',acceptedAnswers:[],evidenceQuote:'Paragraph A text.',explanation:'Synthetic explanation'},{questionId:Q2,isCorrect:false,correctAnswer:'90',acceptedAnswers:[],evidenceQuote:null,explanation:null},{questionId:Q3,isCorrect:true,correctAnswer:'B — Option two',acceptedAnswers:[],evidenceQuote:null,explanation:null}];
 const view=(rt)=>{const path=rt.split('?')[0];if(path!==`/app/reading/general/${GSET}`)return undefined;const progress=checked?{[P1]:{answers:{[Q2]:'90'},score:2,total:3,checked:true,result:rows}}:started?{[P1]:{answers:{},score:null,total:null,checked:false,result:null}}:{};return {kind:'general_set',...generalSet(progress)};};
 const {context,page,errors,state}=await fixture({view,api:async(p,{method,body})=>{if(p==='/api/reading/general/progress'&&method==='POST'){if(body.check){checked=true;return {ok:true,score:2,total:3,result:[{questionId:Q1,isCorrect:true,correctAnswer:'TRUE',acceptedAnswers:[],evidenceQuote:'Paragraph A text.',explanation:'Synthetic explanation'},{questionId:Q2,isCorrect:false,correctAnswer:'90',acceptedAnswers:[],evidenceQuote:null,explanation:null},{questionId:Q3,isCorrect:true,correctAnswer:'B — Option two',acceptedAnswers:[],evidenceQuote:null,explanation:null}]};}if(body.start)started=true;return {ok:true,updatedAt:new Date().toISOString(),score:null,total:null,result:null};}return undefined;}});
 try{
  await page.goto(base+`/app/reading/general/${GSET}`);
  await page.waitForURL(new RegExp(`passage=1$`),{timeout:6000});
  await page.locator('[data-general-passage-tab]').waitFor();
  assert.equal(await page.locator('[data-general-passage-tab]').count(),1);
  assert.equal(await page.locator('[data-reading-question-nav]').count(),3);
  assert.ok(state.requests.some(r=>r.method==='POST'&&r.path==='/api/reading/general/progress'&&r.body.start===true),'a new session is started once');
  await page.locator(`[data-answer-input="${Q2}"]`).fill('90');
  await page.locator('[data-general-save-state="saved"]').waitFor({timeout:6000});
  assert.ok(state.requests.some(r=>r.method==='POST'&&r.body&&r.body.passageId===P1&&r.body.check===false&&r.body.answers[Q2]==='90'),'autosave sends the answer without checking');
  await page.locator('[data-general-check]').click();
  await page.locator('[data-general-result]').first().waitFor({timeout:6000});
  assert.equal(await page.locator('[data-general-result]').count(),3);
  assert.equal(await page.locator('[data-general-result="correct"]').count(),2);
  assert.ok((await page.locator('[data-general-score]').innerText()).includes('2'),'score shown after check');
  await page.locator('[data-general-back]').click();
  await page.waitForURL(/\/app\/reading\/general$/,{timeout:6000});
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

fs.writeFileSync(new URL('browser-reading-v44-results.json',out),JSON.stringify({suite:'V44 Reading migration',date:new Date().toISOString(),results,counts:{PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length}},null,2));
await browser.close();
const fails=results.filter(r=>r.status==='FAIL').length;
console.log(`V44: ${results.length-fails} pass, ${fails} fail`);
process.exit(fails?1:0);
