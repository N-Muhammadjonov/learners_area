/** Optional local Chromium smoke suite. All API successes below are ISOLATED FIXTURES,
 * not live integration. npm install --no-save --package-lock=false playwright-core@1.51.1 @sparticuz/chromium@133.0.0
 * Run after build with preview on 4173: node tests/browser.mjs
 */
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
const results=[];const base='http://127.0.0.1:4173';const out=new URL('../docs/evidence/',import.meta.url);fs.mkdirSync(out,{recursive:true});
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});}}
try{
for(const [name,width,height] of [['mobile',390,844],['tablet',768,1024],['desktop',1440,900]]){
 const context=await browser.newContext({viewport:{width,height}});const page=await context.newPage();
 await check(`${name}: entry renders approved branding and six original vector ornaments`,async()=>{await page.goto(base);if(name==='desktop'){await page.waitForSelector('[data-desktop-intro] video');await page.screenshot({path:new URL('desktop-intro.png',out).pathname});await page.locator('video').dispatchEvent('error');}await page.waitForSelector('[data-touch-welcome] h1',{state:'visible',timeout:25000});assert.equal(await page.locator('.la-welcome-chip svg').count(),6);assert.equal(await page.locator('.brand-name').textContent(),'Learners Area');await page.screenshot({path:new URL(`${name}-entry.png`,out).pathname,fullPage:true});});
 await check(`${name}: recovery direct link and reload`,async()=>{await page.goto(base+'/auth/recovery?next=%2Fapp%2Fprofile#form');await page.waitForSelector('input[type=password]');await page.reload();await page.waitForSelector('input[type=email]');assert.equal(new URL(page.url()).hash,'#form');assert(await page.locator('input[type=password]').evaluate(n=>n.required));await page.screenshot({path:new URL(`${name}-recovery-day.png`,out).pathname,fullPage:true});});
 await check(`${name}: failed theme persistence reverts and announces error`,async()=>{await page.locator('[data-theme-option=night]').click();await page.waitForSelector('[data-theme-toggle=day] [role=alert]:not(:empty)');assert.equal(await page.locator('html').getAttribute('data-theme'),'day');});
 await check(`${name}: fixture theme persistence survives reload`,async()=>{await page.route('**/api/theme',async route=>{const {theme}=route.request().postDataJSON();await context.addCookies([{name:'la_theme',value:theme,url:base}]);await route.fulfill({json:{ok:true}});});await page.locator('[data-theme-option=night]').click();await page.waitForSelector('html[data-theme=night]');await page.reload();await page.waitForSelector('html[data-theme=night]');await page.screenshot({path:new URL(`${name}-recovery-night.png`,out).pathname,fullPage:true});});
 await check(`${name}: fixture locale switches visible text`,async()=>{await page.route('**/api/locale',async route=>{await context.addCookies([{name:'la_locale',value:route.request().postDataJSON().locale,url:base}]);await route.fulfill({json:{ok:true}});});await page.locator('button[lang=en]').click();await page.waitForSelector('label[for=email]');await page.waitForFunction(()=>document.querySelector('label[for=email]')?.textContent==='Email');});
 await check(`${name}: backend unavailable cannot report login success`,async()=>{await page.locator('input[type=email]').fill('fixture@example.invalid');await page.locator('input[type=password]').fill('fixture-only-not-a-real-password');await page.locator('button[type=submit]').click();await page.waitForSelector('form [role=alert]:not(:empty)');assert(new URL(page.url()).pathname==='/auth/recovery');assert.equal(await page.locator('button[type=submit]').isDisabled(),false);});
 await check(`${name}: no horizontal page overflow`,async()=>{assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));});
 await context.close();
}
const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
await check('unknown route uses original not-found screen',async()=>{await page.goto(base+'/does-not-exist');await page.waitForSelector('h1');assert.equal(await page.locator('a[href="/app"]').count(),1);});
await check('unconverted exam deep link reports unavailable; no exam payload fetched',async()=>{const privateRequests=[];page.on('request',r=>{if(r.url().includes('/api/'))privateRequests.push(r.url());});await page.goto(base+'/app/listening/tests/1/study');await page.waitForSelector('h1');assert((await page.locator('h1').textContent()).includes('not converted'));assert.equal(privateRequests.length,0);});
await check('private API returns 503 JSON, never fabricated state',async()=>{const r=await page.request.get(base+'/api/auth/state');assert.equal(r.status(),503);assert.deepEqual(await r.json(),{error:'backend_not_connected'});});
await check('documentation and dotfiles are not published',async()=>{for(const p of ['/docs/source-inventory.json','/.env','/package.json'])assert.equal((await page.request.get(base+p)).status(),404);});
await check('missing JavaScript gets 404 instead of HTML',async()=>{assert.equal((await page.request.get(base+'/js/missing.js')).status(),404);});
await check('public intro supports range requests',async()=>{const r=await page.request.get(base+'/brand/Learners_Area_intro_optimized_v17.mp4',{headers:{Range:'bytes=0-31'}});assert.equal(r.status(),206);assert.equal((await r.body()).length,32);});
await context.close();
}finally{await browser.close();}
const report={browser:'Chromium 133 via @sparticuz/chromium; not Safari',date:new Date().toISOString(),apiIntegration:'Isolated fixtures only where named; real backend NOT connected',baselineScreenshots:0,results,counts:{PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length,SKIP:0,BLOCKED:0}};
fs.writeFileSync(new URL('browser-results.json',out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.counts.FAIL)process.exitCode=1;
