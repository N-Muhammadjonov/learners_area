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

test('Dock opens a warped, edged window above the previous page, including cached routes and either motion preference',async()=>{
 await withDockBrowser(async(browser,origin)=>{
  for(const reducedMotion of ['reduce','no-preference']){
   const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion}),page=await context.newPage();
   try{
    await page.goto(origin+'/app');await page.waitForFunction(()=>window.fixtureReady);
    if(reducedMotion==='no-preference')await page.evaluate(()=>document.documentElement.dataset.theme='night');
    for(const key of ['progress','dashboard','progress']){
     const item=page.locator('[data-dock-module="'+key+'"]');await item.hover();
     await page.waitForFunction(key=>new DOMMatrix(getComputedStyle(document.querySelector('[data-dock-module="'+key+'"] .module-dock__icon')).transform).a>=1.099,key);
     const outgoing=await page.locator('#main-content [data-fixture-page]').getAttribute('data-fixture-page');
     const source=await item.locator('.module-dock__icon').boundingBox();await item.click();
     await page.waitForFunction(()=>document.querySelector('[data-dock-workspace]')?.getAnimations().some(a=>a.id==='dock-genie'));
     await page.evaluate(()=>{const a=document.querySelector('[data-dock-workspace]').getAnimations().find(a=>a.id==='dock-genie');a.pause();a.currentTime=0;});await frames(page);
     const seed=await page.locator('.dock-opening-outline path').evaluate(node=>node.getBoundingClientRect().toJSON());
     for(const edge of ['x','y','width','height'])assert(Math.abs(seed[edge]-source[edge])<2,`${key}: opening ${edge} starts at the clicked artwork (${JSON.stringify({seed,source})})`);
     assert.equal(await page.locator('[data-dock-previous] [data-fixture-page]').getAttribute('data-fixture-page'),outgoing);
     await page.evaluate(()=>{document.querySelector('[data-dock-workspace]').getAnimations().find(a=>a.id==='dock-genie').currentTime=300;});await frames(page);
     const sample=await page.evaluate(()=>{
      const window=document.querySelector('[data-dock-window]'),bands=[...window.querySelectorAll('.dock-opening-band')],live=document.querySelector('[data-dock-workspace]');
      return {edge:window.querySelector('.dock-opening-outline path').getBoundingClientRect().toJSON(),top:bands[0].getBoundingClientRect().width,bottom:bands.at(-1).getBoundingClientRect().width,filter:getComputedStyle(window).filter,stroke:getComputedStyle(window.querySelector('.dock-opening-outline path')).stroke,fill:getComputedStyle(window.querySelector('.dock-opening-outline path')).fill,previous:!!document.querySelector('[data-dock-previous]'),hidden:getComputedStyle(live).opacity,inert:document.querySelector('[data-dock-opening]').inert,duration:live.getAnimations()[0].effect.getTiming().duration};
     });
     assert(sample.edge.y<source.y-20);assert(sample.top>sample.bottom*1.5,'contents bend with the wide head and narrow neck');
     assert(sample.edge.x>5&&sample.edge.x+sample.edge.width<1440-5,`${key}/${reducedMotion}: edges leave the old page visible (${JSON.stringify(sample)})`);
     assert.match(sample.filter,/drop-shadow/);assert.notEqual(sample.stroke,'none');assert.equal(sample.fill,'none');assert.equal(sample.hidden,'0');assert(sample.previous&&sample.inert);assert.equal(sample.duration,400);
     await page.evaluate(()=>document.querySelector('[data-dock-workspace]').getAnimations().find(a=>a.id==='dock-genie').finish());await frames(page);
     assert.equal(await page.locator('[data-dock-opening]').count(),0);assert.equal(await page.locator('[data-dock-workspace]').evaluate(node=>getComputedStyle(node).opacity),'1');
    }
    assert.deepEqual(await page.evaluate(()=>fixtureErrors),[]);
   }finally{await context.close();}
  }
 },{'/app':shellFixture});
});

