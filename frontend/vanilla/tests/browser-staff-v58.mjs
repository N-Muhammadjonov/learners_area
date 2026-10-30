/** V58 Management (staff) browser checks against SYNTHETIC `/api/frontend/staff/*` DTOs. The live read endpoints are
 * NOT verified; these checks prove the frontend fails closed and renders honest states only. Covers: role redirects,
 * statistics (real zero-start rate shows an em dash, 500 retry, invalid DTO fails closed, 401 -> login), owner-only
 * two-step permanent deletion (cancel, wrong label, exact label, 409 blocked with no automatic retry). Old V55 header below.
 */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {publicPolicy, fixtureSession} from './fixtures.mjs';
import en from '../js/i18n/en.js';
import uz from '../js/i18n/uz.js';

const deps = path.resolve(import.meta.dirname, '../node_modules');
if (process.platform === 'linux') {
  const tar = path.join(deps, 'al2023.tar');
  fs.writeFileSync(tar, brotliDecompressSync(fs.readFileSync(path.join(deps, '@sparticuz/chromium/bin/al2023.tar.br'))));
  execFileSync('tar', ['xf', tar, '-C', deps]);
  process.env.LD_LIBRARY_PATH = path.join(deps, 'lib') + ':' + (process.env.LD_LIBRARY_PATH ?? '');
}
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(a => !a.includes('single-process') && !a.includes('disable-web-security') && !a.includes('allow-running-insecure-content')),
  headless: true,
});
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173';
const out = new URL('../docs/evidence/v58/', import.meta.url);
const shots = '/tmp/shots-staff58';
fs.mkdirSync(out, {recursive: true});
fs.mkdirSync(shots, {recursive: true});
const results = [];
async function check(name, fn) {
  if (process.env.TEST_FILTER && !name.includes(process.env.TEST_FILTER)) return;
  try { await fn(); results.push({name, status: 'PASS'}); console.log('PASS', name); }
  catch (e) { results.push({name, status: 'FAIL', error: String(e.message).slice(0, 700)}); console.error('FAIL', name, String(e.message).slice(0, 700)); }
}


const ID1='00000000-0000-4000-8000-000000000001';
const MODULES=['reading','listening','writing','speaking','retention','vocabulary','grammar','video','lessons','mocks'];
const zeroSummary=MODULES.map(module=>({module,started:0,completed:0,learners:0,accuracy:null,band:null,latest:null}));
const statsDTO=(summary=zeroSummary)=>({version:1,kind:'centre-statistics',data:{summary,selected:null,daily:[],students:[],levels:[]}});
const retentionDTO=()=>({version:1,kind:'reading-retention',data:{inventory:[{level:'B1',activeCount:1,target:5,remainingToTarget:4,lifetimeUses:0,archivedCount:0}],level:'B1',filter:'all',sort:'label',bank:{page:1,pageCount:1,total:1,rows:[{textId:ID1,internalLabel:'Synthetic passage A',level:'B1',active:true,preview:'',wordCount:120,versionNumber:1,currentVersionUses:0,lifetimeUses:0,updatedAt:'2026-10-01T00:00:00Z'}]}}});

async function fixture({locale='en',theme='day',width=1440,role='admin',staff=null}={}){
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.addCookies([{name:'la_locale',value:locale,url:base},{name:'la_theme',value:theme,url:base}]);
  const page=await context.newPage();page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',e=>errors.push(String(e.message)));
  const state={staffCalls:[],writes:[],deletes:[],staff,role};
  await context.route('**/api/**',async route=>{
    const r=route.request(),u=new URL(r.url()),p=u.pathname;
    if(r.method()!=='GET'&&!p.startsWith('/api/frontend/'))state.writes.push({method:r.method(),path:p});
    const reply=(status,json)=>route.fulfill({status,json});
    if(p==='/api/frontend/public')return reply(200,publicPolicy);
    if(p==='/api/frontend/session')return reply(200,fixtureSession(state.role));
    if(p==='/api/notifications')return reply(200,{notifications:[],unread:0});
    if(p.startsWith('/api/frontend/staff/')){
      const kind=p.slice('/api/frontend/staff/'.length);state.staffCalls.push(kind);
      const spec=typeof state.staff==='function'?state.staff(kind,u):state.staff;
      if(!spec)return reply(404,{error:'not_found'});
      if(spec.status)return reply(spec.status,{error:'staff_error'});
      return reply(200,spec.json);
    }
    if(r.method()==='DELETE'&&p.startsWith('/api/admin/retention/texts/')){
      const body=JSON.parse(r.postData()??'{}');state.deletes.push({path:p,body});
      if(state.deleteStatus===409)return reply(409,{error:'retention_text_in_use'});
      return reply(200,{ok:true});
    }
    return reply(404,{error:'not_found'});
  });
  return {context,page,errors,state,close:()=>context.close()};
}
const alertText=page=>page.locator('[role="alert"], [data-integration-required]').first().textContent({timeout:8000});

