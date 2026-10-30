import fs from 'node:fs';
export async function traceRecovery(page){
 const parent=[];
 page.on('pageerror',e=>parent.push({at:Date.now(),event:'pageerror',message:e.message}));
 page.on('console',m=>{if(m.type()==='error')parent.push({at:Date.now(),event:'console-error',message:m.text()});});
 page.on('response',r=>{if(r.url().includes('/api/'))parent.push({at:Date.now(),event:'response',path:new URL(r.url()).pathname,status:r.status(),method:r.request().method()});});
 await page.addInitScript(()=>{
  window.__v29trace=[];const log=(event,extra={})=>window.__v29trace.push({at:Date.now(),time:performance.now(),event,...extra});
  const snapshot=()=>{const box=document.querySelector('.score-box');const ancestors=[];for(let n=box;n;n=n.parentElement){const c=getComputedStyle(n);ancestors.push({tag:n.tagName,id:n.id,hidden:n.hidden,class:n.className,display:c.display,visibility:c.visibility,inert:n.inert});}return {box:!!box,ancestors,hubBusy:document.querySelector('#hub')?.getAttribute('aria-busy'),active:document.querySelector('.activity.active')?.id};};
  addEventListener('message',e=>{const d=e.data;if(d?.channel)log('message',{channel:d.channel,op:d.op,phase:d.phase});});
  document.addEventListener('DOMContentLoaded',()=>queueMicrotask(()=>{log('document-ready');for(const name of ['showResults','showModal','closeModal','laHydrateOriginal']){const fn=window[name];if(typeof fn!=='function')continue;window[name]=function(...a){log('before-'+name,{snapshot:snapshot(),stack:new Error().stack});const v=fn.apply(this,a);log('after-'+name,{snapshot:snapshot()});return v;};}new MutationObserver(()=>{const state=snapshot(),text=JSON.stringify(state);if(text!==window.__v29last){window.__v29last=text;log('visibility',{snapshot:state});}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','hidden','inert']});}));
 });
 return async()=>{const frames=[];for(const f of page.frames()){try{frames.push({url:f.url(),trace:await f.evaluate(()=>window.__v29trace)});}catch(e){frames.push({error:e.message});}}fs.writeFileSync(new URL('../docs/evidence/v29/403-timeline.json',import.meta.url),JSON.stringify({parent,frames},null,2));};
}
