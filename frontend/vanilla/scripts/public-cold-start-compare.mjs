/** Public cold-start comparator: never claims private SPA equivalence.
 * Run with: node scripts/public-cold-start-compare.mjs --ours https://learnersarea.uz/login --other https://ieltsbooster.uz/ --cycles 5
 * Requires playwright-core and @sparticuz/chromium, available in benchmark environment.
 * Public pages only. Private routes must be measured by the existing authenticated
 * instant-navigation-bench.mjs fixture benchmark or authorized manual session.
 */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';

const args=new Map();
for(let i=2;i<process.argv.length;i++){if(process.argv[i].startsWith('--'))args.set(process.argv[i++].slice(2),process.argv[i]);}
const ours=args.get('ours'),other=args.get('other');
const count=Number(args.get('cycles')??5);
if(!ours||!other||![ours,other].every(v=>/^https:\/\//.test(v))||!Number.isInteger(count)||count<3||count>20){
 console.error('Usage: --ours https://... --other https://... --cycles 5');process.exitCode=2;
}else{
 const browser=await playwright.launch({executablePath:await chromium.executablePath(),headless:true,args:chromium.args});
 const observations=[];
 try{
  for(let cycle=0;cycle<count;cycle++){
   // Alternate order so transient network conditions do not favor either site.
   for(const [label,url] of (cycle%2?[['other',other],['ours',ours]]:[['ours',ours],['other',other]])){
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    const page=await context.newPage();
    let status=null,error=null,ttfb=null,domContentLoaded=null,load=null,firstPaint=null,lcp=null;
    await page.addInitScript(()=>{
     window.__cold={lcp:null};
     try{new PerformanceObserver(list=>{for(const e of list.getEntries())window.__cold.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});}catch{}
    });
    const t0=Date.now();
    try{
     const response=await page.goto(url,{waitUntil:'load',timeout:25000});
     status=response?.status()??null;
     await page.waitForTimeout(800);
     const timing=await page.evaluate(()=>{
      const n=performance.getEntriesByType('navigation')[0];
      const paints=performance.getEntriesByType('paint');
      return {ttfb:n?.responseStart??null,dcl:n?.domContentLoadedEventEnd??null,load:n?.loadEventEnd??null,
       fp:paints.find(x=>x.name==='first-contentful-paint')?.startTime??null,lcp:window.__cold.lcp};
     });
     ttfb=timing.ttfb;domContentLoaded=timing.dcl;load=timing.load;firstPaint=timing.fp;lcp=timing.lcp;
    }catch(e){error=String(e).slice(0,300);}
    observations.push({label,cycle,status,error,elapsedWallMs:Date.now()-t0,ttfbMs:ttfb,dclMs:domContentLoaded,loadMs:load,fcpMs:firstPaint,lcpMs:lcp});
    await context.close();
   }
  }
 }finally{await browser.close();}
 const median=values=>{const s=values.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:null;};
 const byLabel=Object.fromEntries(['ours','other'].map(label=>{
  const rows=observations.filter(o=>o.label===label);
  return [label,{success:rows.filter(o=>o.status&&o.status<400).length,total:rows.length,
   medianTtfbMs:median(rows.map(o=>o.ttfbMs)),medianFcpMs:median(rows.map(o=>o.fcpMs)),
   medianLcpMs:median(rows.map(o=>o.lcpMs)),medianDclMs:median(rows.map(o=>o.dclMs))}];
 }));
 console.log(JSON.stringify({scope:'PUBLIC_COLD_LOAD_ONLY; different pages are not an equivalent private SPA comparison',
  context:'new isolated context each iteration; service workers disabled; no login; mobile viewport 390x844',
  at:new Date().toISOString(),sites:{ours,other},summary:byLabel,raw:observations},null,2));
 if(observations.some(o=>o.error||!o.status||o.status>=400))process.exitCode=1;
}
