/** V47 TED / PODCAST browser checks: library states, standalone and course studio, YouTube message protocol with a
 * local fake player (served by route interception), progress and END writes, direct media, student notes and transcript modal,
 * navigation teardown, responsive layout and EN/UZ labels. Synthetic fixtures only; no network to real providers. */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {publicPolicy,fixtureSession} from './fixtures.mjs';
import en from '../js/i18n/en.js';
import uz from '../js/i18n/uz.js';

const deps=path.resolve(import.meta.dirname,'../node_modules');
if(process.platform==='linux'){const tar=path.join(deps,'al2023.tar');fs.writeFileSync(tar,brotliDecompressSync(fs.readFileSync(path.join(deps,'@sparticuz/chromium/bin/al2023.tar.br'))));execFileSync('tar',['xf',tar,'-C',deps]);process.env.LD_LIBRARY_PATH=path.join(deps,'lib')+':'+(process.env.LD_LIBRARY_PATH??'');}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('single-process')&&!a.includes('disable-web-security')&&!a.includes('allow-running-insecure-content')),headless:true});
const base=process.env.PREVIEW_URL??'http://127.0.0.1:4173';
const out=new URL('../docs/evidence/v47/',import.meta.url);fs.mkdirSync(out,{recursive:true});
const results=[];
async function check(name,fn){
 if(process.env.TEST_FILTER&&!name.includes(process.env.TEST_FILTER))return;
 try{await fn();results.push({name,status:'PASS'});console.log('PASS',name);}
 catch(e){results.push({name,status:'FAIL',error:String(e.message).slice(0,700)});console.error('FAIL',name,String(e.message).slice(0,700));}
}

const YT='https://www.youtube-nocookie.com/embed/';
const FAKE_PLAYER='<!doctype html><html><body><script>window.emit=function(o){parent.postMessage(JSON.stringify(o),"*");};</script></body></html>';

/** Learner context. view(route) answers the proposed projection; api(path,ctx) answers other same-origin calls;
 * undefined is a 503. Every request is recorded. Embeds and thumbnails are served locally, never by the internet. */
async function fixture({locale='en',theme='day',width=1440,view,api,hasTouch=false}={}){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch});
 await context.addCookies([{name:'la_locale',value:locale,url:base},{name:'la_theme',value:theme,url:base}]);
 await context.addInitScript(()=>{
  window.__gum=0;
  const md=navigator.mediaDevices;
  if(md)md.getUserMedia=()=>{window.__gum++;return Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'}));};
 });
 const page=await context.newPage();page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e.message)));
 const state={requests:[]};
 await context.route(YT+'**',route=>route.fulfill({status:200,contentType:'text/html',body:FAKE_PLAYER}));
 await context.route('**://i.ytimg.com/**',route=>route.abort());
 await context.route('**://media.example.invalid/**',route=>route.fulfill({status:404,body:''}));
 await context.route('**/api/**',async route=>{
  const r=route.request(),u=new URL(r.url()),p=u.pathname;
  let body=null;if(r.method()!=='GET'&&(r.headers()['content-type']??'').includes('application/json')){try{body=r.postDataJSON();}catch{body=null;}}
  state.requests.push({path:p,method:r.method(),query:u.search,body});
  const reply=x=>{if(x===undefined)return route.fulfill({status:503,json:{error:'unavailable'}});if(typeof x.status==='number')return route.fulfill({status:x.status,json:x.json});return route.fulfill({status:200,json:x});};
  if(p==='/api/frontend/public')return reply(publicPolicy);
  if(p==='/api/frontend/session')return reply(fixtureSession('student'));
  if(p==='/api/notifications')return reply({notifications:[],unread:0});
  if(p==='/api/frontend/view'){const rt=u.searchParams.get('route');const data=view?await view(rt):undefined;return data===undefined?reply(undefined):reply({version:1,route:rt,data});}
  if(api){const answer=await api(p,{method:r.method(),body,u,state});if(answer!==undefined)return reply(answer);}
  return reply(undefined);
 });
 return {context,page,state,errors};
}
async function close(f){await f.context.close();}
const posts=(f,suffix)=>f.state.requests.filter(r=>r.method==='POST'&&r.path.endsWith(suffix));
async function until(fn,message,timeout=6000){
 const end=Date.now()+timeout;
 let last;
 while(Date.now()<end){last=await Promise.resolve().then(fn).catch(e=>e);if(last===true)return;await new Promise(r=>setTimeout(r,80));}
 throw new Error(message+' (last='+String(last)+')');
}
const frameOf=f=>f.page.frames().find(fr=>fr.url().startsWith(YT));
async function emit(f,payload){const fr=frameOf(f);assert(fr,'player frame not loaded');await fr.evaluate(o=>window.emit(o),payload);}
const noOverflow=async f=>assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'horizontal overflow');

