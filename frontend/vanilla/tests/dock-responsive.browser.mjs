/** Isolated layout/touch regression; no production account or API is used.
 * Run explicitly: node --test tests/dock-responsive.browser.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=`<!doctype html><html data-theme="day"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/global.css"><link rel="stylesheet" href="/css/campus.css"><link rel="stylesheet" href="/css/dock.css"></head><body><div data-dock-shell data-campus-shell style="height:100dvh;overflow:hidden"><main data-shell-main><h1>Layout fixture</h1></main></div><button data-fixture-tools style="position:fixed;right:16px;bottom:16px;width:48px;height:48px">Tools</button><script type="module">
import {moduleDock} from '/modules/shell/dock.js';
import dict from '/js/i18n/en.js';
const controller=new AbortController();
window.fixtureDock=moduleDock({dict,signal:controller.signal,url:new URL('/app',location.origin),session:{user:{role:'owner'}}});
document.querySelector('[data-dock-shell]').append(window.fixtureDock.node);
window.fixtureNavigation=[];
document.addEventListener('click',event=>{const a=event.target.closest('a');if(a){event.preventDefault();window.fixtureNavigation.push(a.getAttribute('href'));}});
</script></body></html>`;
const frame=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const geometry=page=>page.evaluate(()=>{
 const nav=document.querySelector('.module-dock__glass'),dock=nav.parentElement,links=[...nav.querySelectorAll('a')],bounds=nav.getBoundingClientRect();
 const inside=link=>{const b=link.getBoundingClientRect();return b.left>=bounds.left&&b.right<=bounds.right;};
 return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,dockLeft:dock.getBoundingClientRect().left,dockRight:dock.getBoundingClientRect().right,toolsLeft:document.querySelector('[data-fixture-tools]').getBoundingClientRect().left,client:nav.clientWidth,total:nav.scrollWidth,visible:links.filter(inside).length,first:inside(links[0]),last:inside(links.at(-1)),scroll:nav.scrollLeft,keys:links.map(a=>a.dataset.dockModule)};
});

test('Dock fits available width, scrolls both ways and keeps all modules reachable on phones/tablets',async t=>{
 const server=createServer(async(req,res)=>{
  if(req.url==='/dock-fixture'){res.writeHead(200,{'Content-Type':'text/html'});res.end(fixture);return;}
  const file=path.resolve(root,decodeURIComponent(req.url.split('?')[0]).slice(1));
  if(!file.startsWith(root)){res.writeHead(403);res.end();return;}
  try{const data=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{channel:'chrome'})});
  for(const [width,height]of [[320,568],[390,844],[600,960],[768,1024],[820,1180],[1024,1366],[1366,768]]){
   const context=await browser.newContext({viewport:{width,height},hasTouch:true}),page=await context.newPage();
   try{
    await page.goto(origin+'/dock-fixture');await page.waitForFunction(()=>window.fixtureDock);await frame(page);
    const first=await geometry(page);assert.equal(first.documentWidth,width);assert(first.dockLeft>=0);assert(first.dockRight<=first.toolsLeft-2);assert(first.first);assert(first.visible>=3);assert.equal(first.keys.length,14);
    if(first.total>first.client+1){
     assert(first.visible<=14);
     await page.evaluate(()=>{const nav=document.querySelector('.module-dock__glass');nav.scrollLeft=nav.scrollWidth;});await frame(page);
     const end=await geometry(page);assert(end.last,`${width}: Management must be reachable`);assert(end.scroll>0);
     await page.evaluate(()=>document.querySelector('.module-dock__glass').scrollLeft=0);await frame(page);assert((await geometry(page)).first);
    }
    await page.evaluate(()=>window.fixtureDock.update(new URL('/app/management',location.origin)));await frame(page);assert((await geometry(page)).last);
    await page.setViewportSize({width:height,height:width});await frame(page);assert((await geometry(page)).last,`${width}: active module lost after rotation`);
    t.diagnostic(`${width}x${height}: ${first.visible}/14 visible, ${first.total>first.client?'horizontal scroll':'all fit'}`);
   }finally{await context.close();}
  }
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),page=await context.newPage();
  try{
   await page.goto(origin+'/dock-fixture');await page.waitForFunction(()=>window.fixtureDock);await frame(page);
   const cdp=await context.newCDPSession(page),box=await page.locator('.module-dock__glass').boundingBox();
   const swipe=async(from,to)=>{
    const y=box.y+box.height-30;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from,y}]});
    for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from+(to-from)*i/12,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frame(page);
   };
   await swipe(box.x+box.width-30,box.x+30);await page.waitForFunction(()=>document.querySelector('.module-dock__glass').scrollLeft>30);const moved=(await geometry(page)).scroll;
   await swipe(box.x+30,box.x+box.width-30);await page.waitForFunction(prior=>document.querySelector('.module-dock__glass').scrollLeft<prior,moved);
   assert.equal(await page.evaluate(()=>window.fixtureNavigation.length),0,'swiping must not open a module');
   t.diagnostic('390px: native touch swipe works in both directions without accidental navigation');
  }finally{await context.close();}
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
