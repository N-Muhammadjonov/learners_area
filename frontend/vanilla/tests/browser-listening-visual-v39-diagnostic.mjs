/** V39 Hub visual diagnostic: harness self-control for the V37 strict residual (hub-768-uz-day).
 * Synthetic fixtures and the committed V37 reference JSON only. No live/production access.
 * Experiments: (A) native vs native, (B) reference vs reference (same page, DOM swap),
 * (C) native vs reference in fresh pages, (D) V37 harness order (native, swap, reference).
 * Output: docs/evidence/v39/hub-diagnostic.json (+ PNGs for the differing pair). */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fixtureSession,publicPolicy,viewFixture} from './fixtures.mjs';
import {cases} from './listening-visual-v37-fixtures.mjs';
import en from '../js/i18n/en.js';
import uz from '../js/i18n/uz.js';

const deps=path.resolve(import.meta.dirname,'../node_modules');
if(process.platform==='linux'){const tar=path.join(deps,'al2023.tar');fs.writeFileSync(tar,brotliDecompressSync(fs.readFileSync(path.join(deps,'@sparticuz/chromium/bin/al2023.tar.br'))));execFileSync('tar',['xf',tar,'-C',deps]);process.env.LD_LIBRARY_PATH=path.join(deps,'lib')+':'+(process.env.LD_LIBRARY_PATH??'');}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('single-process')&&!a.includes('disable-web-security')&&!a.includes('allow-running-insecure-content')),headless:true});
const base=process.env.PREVIEW_URL??'http://127.0.0.1:4173';
const out=new URL('../docs/evidence/v39/',import.meta.url);fs.mkdirSync(out,{recursive:true});
const references=JSON.parse(fs.readFileSync(new URL('reference-listening-v37.json',import.meta.url)));
const results={};

async function openPage(locale,theme,width,height,c){
 const context=await browser.newContext({viewport:{width,height}});
 await context.addCookies([{name:'la_locale',value:locale,url:base},{name:'la_theme',value:theme,url:base}]);
 const page=await context.newPage();page.setDefaultTimeout(8000);
 await context.route('**/api/**',async route=>{const u=new URL(route.request().url()),p=u.pathname;const json=x=>route.fulfill({json:x});
  if(p==='/api/frontend/public')return json(publicPolicy);
  if(p==='/api/frontend/session')return json(fixtureSession());
  if(p==='/api/auth/state')return json({ok:true,role:'student',accountStatus:'active',expiresAt:Math.floor(Date.now()/1000)+3600});
  if(p==='/api/notifications')return json({notifications:[],unread:0});
  if(p==='/api/frontend/view'){const target=u.searchParams.get('route');return json({version:1,route:target,data:target===c.route?c.data:viewFixture(target.split('?')[0])});}
  return route.fulfill({status:503,json:{error:'isolated_unconfigured'}});});
 await page.goto(base+c.route);
 const host=page.locator(c.selector);await host.waitFor();
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));for(const a of document.getAnimations()){a.pause();a.currentTime=0;}});
 return {context,page,host};
}
async function swapReference(page,host,html){
 await host.evaluate((n,html)=>{const t=document.createElement('template');t.innerHTML=html;const original=t.content.firstElementChild;n.replaceWith(original);original.dataset.v37reference='';},html);
 return page.locator('[data-v37reference]');
}
// Pixel diff in-page; returns counts and the first differing coordinates (bounded).
async function diff(page,a,b){
 return page.evaluate(async({a,b})=>{async function decode(s){const i=new Image();i.src=s;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return{w:i.width,h:i.height,data:ctx.getImageData(0,0,i.width,i.height).data};}
  const x=await decode(a),y=await decode(b);let differentPixels=0,maxChannelDelta=0;const samples=[];
  for(let k=0;k<Math.max(x.data.length,y.data.length);k+=4){let different=false;for(let j=0;j<4;j++){const d=Math.abs((x.data[k+j]??-1)-(y.data[k+j]??-1));if(d){different=true;maxChannelDelta=Math.max(maxChannelDelta,d);}}
   if(different){differentPixels++;if(samples.length<12){const p=k/4;samples.push({x:p%x.w,y:Math.floor(p/x.w),native:[x.data[k],x.data[k+1],x.data[k+2]],reference:[y.data[k],y.data[k+1],y.data[k+2]]});}}}
  return{dimensionsEqual:x.w===y.w&&x.h===y.h,differentPixels,maxChannelDelta,samples};},{a:'data:image/png;base64,'+a.toString('base64'),b:'data:image/png;base64,'+b.toString('base64')});
}