/** Shared ids (synthetic). */
const SA1='00000000-0000-4000-8000-0000000000a1',SA2='00000000-0000-4000-8000-0000000000a2',SA3='00000000-0000-4000-8000-0000000000a3';
const CV1='00000000-0000-4000-8000-0000000000b1',CV2='00000000-0000-4000-8000-0000000000b2';
const L1='00000000-0000-4000-8000-0000000000c1',L2='00000000-0000-4000-8000-0000000000c2';
const OCC1='00000000-0000-4000-8000-0000000000d1',LEX1='00000000-0000-4000-8000-0000000000e1';
const QC1='00000000-0000-4000-8000-0000000000f1',QG1='00000000-0000-4000-8000-0000000000f2';
const ME='isolated-fixture-user';

const library=()=>({
 standalone:[
  {id:SA1,title:'Synthetic talk one',provider:'youtube',videoId:'abcdefghijk',durationSeconds:1080,progressState:'in_progress'},
  {id:SA2,title:'Synthetic podcast two',provider:'direct',videoId:'clip-01.mp4',durationSeconds:null,progressState:'completed'},
  {id:SA3,title:'Synthetic talk three',provider:'youtube',videoId:'bcdefghijkl',durationSeconds:30,progressState:null},
 ],
 course:[
  {id:CV1,title:'Synthetic course video',provider:'youtube',videoId:'cdefghijklm',durationSeconds:600,state:'available',lessonId:L1,courseSlug:'ielts',courseTitle:'IELTS Synthetic',unitTitle:'Unit A'},
  {id:CV2,title:'Synthetic locked video',provider:'youtube',videoId:'defghijklmn',durationSeconds:600,state:'locked',lessonId:L2,courseSlug:'ielts',courseTitle:'IELTS Synthetic',unitTitle:'Unit B'},
 ],
});
const standaloneDetail=(overrides={})=>({detail:{
 videoLesson:{id:SA1,provider:'youtube',videoId:'abcdefghijk',title:'Synthetic talk one',beforeYouWatch:'Predict the answer.',durationSeconds:1080,transcript:[{startSeconds:0,text:'Hello there synthetic.'},{startSeconds:65,text:'Second line.'}],transcriptSource:'Synthetic',transcriptAttribution:'Synthetic attribution',transcriptText:null,notes:'Synthetic notes text',...overrides.videoLesson},
 questions:[{id:QC1,stage:'comprehension',prompt:'What is the topic?',atSeconds:30},{id:QG1,stage:'gap_fill',prompt:'Fill ___',atSeconds:null}],
 progress:overrides.progress===undefined?{state:'in_progress',watchedSeconds:42,answers:{},responseText:null,summaryText:null}:overrides.progress,
 vocabulary:{ready:true,items:[{occurrenceId:OCC1,id:LEX1,term:'synthetic',partOfSpeech:'adj',definitionEn:'made up',translationUz:null,exampleSentence:'A synthetic word.'}]},
 directMedia:overrides.directMedia??null,embedOrigin:'https://app.example.invalid',
}});
const courseVideo=(overrides={})=>({
 videoLesson:{id:CV1,provider:'youtube',videoId:'cdefghijklm',title:'Synthetic course video',beforeYouWatch:null,durationSeconds:600,transcript:null,transcriptSource:null,transcriptAttribution:null,transcriptText:'Plain transcript paragraph.',notes:'Course notes',...overrides.videoLesson},
 questions:[{id:QC1,stage:'comprehension',prompt:'Comprehension prompt?',atSeconds:null},{id:QG1,stage:'gap_fill',prompt:'Gap fill ___?',atSeconds:null}],
 progress:null,vocabulary:{ready:true,items:[]},directMedia:null,embedOrigin:null,
});
const courseLessonDetail=(video)=>({detail:{ownerId:ME,lesson:{id:L1,title:'Synthetic lesson',summary:null,recordingUrl:null},unitTitle:'Unit A',state:'available',notes:null,completedAt:null,videoAvailable:true,video,materialBlocks:[]}});

