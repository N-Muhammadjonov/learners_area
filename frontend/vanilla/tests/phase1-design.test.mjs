import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup} from './staff-final30/harness.mjs';import {fixtureSession,viewFixture} from './fixtures.mjs';
import {render as dashboard} from '../js/generated/dashboard.js';import {navigationList} from '../modules/shell/navigation-list.js';import {dockItems,moduleDock} from '../modules/shell/dock.js';
import {speakingMascot} from '../modules/shared/mascot.js';import {Button,RegionFailureNotice} from '../modules/shared/presentation.js';
import {EmptyState} from '../js/generated/ui.js';
import {ModuleEmoji,moduleEmojiFor} from '../js/generated/module-emoji.js';
for(const role of ['student','teacher','admin','owner'])test(role+': optional navigation and Dock render the exact authorized destinations and artwork',()=>{
 const h=setup({path:'/app/reading/lessons',role});
 try{
  globalThis.MutationObserver=h.dom.window.MutationObserver;
  const list=navigationList(h.ctx),dock=moduleDock(h.ctx);
  h.ctx.root.append(list,dock.node);
  assert(!list.open);
  assert(list.querySelector('summary'));
  const items=dockItems(h.ctx.dict,role);
  assert.deepEqual([...list.querySelectorAll('a')].map(a=>[a.dataset.navigationListItem,a.getAttribute('href'),a.textContent]),items.map(i=>[i.key,i.href,i.label]));
  assert.equal(list.querySelector('[aria-current="page"]').dataset.navigationListItem,'reading');
  assert.equal(dock.node.querySelector('[aria-current="page"]').dataset.dockModule,'reading');
  assert.equal(Boolean(list.querySelector('[data-navigation-list-item="management"]')),role!=='student');
  for(const item of items){
   for(const selector of [`[data-navigation-list-item="${item.key}"]`,`[data-dock-module="${item.key}"]`]){
    const artwork=h.q(selector).querySelector('svg');
    assert.equal(artwork.dataset.dockArtwork,item.key);
    assert.equal(artwork.getAttribute('focusable'),'false');
    assert(artwork.querySelector('path,image,rect'));
   }
   const icon=ModuleEmoji({kind:item.icon});
   assert.equal(icon.dataset.uiIcon,item.icon);
   assert(!icon.hasAttribute('data-ui-icon-fallback'));
   assert(icon.querySelector('path,rect,circle'));
  }
  dock.update(new URL('/app/study-plan/leaderboard',h.ctx.url));
  assert.equal(dock.node.querySelector('[aria-current="page"]').dataset.dockModule,'leaderboard');
  h.ctx.url=new URL('/app/study-plan/leaderboard',h.ctx.url);
  const ranked=navigationList(h.ctx);
  assert.equal(ranked.querySelector('[aria-current="page"]').dataset.navigationListItem,'leaderboard');
  list.open=true;
  const link=list.querySelector('[data-navigation-list-item="leaderboard"]');
  link.focus();
  assert.equal(document.activeElement,link);
  for(const root of [list,dock.node]){
   const image=root.querySelector('[data-dock-artwork="leaderboard"] image');
   assert.equal(image.getAttribute('href'),'/images/dock/neon/leaderboard.webp');
  }
 }finally{h.dispose();delete globalThis.MutationObserver;}
});
test('leaderboard has a dedicated vector, and unknown module artwork emits a diagnostic',t=>{
 const h=setup();
 const warn=t.mock.method(console,'warn',()=>{});
 try{
  assert.equal(moduleEmojiFor('/app/leaderboard'),'leaderboard');
  assert.equal(moduleEmojiFor('constructor'),null);
  const leaderboard=ModuleEmoji({kind:'leaderboard'});
  assert.equal(leaderboard.querySelectorAll('path').length,2);
  assert.equal(warn.mock.callCount(),0);
  for(const kind of ['missing-module','constructor','__proto__']){
   const icon=ModuleEmoji({kind});
   assert.equal(icon.dataset.uiIcon,'dashboard');
   assert.equal(icon.dataset.uiIconFallback,kind);
   assert(icon.querySelector('svg rect'));
   assert.deepEqual(warn.mock.calls.at(-1).arguments,['Missing Learners Area module icon:',kind]);
  }
  assert.equal(warn.mock.callCount(),3);
  const webp=readFileSync(new URL('../images/dock/neon/leaderboard.webp',import.meta.url));
  assert.equal(webp.toString('ascii',0,4),'RIFF');
  assert.equal(webp.toString('ascii',8,12),'WEBP');
 }finally{h.dispose();}
});
test('Dashboard overview preserves actual target and learning destinations without nested controls',()=>{
 const h=setup({path:'/app/dashboard',role:'student'});try{const data=viewFixture('/app'),input=structuredClone(data);data.dashboard.profile={targetBand:8.5};data.dashboard.streak=0;data.mock.finishedCount=0;
 const n=dashboard({context:{refresh(){}},dict:h.ctx.dict,locale:'en',user:fixtureSession().session.user,...data});h.ctx.root.append(n);
 assert(n.textContent.includes('8.5'));assert.equal(n.querySelectorAll('a button,button a').length,0);
 const content=n.querySelector('[data-dashboard-content]');assert(content.querySelector('[data-dashboard-stats]'));assert.equal(content.children[1].hasAttribute('data-dashboard-skills'),true);assert(content.querySelector('[data-retention-drill] a[href="/app/reading/retention"]'));
 assert.equal(content.querySelectorAll('[data-ui-skill]').length,4);assert.equal(n.lastElementChild.hasAttribute('data-dashboard-mock-overview'),true);assert.equal(data.dashboard.skillCounts.reading,input.dashboard.skillCounts.reading);
 }finally{h.dispose();}
});
test('unknown target is omitted; no band is estimated from missing learner data',()=>{
 const h=setup({path:'/app/dashboard'});try{const data=viewFixture('/app');data.mock.finishedCount=0;const n=dashboard({context:{refresh(){}},dict:h.ctx.dict,locale:'en',user:fixtureSession().session.user,...data});h.ctx.root.append(n);assert(!n.querySelector('[data-dashboard-stats]').textContent.includes(h.ctx.dict.dashboard.targetBand));}finally{h.dispose();}
});
test('empty and failure remain different; retry keeps its callback and loading locks duplicate actions',async()=>{
 const h=setup();try{const empty=EmptyState({title:'No history',body:'Start an existing practice.'});assert(empty.hasAttribute('data-empty-state'));assert(empty.querySelector('h2'));assert(!empty.hasAttribute('role'));
 let release,calls=0;const failure=RegionFailureNotice({region:'fixture',message:'Unable to load',retryLabel:'Retry',refresh:()=>{calls++;return new Promise(r=>release=r);}});h.ctx.root.append(empty,failure);const b=failure.querySelector('button');h.click(b);h.click(b);assert.equal(calls,1);assert(b.disabled);assert.equal(b.getAttribute('aria-busy'),'true');release();await Promise.resolve();await Promise.resolve();assert(!b.disabled);
 const loading=Button({children:'Save',loading:true});assert(loading.disabled);assert.equal(loading.getAttribute('aria-busy'),'true');assert.equal(loading.textContent,'Save');
 }finally{h.dispose();}
});
test('original companion is decorative, has unique SVG ids and never starts media',()=>{
 const h=setup();try{const a=speakingMascot(),b=speakingMascot({state:'success'});h.ctx.root.append(a,b);assert.equal(a.getAttribute('aria-hidden'),'true');assert.equal(a.querySelector('svg').getAttribute('focusable'),'false');assert.notEqual(a.querySelector('linearGradient').id,b.querySelector('linearGradient').id);assert.equal(h.calls.length,0);assert.equal(a.querySelectorAll('audio,video,button,input').length,0);}finally{h.dispose();}
});
test('primary hover endpoints retain AA text contrast and skill colors are independent from states',()=>{
 const css=readFileSync(new URL('../modules/shared/design-system.css',import.meta.url),'utf8');
 const rgb=hex=>hex.match(/[a-f\d]{2}/gi).map(x=>parseInt(x,16));const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 for(const token of ['start','end']){const c=rgb(css.match(new RegExp('--la-primary-'+token+':(#[a-f0-9]{6})'))[1]);for(const brightness of [1,1.08])assert((1.05)/(lum(c.map(v=>Math.min(255,v*brightness)))+.05)>=4.5,token+' contrast');}
 assert(css.includes('@keyframes la-ui-spin'));assert(css.includes('[data-ui-status="completed"]'));assert(css.includes('--la-writing:'));assert(!css.includes('transition:all'));
});
