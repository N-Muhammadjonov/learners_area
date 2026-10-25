/** V6 Phase2 product journeys. No live acceptance.
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
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes("single-process")&&!a.includes("disable-web-security")&&!a.includes("allow-running-insecure-content")),headless:true});

import {fixtureSession,publicPolicy,viewFixture,authoredFixture} from './fixtures.mjs';
import en from '../js/i18n/en.js';import uz from '../js/i18n/uz.js';
const base=process.env.PREVIEW_URL??'http://127.0.0.1:4173',out=new URL('../docs/evidence/v37/',import.meta.url),results=[];fs.mkdirSync(out,{recursive:true});
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

import {activityFixture,studyFixture,legacyFixture,reviewFixture,revisionFixture,id,qid,runId} from './listening-v8-fixtures.mjs';
const ack={ok:true,id:runId,score:1,total:1};
async function activityPage(options,p,extra){return fixture({...options,handler:async args=>{if(extra&&await extra(args))return true;const {route,path,u}=args;if(path==='/api/frontend/view'){const routeKey=u.searchParams.get('route');await route.fulfill({json:{version:1,route:routeKey,data:routeKey.includes('/study')?{kind:'study',study:studyFixture()}:{kind:'activity',activity:p}}});return true;}if(path.endsWith('/activity')){await route.fulfill({json:{...ack,score:args.body.complete?(p.activity===4&&p.data.studyPack?null:1):null}});return true;}if(path.endsWith('/study')){await route.fulfill({json:{score:0,total:1,results:[{number:1,correct:false,key:'Authorized synthetic key'}]}});return true;}if(path==='/api/vocabulary/folders'){await route.fulfill({json:{folders:[{id:runId,name:'Synthetic folder'}]}});return true;}if(path==='/api/vocabulary'){await route.fulfill({json:{ok:true}});return true;}return false;}});}
try{await check('V37 revision transcript vocabulary request retains original attempt identity, not canonical test identity',async()=>{const {context,page,state}=await fixture({handler:async({route,path,u})=>{if(path==='/api/frontend/view'){await route.fulfill({json:{version:1,route:u.searchParams.get('route'),data:{kind:'revision',revision:revisionFixture()}}});return true;}if(path==='/api/vocabulary/folders'){await route.fulfill({json:{folders:[]}});return true;}if(path==='/api/vocabulary'){await route.fulfill({status:400,json:{error:'needs_definition'}});return true;}return false;}});try{await page.goto(base+`/app/listening/attempts/${id}/revision`);await page.locator('[data-speed-transcript]').click();const text=page.locator('[data-clickable-text]').last();await text.focus();await text.press('ArrowRight');await text.press('Enter');await page.locator('[data-word-save]').waitFor();const read=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/vocabulary'&&r.method()==='POST');await page.locator('[data-word-save]').click();const request=await read;assert.equal(request.postDataJSON().sourceId,id);assert.notEqual(id,qid);await page.locator('[data-word-needs-meaning]').waitFor();assert.equal(state.requests.filter(r=>r.path==='/api/vocabulary/lookup').length,0);await page.keyboard.press('Escape');await page.locator('[data-word-popover]').waitFor({state:'detached'});assert(await text.evaluate(n=>n===document.activeElement));}finally{await context.close();}});}finally{await browser.close();const counts={PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length,SKIP:0};fs.writeFileSync(new URL('revision-source-identity.json',out),JSON.stringify({scope:'Native supported fixture; original source passes attempt.id to SpeedTrainer',results,counts},null,2)+'\n');console.log(counts);if(counts.FAIL)process.exitCode=1;}
