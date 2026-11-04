import test from 'node:test';
import assert from 'node:assert/strict';
import {withDockBrowser,frames,shellFixture} from './helpers/dock-browser.mjs';

test('hover grows icons to 1.1 and shows a glass pointer label with both motion preferences',async()=>{
 await withDockBrowser(async(browser,origin)=>{
  for(const reducedMotion of ['reduce','no-preference']){
   const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion}),page=await context.newPage();
   try{
    await page.goto(origin+'/dock-fixture');await page.waitForFunction(()=>window.fixtureDock);await frames(page);
    const item=page.locator('[data-dock-module="speaking"]'),icon=item.locator('.module-dock__icon');
    const before=await icon.boundingBox();await item.hover();
    await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('[data-dock-module="speaking"] .module-dock__icon')).transform).a>=1.099);
    const after=await icon.boundingBox();assert(Math.abs(after.width/before.width-1.1)<.02);
    const label=page.locator('.module-dock__label');assert.equal(await label.textContent(),'Speaking');assert(await label.isVisible());
    const style=await label.evaluate(node=>{const arrow=getComputedStyle(node,'::after');return {radius:getComputedStyle(node).borderRadius,border:getComputedStyle(node).borderTopColor,arrow:arrow.content,arrowTop:parseFloat(arrow.top),height:node.clientHeight,clip:arrow.clipPath,rotation:new DOMMatrix(arrow.transform).b};});
    assert.equal(style.radius,'13px');assert.notEqual(style.border,'rgb(0, 218, 83)');assert.equal(style.arrow,'""');
    assert(style.arrowTop>=style.height);assert.equal(style.rotation,0);assert.match(style.clip,/polygon/);
    await page.mouse.move(1,1);await page.waitForFunction(()=>document.querySelector('.module-dock__label').hidden);
   }finally{await context.close();}
  }
 });
});

test('real SPA Dock clicks animate the viewport, including cached routes, with either motion preference',async()=>{
 await withDockBrowser(async(browser,origin)=>{
  for(const reducedMotion of ['reduce','no-preference']){
   const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion}),page=await context.newPage();
   try{
    await page.goto(origin+'/app');await page.waitForFunction(()=>window.fixtureReady);
    for(const key of ['progress','dashboard','progress']){
     const item=page.locator('[data-dock-module="'+key+'"]');await item.hover();
     await page.waitForFunction(key=>new DOMMatrix(getComputedStyle(document.querySelector('[data-dock-module="'+key+'"] .module-dock__icon')).transform).a>=1.099,key);
     const source=await item.locator('.module-dock__icon').boundingBox();await item.click();
     await page.waitForFunction(()=>document.querySelector('[data-shell-main]')?.getAnimations().some(a=>a.id==='dock-genie'));
     const sample=await page.evaluate(()=>{
      const main=document.querySelector('[data-shell-main]'),animation=main.getAnimations().find(a=>a.id==='dock-genie');
      animation.pause();animation.currentTime=0;const seed=main.getBoundingClientRect().toJSON();animation.currentTime=180;const raised=main.getBoundingClientRect().toJSON();animation.play();
      return {height:main.getBoundingClientRect().height,seed,raised,frames:animation.effect.getKeyframes(),duration:animation.effect.getTiming().duration};
     });
     assert(sample.height>0);assert.equal(sample.duration,520);assert(sample.frames.every(frame=>frame.clipPath.startsWith('polygon(')));
     for(const edge of ['x','y','width','height'])assert(Math.abs(sample.seed[edge]-source[edge])<2,`${key}: opening ${edge} must start at the clicked icon`);
     assert(sample.raised.y<source.y-20,'window must grow upward from the icon');
     assert.notEqual(sample.frames[1].clipPath,sample.frames.at(-1).clipPath);
     await page.evaluate(()=>document.querySelector('[data-shell-main]').getAnimations().find(a=>a.id==='dock-genie')?.finished);
    }
    assert.deepEqual(await page.evaluate(()=>fixtureErrors),[]);
   }finally{await context.close();}
  }
 },{'/app':shellFixture});
});