const tests=[];
// ---- role guard (presentation only; the server stays authoritative) ----
tests.push(['role: student /app/management redirects to /app',async()=>{const f=await fixture({role:'student'});await f.page.goto(base+'/app/management');await f.page.waitForURL(u=>new URL(u).pathname==='/app',{timeout:8000});assert.equal(f.state.staffCalls.length,0);await f.close();}]);
tests.push(['role: teacher /app/admin/statistics redirects to /app and loads no statistics',async()=>{const f=await fixture({role:'teacher',staff:()=>({json:statsDTO()})});await f.page.goto(base+'/app/admin/statistics');await f.page.waitForURL(u=>new URL(u).pathname==='/app',{timeout:8000});assert.equal(f.state.staffCalls.filter(k=>k==='centre-statistics').length,0);await f.close();}]);
tests.push(['role: admin /app/owner/retention redirects to /app',async()=>{const f=await fixture({role:'admin'});await f.page.goto(base+'/app/owner/retention');await f.page.waitForURL(u=>new URL(u).pathname==='/app',{timeout:8000});await f.close();}]);
// ---- statistics: real-only states ----
for(const locale of ['en','uz'])for(const theme of ['day','night'])for(const width of [390,1440])
tests.push([`statistics zero-start: rate is an em dash, not 0% (${locale}/${theme}/${width})`,async()=>{
  const f=await fixture({locale,theme,width,staff:()=>({json:statsDTO()})});await f.page.goto(base+'/app/admin/statistics');
  await f.page.locator('[data-management-statistics]').waitFor();
  const cards=await f.page.locator('[data-result-module]').allTextContents();
  assert.equal(cards.length,10);
  for(const c of cards){assert.ok(!/\b0%/.test(c),'fabricated 0% rate: '+c);assert.ok(c.includes('—'),'missing em dash: '+c);}
  const overflow=await f.page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);
  assert.equal(overflow,false,'horizontal overflow');
  assert.deepEqual(f.errors,[]);await f.close();}]);
tests.push(['statistics 500: integration-required notice with retry, no statistics rendered',async()=>{const f=await fixture({staff:{status:500}});await f.page.goto(base+'/app/admin/statistics');await f.page.locator('[data-integration-required="management-statistics"]').waitFor();assert.equal(await f.page.locator('[data-management-statistics]').count(),0);assert.ok(await f.page.locator('[data-integration-required] button').count()>0,'retry button');await f.close();}]);
tests.push(['statistics invalid DTO (version 2) fails closed, no zeros rendered',async()=>{const f=await fixture({staff:{json:{version:2,kind:'centre-statistics',data:{}}}});await f.page.goto(base+'/app/admin/statistics');await f.page.locator('[data-integration-required="management-statistics"]').waitFor();assert.equal(await f.page.locator('[data-management-statistics]').count(),0);await f.close();}]);
tests.push(['statistics 401: session ends, redirect to /login',async()=>{const f=await fixture({staff:{status:401}});await f.page.goto(base+'/app/admin/statistics');await f.page.waitForURL(u=>new URL(u).pathname==='/login',{timeout:8000});await f.close();}]);
// ---- owner-only two-step permanent deletion ----
async function openRetentionDelete(f){
  await f.page.goto(base+'/app/admin/reading/retention');
  await f.page.locator('[data-retention-row]').first().waitFor();
  await f.page.locator('[data-retention-row] button').last().click();
  const item=f.page.locator('[data-retention-delete]');await item.waitFor({timeout:4000});return item;
}
tests.push(['owner delete: the menu item is labelled "Delete permanently" (EN)',async()=>{const f=await fixture({role:'owner',staff:(k)=>k==='reading-retention'?{json:retentionDTO()}:{json:{version:1,kind:k,data:{}}}});const item=await openRetentionDelete(f);assert.equal((await item.textContent()).trim(),'Delete permanently');await f.close();}]);
tests.push(['owner delete: cancelling the first confirm sends no DELETE',async()=>{const f=await fixture({role:'owner',staff:(k)=>k==='reading-retention'?{json:retentionDTO()}:{json:{version:1,kind:k,data:{}}}});f.page.on('dialog',d=>d.dismiss());const item=await openRetentionDelete(f);await item.click();await f.page.waitForTimeout(400);assert.equal(f.state.deletes.length,0);await f.close();}]);
tests.push(['owner delete: wrong label sends no DELETE; exact label sends one DELETE with expectedLabel',async()=>{const f=await fixture({role:'owner',staff:(k)=>k==='reading-retention'?{json:retentionDTO()}:{json:{version:1,kind:k,data:{}}}});let step=0;const answers=['Wrong label','Synthetic passage A'];
  f.page.on('dialog',async d=>{if(d.type()==='confirm')await d.accept();else await d.accept(answers[step++]);});
  const item=await openRetentionDelete(f);await item.click();await f.page.waitForTimeout(500);assert.equal(f.state.deletes.length,0,'wrong label must not delete');
  await openRetentionDelete(f).then(i=>i.click());await f.page.waitForTimeout(600);
  assert.equal(f.state.deletes.length,1,'exact label must delete once');assert.deepEqual(f.state.deletes[0].body,{expectedLabel:'Synthetic passage A'});await f.close();}]);
tests.push(['owner delete: 409 shows the blocked notice and is NOT retried automatically',async()=>{const f=await fixture({role:'owner',staff:(k)=>k==='reading-retention'?{json:retentionDTO()}:{json:{version:1,kind:k,data:{}}}});f.state.deleteStatus=409;f.page.on('dialog',async d=>{await d.accept(d.type()==='prompt'?'Synthetic passage A':undefined);});
  const item=await openRetentionDelete(f);await item.click();await f.page.waitForTimeout(800);
  assert.equal(f.state.deletes.length,1,'409 must not be retried');
  const text=await f.page.locator('body').textContent();assert.ok(text.includes('still using this text'),'blocked notice');await f.close();}]);

// ---- run ----
for(const [name,fn] of tests)await check(name,fn);
await browser.close();
const pass=results.filter(r=>r.status==='PASS').length,fail=results.length-pass;
fs.writeFileSync(new URL('browser-staff-v58-results.json',out),JSON.stringify({pass,fail,results},null,2));
console.log(JSON.stringify({PASS:pass,FAIL:fail}));
process.exit(fail?1:0);
