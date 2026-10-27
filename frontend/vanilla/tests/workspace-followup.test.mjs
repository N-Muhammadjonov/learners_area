import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {colorCascade,contrastRatio} from './helpers/css-contrast.mjs';
import {dictionaryFolderDialog} from '../modules/vocabulary/dictionary-learner-ui.js';
import {contextualWordPopover} from '../modules/vocabulary/contextual-popover.js';
import {authShell} from '../js/components/auth-shell.js';
import {moduleLayout} from '../modules/shell/module-layout.js';
const styles=['../css/global.css','../css/campus.css','../modules/reading/reading-popover.css'].map(p=>fs.readFileSync(new URL(p,import.meta.url),'utf8'));
function readable(css,node){const s=css.get(node);assert(contrastRatio(s.color,s.background)>=4.5,`${node.textContent}: ${s.color}/${s.background}`);}
for(const theme of ['day','night'])for(const focus of ['off','on']){
 test(`${theme}/${focus}: module sections, folder labels and selected Retention level have contrast`,()=>{
  const h=setup({path:'/app/reading/general',role:'student'});try{
   document.documentElement.dataset.theme=theme;document.documentElement.dataset.focus=focus;
   h.ctx.root.innerHTML='<div data-campus-shell><header data-workspace-header><div data-native-module-header></div></header><main></main></div>';
   const header=h.q('[data-native-module-header]');
   for(const path of ['/app/reading/general','/app/listening/tests','/app/grammar','/app/vocabulary?tab=dictionary']){h.ctx.url=new URL(path,'https://fixture.invalid');header.append(moduleLayout(h.ctx,document.createElement('div')));}
   header.insertAdjacentHTML('beforeend','<div data-writing-tablist><button role="tab" aria-selected="true">Exam</button><button role="tab">Translation</button></div>');
   h.q('main').innerHTML='<button class="retention-level-option" aria-pressed="true"><strong>B2</strong><span class="meta-text">260 words</span></button><button class="retention-level-option" aria-pressed="false"><strong>C1</strong><span class="meta-text">300 words</span></button>';
   dictionaryFolderDialog(h.ctx,{entry:{display_lemma:'word'},sense:{translations:[{text:'so‘z'}]},folders:[{id:'study',name:'My Study Folder',count:3}],onClose(){},onSave(){},onCreate(){}});
   const css=colorCascade(document,styles);
   for(const node of document.querySelectorAll('[data-module-sections] a,[data-writing-tablist] button,.dictionary-folder-dialog label,.dictionary-folder-dialog label span,.retention-level-option strong,.retention-level-option span'))readable(css,node);
   for(const node of h.qa('.retention-level-option[aria-pressed=true],.retention-level-option[aria-pressed=true] strong,.retention-level-option[aria-pressed=true] span')){assert.deepEqual(css.get(node).background,[61,80,250,1]);assert.deepEqual(css.get(node).color,[255,255,255,1]);}
  }finally{h.dispose();}
 });
 test(`${theme}/${focus}: auth brand and account footer are white without changing the form`,()=>{
  const h=setup({path:'/login'});try{
   document.documentElement.dataset.theme=theme;document.documentElement.dataset.focus=focus;
   const form=document.createElement('input');form.setAttribute('data-public-auth','');h.ctx.root.append(authShell(h.ctx,{title:'Sign in',children:form,footer:'Have an account?'}));
   const css=colorCascade(document,styles);
   for(const node of h.qa('[data-auth-brand] .brand-name,[data-auth-brand] .brand-tagline,[data-auth-shell] > .w-full > .text-center'))assert.deepEqual(css.get(node).color,[255,255,255,1]);
   assert.equal(h.qa('[data-auth-shell] .card input').length,1);
  }finally{h.dispose();}
 });
}
test('Retention dictionary stays in the upper right and retains the linked meaning and folder',async()=>{
 const h=setup({path:'/app/reading/retention'});try{
  h.ctx.root.innerHTML='<div data-campus-shell><span data-clickable-text>linked</span></div>';
  h.stub({'/api/vocabulary/lookup':{contextual:{definitionEn:'Original linked meaning',translationUz:'Asl tarjima',verificationStatus:'verified'}},'/api/vocabulary/folders':{folders:[{id:'study',name:'Study'}]}});
  contextualWordPopover(h.ctx,{word:'linked',anchor:h.q('span'),sourceType:'retention',sourceId:ID(1),occurrenceId:ID(2),startChar:0,endChar:6});await tick(5);
  const popup=document.querySelector('[data-word-popover]');assert(popup.textContent.includes('Original linked meaning'));assert(popup.textContent.includes('Asl tarjima'));
  assert.equal(popup.style.left,'');assert.equal(popup.style.top,'');assert.equal(popup.style.visibility,'visible');
  for(const theme of ['day','night']){document.documentElement.dataset.theme=theme;const css=colorCascade(document,styles);for(const node of popup.querySelectorAll('p,select,option'))readable(css,node);}
  assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
 }finally{h.dispose();}
});
