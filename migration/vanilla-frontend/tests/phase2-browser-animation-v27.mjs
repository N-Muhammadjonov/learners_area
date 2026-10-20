/** V6 Phase2 product journeys. No live acceptance.
 * Chromium library setup matches the preserved original harness. */
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

const out=new URL('../docs/evidence/v27/browser-animation/',import.meta.url);fs.mkdirSync(out,{recursive:true});const results=[];
try{for(const mode of ['plain','animated','cancelled'])for(let run=0;run<4;run++){
 const context=await browser.newContext(),page=await context.newPage();await page.setContent(`<style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}.pulse{animation:pulse 2s cubic-bezier(.4,0,.6,1) infinite}</style><main></main>`);
 const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const before=await cdp.send('Memory.getDOMCounters');
 const created=await page.evaluate(mode=>{const root=document.querySelector('main');let n=0;for(let i=0;i<40;i++){const block=document.createElement('section');for(let j=0;j<5;j++){const node=document.createElement('div');node.textContent='diagnostic only';if(mode!=='plain')node.className='pulse';block.append(node);}root.append(block);}const animations=root.getAnimations({subtree:true});n=animations.length;if(mode==='cancelled')for(const a of animations)a.cancel();root.replaceChildren();return n;},mode);
 await cdp.send('HeapProfiler.collectGarbage');const immediate=await cdp.send('Memory.getDOMCounters');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));await cdp.send('HeapProfiler.collectGarbage');const frame1=await cdp.send('Memory.getDOMCounters');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));await cdp.send('HeapProfiler.collectGarbage');const frame2=await cdp.send('Memory.getDOMCounters');
 results.push({mode,run,created,before,immediate,frame1,frame2});await context.close();
 }
 fs.writeFileSync(new URL('results.json',out),JSON.stringify({browser:browser.version(),results},null,2)+'\n');console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