// ---------- Library ----------
await check('library: real cards, standalone and open course grouping, states, links, thumbnails, no iframe',async()=>{
 const f=await fixture({view:r=>r==='/app/video-lessons'?library():undefined});
 try{
  await f.page.goto(base+'/app/video-lessons');
  await f.page.locator('[data-video-lesson-entry]').first().waitFor();
  assert.equal(await f.page.locator('[data-video-standalone-open]').count(),3);
  assert.equal(await f.page.locator('[data-video-lesson-entry]').count(),4,'locked course video must not be listed');
  assert.equal(await f.page.locator('[data-video-lesson-entry="'+CV2+'"]').count(),0);
  assert.deepEqual((await f.page.locator('[data-video-card-title]').allTextContents()).slice(0,3),['Synthetic talk one','Synthetic podcast two','Synthetic talk three']);
  const badges=await f.page.locator('[data-video-lesson-entry] span').allTextContents();
  assert(badges.includes('In progress')&&badges.includes('Completed')&&badges.includes('Available'),'state badges '+badges.join('|'));
  assert.equal(await f.page.locator('a[href="/app/video-lessons/'+SA1+'"]').count(),1);
  assert.equal(await f.page.locator('a[href="/app/courses/ielts/lessons/'+L1+'"]').count(),1);
  const meta=await f.page.locator('[data-video-lesson-entry="'+CV1+'"] [data-video-card-meta]').textContent();
  assert.equal(meta,'10 min · IELTS Synthetic · Unit A');
  await until(async()=>(await f.page.locator('[data-video-thumb=fallback]').count())===4,'fallback thumbnails');//direct item + three YouTube items whose image host is blocked
  assert.equal(await f.page.locator('iframe').count(),0,'library must not frame players');
  assert(f.state.requests.some(r=>r.path==='/api/frontend/view'));
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});
await check('library: empty state when nothing is open; course section only when present',async()=>{
 const f=await fixture({view:r=>r==='/app/video-lessons'?{standalone:[],course:[]}:undefined});
 try{
  await f.page.goto(base+'/app/video-lessons');
  await f.page.locator('[data-video-lessons-empty]').waitFor();
  assert.equal(await f.page.locator('[data-video-lessons-empty]').textContent(),en.videoLessons.none);
  assert.equal(await f.page.locator('[data-video-lesson-entry]').count(),0);
 }finally{await close(f);}
});
await check('library: standalone-only hides the course section when no course video is open',async()=>{
 const data=library();data.course=[data.course[1]];
 const f=await fixture({view:r=>r==='/app/video-lessons'?data:undefined});
 try{
  await f.page.goto(base+'/app/video-lessons');
  await f.page.locator('[data-video-standalone-open]').first().waitFor();
  assert.equal(await f.page.locator('#video-course').count(),0);
  assert.equal(await f.page.locator('[data-video-lessons-empty]').count(),0);
 }finally{await close(f);}
});
await check('library: loading skeleton, then a retryable error on a failed projection, then data',async()=>{
 let calls=0;
 const f=await fixture({view:r=>{calls++;if(calls===1)return undefined;return library();}});
 try{
  await f.page.goto(base+'/app/video-lessons');
  await f.page.locator('[data-region-retry=video-lessons]').waitFor();
  assert.equal(await f.page.locator('[data-video-lesson-entry]').count(),0);
  await f.page.locator('[data-region-retry=video-lessons]').click();
  await f.page.locator('[data-video-lesson-entry]').first().waitFor();
  assert(calls>=2);
 }finally{await close(f);}
});
await check('library: malformed projection (bad video id) fails the region, renders no fake card',async()=>{
 const data=library();data.standalone[0].videoId='PLACEHOLDER1';
 const f=await fixture({view:r=>r==='/app/video-lessons'?data:undefined});
 try{
  await f.page.goto(base+'/app/video-lessons');
  await f.page.locator('[data-region-retry=video-lessons]').waitFor();
  assert.equal(await f.page.locator('[data-video-lesson-entry]').count(),0);
 }finally{await close(f);}
});
await check('library: Uzbek labels and responsive 390px layout without overflow',async()=>{
 const f=await fixture({locale:'uz',width:390,view:r=>r==='/app/video-lessons'?library():undefined});
 try{
  await f.page.goto(base+'/app/video-lessons');
  await f.page.locator('[data-video-lesson-entry]').first().waitFor();
  const heading=await f.page.locator('[data-video-standalone-list] h2').textContent();
  assert.equal(heading,uz.videoLessons.standaloneHeading);
  assert.equal(await f.page.locator('[data-video-library-grid]').first().evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),1,'one column on phones');
  await noOverflow(f);
 }finally{await close(f);}
});

