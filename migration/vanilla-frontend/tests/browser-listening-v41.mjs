/** V41 Listening sections browser suite: Lessons author desk (staff), MCQ Mastery catalogue, and the
 * staff/learner boundary. Synthetic fixtures only; every case drives real input and asserts on visible
 * behaviour or on recorded request bodies. Existing V10/V38/V39/V40 suites cover the learner pages. */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {publicPolicy,fixtureSession} from './fixtures.mjs';
import en from '../js/i18n/en.js';import uz from '../js/i18n/uz.js';

const deps=path.resolve(import.meta.dirname,'../node_modules');
if(process.platform==='linux'){const tar=path.join(deps,'al2023.tar');fs.writeFileSync(tar,brotliDecompressSync(fs.readFileSync(path.join(deps,'@sparticuz/chromium/bin/al2023.tar.br'))));execFileSync('tar',['xf',tar,'-C',deps]);process.env.LD_LIBRARY_PATH=path.join(deps,'lib')+':'+(process.env.LD_LIBRARY_PATH??'');}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('single-process')&&!a.includes('disable-web-security')&&!a.includes('allow-running-insecure-content')),headless:true});
const base=process.env.PREVIEW_URL??'http://127.0.0.1:4173';
const out=new URL('../docs/evidence/v41/',import.meta.url);fs.mkdirSync(out,{recursive:true});
const results=[];
async function check(name,fn){if(process.env.TEST_FILTER&&!name.includes(process.env.TEST_FILTER))return;try{await fn();results.push({name,status:'PASS'});console.log('PASS',name);}catch(e){results.push({name,status:'FAIL',error:String(e.message).slice(0,700)});console.error('FAIL',name,String(e.message).slice(0,700));}}
const dictOf=locale=>locale==='uz'?uz:en;

const UNIT='00000000-0000-4000-8000-0000000000a1';
const UNIT2='00000000-0000-4000-8000-0000000000a2';
const LESSON='00000000-0000-4000-8000-0000000000b1';
const LESSON_NEW='00000000-0000-4000-8000-0000000000b2';
const TEST_ID='00000000-0000-4000-8000-000000000001';

/** Fixture browser. view(route) returns the projection data, undefined (503), or {status,json}.
 * api(path,{method,body,u}) answers other same-origin calls the same way. Every /api call is recorded. */
async function fixture({role='student',locale='en',theme='day',width=1440,height=900,view,api}={}){
 const context=await browser.newContext({viewport:{width,height}});
 await context.addCookies([{name:'la_locale',value:locale,url:base},{name:'la_theme',value:theme,url:base}]);
 await context.addInitScript(()=>{window.open=()=>null;});
 const page=await context.newPage();page.setDefaultTimeout(8000);
 const state={requests:[]};
 await context.route('**/api/**',async route=>{
  const r=route.request(),u=new URL(r.url()),p=u.pathname;
  const ct=r.headers()['content-type']??'';
  let body=null;if(r.method()!=='GET'&&ct.includes('application/json')){try{body=r.postDataJSON();}catch{body=null;}}
  state.requests.push({path:p,method:r.method(),query:u.search,body});
  const reply=(x)=>{if(x===undefined)return route.fulfill({status:503,json:{error:'unavailable'}});if(x.status)return route.fulfill({status:x.status,json:x.json});return route.fulfill({status:200,json:x});};
  if(p==='/api/frontend/public')return reply(publicPolicy);
  if(p==='/api/frontend/session')return reply(fixtureSession(role));
  if(p==='/api/notifications')return reply({notifications:[],unread:0});
  if(p==='/api/frontend/view'){const rt=u.searchParams.get('route');const data=view?await view(rt,{body,method:r.method()}):undefined;return data===undefined?reply(undefined):reply({version:1,route:rt,data});}
  if(api){const answer=await api(p,{method:r.method(),body,u,state});if(answer!==undefined)return reply(answer);}
  return reply(undefined);
 });
 return {context,page,state};
}
const count=(state,fn)=>state.requests.filter(fn).length;

