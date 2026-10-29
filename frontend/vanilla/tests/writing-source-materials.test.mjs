import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup,tick} from './staff-final30/harness.mjs';
import {mountTab} from '../modules/writing/exam.js';
import {mountTab as translation} from '../modules/writing/translation.js';

const source=JSON.parse(readFileSync(new URL('../../../services/backend/app/writing_source_materials.json',import.meta.url)));
function env(path,locale='en'){
 const h=setup({path,locale,role:'student'});
 for(const k of ['localStorage','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement']) globalThis[k]=window[k];
 return h;
}
test('Retired Real Exam test pack remains absent in repository fixture',()=>{
 assert.deepEqual(source.prompts,[]);
 assert.deepEqual(source.fullTests,[]);
 assert.equal(source.translations.length,57);
});
for(const locale of ['en','uz']){
 test('Real Exam no longer offers retired source tests ('+locale+')',async()=>{
  const h=env('/app/writing?tab=exam',locale);
  try{
   h.stub({'/api/frontend/view':{version:1,route:h.ctx.url.pathname+h.ctx.url.search,data:{exam:{availability:{task1:0,task2:0},sourceMaterials:{fullTests:[],task1:[],task2:[]}}}}});
   mountTab(h.ctx,h.ctx.root);await tick();
   assert.equal(h.qa('[data-exam-mode-card]').length,3);
   assert.equal(h.qa('[data-writing-full-test]').length,0);
   assert.equal(h.qa('[data-writing-source-practice]').length,0);
   assert(h.qa('[data-exam-start]').every(b=>b.disabled));
  }finally{h.dispose();}
 });
 test('Translation retains all 57 independent materials ('+locale+')',async()=>{
  const h=env('/app/writing?tab=translation',locale);
  try{
   h.stub({'/api/frontend/view':{version:1,route:h.ctx.url.pathname+h.ctx.url.search,data:{sets:source.translations.map(t=>({...t,sentences:1}))}}});
   translation(h.ctx,h.ctx.root);await tick();h.click(h.q('[data-translation-path=topic]'));
   for(const t of source.translations) assert(h.ctx.root.textContent.includes(t.title));
  }finally{h.dispose();}
 });
}