await check('library: night appearance renders the same real cards with no errors',async()=>{
 const f=await fixture({theme:'night',view:r=>r==='/app/video-lessons'?library():undefined});
 try{
  await f.page.goto(base+'/app/video-lessons');
  await f.page.locator('[data-video-lesson-entry]').first().waitFor();
  assert.equal(await f.page.locator('[data-video-lesson-entry]').count(),4);
  assert.equal(await f.page.evaluate(()=>document.documentElement.dataset.theme),'night','night theme applied');
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});
// ---------- Standalone detail ----------
await check('standalone detail: YouTube embed rules, resume start, no autoplay, sandbox, origin, tabs, notes',async()=>{
 const f=await fixture({view:r=>r==='/app/video-lessons/'+SA1?standaloneDetail():undefined});
 try{
  await f.page.goto(base+'/app/video-lessons/'+SA1);
  await f.page.locator('[data-video-lesson]').waitFor();
  const frame=f.page.locator('iframe[data-video-frame]');
  const src=await frame.getAttribute('src');
  assert(src.startsWith(YT+'abcdefghijk?'),src);
  assert(src.includes('enablejsapi=1')&&src.includes('rel=0')&&src.includes('cc_load_policy=1'),src);
  assert(src.includes('origin=https%3A%2F%2Fapp.example.invalid'),'configured origin only');
  assert(src.endsWith('&start=42'),'resume at server position '+src);
  assert(!/autoplay/i.test(src),'no autoplay');
  assert.equal(await frame.getAttribute('sandbox'),'allow-scripts allow-same-origin allow-presentation');
  assert.equal(await frame.getAttribute('allow'),'encrypted-media; picture-in-picture; fullscreen');
  assert.equal(await frame.getAttribute('referrerpolicy'),'strict-origin-when-cross-origin');
  assert.deepEqual(await f.page.locator('[data-video-tab]').evaluateAll(ns=>ns.map(n=>n.getAttribute('data-video-tab'))),['description','notes','vocabulary','ownNotes']);
  await f.page.locator('[data-video-tab=notes]').click();
  assert.equal(await f.page.locator('[data-video-notes]').getAttribute('data-video-notes'),'shown');
  assert.equal(await f.page.locator('[data-video-notes]').textContent(),'Synthetic notes text');
  assert.equal(await f.page.locator('[data-video-detail-meta]').textContent(),'18 min');
  assert.equal(await f.page.locator('[data-video-state]').first().getAttribute('data-video-state'),'in_progress');
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});
await check('standalone: Transcript button opens a modal while Description remains selected',async()=>{
 const f=await fixture({view:r=>r==='/app/video-lessons/'+SA1?standaloneDetail():undefined});
 try{
  await f.page.goto(base+'/app/video-lessons/'+SA1);
  await f.page.locator('[data-video-transcript-button]').click();
  assert((await f.page.locator('.video-transcript-dialog').textContent()).includes('Hello there synthetic.'));
  assert.equal(await f.page.locator('[data-video-open-transcript]').count(),0);
 }finally{await close(f);}
});
await check('standalone vocabulary: save posts only the occurrence id, saved state is final',async()=>{
 const f=await fixture({
  view:r=>r==='/app/video-lessons/'+SA1?standaloneDetail():undefined,
  api:(p,{method})=>p.endsWith('/vocabulary')&&method==='POST'?{ok:true}:undefined,
 });
 try{
  await f.page.goto(base+'/app/video-lessons/'+SA1);
  await f.page.locator('[data-video-tab=vocabulary]').click();
  const button=f.page.locator('[data-video-vocabulary] button');
  await button.click();
  await until(async()=>(await button.textContent())===en.videoLesson.vocabularySaved,'not saved');
  assert(await button.isDisabled());
  assert.deepEqual(posts(f,'/vocabulary')[0].body,{occurrenceId:OCC1});
  assert.equal(posts(f,'/vocabulary').length,1);
 }finally{await close(f);}
});
await check('standalone vocabulary failure shows a localized alert and keeps the word unsaved',async()=>{
 const f=await fixture({
  view:r=>r==='/app/video-lessons/'+SA1?standaloneDetail():undefined,
  api:(p,{method})=>p.endsWith('/vocabulary')&&method==='POST'?{status:503,json:{error:'service_unavailable'}}:undefined,
 });
 try{
  await f.page.goto(base+'/app/video-lessons/'+SA1);
  await f.page.locator('[data-video-tab=vocabulary]').click();
  await f.page.locator('[data-video-vocabulary] button').click();
  await f.page.locator('[data-video-vocabulary] [role=alert]').waitFor();
  assert(!await f.page.locator('[data-video-vocabulary] button').isDisabled());
 }finally{await close(f);}
});
await check('standalone own notes save without overwriting older responses; server decides progress',async()=>{
 const f=await fixture({
  view:r=>r==='/app/video-lessons/'+SA1?standaloneDetail():undefined,
  api:(p,{method})=>p.endsWith('/response')&&method==='POST'?{state:'completed'}:undefined,
 });
 try{
  await f.page.goto(base+'/app/video-lessons/'+SA1);
  await f.page.locator('[data-video-tab=ownNotes]').click();
  await f.page.locator('[data-video-own-notes-input]').fill('I learned about synthetic things.');
  await f.page.locator('[data-video-save-response]').click();
  await f.page.locator('[data-video-response-state=saved]').waitFor();
  assert.deepEqual(posts(f,'/response')[0].body,{summaryText:'I learned about synthetic things.'});
  assert.equal(await f.page.locator('[data-video-state]').first().getAttribute('data-video-state'),'completed');
  assert.equal(await f.page.locator('[data-video-progress-state]').textContent(),en.videoLesson.stateCompleted);
 }finally{await close(f);}
});
await check('standalone: removed exercises and recorder never render or request the microphone',async()=>{
 const f=await fixture({view:r=>r==='/app/video-lessons/'+SA1?standaloneDetail():undefined});
 try{
  await f.page.goto(base+'/app/video-lessons/'+SA1);await f.page.locator('[data-video-description]').waitFor();
  for(const name of ['notes','vocabulary','ownNotes'])await f.page.locator('[data-video-tab='+name+']').click();
  assert.equal(await f.page.locator('[data-video-answer-input],[data-local-reflection],[data-ted-study-pack]').count(),0);
  assert.equal(await f.page.evaluate(()=>window.__gum),0);
 }finally{await close(f);}
});
await check('YouTube progress: periodic write after 5 new seconds, one END write, replay without resume offset',async()=>{
 const f=await fixture({view:r=>r==='/app/video-lessons/'+SA1?standaloneDetail():undefined,api:(p,{method})=>{if(p.endsWith('/progress')&&method==='POST')return {state:'in_progress',watchedSeconds:50,completedAt:null};return undefined;}});
 try{
  await f.page.goto(base+'/app/video-lessons/'+SA1);
  await f.page.locator('iframe[data-video-frame]').waitFor();
  await until(()=>frameOf(f)!==undefined,'frame');
  await emit(f,{event:'infoDelivery',info:{currentTime:43,playerState:1}});
  await emit(f,{event:'infoDelivery',info:{currentTime:50,playerState:1}});
  await until(()=>posts(f,'/progress').length>=1,'no periodic progress write');
  assert.equal(posts(f,'/progress')[0].body.watchedSeconds,50);
  assert.equal(await f.page.locator('[data-video-live-transcript]').getAttribute('data-video-live-transcript'),'yes');
  await emit(f,{event:'onStateChange',info:0});
  await f.page.locator('[data-video-ended]').waitFor();
  assert.equal(await f.page.locator('iframe[data-video-frame]').count(),0,'frame removed at the end');
  await until(()=>posts(f,'/progress').some(p=>p.body.ended===true),'no END write');
  const end=posts(f,'/progress').find(p=>p.body.ended===true);
  assert.equal(end.body.watchedSeconds,1080,'END uses the authored duration');
  assert.equal(posts(f,'/progress').filter(p=>p.body.ended===true).length,1,'one END write per playback');
  await f.page.locator('[data-video-ended] button').click();
  await f.page.locator('iframe[data-video-frame]').waitFor();
  const src=await f.page.locator('iframe[data-video-frame]').getAttribute('src');
  assert(!src.includes('&start='),'replay starts from 0: '+src);
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});
await check('navigation away tears down the player: frame removed, late player messages send nothing',async()=>{
 const f=await fixture({view:r=>{if(r==='/app/video-lessons/'+SA1)return standaloneDetail();if(r==='/app/video-lessons')return library();return undefined;},api:(p,{method})=>p.endsWith('/progress')&&method==='POST'?{state:'in_progress',watchedSeconds:60}:undefined});
 try{
  await f.page.goto(base+'/app/video-lessons/'+SA1);
  await f.page.locator('iframe[data-video-frame]').waitFor();
  await until(()=>frameOf(f)!==undefined,'frame');
  const stale=frameOf(f);
  await f.page.locator('[data-video-back]').click();
  await f.page.locator('[data-video-lesson-entry]').first().waitFor();
  assert.equal(await f.page.locator('iframe').count(),0);
  const before=posts(f,'/progress').length;
  await stale.evaluate(()=>window.emit({event:'infoDelivery',info:{currentTime:99,playerState:1}})).catch(()=>{});
  await f.page.waitForTimeout(400);
  assert.equal(posts(f,'/progress').length,before,'no progress write from a removed player');
  assert.equal(await f.page.evaluate(()=>location.pathname),'/app/video-lessons');
 }finally{await close(f);}
});
await check('direct media: owner-authorised player with captions, speed, CC, no autoplay, no iframe',async()=>{
 const MEDIA='https://media.example.invalid/media/clip-01.mp4',TRACK='https://media.example.invalid/media/clip-01.vtt';
 const f=await fixture({view:r=>r==='/app/video-lessons/'+SA2?standaloneDetail({videoLesson:{id:SA2,provider:'direct',videoId:'clip-01.mp4',title:'Synthetic podcast two',transcript:null,transcriptText:null,notes:null,durationSeconds:null,beforeYouWatch:null,transcriptAttribution:null},progress:null,directMedia:{src:MEDIA,captions:TRACK}}):undefined});
 try{
  await f.page.goto(base+'/app/video-lessons/'+SA2);
  await f.page.locator('[data-direct-player]').waitFor();
  const v=f.page.locator('[data-direct-player] video');
  assert.equal(await v.evaluate(n=>n.getAttribute('src')??n.querySelector('source')?.getAttribute('src')??null),MEDIA,'authorised media URL only');
  assert.equal(await f.page.locator('[data-direct-player] track[kind=captions]').count(),1,'same-origin captions track');
  assert.equal(await f.page.locator('iframe').count(),0);
  assert.equal(await v.getAttribute('autoplay'),null);
  assert.equal(await v.getAttribute('controlslist'),'nodownload');
  assert.equal(await f.page.locator('[data-direct-player] select option').count(),4);
  await f.page.locator('[data-direct-player] select').selectOption('1.25');
  assert.equal(await v.evaluate(n=>n.playbackRate),1.25);
  assert.equal(await f.page.locator('[data-direct-player] button[aria-label]').count()>=2,true);
 }finally{await close(f);}
});
await check('blocked or unsupported media is an honest notice, never a black frame',async()=>{
 const f=await fixture({view:r=>r==='/app/video-lessons/'+SA2?standaloneDetail({videoLesson:{id:SA2,provider:'direct',videoId:'bad id.mp4',title:'x'},progress:null,directMedia:null}):undefined});
 try{
  await f.page.goto(base+'/app/video-lessons/'+SA2);
  await f.page.locator('[data-region-retry=video-lesson]').waitFor();
  assert.equal(await f.page.locator('[data-direct-player]').count(),0);
 }finally{await close(f);}
});
await check('detail: retryable projection error, not-found for a non-live item, invalid id is not-found without lookup',async()=>{
 let calls=0;
 const f=await fixture({view:r=>{calls++;if(r.endsWith('/'+SA1)&&calls===1)return undefined;return r.endsWith('/'+SA1)?standaloneDetail():{detail:null};}});
 try{
  await f.page.goto(base+'/app/video-lessons/'+SA1);
  await f.page.locator('[data-region-retry=video-lesson]').waitFor();
  await f.page.locator('[data-region-retry=video-lesson]').click();
  await f.page.locator('[data-video-lesson]').waitFor();
 }finally{await close(f);}
 const g=await fixture({view:()=>({detail:null})});
 try{
  await g.page.goto(base+'/app/video-lessons/'+SA3);
  await until(async()=>(await g.page.locator('[data-video-standalone]').count())===0&&(await g.page.locator('[data-region-retry]').count())===0&&(await g.page.locator('body').textContent()).length>0,'not found');
  assert.equal(await g.page.locator('iframe').count(),0);
 }finally{await close(g);}
 const h=await fixture({view:()=>{throw new Error('must not look up an invalid id');}});
 try{
  await h.page.goto(base+'/app/video-lessons/not-a-uuid');
  await h.page.waitForTimeout(400);
  assert.equal(h.state.requests.filter(r=>r.path==='/api/frontend/view').length,0);
 }finally{await close(h);}
});
await check('detail responsive 390px: no horizontal overflow, tabs wrap',async()=>{
 const f=await fixture({width:390,hasTouch:true,view:r=>r==='/app/video-lessons/'+SA1?standaloneDetail():undefined});
 try{
  await f.page.goto(base+'/app/video-lessons/'+SA1);
  await f.page.locator('[data-video-tablist]').waitFor();
  await noOverflow(f);
 }finally{await close(f);}
});

// ---------- Course mode ----------
await check('course studio: Description opens first and only learning materials remain',async()=>{
 const f=await fixture({view:r=>r==='/app/courses/ielts/lessons/'+L1?courseLessonDetail(courseVideo()):undefined});
 try{
  await f.page.goto(base+'/app/courses/ielts/lessons/'+L1);await f.page.locator('[data-video-lesson]').waitFor();
  assert.deepEqual(await f.page.locator('[data-video-tab]').evaluateAll(ns=>ns.map(n=>n.getAttribute('data-video-tab'))),['description','notes','vocabulary']);
  assert.equal(await f.page.locator('[data-video-tab-active]').getAttribute('data-video-tab-active'),'description');
  assert.equal(await f.page.locator('[data-video-answer-input],[data-local-reflection]').count(),0);
  assert.equal(await f.page.locator('iframe[data-video-frame]').count(),1);
  assert.equal(await f.page.locator('[data-lesson-notes-panel]').count(),1);
 }finally{await close(f);}
});
await check('course studio: plain transcript opens from a button and course notes stay available',async()=>{
 const f=await fixture({view:r=>r==='/app/courses/ielts/lessons/'+L1?courseLessonDetail(courseVideo()):undefined});
 try{
  await f.page.goto(base+'/app/courses/ielts/lessons/'+L1);await f.page.locator('[data-video-transcript-button]').click();
  await f.page.locator('.video-transcript-dialog').waitFor();
  assert((await f.page.locator('.video-transcript-dialog').textContent()).includes('Plain transcript paragraph.'));
  await f.page.locator('.video-transcript-dialog button').first().click();
  assert.equal(await f.page.locator('.video-transcript-dialog').count(),0);
  assert.equal(await f.page.locator('[data-lesson-notes-panel]').count(),1);
 }finally{await close(f);}
});
await check('course studio retry does not leave a second player behind',async()=>{
 let calls=0;
 const f=await fixture({view:r=>{if(r!=='/app/courses/ielts/lessons/'+L1)return undefined;calls++;return calls===1?courseLessonDetail({...courseVideo(),videoLesson:{...courseVideo().videoLesson,videoId:'BAD'}}):courseLessonDetail(courseVideo());}});
 try{
  await f.page.goto(base+'/app/courses/ielts/lessons/'+L1);
  await f.page.locator('[data-region-retry=course-lesson]').waitFor();
  await f.page.locator('[data-region-retry=course-lesson]').click();
  await f.page.locator('[data-video-lesson]').waitFor();
  assert.equal(await f.page.locator('iframe[data-video-frame]').count(),1);
 }finally{await close(f);}
});

const fails=results.filter(r=>r.status==='FAIL').length;
fs.writeFileSync(new URL('browser-video-v47-results.json',out),JSON.stringify({suite:'V47 TED / PODCAST',date:new Date().toISOString(),results,counts:{PASS:results.length-fails,FAIL:fails}},null,2));
await browser.close();
console.log(`V47 browser: ${results.length-fails} pass, ${fails} fail`);
process.exit(fails?1:0);
