import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mountTab as exam} from '../modules/writing/exam.js';
import {mountTab as grade} from '../modules/writing/grade.js';
import {mountTab as stealing} from '../modules/writing/stealing.js';
import {searchBox} from '../modules/vocabulary/search.js';
import {createShell,focusFrame} from '../modules/shell/layout.js';
import {BackLink} from '../modules/shared/presentation.js';
import {returnPolicy} from '../modules/campus/return-policy.js';
import {colorCascade,contrastRatio} from './helpers/css-contrast.mjs';
const styles=['../css/global.css','../css/campus.css'].map(p=>fs.readFileSync(new URL(p,import.meta.url),'utf8'));
function env(path){const h=setup({path,role:'student'});for(const key of ['localStorage','MutationObserver','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement'])globalThis[key]=window[key];Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);h.view=data=>h.stub({'/api/frontend/view':{version:1,route:h.ctx.url.pathname+h.ctx.url.search,data}});return h;}
test('exam entry cards show 20/40/60 minutes, task minimums, real availability, resume and recent dates',async()=>{
 const h=env('/app/writing?tab=exam');try{const d={exam:{availability:{task1:0,task2:2},open:null,recent:[]}};h.view(d);exam(h.ctx,h.ctx.root);await tick();assert.equal(h.qa('[data-exam-mode-card]').length,3);
 for(const [mode,time,min,disabled]of [['task1','20','150+',true],['task2','40','250+',false],['full','60','150+ / 250+',true]]){const card=h.q('[data-exam-mode-card='+mode+']');assert(card.querySelector('dl').textContent.includes(time));assert(card.querySelector('dl').textContent.includes(min));assert.equal(card.querySelector('button').disabled,disabled);}
 assert(h.q('[data-writing-exam-home] header').textContent.includes(h.ctx.dict.writingWorkspace.exam.eyebrow));
 h.ctx.root.replaceChildren();d.exam.open={id:ID(1),mode:'full',remainingSeconds:359,expiresAt:'2099-01-01T00:00:00Z'};d.exam.recent=[{id:ID(2),mode:'task2',startedAt:'2026-10-25T01:00:00Z',finalizeReason:'submitted'}];h.view(d);exam(h.ctx,h.ctx.root);await tick();assert(h.q('[data-exam-resume]').textContent.includes('05:59'));assert(h.q('[data-exam-recent]').textContent.includes('2026'));assert.equal(h.q('[data-exam-resume] a').getAttribute('href'),'/app/writing/exam/'+ID(1));
 }finally{h.dispose();}
});
test('grade entry has its active subtab, live AI notice, boxed form and four marking explanations',async()=>{
 const h=env('/app/writing?tab=grade');try{h.view({aiReady:false,essays:[],task1Prompts:[]});grade(h.ctx,h.ctx.root);await tick();assert.equal(h.q('[data-writing-grade] nav [aria-current=page]').getAttribute('href'),'/app/writing?tab=grade');assert(h.q('[data-grade-ai-unavailable]'));assert.equal(h.qa('[data-grade-how] li').length,h.ctx.dict.writingWorkspace.grade.how.length);assert(h.q('[data-grade-form]').parentElement.classList.contains('card'));
 }finally{h.dispose();}
});
test('My essays keeps task/date/word count, question, score and the active list tab',async()=>{
 const h=env('/app/writing?tab=grade&view=essays');try{h.view({aiReady:true,essays:[{id:ID(2),taskType:'task2',createdAt:'2026-10-25T01:00:00Z',wordCount:280,questionText:'Discuss education.',status:'evaluated',overall:7.5}]});grade(h.ctx,h.ctx.root);await tick();assert.equal(h.q('[data-writing-grade] nav [aria-current=page]').getAttribute('href'),'/app/writing?tab=grade&view=essays');const row=h.q('[data-grade-essays] a');for(const text of ['280','2026','Discuss education.','7.5'])assert(row.textContent.includes(text));assert.equal(h.q('[data-grade-ai-unavailable]'),null);
 }finally{h.dispose();}
});
test('language stealing has seven responsive workflow steps and explicit empty source/library panels',async()=>{
 const h=env('/app/writing?tab=language-stealing');try{h.view({library:{patterns:[],topics:[],bands:[],savedCount:0},sources:[],sessions:[],aiReady:false});stealing(h.ctx,h.ctx.root);await tick();const steps=h.q('[data-stealing-steps] ol');assert.equal(steps.children.length,7);assert(steps.classList.contains('lg:grid-cols-7'));assert(h.q('[data-stealing-library-empty]').textContent);assert(h.q('[data-stealing-filters]').querySelector('a[href*="bank=1"]'));
 }finally{h.dispose();}
});
test('Vocabulary search rejects an old response as soon as a new query is typed and supports status, outside click and keyboard selection',async()=>{
 const h=env('/app/vocabulary'),pending=[],opened=[];try{h.stub({'/api/vocabulary/search':raw=>new Promise(resolve=>pending.push({raw,resolve}))});h.ctx.root.append(searchBox(h.ctx,word=>opened.push(word.id)));const input=h.q('input'),wait=()=>new Promise(r=>setTimeout(r,190));h.input(input,'old');assert.equal(h.q('[data-search-status]').textContent,h.ctx.dict.common.loading);await wait();assert.equal(pending.length,1);h.input(input,'new');pending[0].resolve({results:[{id:'old',term:'old',definitionEn:'old definition'}]});await tick();assert.equal(h.q('[aria-expanded=true]'),null);await wait();pending[1].resolve({results:[{id:'one',term:'new',definitionEn:'new definition',translationUz:'yangi'},{id:'two',term:'newer',definitionEn:'another definition'}]});await tick();assert.equal(h.q('[data-search-status]').textContent,'2 '+h.ctx.dict.vocabulary.search.results);assert(h.q('[data-search-hit=one]').textContent.includes('yangi'));
 input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));assert.equal(input.getAttribute('aria-activedescendant'),'vocab-suggest-1');input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.deepEqual(opened,['two']);input.dispatchEvent(new window.FocusEvent('focus'));assert.equal(input.getAttribute('aria-expanded'),'true');document.body.dispatchEvent(new window.MouseEvent('mousedown',{bubbles:true}));assert.equal(input.getAttribute('aria-expanded'),'false');assert.equal(input.getAttribute('aria-activedescendant'),null);
 }finally{h.dispose();}
});
test('persistent shell uses the requested green borders on cards/forms/buttons and keeps the route Back only in its topbar',()=>{
 const h=env('/app/speaking/practice');try{h.stub({});h.ctx.back=()=>{};const shell=createShell(h.ctx);h.ctx.root.append(shell.host);shell.outlet.append(BackLink({fallbackHref:'/app/speaking',label:'Back'}));const card=document.createElement('section');card.className='card';card.innerHTML='<p>Words</p><input class="input"><textarea class="input"></textarea><button class="btn-primary">Save</button>';shell.outlet.append(card);
 for(const [path,color]of [['/app/reading/academic','#f59e0b'],['/app/listening/academic','#38bdf8'],['/app/writing?tab=grade','#10b981'],['/app/vocabulary','#fb7185'],['/app/admin/statistics','#d6b4ff'],['/app/speaking/practice','#c084fc']]){shell.update(new URL(path,'https://fixture.invalid'));const cascade=colorCascade(document,styles);for(const node of [card,...card.querySelectorAll('input,textarea,button')])assert.equal(cascade.resolve(node,'border-color'),'#22c55e',path);}
 const cascade=colorCascade(document,styles);assert.equal(cascade.get(shell.outlet.querySelector('[data-back-link]')).visible,false);assert.equal(cascade.get(shell.host.querySelector('[data-campus-back-link]')).visible,true);assert(shell.host.querySelector('[data-shell-topbar] [data-campus-back-link]'));
 const world=document.createElement('div');world.setAttribute('data-campus-world','');shell.outlet.append(world);assert.notEqual(colorCascade(document,styles).resolve(card,'border-color'),'#c084fc');
 }finally{h.dispose();}
});