/** Lesson edit model returned by GET /api/admin/content/lessons/:id/edit. */
function editModel(over={}){return {lesson:{id:LESSON,title:'Existing lesson',slug:'existing-lesson',sourceRef:'lesson-ref-1',learningArea:'listening',unitId:UNIT,summary:'Short summary',teacherNotes:'Notes for the class',estimatedMinutes:12,blocks:[],draft:{versionId:'ver-draft-1',versionNo:3,publicationState:'draft'},published:{versionId:'ver-pub-1',versionNo:2,publicationState:'published'},scheduled:null,live:true,...over}};}
const authorView=(extra={})=>({authorized:true,canPublish:false,lessons:[],units:[{id:UNIT,label:'Unit A',course:'Course'}],...extra});
const existingRow={id:LESSON,title:'Existing lesson',slug:'existing-lesson',sourceRef:'lesson-ref-1',learningArea:'listening',publicationState:'published',draft:{id:'ver-draft-1',versionNo:3,publicationState:'draft'},published:{id:'ver-pub-1',versionNo:2,publicationState:'published'}};

const apiHandler=({edit=editModel(),draftResponse,unitsFor,onDraft,revision,publication,intent,finalize,proxy}={})=>async(p,{method,body,u})=>{
 if(p===`/api/admin/content/lessons/${LESSON}/edit`&&method==='GET')return {lesson:edit.lesson};
 if(p===`/api/admin/content/lessons/${LESSON_NEW}/edit`&&method==='GET')return {lesson:editModel({id:LESSON_NEW,title:'Brand new lesson',slug:'brand-new-lesson',sourceRef:'new-ref',draft:{versionId:'ver-new',versionNo:1,publicationState:'draft'},published:null,live:false}).lesson};
 if(p==='/api/admin/content/drafts'&&method==='POST'){if(onDraft)onDraft(body);return draftResponse??{status:200,json:{versionId:'ver-new',versionNo:1,created:true,targetId:LESSON_NEW}};}
 if(p===`/api/admin/content/lessons/${LESSON}/revision`&&method==='POST')return revision??{lesson:editModel({live:true,draft:{versionId:'ver-draft-2',versionNo:4,publicationState:'draft'}}).lesson,created:true};
 if(p.startsWith('/api/admin/content/versions/')&&p.endsWith('/publication')&&method==='POST')return publication??{publicationState:'published'};
 if(p==='/api/lessons/units'){if(unitsFor)return unitsFor(u.searchParams);return {options:[{id:UNIT,label:'Unit A',course:'Course'}],nextCursor:null};}
 if(p==='/api/uploads/intent'&&method==='POST')return intent??{uploadId:'up-1',objectKey:'material/obj-1',mode:'proxy',uploadUrl:null,contentType:'text/plain'};
 if(p==='/api/uploads'&&method==='POST')return proxy??{ok:true};
 if(p==='/api/uploads/finalize'&&method==='POST')return finalize??{ok:true};
 return undefined;
};

const deskLoaded=page=>page.locator('[data-lesson-authoring-desk]').waitFor();

await check('Lessons author: a learner is sent back to the dashboard and the desk is never shown',async()=>{
 const {context,page}=await fixture({role:'student',view:(rt)=>rt==='/app/listening/lessons/author'?{authorized:false,canPublish:false,lessons:[],units:[]}:undefined});
 try{await page.goto(base+'/app/listening/lessons/author');await page.waitForURL(/\/app\/?$/,{timeout:8000});assert.equal(await page.locator('[data-lesson-authoring-desk]').count(),0);}
 finally{await context.close();}
});

await check('Lessons author: staff opens the desk, lists lessons and states the revision pointers',async()=>{
 const {context,page}=await fixture({role:'teacher',view:(rt)=>rt==='/app/listening/lessons/author'?authorView({lessons:[existingRow]}):undefined,api:apiHandler()});
 try{
  await page.goto(base+'/app/listening/lessons/author');await deskLoaded(page);
  const item=page.locator(`[data-lesson-authoring-item="${LESSON}"]`);
  await item.waitFor();
  assert.equal(await item.getAttribute('data-lesson-authoring-item-published'),'2');
  assert.equal(await item.getAttribute('data-lesson-authoring-item-draft'),'3');
  assert.equal(await page.locator('[data-lesson-authoring-can-publish="false"]').count(),1);
  assert.equal(await page.locator('[data-lesson-authoring-publish]').count(),0,'teacher never sees Publish');
  assert.ok((await page.locator('[data-lesson-authoring-no-publish]').first().innerText()).includes(en.listening.lessons.authoring.cannotPublish));
 }finally{await context.close();}
});

