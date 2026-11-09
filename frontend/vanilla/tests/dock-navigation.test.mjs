import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setup,tick} from './staff-final30/harness.mjs';
import {fixtureSession} from './fixtures.mjs';
import {createShell,focusFrame} from '../modules/shell/layout.js';
import {moduleDock} from '../modules/shell/dock.js';
import {shellUtilities} from '../modules/shell/utilities.js';
import {supportsStudyFocus} from '../modules/shell/study-focus.js';
import routes from '../js/routes.js';
import * as dashboard from '../modules/dashboard.js';

const url=path=>new URL(path,'https://fixture.invalid');
function fixture(path='/app',role='student',locale='en'){
 const h=setup({path,role,locale});
 for(const key of ['MutationObserver','Element','localStorage','sessionStorage','CustomEvent'])globalThis[key]=h.dom.window[key];
 globalThis.innerWidth=h.dom.window.innerWidth;globalThis.innerHeight=h.dom.window.innerHeight;
 h.dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 h.ctx.session=fixtureSession(role).session;h.stub({'/api/notifications':{unread:0}});
 return h;
}
const press=(h,key='f',options={})=>(options.target??document).dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));

test('both home URLs mount the real Dashboard; no campus scene is loaded',async()=>{
 for(const path of ['/app','/app/dashboard']){
  const route=routes.find(r=>r.pattern===path);assert.equal((await route.load()).mount,dashboard.mount);assert(route.protected);assert(route.progressiveMount);
 }
});
for(const role of ['student','teacher','admin','owner'])test(`${role}: Dock preserves the requested order and Management boundary`,()=>{
 const h=fixture('/app',role);
 try{
  const dock=moduleDock(h.ctx);h.ctx.root.append(dock.node);
  const entries=h.qa('[data-dock-module]'),keys=entries.map(a=>a.dataset.dockModule);
  assert.deepEqual(keys.slice(0,12),['dashboard','live-classes','assignments','mocks','video-lessons','listening','reading','writing','speaking','grammar','vocabulary','progress']);
  assert.equal(keys.includes('management'),role!=='student');
  assert.equal(keys.length,role==='student'?13:14);
  for(const removed of ['/app/courses/ielts','/app/coach','/app/reports'])assert(!entries.some(a=>a.getAttribute('href')===removed));
  if(role!=='student')assert.equal(keys.at(-1),'management');
  assert(!entries.some(a=>/^\/app\/(admin|teacher|owner)(?:\/|$)/.test(a.getAttribute('href'))));
  for(const a of entries){assert(a.getAttribute('aria-label'));assert(a.getAttribute('href').startsWith('/app'));}
  assert.equal(entries[0].getAttribute('aria-current'),'page');dock.update(url('/app/dashboard'));assert.equal(entries[0].getAttribute('aria-current'),'page');
 }finally{h.dispose();}
});
test('Back pages hide Dock on direct entry and on same-document updates; returning restores it',()=>{
 const h=fixture('/app/speaking/ai','owner');
 try{
  const shell=createShell(h.ctx);h.ctx.root.append(shell.host);const dock=h.q('[data-module-dock]'),back=h.q('[data-campus-back-link]');
  assert(dock.hidden);assert(!back.hidden);assert.equal(back.getAttribute('href'),'/app/speaking');
  for(const path of ['/app','/app/speaking','/app/listening/lessons','/app/reading/lessons','/app/writing?tab=typing','/app/management']){
   shell.update(url(path));assert(!dock.hidden,path);assert(back.hidden,path);assert.equal(h.q('[data-campus-main-link]'),null);
  }
  for(const path of ['/app/speaking/ai','/app/speaking/practice?part=part2','/app/speaking/practice?part=part2&topic=work','/app/live-classes/example','/app/video-lessons/example','/app/management?view=mocks','/app/management?view=mock-grading','/app/admin/people']){
   shell.updateLocation(url(path));assert(dock.hidden,path);assert(!back.hidden,path);
  }
  shell.updateLocation(url('/app/speaking'));assert(!dock.hidden);assert(back.hidden);
 }finally{h.dispose();}
});
for(const locale of ['en','uz'])test(`${locale}: eject menu and F toggle focus without replacing live form content`,async()=>{
 const h=fixture('/app/writing', 'student',locale);
 try{
  const shell=createShell(h.ctx);h.ctx.root.append(shell.host);const draft=document.createElement('textarea');draft.value='My unfinished answer';shell.outlet.append(draft);
  h.click(h.q('[data-utilities-launcher]'));const toggle=h.q('[data-focus-toggle]');assert(toggle);assert.equal(toggle.getAttribute('aria-pressed'),'false');assert.equal(toggle.textContent,h.ctx.dict.focus.enter);
  h.click(toggle);await tick();assert.equal(document.documentElement.dataset.studyFocus,'on');assert(h.q('[data-module-dock]').hidden);assert.equal(h.q('[data-focus-indicator]').textContent,'Focus');assert.equal(h.q('[data-shell-utilities-panel]'),null);h.click(h.q('[data-utilities-launcher]'));assert.equal(h.q('[data-focus-toggle]').getAttribute('aria-pressed'),'true');
  press(h,'F');await tick();assert.equal(document.documentElement.dataset.studyFocus,'off');assert(!h.q('[data-module-dock]').hidden);
  assert.equal(shell.outlet.querySelector('textarea'),draft);assert.equal(draft.value,'My unfinished answer');assert.equal(h.nav.length,0);assert(!h.calls.some(c=>c.method!=='GET'));
  shell.update(url('/app/speaking'));h.click(h.q('[data-utilities-launcher]'));assert.equal(h.q('[data-focus-toggle]'),null);press(h);assert.equal(document.documentElement.dataset.studyFocus,'off');
  assert(!h.ctx.root.textContent.includes('press F'));assert(!h.ctx.root.querySelector('[aria-keyshortcuts="F"]'));
 }finally{h.dispose();}
});
test('typing, modifiers, composition, held keys and dialogs keep their keyboard input',()=>{
 const h=fixture('/app/reading/lessons');
 try{
  h.ctx.root.append(shellUtilities(h.ctx).node);
  for(const tag of ['input','textarea','select']){
   const field=document.createElement(tag);h.ctx.root.append(field);field.focus();press(h,'f',{target:field});assert.equal(document.documentElement.dataset.studyFocus,'off',tag);field.remove();
  }
  const editable=document.createElement('div');editable.contentEditable='true';editable.setAttribute('contenteditable','true');h.ctx.root.append(editable);press(h,'f',{target:editable});assert.equal(document.documentElement.dataset.studyFocus,'off');editable.remove();
  for(const options of [{ctrlKey:true},{metaKey:true},{altKey:true},{repeat:true},{isComposing:true}]){press(h,'f',options);assert.equal(document.documentElement.dataset.studyFocus,'off');}
  const dialog=document.createElement('dialog');dialog.setAttribute('open','');const button=document.createElement('button');dialog.append(button);h.ctx.root.append(dialog);button.focus();press(h,'f',{target:button});assert.equal(document.documentElement.dataset.studyFocus,'off');dialog.remove();
  press(h);assert.equal(document.documentElement.dataset.studyFocus,'on');h.controller.abort();assert.equal(document.documentElement.dataset.studyFocus,'off');press(h);assert.equal(document.documentElement.dataset.studyFocus,'off');
 }finally{h.dispose();}
});
test('Study Focus follows the existing Back policy; deep exams never offer an extra toggle',()=>{
 const h=fixture('/app/reading/lessons');
 try{
  for(const path of ['/app/listening/tests','/app/reading/lessons','/app/writing','/app/grammar/lessons','/app/vocabulary','/app/mocks','/app/assignments'])assert(supportsStudyFocus(url(path)),path);
  for(const path of ['/app','/app/progress','/app/profile','/app/management','/app/admin/people','/app/speaking','/app/speaking/ai','/app/speaking/practice','/app/listening/tests/x/study','/app/reading/attempts/x','/app/live-classes/x'])assert(!supportsStudyFocus(url(path)),path);
 }finally{h.dispose();}
});
test('focus detail frames retain the exact exam DOM without a Dock, mascot or extra Focus toggle',()=>{
 for(const path of ['/app/listening/tests/x/study','/app/reading/attempts/x']){
  const h=fixture(path);
  try{const staging=document.createElement('div'),exam=document.createElement('section');exam.dataset.fixtureExam='';staging.append(exam);const frame=focusFrame(h.ctx,staging);h.ctx.root.append(frame);assert(frame.contains(exam));assert.equal(frame.querySelector('[data-ui-system]'),null);assert.equal(h.q('[data-module-dock]'),null);assert.equal(h.q('.la-mascot'),null);h.click(h.q('[data-utilities-launcher]'));assert.equal(h.q('[data-focus-toggle]'),null);press(h);assert.equal(document.documentElement.dataset.studyFocus,'off');}finally{h.dispose();}
 }
});
test('Retention keeps its automatic focus ownership; Dock follows it',async()=>{
 const h=fixture('/app/reading/retention');
 try{
  const shell=createShell(h.ctx);h.ctx.root.append(shell.host);document.documentElement.dataset.retentionFocus='on';document.documentElement.dataset.focus='on';await tick();assert(h.q('[data-module-dock]').hidden);
  press(h);press(h);assert.equal(document.documentElement.dataset.focus,'on');assert.equal(document.documentElement.dataset.retentionFocus,'on');
  delete document.documentElement.dataset.retentionFocus;await tick();assert(!h.q('[data-module-dock]').hidden);
 }finally{h.dispose();}
});
test('Dock tooltip, magnification and keyboard navigation work without route mutations',async()=>{
 const h=fixture();
 try{
  const dock=moduleDock(h.ctx);h.ctx.root.append(dock.node);const first=h.q('[data-dock-module]'),last=h.qa('[data-dock-module]').at(-1),nav=first.parentElement;
  first.getBoundingClientRect=()=>({left:100,width:48,top:700,height:58});
  first.dispatchEvent(new window.Event('pointerover',{bubbles:true}));assert.equal(h.q('.module-dock__label').textContent,first.getAttribute('aria-label'));assert(!h.q('.module-dock__label').hidden);
  nav.dispatchEvent(new window.MouseEvent('pointermove',{clientX:124,bubbles:true}));await new Promise(r=>window.requestAnimationFrame(r));assert(Number(first.style.getPropertyValue('--dock-scale'))>1);
  dock.node.dispatchEvent(new window.Event('pointerleave'));assert.equal(first.style.getPropertyValue('--dock-scale'),'');assert(h.q('.module-dock__label').hidden);
  first.focus();press(h,'ArrowLeft',{target:first});assert.equal(document.activeElement,last);press(h,'Home',{target:last});assert.equal(document.activeElement,first);assert.equal(h.nav.length,0);
 }finally{h.dispose();}
});
test('Dock navigation starts immediately without capturing or animating a window, including reduced motion',()=>{
 const h=fixture();
 try{
  const shell=createShell(h.ctx);h.ctx.root.append(shell.host);const content=document.createElement('article');shell.outlet.append(content);
  let calls=0;const old=window.Element.prototype.animate;window.Element.prototype.animate=()=>{calls++;throw Error('Unexpected opening animation');};
  try{for(const reduced of [false,true]){window.matchMedia=()=>({matches:reduced});const flight=new AbortController();shell.begin(url('/app/writing'),flight.signal,h.q('[data-dock-module="writing"]'));shell.update(url('/app/writing'));shell.end(true);assert.equal(calls,0);assert.equal(h.q('[data-dock-opening]'),null);assert(shell.outlet.contains(content));flight.abort();}}finally{window.Element.prototype.animate=old;}
 }finally{h.dispose();}
});
test('glass styles ship in the Python native build and reserve space for mobile scrolling',()=>{
 const css=fs.readFileSync(new URL('../css/dock.css',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),builder=fs.readFileSync(new URL('../../../scripts/build_native_assets.py',import.meta.url),'utf8');
 assert.match(css,/backdrop-filter:blur/);assert.match(css,/overflow-x:auto/);assert.match(css,/prefers-reduced-motion/);assert.match(html,/href="\/css\/dock.css"/);assert(builder.includes("'css/dock.css'"));
});
