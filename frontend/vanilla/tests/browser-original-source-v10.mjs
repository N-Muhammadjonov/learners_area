/** Optional read-only actual-original HTML navigation probe. No grading/playback/live acceptance.
 * Chromium library setup matches the preserved original harness. */
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
if(!process.env.ORIGINAL_SOURCE_ROOT)throw Error('Set ORIGINAL_SOURCE_ROOT to the read-only original checkout; curriculum is never packaged.');
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes("single-process")&&!a.includes("disable-web-security")&&!a.includes("allow-running-insecure-content")),headless:true});

import {fixtureSession,publicPolicy,viewFixture,authoredFixture} from './fixtures.mjs';
import en from '../js/i18n/en.js';import uz from '../js/i18n/uz.js';
const base=process.env.PREVIEW_URL??'http://127.0.0.1:4173',out=new URL('../docs/evidence/v10/',import.meta.url),results=[];fs.mkdirSync(out,{recursive:true});
async function check(name,fn){if(process.env.TEST_FILTER&&!name.includes(process.env.TEST_FILTER))return;try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});console.error('FAIL',name,e.stack);}}
async function fixture({width=1440,height=900,locale='en',theme='day',status='active',role='student',policy=publicPolicy,handler}={}){
 const context=await browser.newContext({viewport:{width,height}});await context.addCookies([{name:'la_locale',value:locale,url:base},{name:'la_theme',value:theme,url:base}]);await context.addInitScript(()=>{window.open=()=>null;});const page=await context.newPage();page.setDefaultTimeout(8000);const state={status,onboarded:true,requests:[],openRequest:null};
 await context.route('**/api/**',async route=>{const r=route.request(),u=new URL(r.url()),path=u.pathname,body=r.method()==='GET'||!(r.headers()['content-type']??'').includes('application/json')?null:r.postDataJSON();state.requests.push({path,body});if(handler&&await handler({route,r,u,path,body,state,context}))return;const json=value=>route.fulfill({json:value});
 if(path==='/api/frontend/public')return json(policy);
 if(path==='/api/frontend/session'){const value=fixtureSession(role);value.session.user.accountStatus=state.status;return json(value);}
 if(path==='/api/frontend/view'){const key=u.searchParams.get('route');return json({version:1,route:key,region:u.searchParams.get('region')??undefined,data:key==='/pending'?{openRequest:state.openRequest}:viewFixture(key.split('?')[0])});}
 if(path==='/api/auth/state')return json({ok:true,role,accountStatus:state.status,expiresAt:Math.floor(Date.now()/1000)+3600});
 if(path==='/api/auth/login'||path==='/api/auth/recovery/login')return json({ok:true,onboarded:state.onboarded,accountStatus:state.status});
 if(path==='/api/auth/register'){state.status='pending';return json({ok:true,onboarded:false,accountStatus:'pending'});}
 if(path==='/api/auth/reset/request')return json({ok:true,devResetUrl:'/reset-password/confirm?token=synthetic-reset'});
 if(path==='/api/auth/reset/confirm')return body.token==='synthetic-reset'?json({ok:true}):route.fulfill({status:400,json:{error:'invalid_or_expired_token'}});
 if(path==='/api/admission/request'||path==='/api/onboarding'||path==='/api/auth/logout')return json({ok:true});
 if(path==='/api/notifications')return json({notifications:[],unread:0});
 if(path==='/api/locale'||path==='/api/theme'){const key=path.slice(5);await context.addCookies([{name:'la_'+key,value:body[key],url:base}]);return json({ok:true});}
 return route.fulfill({status:503,json:{error:'isolated_unconfigured'}});
 });return {context,page,state};
}


import ts from 'typescript';
const sourceRoot=path.resolve(process.env.ORIGINAL_SOURCE_ROOT),source=fs.readFileSync(path.join(sourceRoot,'content/listening/academic/test-01/source.html'),'utf8');
const hooks=fs.readFileSync(path.join(sourceRoot,'src/lib/listening/original-test-one-hooks.ts'),'utf8').replace(/import \{originalCourseHooks\} from '\.\/original-course-hooks';/,''),course=fs.readFileSync(path.join(sourceRoot,'src/lib/listening/original-course-hooks.ts'),'utf8');
const code=ts.transpileModule(course+'\n'+hooks,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {adaptOriginalTestOne}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const dto={...authoredFixture,storageKey:'la_listening_test_1_v2',audioPath:'audio/full.mp3',runtime:{entryPath:'source.html',files:{'source.html':adaptOriginalTestOne(source)}}};
try{await check('Actual read-only Test 1 HTML: nine genuine identities open and return in one opaque hydrated generation',async()=>{const {context,page}=await fixture({handler:async({route,path})=>{if(path.endsWith('/authored')){await route.fulfill({json:dto});return true;}if(path.endsWith('/authored-state')){await route.fulfill({json:{values:{},course:null}});return true;}if(path.endsWith('/sandbox')){await route.fulfill({body:`<!doctype html><script>addEventListener('message',function init(e){if(e.source!==parent||e.data?.channel!=='learners-area-sandbox-init')return;removeEventListener('message',init);document.open();document.write(e.data.html);document.close();});<\/script>`,contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline'; media-src data: blob:; img-src data: blob:; connect-src 'none'; sandbox allow-scripts"}});return true;}return false;}});try{await page.goto(base+'/app/listening/tests/00000000-0000-4000-8000-000000000001');const frame=page.frameLocator('iframe');await frame.locator('#activityCards [data-open=exam]').waitFor();assert.deepEqual(await frame.locator('#activityCards [data-open]').evaluateAll(nodes=>nodes.map(n=>n.dataset.open)),['exam','review','script','mcq','map','multi','completion','vocab','retry']);for(const id of ['exam','review','script','mcq','map','multi','completion','vocab','retry']){await frame.locator('[data-open='+id+']').click();await frame.locator('#activity-'+id+'.active').waitFor();await frame.locator('#activity-'+id+' [data-back]').click();await frame.locator('#hub').waitFor();}assert.equal(await page.locator('iframe').count(),1);assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts');}finally{await context.close();}});}finally{await browser.close();}
const report={status:results.some(r=>r.status==='FAIL')?'FAIL':'PARTIAL',source:'read-only original source.html and original adaptation functions, authorized API fixture, no copied corpus or screenshots',navigationIdentitiesVerified:results.every(r=>r.status==='PASS')?9:0,comprehensivelyAcceptedOriginalActivities:0,gradingPlaybackAutosaveFullInteractions:'UNVERIFIED',productionAcceptance:'NONE',results};fs.writeFileSync(new URL('original-source-navigation.json',out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.status==='FAIL')process.exitCode=1;