await check('Lessons author: opening a live lesson hydrates it, locks the stable reference and offers a revision',async()=>{
 const {context,page,state}=await fixture({role:'teacher',view:(rt)=>rt==='/app/listening/lessons/author'?authorView({lessons:[existingRow]}):undefined,api:apiHandler({edit:editModel({draft:null})})});
 try{
  await page.goto(base+'/app/listening/lessons/author');await deskLoaded(page);
  await page.locator(`[data-lesson-authoring-item="${LESSON}"]`).click();
  await page.locator('#lesson-title').waitFor();
  assert.equal(await page.locator('#lesson-title').inputValue(),'Existing lesson');
  assert.equal(await page.locator('[data-lesson-authoring-needs-revision]').count(),1);
  assert.equal(await page.locator('[data-lesson-authoring-source-ref]').isDisabled(),true);
  assert.equal(await page.locator('[data-lesson-authoring-source-ref-locked="true"]').count(),1);
  await page.locator('[data-lesson-authoring-start-revision]').waitFor();
  assert.equal(await page.locator('[data-lesson-authoring-save]').isDisabled(),true,'a live lesson cannot be saved in place');
  await page.locator('[data-lesson-authoring-start-revision]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-lesson-authoring-needs-revision]'),null,{timeout:8000});
  assert.ok(state.requests.some(q=>q.method==='POST'&&q.path===`/api/admin/content/lessons/${LESSON}/revision`));
  assert.equal(await page.locator('[data-lesson-authoring-save]').isDisabled(),false);
 }finally{await context.close();}
});

await check('Lessons author: a new lesson saves one draft with the authored payload, then re-reads it',async()=>{
 let draftBody=null;
 const {context,page,state}=await fixture({role:'teacher',view:(rt)=>rt==='/app/listening/lessons/author'?authorView():undefined,api:apiHandler({onDraft:b=>{draftBody=b;}})});
 try{
  await page.goto(base+'/app/listening/lessons/author');await deskLoaded(page);
  await page.locator('[data-lesson-authoring-new]').click();
  await page.locator('#lesson-title').fill('Brand new lesson');
  await page.locator('#lesson-slug').fill('brand-new-lesson');
  await page.locator('#lesson-ref').fill('new-ref');
  await page.locator('[data-lesson-authoring-add="text"]').click();
  await page.locator('[data-lesson-authoring-block="text"] textarea').fill('Explain the main idea.');
  await page.locator('[data-lesson-authoring-save]').click();
  await page.locator('[data-lesson-authoring-message]').waitFor();
  assert.ok(draftBody,'draft POST sent');
  assert.equal(draftBody.module,'lesson');assert.equal(draftBody.contentType,'lesson');assert.equal(draftBody.sourceRef,'new-ref');assert.equal(draftBody.title,'Brand new lesson');
  assert.equal(draftBody.versionId,null,'first save creates a draft');
  assert.equal(draftBody.payload.unitId,UNIT);assert.equal(draftBody.payload.slug,'brand-new-lesson');assert.ok(typeof draftBody.payload.learningArea==='string'&&draftBody.payload.learningArea.length>0,'a learning area is always sent');
  assert.deepEqual(draftBody.payload.blocks,[{type:'text',text:'Explain the main idea.'}]);
  assert.equal(draftBody.payload.summary,null);assert.equal(draftBody.payload.estimatedMinutes,null);
  assert.ok(state.requests.some(q=>q.method==='GET'&&q.path===`/api/admin/content/lessons/${LESSON_NEW}/edit`),'saved lesson is re-read');
  assert.equal(await page.locator('[data-lesson-authoring-message]').innerText(),en.listening.lessons.authoring.savedDraft);
 }finally{await context.close();}
});

