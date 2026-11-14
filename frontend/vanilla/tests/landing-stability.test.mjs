import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {JSDOM} from 'jsdom';
import {LANDING_HTML} from '../modules/landing-inline.js';
const source=execFileSync('git',['show','f57647f9e939336fe83ae1d379af0beff3ad47b6:frontend/vanilla/modules/landing-inline.js'],{maxBuffer:2e6}).toString();
const baseline=JSON.parse(source.match(/export const LANDING_HTML\s*=\s*("[\s\S]*");/)[1]);
const blocks=[
 '@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}.js .rv{opacity:1;transform:none}}',
 '@media(prefers-reduced-motion:reduce){.bl,.pn,.mq div,.wv i,.tk i,.ch path{animation:none!important}}',
 '@media(prefers-reduced-motion:reduce){.tl:before,.hn i{animation:none!important}}',
];
test('landing CSS and initial DOM match the original except the three motion blocks',()=>{
 const before=new JSDOM(baseline),after=new JSDOM(LANDING_HTML);
 const css=doc=>[...doc.window.document.querySelectorAll('style')].map(x=>x.textContent).join('\n');
 assert.equal(css(after),blocks.reduce((s,block)=>s.replace(block,''),css(before)));
 for(const dom of [before,after])dom.window.document.querySelectorAll('script').forEach(x=>x.remove());
 assert.equal(after.window.document.body.outerHTML,before.window.document.body.outerHTML);
 before.window.close();after.window.close();
});
test('external WebP files contain byte-identical source images',()=>{
 const images=[...baseline.matchAll(/data:image\/webp;base64,([A-Za-z0-9+/=]+)/g)];assert.equal(images.length,10);
 for(const [,base64] of images){const bytes=Buffer.from(base64,'base64'),hash=createHash('sha256').update(bytes).digest('hex').slice(0,20),path='/brand/landing/'+hash+'.webp';assert(LANDING_HTML.includes(path));assert.deepEqual(readFileSync(new URL('..'+path,import.meta.url)),bytes);}
});
test('scroll reveal uses its original observer and missing-observer fallback',()=>{
 const code=LANDING_HTML.split('\n').find(line=>line.startsWith("if('IntersectionObserver' in window)"));
 for(const preference of ['reduce','no-preference']){
  const shown=new Set(),node={classList:{add:value=>shown.add(value)}};
  runInNewContext(code,{window:{preference},document:{querySelectorAll:()=>[node]}});assert(shown.has('in'));
  let callback;shown.clear();class Observer{constructor(cb){callback=cb;}observe(){}unobserve(){}}
  runInNewContext(code,{window:{preference,IntersectionObserver:Observer},IntersectionObserver:Observer,document:{querySelectorAll:()=>[node]}});
  callback([{isIntersecting:true,target:node}]);assert(shown.has('in'));
 }
});
test('static fallback survives until iframe load and then gives the iframe its original display',async()=>{
 const dom=new JSDOM('<div id="root"><main data-public-landing-fallback>Visible fallback</main></div><script nonce="fixture-nonce"></script>',{url:'https://fixture.invalid/'});
 const previous={window:globalThis.window,document:globalThis.document};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 const controller=new dom.window.AbortController(),root=document.createElement('div');
 try{
  const {mount}=await import('../modules/auth/public.js');
  await mount({root,url:new URL(window.location),signal:controller.signal,navigate:async()=>{}});
  const frame=root.querySelector('iframe');assert(frame);
  assert(root.querySelector('[data-public-landing-fallback]'));
  assert.equal(frame.style.display,'none');
  frame.dispatchEvent(new dom.window.Event('load'));
  assert.equal(root.querySelector('[data-public-landing-fallback]'),null);
  assert.equal(frame.style.display,'block');
 }finally{controller.abort();dom.window.close();Object.assign(globalThis,previous);}
});
test('computed animation styles match both browser preferences',{skip:!process.env.VISUAL_EVIDENCE&&'Chrome launch and local TCP listeners are denied in this sandbox'},()=>{
 const evidence=JSON.parse(readFileSync(process.env.VISUAL_EVIDENCE,'utf8'));
 for(const width of [390,768,1440]){const rows=evidence.filter(x=>x.path==='/'&&x.width===width);assert.equal(rows.length,2);assert.deepEqual(rows[0].animations,rows[1].animations);}
});
