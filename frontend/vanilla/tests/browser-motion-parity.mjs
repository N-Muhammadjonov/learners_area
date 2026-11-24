import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {fixtureSession,publicPolicy,testId,viewFixture} from './fixtures.mjs';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const origin='http://learners-area-fixture.local';
const catalog='/app/listening/tests';
const testUrl='/app/listening/tests/'+testId;
const kinds=['grammar','reading','listening','writing','speaking','vocabulary'];
const sequence={state:'active',totalDays:30,currentDay:1,completedDays:0,today:'2026-11-01',
 days:Array.from({length:30},(_,i)=>({
  day:i+1,date:'2026-11-'+String(i+1).padStart(2,'0'),status:i?'locked':'active',minutes:120,
  tasks:kinds.map((kind,slot)=>({kind,slot,title:'Fixture '+kind,minutes:20,
   status:i?'locked':'ready',href:i?null:'/app/'+kind})),
 }))};

const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined});
async function compareState(theme,width,preference){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,reducedMotion:preference,
  serviceWorkers:'block'});
 try{
  await context.addCookies([{name:'la_locale',value:'en',url:origin},{name:'la_theme',value:theme,url:origin}]);
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url()),p=url.pathname;
   if(url.origin!==origin)return route.abort();
   if(p==='/api/frontend/public')return route.fulfill({json:publicPolicy});
   if(p==='/api/frontend/session')return route.fulfill({json:fixtureSession()});
   if(p==='/api/frontend/view'){
    const key=url.searchParams.get('route');
    const data=key===testUrl?{kind:'locked'}:viewFixture(key.split('?')[0]);
    return route.fulfill({json:{version:1,route:key,region:url.searchParams.get('region')??undefined,data}});
   }
   if(p==='/api/study-plan/monthly/sequence')return route.fulfill({json:sequence});
   if(p==='/api/auth/state')return route.fulfill({json:{ok:true,role:'student',accountStatus:'active',expiresAt:Math.floor(Date.now()/1000)+3600}});
   if(p==='/api/notifications')return route.fulfill({json:{notifications:[],unread:0}});
   if(p.startsWith('/api/'))return route.fulfill({status:503,json:{error:'fixture_not_configured'}});
   const name=p==='/'||p==='/app'||p.startsWith('/app/')?'index.html':p.slice(1);
   const file=path.resolve(root,name);
   if(!file.startsWith(root+path.sep)||!await fs.stat(file).then(stat=>stat.isFile(),()=>false))return route.fulfill({status:404});
   return route.fulfill({path:file});
  });
  const page=await context.newPage();
  page.setDefaultTimeout(12000);
  const css=(selector,properties)=>page.locator(selector).first().evaluate((element,props)=>{
   const style=getComputedStyle(element);
   return Object.fromEntries(props.map(prop=>[prop,style.getPropertyValue(prop)]));
  },properties);
  await page.goto(origin+'/app');
  assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),preference==='reduce');
  assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
  const companion={};
  for(const [part,animation] of Object.entries({body:'sway',eyes:'blink',gaze:'look'})){
   const selector='.la-dashboard-companion .fluency-companion-'+part;
   await page.waitForFunction(({selector,animation})=>document.querySelector(selector)&&
    getComputedStyle(document.querySelector(selector)).animationName==='sequence-mascot-'+animation,{selector,animation});
   companion[part]=await css(selector,['animation-name','animation-duration','display','visibility']);
  }
  const dock=page.locator('[data-module-dock]');
  const dockListening=dock.locator('[data-dock-module="listening"]');
  await dockListening.scrollIntoViewIfNeeded();
  if(width!==390){
   await dockListening.hover();
   await dock.locator('.module-dock__label').waitFor({state:'visible'});
  }
  // Browser decode also catches WebP serving and case-sensitive path regressions.
  assert.deepEqual(await page.evaluate(async()=>{
   const image=new Image();
   image.src='/images/dock/neon/leaderboard.webp';
   await image.decode();
   return [image.naturalWidth,image.naturalHeight];
  }),[104,104]);
  const dockStyle=await css('[data-dock-module="listening"] .module-dock__icon',['transition-duration','display']);
  const scrollable=await dock.locator('nav').evaluate(node=>node.scrollWidth>node.clientWidth);
  if(width===390)assert(scrollable);
  if(width===390)await dockListening.tap();else await dockListening.click();
  await page.waitForURL(origin+catalog);
  await page.locator('[data-listening-test-count]').waitFor();
  await dock.locator('[data-dock-module="listening"][aria-current="page"]').waitFor();
  await page.keyboard.press('f');
  await dock.waitFor({state:'hidden'});
  assert.equal(await page.locator('html').getAttribute('data-study-focus'),'on');
  await page.keyboard.press('f');
  await dock.waitFor({state:'visible'});
  assert.equal(await page.locator('html').getAttribute('data-study-focus'),'off');
  await page.goto(origin+'/app/assignments');
  const day=page.locator('[data-sequence-day="1"]');
  await page.waitForFunction(()=>document.querySelector('link[data-study-sequence-css]')?.sheet);
  await day.waitFor();
  const calendar=await css('[data-sequence-day="1"]',['transition-duration','transition-property','display','visibility']);
  assert(calendar['transition-duration'].split(',').some(duration=>parseFloat(duration)>0));
  await day.click();
  assert.equal(await day.getAttribute('aria-pressed'),'true');
  await page.goto(origin+testUrl);
  const back=page.locator('[data-listening-parent-back]');
  await back.waitFor();
  await page.locator('[data-listening-sequence-locked]').waitFor();
  await dock.waitFor({state:'hidden'});
  await page.keyboard.press('f');
  await dock.waitFor({state:'hidden'});
  const examBack=await back.getAttribute('href');
  assert.equal(examBack,'/app/listening/tests');
  await back.click();
  await page.waitForURL(origin+examBack);
  return {companion,dockStyle,calendar,examBack,scrollable};
 }finally{await context.close();}
}

try{
 for(const theme of ['day','night'])for(const width of [1440,390]){
  console.log(`Comparing ${theme} at ${width}px`);
  const normal=await compareState(theme,width,'no-preference');
  const reduced=await compareState(theme,width,'reduce');
  assert.deepEqual(reduced,normal,`${theme} ${width}px`);
  console.log(JSON.stringify({theme,width,...normal}));
 }
}finally{await browser.close();}