test('Focus uses the flat themed section band and Writing retains the reference content width',()=>{
 const h=env('/app/writing?tab=exam');try{h.ctx.root.innerHTML='<div data-shell data-campus-shell><section data-native-module-header><h1 class="native-module-title">Real exam mode</h1></section><main data-writing-native class="mx-auto max-w-6xl"></main></div>';const writing=fs.readFileSync(new URL('../modules/writing/writing.css',import.meta.url),'utf8');
  for(const theme of ['day','night']){document.documentElement.dataset.theme=theme;document.documentElement.dataset.focus='on';const cascade=colorCascade(document,[...styles,writing]),band=h.q('[data-native-module-header]'),title=h.q('h1');assert.deepEqual(cascade.get(band).background.slice(0,3),theme==='day'?[255,255,255]:[26,22,37]);assert(contrastRatio(cascade.get(title).color,cascade.get(title).background)>=4.5);assert.equal(cascade.resolve(h.q('[data-writing-native]'),'max-width'),'72rem');}
 }finally{h.dispose();}
});
test('focus route frames put Back in the topbar and move the existing media/draft nodes intact',()=>{
 const h=env('/app/listening/tests/'+ID(1)+'/2');try{h.stub({});h.ctx.back=()=>{};const audio=document.createElement('audio'),draft=document.createElement('textarea');draft.value='An unsaved answer';h.ctx.root.append(audio,draft,BackLink({fallbackHref:'/app/listening/tests/'+ID(1),label:'Back'}));const stage=h.ctx.root,frame=focusFrame(h.ctx,stage);stage.replaceChildren(frame);assert.equal(frame.querySelector('audio'),audio);assert.equal(frame.querySelector('textarea'),draft);assert.equal(draft.value,'An unsaved answer');const back=frame.querySelector('[data-shell-topbar] [data-campus-back-link]');assert(back);assert.equal(back.getAttribute('href'),'/app/listening/tests/'+ID(1));assert.equal(returnPolicy(h.ctx.url).mode,'back');const cascade=colorCascade(document,styles);assert.equal(cascade.get(frame.querySelector('[data-shell-main] [data-back-link]')).visible,false);
  const own=document.createElement('div');own.innerHTML='<header class="reading-workspace-header">Exam controls</header>';assert.equal(focusFrame(h.ctx,own),own);
 }finally{h.dispose();}
});
for(const theme of ['day','night'])for(const focus of ['off','on'])test(`${theme}/${focus}: real topbar controls and section heading retain contrast`,async()=>{
 const h=env('/app/writing?tab=exam');try{h.stub({});document.documentElement.dataset.theme=theme;document.documentElement.dataset.focus=focus;const shell=createShell(h.ctx);h.ctx.root.append(shell.host);await tick();const cascade=colorCascade(document,styles),bad=[];let checked=0;
  for(const node of shell.host.querySelectorAll('[data-shell-topbar] *,[data-native-module-header] *')){const text=[...node.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim();if(!/[\p{L}\p{N}]/u.test(text)||node.closest('[disabled]'))continue;const s=cascade.get(node);if(!s.visible)continue;checked++;const ratio=contrastRatio(s.color,s.background);if(ratio<4.5)bad.push({text,ratio,color:s.color,background:s.background});}assert(checked>3);assert.deepEqual(bad,[]);assert.equal(cascade.unknown.size,0);
 }finally{h.dispose();}
});
test('Reading intro remains white and readable beside the shared header in all four palette combinations',()=>{
 const reading=fs.readFileSync(new URL('../modules/reading/reading-workspace.css',import.meta.url),'utf8');for(const theme of ['day','night'])for(const focus of ['off','on']){const h=env('/app/reading/academic/'+ID(1));try{h.stub({});document.documentElement.dataset.theme=theme;document.documentElement.dataset.focus=focus;h.ctx.root.innerHTML='<main class="reading-focus" data-reading-full-focus><section class="reading-exam-intro"><p class="body-text" data-check>Read three passages</p><article class="card"><span class="meta-text" data-check>Passage 1</span><h2 class="card-title" data-check>Reading</h2></article><button class="btn-primary" data-check>Full Reading</button></section></main>';const frame=focusFrame(h.ctx,h.ctx.root);h.ctx.root.replaceChildren(frame);const cascade=colorCascade(document,[...styles,reading]);for(const node of h.ctx.root.querySelectorAll('[data-check],[data-locale-switcher] button')){const s=cascade.get(node);assert(contrastRatio(s.color,s.background)>=4.5,`${theme}/${focus} ${node.textContent}`);}assert.deepEqual(cascade.get(h.q('.reading-exam-intro .card')).background,[255,255,255,1]);}finally{h.dispose();}}
});

test('gradient contrast uses the least readable paint for each foreground',()=>{
 const h=env('/app/dashboard');try{
  h.ctx.root.innerHTML='<div id="gradient-probe">Black<span>White</span></div>';
  const c=colorCascade(document,['#gradient-probe{background:linear-gradient(90deg,#3EE6D0 0%,#3B6CFF 100%);color:#000}#gradient-probe span{color:#fff}']);
  const black=c.get(h.q('#gradient-probe')),white=c.get(h.q('#gradient-probe span'));
  assert(contrastRatio(black.color,black.background)>=4.5);
  assert(contrastRatio(white.color,white.background)<4.5);
  assert.notDeepEqual(black.background,white.background);
  assert.equal(c.unknown.size,0);
 }finally{h.dispose();}
});