await check('Lessons author: missing fields are refused before any request, and server issues are shown in the source wording',async()=>{
 let draftCalls=0;
 const {context,page}=await fixture({role:'teacher',view:(rt)=>rt==='/app/listening/lessons/author'?authorView():undefined,api:apiHandler({onDraft:()=>{draftCalls++;},draftResponse:{status:400,json:{error:'invalid',issues:[{code:'missing_unit',message:'server sentence'}]}}})});
 try{
  await page.goto(base+'/app/listening/lessons/author');await deskLoaded(page);
  await page.locator('[data-lesson-authoring-new]').click();
  await page.locator('[data-lesson-authoring-save]').click();
  await page.locator('[data-lesson-authoring-issue="missing_fields"]').waitFor();
  assert.equal(draftCalls,0);
  await page.locator('#lesson-title').fill('T');await page.locator('#lesson-slug').fill('t');await page.locator('#lesson-ref').fill('r');
  await page.locator('[data-lesson-authoring-save]').click();
  await page.locator('[data-lesson-authoring-issue="missing_unit"]').waitFor();
  assert.equal(await page.locator('[data-lesson-authoring-issue="missing_unit"]').innerText(),en.listening.lessons.authoringIssues.missing_unit);
  assert.equal(draftCalls,1,'exactly one write for one save click');
 }finally{await context.close();}
});

await check('Lessons author: typing keeps focus and value; the desk does not rebuild the input under the author',async()=>{
 const {context,page}=await fixture({role:'teacher',view:(rt)=>rt==='/app/listening/lessons/author'?authorView():undefined,api:apiHandler()});
 try{
  await page.goto(base+'/app/listening/lessons/author');await deskLoaded(page);
  await page.locator('[data-lesson-authoring-new]').click();
  const title=page.locator('#lesson-title');await title.click();
  await page.keyboard.type('Focus stays');
  assert.equal(await title.inputValue(),'Focus stays');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'lesson-title');
  assert.ok((await page.locator('[data-lesson-authoring-dirty]').innerText()).includes(en.listening.lessons.authoring.unsavedChanges));
 }finally{await context.close();}
});

await check('Lessons author: quiz options keep a line break while typing and save as separate options',async()=>{
 let draftBody=null;
 const {context,page}=await fixture({role:'teacher',view:(rt)=>rt==='/app/listening/lessons/author'?authorView():undefined,api:apiHandler({onDraft:b=>{draftBody=b;}})});
 try{
  await page.goto(base+'/app/listening/lessons/author');await deskLoaded(page);
  await page.locator('[data-lesson-authoring-new]').click();
  await page.locator('#lesson-title').fill('Quiz lesson');await page.locator('#lesson-slug').fill('quiz-lesson');await page.locator('#lesson-ref').fill('quiz-ref');
  await page.locator('[data-lesson-authoring-add="quiz"]').click();
  const options=page.locator('[data-lesson-authoring-block="quiz"] textarea');
  await options.click();await page.keyboard.type('Alpha');await page.keyboard.press('Enter');await page.keyboard.type('Beta');await page.keyboard.press('Enter');
  assert.equal(await options.inputValue(),'Alpha\nBeta\n','the typed line break survives the rerender');
  await page.keyboard.type('Gamma');
  await page.locator('[data-lesson-authoring-save]').click();
  await page.locator('[data-lesson-authoring-message]').waitFor();
  assert.deepEqual(draftBody.payload.blocks[0].quiz.options,['Alpha','Beta','Gamma']);
  assert.equal(draftBody.payload.blocks[0].quiz.questionType,'mcq_single');
 }finally{await context.close();}
});

await check('Lessons author: publish sends one publication request with the draft version and no publish time',async()=>{
const {context,page,state}=await fixture({role:'admin',view:(rt)=>rt==='/app/listening/lessons/author'?authorView({canPublish:true,lessons:[existingRow]}):undefined,api:apiHandler({publication:{publicationState:'published'}})});
 try{
  page.on('dialog',d=>d.accept());
  await page.goto(base+'/app/listening/lessons/author');await deskLoaded(page);
  await page.locator(`[data-lesson-authoring-item="${LESSON}"]`).click();
  await page.locator('[data-lesson-authoring-publish]').waitFor();
  const sent=page.waitForRequest(r=>r.method()==='POST'&&r.url().includes('/publication'),{timeout:8000});
  await page.locator('[data-lesson-authoring-publish]').click();
  await sent;
  await page.waitForTimeout(300);
  const pubReq=state.requests.find(q=>q.method==='POST'&&q.path.endsWith('/publication'));
  assert.ok(pubReq,'publication POST sent');
  assert.equal(pubReq.path,'/api/admin/content/versions/ver-draft-1/publication');
  assert.deepEqual(pubReq.body,{to:'published',publishAt:null});
  assert.equal(state.requests.filter(q=>q.method==='POST'&&q.path.endsWith('/publication')).length,1,'one click, one request');
 }finally{await context.close();}
});