// (E) structural comparison: element tree, text-node boundaries and rasterization-relevant computed style.
async function structure(page,node){
 return node.evaluate(n=>{const props=['font-family','font-size','font-weight','letter-spacing','word-spacing','text-rendering','-webkit-font-smoothing','color','background-color','background-image','opacity','transform','filter','backdrop-filter','will-change','transition-property','transition-duration','animation-name','mix-blend-mode','isolation','text-shadow','box-shadow'];
  const out=[];let i=0;
  const walk=(el,depth)=>{const cs=getComputedStyle(el);const kids=[...el.childNodes].map(c=>c.nodeType===3?{t:c.textContent}:c.nodeType===1?null:{comment:true});
    out.push({i:i++,depth,tag:el.tagName,cls:el.getAttribute('class')??'',text:kids.filter(k=>k&&k.t!==undefined).map(k=>k.t).join('|'),textNodes:[...el.childNodes].filter(c=>c.nodeType===3).length,style:Object.fromEntries(props.map(p=>[p,cs.getPropertyValue(p)])),rect:el.getBoundingClientRect().toJSON()});
    for(const c of el.children)walk(c,depth+1);};
  walk(n,0);return out;});
}

// (F) noise floor: N fresh-page pairs of the same source (native|native, reference|reference) and cross (native|reference).
async function noise(name,locale,theme,width,height,trials){
 const dict=locale==='en'?en:uz;const c=cases(dict).find(x=>x.kind==='hub');
 const html=references.refs.find(r=>r.locale===locale&&r.kind==='hub').html;
 const shot={native:async()=>{const p=await openPage(locale,theme,width,height,c);const b=await png(p.host);await p.context.close();return b;},
  reference:async()=>{const p=await openPage(locale,theme,width,height,c);const r=await swapReference(p.page,p.host,html);const b=await png(r);await p.context.close();return b;}};
 const page=await browser.newPage();await page.goto(base+'/app/listening/mcq');
 const rows=[];
 for(const [a,b] of [['native','native'],['reference','reference'],['native','reference']]){
  for(let t=0;t<trials;t++){const x=await shot[a](),y=await shot[b]();const d=await diff(page,x,y);rows.push({pair:a+'|'+b,differentPixels:d.differentPixels,maxChannelDelta:d.maxChannelDelta});}
 }
 await page.close();
 const summary={};for(const r of rows){summary[r.pair]=summary[r.pair]||{trials:0,nonzero:0,maxDelta:0,maxPixels:0};const s=summary[r.pair];s.trials++;if(r.differentPixels)s.nonzero++;s.maxDelta=Math.max(s.maxDelta,r.maxChannelDelta);s.maxPixels=Math.max(s.maxPixels,r.differentPixels);}
 results[name+'-noise']={rows,summary};
 console.log(name,'noise',JSON.stringify(summary));
}

// (G) backbar effect: native|native fresh-page pairs with the sticky Focus back bar as rendered (A) vs hidden (B).
// Hiding is diagnostic only (visibility, not layout removal) and does not change the product.
async function backbar(name,locale,theme,width,height,trials){
 const dict=locale==='en'?en:uz;const c=cases(dict).find(x=>x.kind==='hub');
 const page=await browser.newPage();await page.goto(base+'/app/listening/mcq');
 const rows={present:[],hidden:[]};
 const shot=async hide=>{const p=await openPage(locale,theme,width,height,c);if(hide)await p.page.evaluate(()=>{document.querySelector('[data-listening-focus-backbar]').style.display='none';});await p.host.waitFor();const b=await png(p.host);await p.context.close();return b;};
 for(let t=0;t<trials;t++){const x=await shot(false),y=await shot(false);rows.present.push((await diff(page,x,y)).differentPixels);const u=await shot(true),v=await shot(true);rows.hidden.push((await diff(page,u,v)).differentPixels);}
 await page.close();
 const nz=a=>a.filter(n=>n>0).length;
 results[name+'-backbar']={present:{trials,nonzero:nz(rows.present),counts:rows.present},hidden:{trials,nonzero:nz(rows.hidden),counts:rows.hidden}};
 console.log(name,'backbar',JSON.stringify(results[name+'-backbar']));
}