test('fast pointer movement and horizontal scrolling keep the label on the current visible icon',async()=>{
 await withDockBrowser(async(browser,origin)=>{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
   try{
    await page.goto(origin+'/dock-fixture');await page.waitForFunction(()=>window.fixtureDock);await frames(page);
    const results=await page.evaluate(async()=>{
     const dock=document.querySelector('[data-module-dock]'),nav=dock.querySelector('nav'),label=dock.querySelector('.module-dock__label');
     const viewport=nav.getBoundingClientRect(),edge=parseFloat(getComputedStyle(nav).getPropertyValue('--dock-edge-inset'));
     const visible=[...nav.children].filter(link=>link.getBoundingClientRect().right<=viewport.right-edge);
     const move=(x,y)=>document.elementFromPoint(x,y).dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,pointerType:'mouse',bubbles:true}));
     const read=link=>{
      const b=link.querySelector('.module-dock__icon').getBoundingClientRect(),labelBox=label.getBoundingClientRect();
      const anchor=(Math.max(b.left,viewport.left+edge)+Math.min(b.right,viewport.right-edge))/2;
      const arrowX=labelBox.left+label.clientLeft+parseFloat(getComputedStyle(label,'::after').left);
      return {expected:link.getAttribute('aria-label'),actual:label.textContent,hidden:label.hidden,error:Math.abs(arrowX-anchor),duration:getComputedStyle(label).transitionDuration};
     };
     const samples=[visible[0],visible.at(-1),visible[1],visible[0]].map(link=>{
      const b=link.getBoundingClientRect();move(b.left+b.width/2,b.top+b.height/2);return read(link);
     });
     if(nav.scrollWidth>nav.clientWidth){
      nav.scrollLeft=visible[1].offsetLeft-visible[0].offsetLeft;
      nav.dispatchEvent(new Event('scroll'));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      samples.push(read(visible[1]));
     }
     const first=nav.querySelector('[data-dock-module="assignments"]').getBoundingClientRect();
     move(first.right+4,first.top+first.height/2);
     return {samples,gapHidden:label.hidden};
    });
    for(const sample of results.samples){assert.equal(sample.actual,sample.expected);assert(!sample.hidden);assert(sample.error<2,JSON.stringify(sample));assert.equal(sample.duration,'0s');}
    assert(results.gapHidden);
   }finally{await context.close();}
  }
 });
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
   assert.equal(await page.locator('[data-dock-module="support"]').count(),0);
   await page.locator('[data-report-toggle]').click();
   assert(await page.locator('[data-report-message]').isVisible());
   await page.locator('[data-report-toggle]').click();
   const focus=page.locator('[data-focus-toggle]'),coach=page.locator('[data-coach-fab]');
   const f=await focus.evaluate(node=>({height:node.getBoundingClientRect().height,bg:getComputedStyle(node).backgroundImage})),c=await coach.evaluate(node=>({height:node.getBoundingClientRect().height,bg:getComputedStyle(node).backgroundImage}));
   assert(Math.abs(f.height-c.height)<2);assert.equal(f.bg,c.bg);
   await focus.click();await page.waitForFunction(()=>document.documentElement.dataset.studyFocus==='on');
   assert.equal(await page.locator('[data-dock-opening]').count(),0);
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

