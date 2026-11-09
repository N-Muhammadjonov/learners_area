import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup} from './staff-final30/harness.mjs';import {fixtureSession,viewFixture} from './fixtures.mjs';
import {render as dashboard} from '../js/generated/dashboard.js';import {navigationList} from '../modules/shell/navigation-list.js';import {dockItems} from '../modules/shell/dock.js';
import {speakingMascot} from '../modules/shared/mascot.js';import {Button,RegionFailureNotice} from '../modules/shared/presentation.js';
import {EmptyState} from '../js/generated/ui.js';
for(const role of ['student','teacher','admin','owner'])test(role+': optional navigation lists the exact authorized Dock destinations',()=>{
 const h=setup({path:'/app/reading/lessons',role});try{const n=navigationList(h.ctx);h.ctx.root.append(n);assert(!n.open);assert(n.querySelector('summary'));assert.deepEqual([...n.querySelectorAll('a')].map(a=>[a.dataset.navigationListItem,a.getAttribute('href'),a.textContent]),dockItems(h.ctx.dict,role).map(i=>[i.key,i.href,i.label]));assert.equal(n.querySelector('[aria-current="page"]').dataset.navigationListItem,'reading');assert.equal(Boolean(n.querySelector('[data-navigation-list-item="management"]')),role!=='student');}finally{h.dispose();}
});
test('Dashboard hierarchy, actual target and all shortcuts preserve source values without nested interactive controls',()=>{
 const h=setup({path:'/app/dashboard',role:'student'});try{const data=viewFixture('/app'),input=structuredClone(data);data.dashboard.profile={targetBand:8.5};data.dashboard.streak=0;data.mock.finishedCount=0;
 const n=dashboard({context:{refresh(){}},dict:h.ctx.dict,locale:'en',user:fixtureSession().session.user,...data});h.ctx.root.append(n);
 assert(n.textContent.includes('8.5'));assert.equal(n.querySelectorAll('a button,button a').length,0);
 const content=n.querySelector('[data-dashboard-content]');assert(content.querySelector('[data-my-tasks]'));assert.equal(content.children[1].hasAttribute('data-my-tasks'),true);assert.equal(content.children[2].hasAttribute('data-dashboard-skills'),true);
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
 assert(css.includes('prefers-reduced-motion:reduce'));assert(css.includes('[data-ui-status="completed"]'));assert(css.includes('--la-writing:'));assert(!css.includes('transition:all'));
});
