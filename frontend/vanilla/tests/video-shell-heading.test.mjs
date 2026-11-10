import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {fixtureSession} from './fixtures.mjs';
import {createShell} from '../modules/shell/layout.js';
import {mount} from '../modules/video/detail.js';

test('TED detail hoists the loaded video name next to its module without a duplicate title or stale library heading',async()=>{
 const path='/app/video-lessons/'+ID(2),h=setup({path,role:'student'}),original=globalThis.AbortController;
 try{
  for(const key of ['MutationObserver','Element','localStorage','sessionStorage','CustomEvent','AbortController'])globalThis[key]=window[key];
  window.matchMedia=()=>({matches:false});h.ctx.session=fixtureSession().session;
  h.stub({'/api/notifications':{unread:0},'/api/frontend/view':{version:1,route:path,data:{detail:{videoLesson:{id:ID(2),provider:'youtube',videoId:'abcdefghijk',title:'How to Make Stress Your Friend',beforeYouWatch:null,durationSeconds:840,transcript:[],transcriptText:null,notes:null},questions:[],progress:null,vocabulary:{ready:true,items:[]},embedOrigin:window.location.origin}}}});
  const shell=createShell(h.ctx);h.ctx.root.append(shell.host);
  const staging=document.createElement('div');mount({...h.ctx,root:staging});shell.outlet.append(...staging.childNodes);shell.attachModuleHeader(shell.outlet);await tick(8);
  const header=h.q('[data-campus-section-title]'),title=header.querySelector('h1');assert.equal(title.textContent,'How to Make Stress Your Friend');
  assert(!header.textContent.includes(h.ctx.dict.videoLessons.title));assert(h.q('[data-video-detail-heading]').hidden);assert.equal(h.q('[data-video-detail-meta]').textContent,'14 min');
  assert.equal(h.q('[data-campus-back-link]').getAttribute('href'),'/app/video-lessons');
  shell.outlet.append(document.createElement('span'));await tick();assert.equal(header.querySelector('h1'),title);
  shell.update(new URL('/app/video-lessons',window.location.origin));assert.equal(header.querySelector('h1').textContent,h.ctx.dict.videoLessons.title);
 }finally{h.dispose();globalThis.AbortController=original;}
});
