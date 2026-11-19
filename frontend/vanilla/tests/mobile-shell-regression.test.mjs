import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modulePrewarm} from '../js/module-prewarm.js';

test('mobile does not schedule speculative bulk module or grammar imports',()=>{
 const controller=new AbortController();
 let scheduled=0;
 const warmer=modulePrewarm({
  root:new EventTarget(),routes:[],signal:controller.signal,
  window:{innerWidth:390,matchMedia:()=>({matches:true}),location:new URL('https://fixture.invalid/app')},
  document:{visibilityState:'visible'},
  navigator:{onLine:true,connection:{effectiveType:'4g'}},
  setTimer:()=>++scheduled,clearTimer:()=>{},
 });
 try{assert.equal(scheduled,0);}finally{warmer.dispose();controller.abort();}
});

test('unconstrained desktop retains idle module prewarm',()=>{
 const controller=new AbortController();
 const scheduled=[];
 const warmer=modulePrewarm({
  root:new EventTarget(),routes:[],signal:controller.signal,
  window:{innerWidth:1440,matchMedia:()=>({matches:false}),location:new URL('https://fixture.invalid/app')},
  document:{visibilityState:'visible'},
  navigator:{onLine:true,connection:{effectiveType:'4g'}},
  setTimer:(callback,delay)=>{scheduled.push(delay);return scheduled.length;},clearTimer:()=>{},
 });
 try{assert.deepEqual(scheduled,[2200,5000]);}finally{warmer.dispose();controller.abort();}
});

test('mobile search is icon-first, expands to a focusable input and has a close control',()=>{
 const css=readFileSync(new URL('../modules/shared/design-system.css',import.meta.url),'utf8');
 const search=readFileSync(new URL('../modules/shell/search.js',import.meta.url),'utf8');
 assert.match(css,/\[data-global-search-trigger\]\s*\{\s*display:inline-flex!important/);
 assert.match(css,/\[data-global-search\]\[data-search-open="true"\] \[data-global-search-field\]/);
 assert.match(css,/\[data-campus-section-title\] \.native-module-title\s*\{/);
 assert.match(search,/holder\.dataset\.searchOpen=String\(open\)/);
 assert.match(search,/function show\(\)\{[^}]*input\.focus\(\)/);
 assert.match(search,/listen\(close,'click',\(\)=>hide\(\)/);
});