await check('Lessons author: unit search asks the server, shows results and keeps the chosen unit',async()=>{
 const seen=[];
 const {context,page}=await fixture({role:'teacher',view:(rt)=>rt==='/app/listening/lessons/author'?authorView():undefined,api:apiHandler({unitsFor:(params)=>{seen.push(params.get('q'));return {options:[{id:UNIT2,label:'Unit B',course:'C'}],nextCursor:null};}})});
 try{
  await page.goto(base+'/app/listening/lessons/author');await deskLoaded(page);
  await page.locator('[data-lesson-authoring-new]').click();
  await page.locator('[data-lesson-unit-search]').fill('unit b');
  await page.locator(`[data-lesson-authoring-unit] option[value="${UNIT2}"]`).waitFor({state:'attached'});
  assert.deepEqual(seen,['unit b']);
  await page.locator('[data-lesson-authoring-unit]').selectOption(UNIT2);
  assert.equal(await page.locator('[data-lesson-authoring-unit]').inputValue(),UNIT2,'the author picks the search result');
 }finally{await context.close();}
});

await check('Lessons author: an upload replaces the file once the new upload completes; a failed replacement keeps the old file',async()=>{
 const intents=[];
 const {context,page,state}=await fixture({role:'teacher',view:(rt)=>rt==='/app/listening/lessons/author'?authorView({lessons:[existingRow]}):undefined,api:(p,ctx)=>{if(p==='/api/uploads/intent'){intents.push(ctx.body);return {status:413,json:{error:'file_too_large'}};}return apiHandler({edit:editModel({blocks:[{type:'file',text:null,url:null,objectKey:'old-key',originalName:'old.txt',mimeType:'text/plain',size:3,ref:null,quiz:null}]})})(p,ctx);}});
 try{
  await page.goto(base+'/app/listening/lessons/author');await deskLoaded(page);
  await page.locator(`[data-lesson-authoring-item="${LESSON}"]`).click();
  await page.locator('[data-lesson-authoring-object="old-key"]').waitFor();
  await page.locator('[data-lesson-authoring-upload]').click();
  await page.locator('[data-lesson-authoring-file]').setInputFiles({name:'new.txt',mimeType:'text/plain',buffer:Buffer.from('new text')});
  await page.locator('[data-lesson-authoring-upload-state="failed"]').waitFor();
  assert.equal(await page.locator('[data-lesson-authoring-object="old-key"]').count(),1,'the old file is kept');
  assert.equal(intents.length,1);assert.equal(intents[0].blockKind,'file');assert.equal(intents[0].filename,'new.txt');
  assert.ok(state.requests.every(q=>q.path!=='/api/uploads/finalize'),'no finalize after a refused intent');
  assert.ok((await page.locator('[data-lesson-authoring-message]').innerText()).includes(en.listening.lessons.authoring.mediaFailed));
 }finally{await context.close();}
});

await check('Lessons author: a successful upload records its object and saves it as the block media',async()=>{
 let draftBody=null;
 const {context,page,state}=await fixture({role:'teacher',view:(rt)=>rt==='/app/listening/lessons/author'?authorView():undefined,api:apiHandler({onDraft:b=>{draftBody=b;}})});
 try{
  await page.goto(base+'/app/listening/lessons/author');await deskLoaded(page);
  await page.locator('[data-lesson-authoring-new]').click();
  await page.locator('#lesson-title').fill('Upload lesson');await page.locator('#lesson-slug').fill('upload-lesson');await page.locator('#lesson-ref').fill('upload-ref');
  await page.locator('[data-lesson-authoring-add="file"]').click();
  await page.locator('[data-lesson-authoring-upload]').click();
  await page.locator('[data-lesson-authoring-file]').setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('hello')});
  await page.locator('[data-lesson-authoring-object="material/obj-1"]').waitFor();
  assert.ok(state.requests.some(q=>q.path==='/api/uploads/finalize'),'finalize runs after bytes');
  await page.locator('[data-lesson-authoring-save]').click();
  await page.locator('[data-lesson-authoring-message]').waitFor();
  const b=draftBody.payload.blocks[0];
  assert.equal(b.type,'file');assert.equal(b.objectKey,'material/obj-1');assert.equal(b.originalName,'note.txt');assert.equal(b.size,5);
 }finally{await context.close();}
});