test('the thirteen reference photographs share a decoded inline atlas and keep their requested mapping',async()=>{
 await withDockBrowser(async(browser,origin)=>{
  const context=await browser.newContext({viewport:{width:1680,height:700}}),page=await context.newPage();
  try{
   const imageRequests=[];
   page.on('request',request=>{if(request.resourceType()==='image'&&request.url().startsWith(origin))imageRequests.push(request.url());});
   await page.goto(origin+'/dock-fixture');await page.waitForFunction(()=>window.fixtureDock);
   const artwork=await page.evaluate(()=>[...document.querySelectorAll('[data-dock-module]')].map(a=>({key:a.dataset.dockModule,art:a.querySelector('svg')?.dataset.dockArtwork,label:a.getAttribute('aria-label')})));
   assert.equal(artwork.length,13);assert(artwork.every(a=>a.key===a.art&&a.label));
   assert(!artwork.some(a=>['courses','coach','reports','support'].includes(a.key)));
   const {references,atlas}=await page.evaluate(async()=>{
    const pictures=[...document.querySelectorAll('[data-dock-reference]')];
    const href=pictures[0].querySelector('image').getAttribute('href'),image=new Image();
    image.src=href;await image.decode();
    return {atlas:{inline:href.startsWith('data:image/webp;base64,'),size:href.length,width:image.naturalWidth,height:image.naturalHeight},references:pictures.map(svg=>{
     const image=svg.querySelector('image'),container=svg.parentElement;
     return {key:svg.dataset.dockArtwork,shared:image.getAttribute('href')===href,x:Number(image.getAttribute('x')),y:Number(image.getAttribute('y')),viewBox:svg.getAttribute('viewBox'),background:getComputedStyle(container).backgroundImage,overlay:getComputedStyle(container,'::before').display};
    })};
   });
   assert.deepEqual(references.map(r=>r.key),['dashboard','live-classes','assignments','mocks','video-lessons','listening','reading','writing','speaking','grammar','vocabulary','progress','management']);
   assert(atlas.inline&&atlas.size<135000);assert.equal(atlas.width,768);assert.equal(atlas.height,788);assert.deepEqual(imageRequests,[]);
   for(const [index,ref] of references.entries()){
    assert(ref.shared);assert.equal(ref.x,0-(index%4)*192);assert.equal(ref.y,0-Math.floor(index/4)*197);
    assert.equal(ref.viewBox,'0 0 192 197');assert.equal(ref.background,'none');assert.equal(ref.overlay,'none');
   }
   const ids=await page.evaluate(()=>[...document.querySelectorAll('[data-module-dock] [id]')].map(n=>n.id));assert.equal(new Set(ids).size,ids.length);
  }finally{await context.close();}
 });
});

test('Dock launch never bounces the icon while navigation and opening continue',async()=>{
 await withDockBrowser(async(browser,origin)=>{
  for(const reducedMotion of ['reduce','no-preference']){
   const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion}),page=await context.newPage();
   try{
    await page.goto(origin+'/app');await page.waitForFunction(()=>window.fixtureReady);
    const item=page.locator('[data-dock-module="progress"]');await item.click();await page.locator('#main-content [data-fixture-page="/app/progress"]').waitFor();
    assert.equal(await item.evaluate(node=>node.getAnimations({subtree:true}).filter(a=>a.id==='dock-bounce').length),0);
    assert(await page.evaluate(()=>document.querySelector('[data-dock-workspace]').getAnimations().some(a=>a.id==='dock-genie')));
    await page.evaluate(async()=>{const link=document.querySelector('[data-dock-module="progress"]');await fixtureRouter.go('/app/progress',{source:link});});
    assert.equal(await item.evaluate(node=>node.getAnimations({subtree:true}).filter(a=>a.id==='dock-bounce').length),0);
    assert.deepEqual(await page.evaluate(()=>fixtureErrors),[]);
   }finally{await context.close();}
  }
 },{'/app':shellFixture});
});