test('glass stays close above and below icons while hover remains unclipped',async()=>{
 await withDockBrowser(async(browser,origin)=>{
  for(const width of [390,768,1440]){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
   try{
    await page.goto(origin+'/dock-fixture');await page.waitForFunction(()=>window.fixtureDock);await frames(page);
    const m=await page.evaluate(()=>{
     const dock=document.querySelector('[data-module-dock]'),nav=dock.querySelector('nav'),icon=dock.querySelector('.module-dock__icon');
     const d=dock.getBoundingClientRect(),i=icon.getBoundingClientRect(),height=parseFloat(getComputedStyle(dock,'::before').height);
     return {height,icon:i.height,above:i.top-(d.bottom-height),below:d.bottom-i.bottom,navTop:nav.getBoundingClientRect().top};
    });
    assert(Math.abs(m.height-m.icon-18)<1);assert(m.above>=3&&m.above<=6);assert(m.below<=15);
    if(width===1440){await page.locator('[data-dock-module="speaking"]').hover();await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('[data-dock-module="speaking"] .module-dock__icon')).transform).a>=1.099);const b=await page.locator('[data-dock-module="speaking"] .module-dock__icon').boundingBox();assert(b.y>=m.navTop);}
   }finally{await context.close();}
  }
 });
});

test('study tools stay above Dock, Focus matches other actions and its active badge sits above the launcher',async()=>{
 await withDockBrowser(async(browser,origin)=>{
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  try{
   await page.goto(origin+'/app');await page.waitForFunction(()=>window.fixtureReady);await page.locator('[data-dock-module="writing"]').click();await page.waitForFunction(()=>location.pathname==='/app/writing');
   const launcher=page.locator('[data-utilities-launcher]');
   const front=await launcher.evaluate(node=>{const b=node.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('[data-utilities-launcher]')===node;});assert(front);
   await launcher.click();
   const focus=page.locator('[data-focus-toggle]'),coach=page.locator('[data-coach-fab]');
   const f=await focus.evaluate(node=>({height:node.getBoundingClientRect().height,bg:getComputedStyle(node).backgroundImage})),c=await coach.evaluate(node=>({height:node.getBoundingClientRect().height,bg:getComputedStyle(node).backgroundImage}));
   assert(Math.abs(f.height-c.height)<2);assert.equal(f.bg,c.bg);
   await focus.click();await page.waitForFunction(()=>document.documentElement.dataset.studyFocus==='on');
   const label=page.locator('[data-focus-indicator]');assert.equal(await label.textContent(),'Focus');assert((await label.boundingBox()).y<(await launcher.boundingBox()).y);
   assert(await page.locator('[data-module-dock]').isHidden());
   await launcher.click();assert.equal(await focus.getAttribute('aria-pressed'),'true');
   await page.evaluate(()=>{const panel=document.createElement('section');panel.dataset.routeUsable='coach';const button=document.createElement('button');button.className='btn-primary';button.textContent='Boshlash';panel.append(button);document.querySelector('[data-shell-main]').append(panel);window.fixtureStart=button;});
   for(const theme of ['day','night']){
    await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
    const palette=await page.evaluate(()=>{const start=getComputedStyle(fixtureStart),focus=getComputedStyle(document.querySelector('[data-focus-toggle]')),badge=getComputedStyle(document.querySelector('[data-focus-indicator]'));return {start:start.backgroundImage,text:start.color,focus:focus.backgroundImage,focusText:focus.color,badge:badge.backgroundImage};});
    assert.equal(palette.focus,palette.start);assert.equal(palette.focusText,palette.text);assert.equal(palette.badge,palette.start);
   }
   await page.keyboard.press('f');await page.waitForFunction(()=>document.documentElement.dataset.studyFocus==='off');assert.equal(await page.locator('[data-focus-indicator]').count(),0);
  }finally{await context.close();}
 },{'/app':shellFixture});
});

test('every Dock module has distinct complete artwork with unique SVG resources',async()=>{
 await withDockBrowser(async(browser,origin)=>{
  const context=await browser.newContext({viewport:{width:1680,height:700}}),page=await context.newPage();
  try{
   await page.goto(origin+'/dock-fixture');await page.waitForFunction(()=>window.fixtureDock);await frames(page);
   const artwork=await page.evaluate(()=>[...document.querySelectorAll('[data-dock-module]')].map(a=>({key:a.dataset.dockModule,art:a.querySelector('svg')?.dataset.dockArtwork,label:a.getAttribute('aria-label')})));
   assert.equal(artwork.length,14);assert(artwork.every(a=>a.key===a.art&&a.label));
   assert(!artwork.some(a=>['courses','coach','reports'].includes(a.key)));
   const ids=await page.evaluate(()=>[...document.querySelectorAll('[data-module-dock] [id]')].map(n=>n.id));assert.equal(new Set(ids).size,ids.length);
   await page.locator('[data-module-dock]').screenshot({path:'/tmp/la-premium-dock.png'});
  }finally{await context.close();}
 });
});
