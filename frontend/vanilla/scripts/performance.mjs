import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import path from 'node:path';
process.env.LD_LIBRARY_PATH=path.resolve(import.meta.dirname,'../node_modules/lib')+':'+(process.env.LD_LIBRARY_PATH??'');
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('single-process')&&!a.includes('disable-web-security')&&!a.includes('allow-running-insecure-content')),headless:true});
try{const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const samples=[];
for(let i=0;i<10;i++){await page.goto('http://127.0.0.1:4173/benchmark-not-found');await page.waitForSelector('a[href="/"]');samples.push(await page.evaluate(()=>{const start=performance.now();document.querySelector('a[href="/"]').click();return new Promise(resolve=>{function sample(){if(document.querySelector('[data-landing-cta]'))resolve(performance.now()-start);else requestAnimationFrame(sample);}sample();});}));}
const metrics=await page.evaluate(()=>({navigation:performance.getEntriesByType('navigation').map(x=>({duration:x.duration,transferSize:x.transferSize,domContentLoaded:x.domContentLoadedEventEnd})),resources:performance.getEntriesByType('resource').map(x=>({name:new URL(x.name).pathname,transferSize:x.transferSize,duration:x.duration}))}));
fs.writeFileSync(new URL('../docs/evidence/performance.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),conditions:'Local HTTP, Chromium 133 headless, 390x844 touch. 10 visits to not-found followed by SPA link to landing. CSS animations NOT complete at DOM readiness. No backend, throttling or original baseline. Not an application-shell or module benchmark.',samplesMs:samples,medianMs:[...samples].sort((a,b)=>a-b)[5],metrics},null,2)+'\n');
}finally{await browser.close();}