await check('Lessons author: EN and UZ, Day and Night, phone width renders the desk without horizontal overflow',async()=>{
 const {context,page}=await fixture({role:'teacher',locale:'uz',theme:'night',width:390,height:844,view:(rt)=>rt==='/app/listening/lessons/author'?authorView({lessons:[existingRow]}):undefined,api:apiHandler()});
 try{
  await page.goto(base+'/app/listening/lessons/author');await deskLoaded(page);
  await page.locator(`[data-lesson-authoring-item="${LESSON}"]`).waitFor();
  assert.equal(await page.locator('[data-lesson-authoring-item]').first().innerText().then(t=>t.includes(uz.listening.lessons.authoring.publishedLabel)),true,'UZ labels');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
  assert.equal(overflow,false,'no horizontal overflow on a 390px phone');
  await page.screenshot({path:new URL('lesson-authoring-390-uz-night.png',out).pathname});
 }finally{await context.close();}
});

await check('Lessons author: when the desk projection is unavailable, the page shows a retry notice and no form',async()=>{
 const {context,page,state}=await fixture({role:'teacher',view:()=>undefined});
 try{
  await page.goto(base+'/app/listening/lessons/author');
  await page.locator('[data-region-failure="lesson-authoring"]').waitFor();
  assert.equal(await page.locator('[data-lesson-authoring-desk]').count(),0,'no editable desk without its data');
  assert.equal(await page.locator('[data-lesson-authoring-save]').count(),0);
  assert.ok(count(state,q=>q.path==='/api/frontend/view')>=1);
 }finally{await context.close();}
});

await check('Lessons author: at desktop width the lesson list sits beside the editor; on a phone the two stack',async()=>{
 const desktop=await fixture({role:'teacher',width:1440,height:900,view:(rt)=>rt==='/app/listening/lessons/author'?authorView({lessons:[existingRow]}):undefined,api:apiHandler()});
 try{
  await desktop.page.goto(base+'/app/listening/lessons/author');await deskLoaded(desktop.page);
  await desktop.page.locator(`[data-lesson-authoring-item="${LESSON}"]`).waitFor();
  const a=await desktop.page.locator('[data-lesson-authoring-desk] > aside').boundingBox();
  const m=await desktop.page.locator('[data-lesson-authoring-desk] > section').boundingBox();
  assert.ok(a.x+a.width<=m.x+1,'list is left of the editor');
  assert.ok(Math.abs(a.y-m.y)<4,'list and editor share a row');
  await desktop.page.screenshot({path:new URL('lesson-authoring-1440-en-day.png',out).pathname});
 }finally{await desktop.context.close();}
 const phone=await fixture({role:'teacher',width:390,height:844,view:(rt)=>rt==='/app/listening/lessons/author'?authorView({lessons:[existingRow]}):undefined,api:apiHandler()});
 try{
  await phone.page.goto(base+'/app/listening/lessons/author');await deskLoaded(phone.page);
  await phone.page.locator(`[data-lesson-authoring-item="${LESSON}"]`).waitFor();
  const a=await phone.page.locator('[data-lesson-authoring-desk] > aside').boundingBox();
  const m=await phone.page.locator('[data-lesson-authoring-desk] > section').boundingBox();
  assert.ok(m.y>=a.y+a.height-1,'editor sits below the list on a phone');
  assert.ok(m.width<=390,'editor fits the phone');
 }finally{await phone.context.close();}
});

/* ---------------- MCQ Mastery catalogue ---------------- */
const mcqDays=[
 {day:1,testId:'00000000-0000-4000-8000-0000000000d1',title:'Day one',questionCount:5,status:{state:'not_started',completed:0,total:5},draft:false,locked:false},
 {day:2,testId:'00000000-0000-4000-8000-0000000000d2',title:'Day two',questionCount:5,status:{state:'in_progress',completed:2,total:5},draft:false,locked:false},
 {day:3,testId:'00000000-0000-4000-8000-0000000000d3',title:'Day three',questionCount:5,status:{state:'completed',completed:5,total:5},draft:false,locked:false},
 {day:4,testId:'00000000-0000-4000-8000-0000000000d4',title:'Day four',questionCount:5,status:{state:'not_started',completed:0,total:5},draft:false,locked:true},
];