test('opening pictures preserve scroll and drawings, never reload players, and clear on supersession, Back and account teardown',async()=>{
 await withDockBrowser(async(browser,origin)=>{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
   try{
    await page.goto(origin+'/app');await page.waitForFunction(()=>window.fixtureReady);
    await page.evaluate(()=>{
     const main=document.querySelector('#main-content'),article=main.querySelector('article');article.style.height='1800px';
     const input=document.createElement('input');input.dataset.snapshotDraft='';input.value='Keep my draft';input.addEventListener('input',()=>window.fixtureClonedEvents=(window.fixtureClonedEvents??0)+1);
     const file=document.createElement('input');file.type='file';const files=new DataTransfer();files.items.add(new File(['draft'],'draft.txt',{type:'text/plain'}));file.files=files.files;article.append(file);
     const drawing=document.createElement('canvas');drawing.width=40;drawing.height=40;drawing.getContext('2d').fillRect(0,0,40,40);
     const player=document.createElement('iframe');player.srcdoc='<p>Already mounted player</p>';article.append(input,drawing,player);main.scrollTop=120;
    });
    await page.locator('[data-dock-module="progress"]').click();await page.waitForFunction(()=>document.querySelector('[data-dock-workspace]').getAnimations().some(a=>a.id==='dock-genie'));
    await page.evaluate(()=>{const a=document.querySelector('[data-dock-workspace]').getAnimations()[0];a.pause();a.currentTime=300;});await frames(page);
    assert.equal(await page.locator('[data-dock-previous] [data-shell-main]').evaluate(node=>node.scrollTop),120);
    assert.equal(await page.locator('[data-dock-previous] [data-snapshot-draft]').inputValue(),'Keep my draft');
    assert.equal(await page.locator('[data-dock-opening] iframe,[data-dock-opening] video,[data-dock-opening] canvas').count(),0);
    assert.equal(await page.locator('[data-dock-previous] img[src^="data:image/png"]').count(),1);
    await page.locator('[data-dock-previous] [data-snapshot-draft]').evaluate(node=>node.dispatchEvent(new Event('input',{bubbles:true})));
    assert.equal(await page.evaluate(()=>window.fixtureClonedEvents??0),0,'visual pictures never acquire app listeners');
    await page.evaluate(()=>fixtureRouter.go('/app/writing',{source:document.querySelector('[data-dock-module="writing"]')}));
    assert.equal(await page.locator('[data-dock-opening]').count(),1);assert.equal(await page.locator('[data-dock-previous] [data-fixture-page]').getAttribute('data-fixture-page'),'/app/progress');
    await page.evaluate(()=>fixtureRouter.go('/app/speaking'));await frames(page);
    assert.equal(await page.locator('[data-dock-opening]').count(),0);assert.equal(await page.locator('[data-dock-workspace]').evaluate(node=>getComputedStyle(node).opacity),'1');
    await page.goBack();await page.waitForFunction(()=>location.pathname==='/app/writing');await frames(page);assert.equal(await page.locator('[data-dock-opening]').count(),0,'Back has no closing effect');
    await page.evaluate(()=>fixtureRouter.go('/app/progress',{source:document.querySelector('[data-dock-module="progress"]')}));
    await page.setViewportSize({width:width+10,height:900});await page.waitForFunction(()=>!document.querySelector('[data-dock-opening]'));assert.equal(await page.locator('[data-dock-opening]').count(),0);
    await page.evaluate(()=>fixtureRouter.go('/app/writing',{source:document.querySelector('[data-dock-module="writing"]')}));
    await page.evaluate(()=>fixtureWorkspace.destroy());assert.equal(await page.locator('[data-dock-opening],[data-dock-snapshot]').count(),0);
    assert.deepEqual(await page.evaluate(()=>fixtureErrors),[]);
   }finally{await context.close();}
  }
 },{'/app':shellFixture});
});

test('long catalogues keep visible content while bounding temporary window pictures',async()=>{
 const catalogue=shellFixture.replace('article.append(heading);',`article.append(heading);for(let i=0;i<2000;i++){const card=document.createElement('section');card.style.cssText='height:48px';card.innerHTML='<h2>Catalogue '+i+'</h2><p>Visible content</p><span>Details</span>';article.append(card);}`);
 await withDockBrowser(async(browser,origin)=>{
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  try{
   await page.goto(origin+'/app');await page.waitForFunction(()=>window.fixtureReady);
   await page.evaluate(()=>fixtureRouter.go('/app/progress',{source:document.querySelector('[data-dock-module="progress"]')}));
   const counts=await page.evaluate(()=>({live:document.querySelector('[data-dock-workspace]').querySelectorAll('*').length,band:document.querySelector('.dock-opening-band').querySelectorAll('*').length}));
   assert(counts.live>8000);assert(counts.band<2500,'off-screen card contents must not be cloned into every band');
   await page.evaluate(()=>fixtureWorkspace.destroy());assert.equal(await page.locator('[data-dock-snapshot]').count(),0);
  }finally{await context.close();}
 },{'/app':catalogue});
});
