import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {dismissDailyReward} from './browser-daily-reward.mjs';

const origin=process.env.ACADEMY_UX_ORIGIN;
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const {tokens,studentId}=JSON.parse(readFileSync(0,'utf8'));
const stage=process.env.ACADEMY_UX_STAGE||'before';
assert.ok(['before','after'].includes(stage));
const directory=resolve('docs/verification/academy-ux',stage);
mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
const results=[];
try {
 for(const role of ['owner','admin','teacher','student','guardian']) {
  for(const theme of ['day','night']) for(const width of [1440,390]) {
   const context=await browser.newContext({viewport:{width,height:width===1440?900:844},serviceWorkers:'block'});
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await context.addCookies([{name:'la_session',value:tokens[role],url:origin,httpOnly:true,sameSite:'Lax'},
    {name:'la_locale',value:'uz',url:origin},{name:'la_theme',value:theme,url:origin}]);
   const page=await context.newPage();page.setDefaultTimeout(15000);
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const path=['owner','admin'].includes(role)?'/app/management/finance':role==='teacher'?'/app/management/guardians':stage==='after'?'/app/payments':'/app/progress';
   const response=await page.goto(origin+path);
   await page.waitForLoadState('networkidle');
   let dailyReward=null;
   if(role!=='guardian'){
    const dialog=page.locator('[data-daily-reward]');await dialog.waitFor();
    assert.equal(await dialog.locator('.daily-reward-day').count(),7);
    dailyReward=await dialog.evaluate(node=>{const r=node.getBoundingClientRect();return {width:r.width,left:r.left,right:r.right,viewport:innerWidth};});
    assert(dailyReward.left>=0&&dailyReward.right<=width,role+' daily receipt fits');
    await page.screenshot({path:resolve(directory,`daily-${role}-${theme}-${width}.png`)});
    await dismissDailyReward(page);
    await page.reload();await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[data-daily-reward]').count(),0,'same-day reload does not reopen receipt');
   }
   const filename=`${role}-${theme}-${width}.png`;
   await page.screenshot({path:resolve(directory,filename),fullPage:true});
   const metrics=await page.evaluate(()=>({title:document.querySelector('main h1')?.textContent,
    overflow:document.documentElement.scrollWidth>innerWidth,headings:[...document.querySelectorAll('main h2')].map(n=>n.textContent),
    unlabeledFields:[...document.querySelectorAll('main input,main select,main textarea')].filter(n=>
     !n.labels?.length&&!n.getAttribute('aria-label')&&!n.getAttribute('aria-labelledby')&&n.type!=='hidden').length}));
   if(role==='student'){
    const data=await (await context.request.get(origin+'/api/finance/me')).json();
    assert.equal(data.position.balanceDueMinor,800000);
   }
   if(['owner','admin'].includes(role)){
    metrics.fields=await page.locator('main .input').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>{
     const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {type:n.type,width:r.width,height:r.height,left:r.left,right:r.right,background:s.backgroundColor,color:s.color,border:s.borderTopWidth};
    }));
    assert(metrics.fields.length>0);
    for(const field of metrics.fields){assert(field.width>=96&&field.height>=44,JSON.stringify({role,width,field}));assert(field.left>=0&&field.right<=width,JSON.stringify(field));assert.notEqual(field.background,'rgba(0, 0, 0, 0)');}
   }
   const actualPath=new URL(page.url()).pathname;
   if(role==='owner'&&width===1440){
    await page.goto(origin+'/app/admin/statistics');
    await page.locator('[data-result-module="reading"]').click();
    await page.locator('[data-centre-result-history] h2').filter({hasText:'Reading'}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('module'),'reading');
    await page.screenshot({path:resolve(directory,`statistics-${theme}.png`)});
   }
   results.push({role,theme,width,path,responseStatus:response.status(),actualPath,screenshot:filename,errors,dailyReward,...metrics});
   await context.close();
  }
 }
 writeFileSync(resolve(directory,'receipt.json'),JSON.stringify({stage,sourceCommit:process.env.ACADEMY_UX_SOURCE_SHA??null,source:'isolated PostgreSQL and real FastAPI; synthetic fixtures',studentId,results},null,2)+'\n');
 if(stage==='after')for(const row of results){
  const scope=`${row.role}/${row.theme}/${row.width}`;
  assert.equal(row.responseStatus,200,scope+' document response');
  assert.equal(row.actualPath,row.path,scope+' permitted route');
  assert.deepEqual(row.errors,[],scope+' page errors');
  assert.equal(row.overflow,false,scope+' horizontal reflow');
  assert.equal(row.unlabeledFields,0,scope+' field labels');
 }
 console.log(JSON.stringify({stage,screenshots:results.length,pageErrors:results.flatMap(r=>r.errors),overflow:results.filter(r=>r.overflow).map(r=>`${r.role}:${r.theme}:${r.width}`)}));
} finally {await browser.close();}