await check('MCQ catalogue: each day shows its real status, the right action and one address per day',async()=>{
 const {context,page}=await fixture({role:'student',view:(rt)=>rt==='/app/listening/mcq'?{days:mcqDays}:undefined});
 try{
  await page.goto(base+'/app/listening/mcq');
  await page.locator('[data-listening-mcq-grid]').waitFor();
  assert.equal(await page.locator('[data-listening-mcq-card]').count(),4);
  assert.equal(await page.locator('[data-listening-mcq-card="1"] [data-listening-mcq-open]').getAttribute('data-listening-mcq-action'),'start');
  assert.equal(await page.locator('[data-listening-mcq-card="2"] [data-listening-mcq-open]').getAttribute('data-listening-mcq-action'),'continue');
  assert.equal(await page.locator('[data-listening-mcq-card="3"] [data-listening-mcq-open]').getAttribute('data-listening-mcq-action'),'review');
  assert.equal(await page.locator('[data-listening-mcq-card="2"] [data-listening-mcq-card-status]').getAttribute('data-listening-mcq-card-status'),'in_progress');
  assert.ok((await page.locator('[data-listening-mcq-card="2"]').innerText()).includes('Day progress: 2 / 5'));
  assert.equal(await page.locator('[data-listening-mcq-card="1"] [data-listening-mcq-open]').getAttribute('href'),'/app/listening/mcq/day/1');
  assert.equal(await page.locator('[data-listening-mcq-card="4"] [data-listening-mcq-locked]').count(),1,'a locked day shows the lock, not an action');
  assert.equal(await page.locator('[data-listening-mcq-card="4"] [data-listening-mcq-open]').count(),0);
  await page.locator('[data-listening-mcq-card="1"] [data-listening-mcq-open]').click();
  await page.waitForURL(/\/app\/listening\/mcq\/day\/1$/,{timeout:8000});
 }finally{await context.close();}
});

await check('MCQ catalogue: an empty programme is an honest empty state, with a staff-only hint',async()=>{
 const learner=await fixture({role:'student',view:(rt)=>rt==='/app/listening/mcq'?{days:[]}:undefined});
 try{
  await learner.page.goto(base+'/app/listening/mcq');
  await learner.page.locator('[data-listening-mcq-empty]').waitFor();
  assert.equal(await learner.page.locator('[data-listening-mcq-staff-hint]').count(),0,'learners never see the staff hint');
 }finally{await learner.context.close();}
 const staff=await fixture({role:'teacher',view:(rt)=>rt==='/app/listening/mcq'?{days:[]}:undefined});
 try{
  await staff.page.goto(base+'/app/listening/mcq');
  await staff.page.locator('[data-listening-mcq-staff-hint]').waitFor();
 }finally{await staff.context.close();}
});

await check('MCQ catalogue: a failed read shows a retry that re-requests the same day list',async()=>{
 let calls=0;
 const {context,page,state}=await fixture({role:'student',view:(rt)=>{if(rt!=='/app/listening/mcq')return undefined;calls++;return calls===1?{status:500,json:{error:'server'}}:{days:mcqDays.slice(0,1)};}});
 try{
  await page.goto(base+'/app/listening/mcq');
  await page.locator('[data-region-retry="listening-mcq"]').waitFor();
  await page.locator('[data-region-retry="listening-mcq"]').click();
  await page.locator('[data-listening-mcq-card="1"]').waitFor();
  assert.equal(calls,2);
  assert.equal(count(state,q=>q.path==='/api/frontend/view'),2);
 }finally{await context.close();}
});

fs.writeFileSync(new URL('browser-listening-v41-results.json',out),JSON.stringify({suite:'V41 Listening sections',date:new Date().toISOString(),results,counts:{PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length}},null,2));
await browser.close();
const fails=results.filter(r=>r.status==='FAIL').length;
console.log(`V41: ${results.length-fails} pass, ${fails} fail`);
process.exit(fails?1:0);