// (I) settle control: native|native fresh-page pairs with an explicit post-mount settle (2 animation frames + 500 ms) before capture.
async function settle(name,locale,theme,width,height,trials){
 const dict=locale==='en'?en:uz;const c=cases(dict).find(x=>x.kind==='hub');
 const page=await browser.newPage();await page.goto(base+'/app/listening/mcq');
 const shot=async()=>{const p=await openPage(locale,theme,width,height,c);await p.page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,500)))));const b=await png(p.host);await p.context.close();return b;};
 const counts=[];
 for(let t=0;t<trials;t++){const x=await shot(),y=await shot();counts.push((await diff(page,x,y)).differentPixels);}
 await page.close();
 results[name+'-settle']={trials,nonzero:counts.filter(n=>n>0).length,counts};
 console.log(name,'settle',JSON.stringify(results[name+'-settle']));
}
const png=l=>l.screenshot({animations:'allow'});

async function run(name,locale,theme,width,height){
 const dict=locale==='en'?en:uz;const c=cases(dict).find(x=>x.kind==='hub');
 const html=references.refs.find(r=>r.locale===locale&&r.kind==='hub').html;
 const res={};
 // (A) native vs native in one page, no DOM change.
 {const {context,page,host}=await openPage(locale,theme,width,height,c);
  const a=await png(host),b=await png(host);res.A_nativeTwice=await diff(page,a,b);await context.close();}
 // (B) reference vs reference: swap once, capture twice.
 {const {context,page,host}=await openPage(locale,theme,width,height,c);
  const ref=await swapReference(page,host,html);
  await page.evaluate(async()=>{await document.fonts.ready;});
  const a=await png(ref),b=await png(ref);res.B_referenceTwice=await diff(page,a,b);await context.close();}
 // (C) fresh pages: native-only capture vs reference-only capture (no shared page state).
 {const p1=await openPage(locale,theme,width,height,c);const nat=await png(p1.host);await p1.context.close();
  const p2=await openPage(locale,theme,width,height,c);const ref=await swapReference(p2.page,p2.host,html);const rf=await png(ref);
  res.C_freshPages=await diff(p2.page,nat,rf);
  if(res.C_freshPages.differentPixels){fs.writeFileSync(new URL(`${name}-C-native.png`,out),nat);fs.writeFileSync(new URL(`${name}-C-reference.png`,out),rf);}
  await p2.context.close();}
 // (D) V37 order: native, swap, reference in the same page (reproduces the strict harness).
 {const {context,page,host}=await openPage(locale,theme,width,height,c);
  const a=await png(host);const ref=await swapReference(page,host,html);const b=await png(ref);
  res.D_v37Order=await diff(page,a,b);await context.close();}
 // (E) structure: native tree vs reference tree in fresh pages.
 {const p1=await openPage(locale,theme,width,height,c);const sn=await structure(p1.page,p1.host);await p1.context.close();const p2=await openPage(locale,theme,width,height,c);const ref=await swapReference(p2.page,p2.host,html);const sr=await structure(p2.page,ref);await p2.context.close();
  const diffs=[];const n=Math.max(sn.length,sr.length);for(let k=0;k<n;k++){const a=sn[k],b=sr[k];if(!a||!b){diffs.push({k,missing:!a?'native':'reference'});continue;}const keys=['tag','cls','text','textNodes'];for(const kk of keys)if(a[kk]!==b[kk])diffs.push({k,field:kk,native:a[kk],reference:b[kk]});for(const pk of Object.keys(a.style))if(a.style[pk]!==b.style[pk])diffs.push({k,field:'style:'+pk,native:a.style[pk],reference:b.style[pk],tag:a.tag,cls:a.cls.slice(0,80)});}
  res.E_structure={nativeNodes:sn.length,referenceNodes:sr.length,diffs};}
 results[name]=res;
 console.log(name,JSON.stringify(Object.fromEntries(Object.entries(res).filter(([k])=>k!=='E_structure').map(([k,v])=>[k,{d:v.differentPixels,m:v.maxChannelDelta}]))),'E diffs:',res.E_structure.diffs.length,'nodes',res.E_structure.nativeNodes,res.E_structure.referenceNodes);
}

try{
 await run('hub-768-uz-day','uz','day',768,1024);
 await run('hub-768-en-day','en','day',768,1024);
 await settle('hub-768-uz-day','uz','day',768,1024,8);
}finally{
 await browser.close();
 fs.writeFileSync(new URL('hub-diagnostic.json',out),JSON.stringify({scope:'V39 Hub strict-residual self-control; synthetic fixtures; V37 reference JSON; not production parity',results},null,2)+'\n');
}
