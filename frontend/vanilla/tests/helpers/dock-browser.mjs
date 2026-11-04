import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const root=fileURLToPath(new URL('../../',import.meta.url));
export const documentFixture=(script,body='<div data-shell data-campus-shell data-dock-shell style="height:100dvh;overflow:hidden"><main data-shell-main style="min-height:400px"><h1>Fixture</h1></main></div>')=>`<!doctype html><html data-theme="day"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/global.css"><link rel="stylesheet" href="/css/campus.css"><link rel="stylesheet" href="/css/dock.css"></head><body><div id="root">${body}</div><script type="module">${script}</script></body></html>`;
export const dockFixture=documentFixture(`
import {moduleDock} from '/modules/shell/dock.js';
import dict from '/js/i18n/en.js';
window.fixtureController=new AbortController();
window.fixtureDock=moduleDock({dict,signal:fixtureController.signal,url:new URL('/app',location.origin),session:{user:{role:'owner'}}});
document.querySelector('[data-dock-shell]').append(fixtureDock.node);
`);
export const shellFixture=documentFixture(`
import {createRouter,compilePattern} from '/js/router.js';
import {createWorkspace} from '/js/workspace.js';
import {createRouteReuse} from '/js/route-reuse.js';
import {api} from '/js/api-client.js';
import {fixtureSession} from '/tests/fixtures.mjs';
document.cookie='la_locale=en';
api.request=async path=>path==='/api/frontend/session'?fixtureSession('owner'):path.startsWith('/api/notifications')?{unread:0}:path==='/api/auth/state'?{role:'owner',accountStatus:'active',expiresAt:Math.floor(Date.now()/1000)+3600}:{ok:true};
const root=document.querySelector('#root'),workspace=createWorkspace(root);window.fixtureWorkspace=workspace;
const routes=['/app','/app/progress','/app/writing','/app/speaking','/app/live-classes'].map(pattern=>({pattern,protected:true,progressiveMount:true,match:compilePattern(pattern),load:async()=>({mount(context){const article=document.createElement('article');article.style.minHeight='300px';article.dataset.fixturePage=context.url.pathname;const heading=document.createElement('h1');heading.textContent='Fixture '+context.url.pathname;article.append(heading);context.root.append(article);}})}));
window.fixtureErrors=[];
window.fixtureRouter=createRouter({root,window,routes,reuse:createRouteReuse(),prepare:context=>workspace.prepare(context),commit:(staging,context)=>workspace.commit(staging,context),onStart:(url,{signal,source})=>workspace.begin(url,signal,source),onUpdate:context=>workspace.updateLocation(context),notFound:()=>({mount(){}}),onError:error=>fixtureErrors.push(error.message)});
await fixtureRouter.start();window.fixtureReady=true;
`, '');
export const tedPath='/app/video-lessons/00000000-0000-4000-8000-000000000002';
export const tedFixture=documentFixture(`
import {createShell} from '/modules/shell/layout.js';
import {mount} from '/modules/video/detail.js';
import dict from '/js/i18n/en.js';
import {fixtureSession} from '/tests/fixtures.mjs';
import {api} from '/js/api-client.js';
const controller=new AbortController(),id='00000000-0000-4000-8000-000000000002';
api.request=async path=>path.startsWith('/api/notifications')?{unread:0}:{version:1,route:location.pathname,data:{detail:{videoLesson:{id,provider:'youtube',videoId:'abcdefghijk',title:'How to Make Stress Your Friend',beforeYouWatch:'Description',durationSeconds:840,transcript:[],transcriptText:'A useful word.',notes:'Notes'},questions:[],progress:null,vocabulary:{ready:true,items:[]},embedOrigin:location.origin}}};
const context={dict,locale:'en',url:new URL(location.href),signal:controller.signal,session:fixtureSession('owner').session,state:{},navigate(){},refresh(){}};
const shell=createShell(context);document.querySelector('#root').append(shell.host);
const staging=document.createElement('div');mount({...context,root:staging});shell.outlet.append(...staging.childNodes);shell.attachModuleHeader(shell.outlet);
window.fixtureReady=true;
`, '');
export const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
export async function withDockBrowser(run,fixtures={'/dock-fixture':dockFixture}){
 const server=createServer(async(req,res)=>{
  if(fixtures[req.url]){res.writeHead(200,{'Content-Type':'text/html'});res.end(fixtures[req.url]);return;}
  const file=path.resolve(root,decodeURIComponent(req.url.split('?')[0]).slice(1));
  if(!file.startsWith(root)){res.writeHead(403);res.end();return;}
  try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')||file.endsWith('.mjs')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':'application/octet-stream'});res.end(bytes);}catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{channel:'chrome'})});await run(browser,'http://127.0.0.1:'+server.address().port);}
 finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
