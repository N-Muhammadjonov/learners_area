import assert from 'node:assert/strict';import fs from 'node:fs';
export async function run({check,originalFixture,target,open,submitted,variant}){
 await check('V26 native authorized vocabulary modal confines focus and restores background on dismissal',async()=>{
  const {context,page}=await originalFixture({initial:submitted(),handler:async({route,path,u})=>{
   if(path==='/api/vocabulary/meaning'){await route.fulfill({json:{status:'unresolved',contextual:null}});return true;}
   if(path.endsWith('/authored')&&u.searchParams.has('vocabulary')){await route.fulfill({json:{vocabulary:[{term:'candidate',senseId:'00000000-0000-4000-8000-000000000011',definitionEn:'Authorized fixture meaning',translationUz:null}]}});return true;}
   if(path==='/api/vocabulary/folders'){await route.fulfill({json:{folders:[]}});return true;}return false;
  }});
  try{await page.addInitScript(()=>addEventListener('message',e=>{if(e.data?.token)window.__v26token=e.data.token;}));await page.goto(target);await open(page,'review');await page.frameLocator('iframe').locator('body:not([inert])').waitFor();const token=await page.evaluate(()=>window.__v26token);
   await page.frameLocator('iframe').locator('body').evaluate((_,token)=>parent.postMessage({channel:'learners-area-authored-v1',token,op:'word',mode:'vocab',word:'candidate',x:1,y:1},'*'),token);
   const modal=page.getByRole('dialog');await modal.getByText('Authorized fixture meaning',{exact:true}).waitFor();
   assert.equal(await modal.evaluate(n=>{document.querySelector('iframe').focus();return n.contains(document.activeElement);}),true,'iframe must not receive focus behind an active modal');
   await page.keyboard.press('Tab');assert.equal(await modal.evaluate(n=>n.contains(document.activeElement)),true);await page.keyboard.press('Shift+Tab');assert.equal(await modal.evaluate(n=>n.contains(document.activeElement)),true);
   await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});assert.equal(await page.locator('iframe').evaluate(n=>!n.inert&&document.activeElement===n),true);assert.equal(await page.locator('body').evaluate(n=>!n.querySelector('[inert]')),true);
   const cdp=await context.newCDPSession(page);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));await cdp.send('HeapProfiler.collectGarbage');const baseline=await cdp.send('Memory.getDOMCounters'),samples=[];
   for(let cycle=0;cycle<24;cycle++){
    await page.frameLocator('iframe').locator('body').evaluate((_,token)=>parent.postMessage({channel:'learners-area-authored-v1',token,op:'word',mode:'vocab',word:'candidate',x:1,y:1},'*'),token);await modal.waitFor();await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));await cdp.send('HeapProfiler.collectGarbage');const counts=await cdp.send('Memory.getDOMCounters');samples.push(counts);
    assert.equal(counts.documents,baseline.documents);assert(counts.jsEventListeners<=baseline.jsEventListeners);assert(counts.nodes<=baseline.nodes+50);assert.equal(await page.locator('body').evaluate(n=>!n.querySelector('[inert]')),true);
   }
   fs.writeFileSync(new URL('../docs/evidence/v26/modal-resources.json',import.meta.url),JSON.stringify({scope:'24 native authorized vocabulary modal cycles, frame/GC comparable settlement; no heap/native-timer or infinite stability claim',baseline,samples},null,2));
  }finally{await context.close();}
 });
 await check('V26 actual catalogue source '+variant+' four-part Check transcript Retry and keyboard navigation',async()=>{
  const {context,page}=await originalFixture({initial:submitted()});
  const ready=async()=>{await page.frameLocator('iframe').locator('body:not([inert])').waitFor();await page.locator('[data-review-authority],[data-review-navigation]').waitFor({state:'detached'});};
  const errors=[];page.on('pageerror',e=>errors.push(e.message));try{await page.goto(target);await open(page,'review');await ready();const f=page.frameLocator('iframe');
   for(let part=1;part<=4;part++){
    if(part!==1){await f.locator('[data-rpart="'+part+'"]').click();await ready();}
    console.log('VARIANT_STAGE',variant,part,await f.locator('body').evaluate(()=>({active:document.querySelector('.activity.active')?.id,part:typeof reviewPart==='undefined'?null:reviewPart,render:typeof renderReview,tabs:document.querySelector('#reviewTabs')?.childElementCount,html:document.querySelector('#reviewHost')?.childElementCount,button:document.querySelector('#hub [data-open=review]')?.disabled}))); assert.equal(await f.locator('[data-rpart="'+part+'"]').getAttribute('aria-selected'),'true');
    assert(await f.locator('.review-card').count()>0);const input=f.locator('[data-review-input]').first();if(await input.count())await input.fill('own response '.repeat(100));
    await f.locator('#checkReviewPart').press('Enter');await ready();await f.locator('#retryReviewPart').waitFor();
    await f.locator('[data-review-transcript] summary').press('Enter');await ready();await f.locator('[data-review-transcript][open]').waitFor();
    await f.locator('[data-review-transcript] .transcript').press('Escape');await f.locator('[data-review-transcript]:not([open])').waitFor();
    await f.locator('#retryReviewPart').press('Space');await ready();await f.locator('#checkReviewPart').waitFor();assert.equal(await f.locator('[data-review-transcript]').count(),0);
   }
   await f.locator('[data-rpart="4"]').press('Home');await ready();assert.equal(await f.locator('[data-rpart="1"]').getAttribute('aria-selected'),'true');
   await f.locator('[data-rpart="1"]').press('End');await ready();assert.equal(await f.locator('[data-rpart="4"]').getAttribute('aria-selected'),'true');
   assert.equal(await f.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }finally{console.log('VARIANT_ERRORS',variant,JSON.stringify(errors));await context.close();}
 });

 await check('V26 modal held folders canonical retake disposes isolation and fences late continuation',async()=>{
  let release,replace;const held=new Promise(r=>release=r);const {context,page,state}=await originalFixture({initial:submitted(),handler:async({route,path,u,setValues})=>{replace=setValues;
   if(path==='/api/vocabulary/meaning'){await route.fulfill({json:{status:'unresolved',contextual:null}});return true;}
   if(path.endsWith('/authored')&&u.searchParams.has('vocabulary')){await route.fulfill({json:{vocabulary:[{term:'candidate',senseId:'00000000-0000-4000-8000-000000000011',definitionEn:'Authorized fixture meaning',translationUz:null}]}});return true;}
   if(path==='/api/vocabulary/folders'){await held;try{await route.fulfill({json:{folders:[]}});}catch{}return true;}return false;
  }});
  try{await page.addInitScript(()=>addEventListener('message',e=>{if(e.data?.token)window.__v26token=e.data.token;}));await page.goto(target);await open(page,'review');await page.frameLocator('iframe').locator('body:not([inert])').waitFor();const token=await page.evaluate(()=>window.__v26token);
   await page.frameLocator('iframe').locator('body').evaluate((_,token)=>parent.postMessage({channel:'learners-area-authored-v1',token,op:'word',mode:'vocab',word:'candidate',x:1,y:1},'*'),token);await page.getByRole('dialog').waitFor();
   const next=submitted();for(const k of Object.keys(next)){const own=JSON.parse(next[k]);own.attemptKey='00000000-0000-4000-8000-000000000099';next[k]=JSON.stringify(own);}replace(next);await page.evaluate(()=>dispatchEvent(new Event('learners-area:authority-hint')));
   await page.getByRole('dialog').waitFor({state:'detached'});await page.locator('iframe').waitFor({state:'detached'});release();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
   assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('body').evaluate(n=>!n.inert&&!n.querySelector('nav[inert],main[inert]')),true);assert.equal(state.requests.filter(r=>r.body&&r.path==='/api/vocabulary').length,0);
  }finally{release();await context.close();}
 });

}
