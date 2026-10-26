import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mountTab,mount as exam} from '../modules/writing/exam.js';
import {mount as submission} from '../modules/writing/submissions.js';
import {mountTab as translation} from '../modules/writing/translation.js';
const source=JSON.parse(readFileSync(new URL('../../../services/backend/app/writing_source_materials.json',import.meta.url)));
const ready=source.prompts.filter(p=>p.publicationState==='published');
const catalogue={fullTests:source.fullTests.filter(t=>t.ready),task1:ready.filter(p=>p.taskType==='task1').map(p=>({id:p.id,title:p.practice.title})),task2:ready.filter(p=>p.taskType==='task2').map(p=>({id:p.id,title:p.practice.title}))};
const prompt=p=>({...p,materials:p.image?[{id:p.image.resourceId,type:'image',objectKey:p.image.objectKey,originalName:p.image.originalName}]:[]});
function env(path,locale='en'){const h=setup({path,locale,role:'student'});for(const k of ['localStorage','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement'])globalThis[k]=window[k];return h;}
for(const locale of ['en','uz']){
 test(`Writing home lists all ready source groups and selects the exact full test (${locale})`,async()=>{
  const h=env('/app/writing?tab=exam',locale),fetch=globalThis.fetch;
  try{
   h.stub({'/api/frontend/view':{version:1,route:h.ctx.url.pathname+h.ctx.url.search,data:{exam:{availability:{task1:49,task2:55},sourceMaterials:catalogue}}}});
   mountTab(h.ctx,h.ctx.root);await tick();
   assert.equal(h.qa('[data-exam-mode-card]').length,3);
   assert.deepEqual(h.qa('[data-writing-full-test] option').map(x=>x.textContent),catalogue.fullTests.map(x=>x.title));
   assert.equal(h.qa('[data-writing-source-practice=task1] a').length,49);
   assert.equal(h.qa('[data-writing-source-practice=task2] a').length,55);
   for(const p of source.prompts.filter(p=>p.publicationState==='draft'))assert(!h.qa('a').some(a=>a.href.endsWith(p.id)));
   let sent;globalThis.fetch=async(url,options)=>{sent={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({id:ID(9)}),{status:200});};
   h.change(h.q('[data-writing-full-test]'),'D15');h.click(h.q('[data-exam-start=full]'));await tick();
   assert.deepEqual(sent,{url:'/api/writing/exam',body:{mode:'full',fullTest:'D15'}});
   assert.equal(h.nav[0].path,'/app/writing/exam/'+ID(9));
  }finally{globalThis.fetch=fetch;h.dispose();}
 });
 test(`Every published practice prompt keeps its original question, guide and graph (${locale})`,async()=>{
  for(const p of ready){const path='/app/writing/prompts/'+p.id,h=env(path,locale);try{
   h.stub({'/api/frontend/view':{version:1,route:h.ctx.url.pathname+h.ctx.url.search,data:{prompt:prompt(p)}}});submission(h.ctx);await tick();
   assert.equal(h.q('h1').textContent,p.prompt);
   const guide=h.q('[data-writing-practice-guide]');assert(guide);
   assert(guide.textContent.includes(p.practice.title));for(const text of p.practice.instructions)assert(guide.textContent.includes(text));
   assert.equal(h.qa('[data-resource-block=image] img').length,p.image?1:0);
   if(p.image)assert.equal(h.q('img').getAttribute('src'),'/api/resources/'+p.image.objectKey);
  }finally{h.dispose();}}
 });
 test(`All 57 translation titles are in Translation (${locale})`,async()=>{
  const h=env('/app/writing?tab=translation',locale);try{
   h.stub({'/api/frontend/view':{version:1,route:h.ctx.url.pathname+h.ctx.url.search,data:{sets:source.translations.map(t=>({...t,sentences:1}))}}});translation(h.ctx,h.ctx.root);await tick();h.click(h.q('[data-translation-path=topic]'));
   for(const t of source.translations){assert(h.ctx.root.textContent.includes(t.title));assert(!h.ctx.root.textContent.includes(t.modelEnglish));}
  }finally{h.dispose();}
 });
}
test('Timed Full Writing switches the original A40 graph without practice instructions',async()=>{
 const pair=source.fullTests.find(t=>t.code==='A40'),prompts=pair.promptIds.map(id=>source.prompts.find(p=>p.id===id));
 const h=env('/app/writing/exam/'+ID(8));try{
  h.stub({'/api/frontend/view':{version:1,route:h.ctx.url.pathname+h.ctx.url.search,data:{paper:{id:ID(8),mode:'full',remainingSeconds:3600,entries:prompts.map((p,i)=>({position:i+1,promptId:p.id,prompt:p.prompt,taskType:p.taskType,content:'',revision:0}))},materials:{1:prompt(prompts[0]).materials}}}});
  exam(h.ctx);await tick();assert.equal(h.q('[data-exam-prompt]').textContent,prompts[0].prompt);
  assert.equal(h.q('[data-exam-materials] img').getAttribute('src'),'/api/resources/'+prompts[0].image.objectKey);
  assert.equal(h.q('[data-writing-practice-guide]'),null);assert(!h.ctx.root.textContent.includes(prompts[0].practice.instructions[0]));
  h.click(h.q('[data-exam-task-tab=task2]'));assert.equal(h.q('[data-exam-prompt]').textContent,prompts[1].prompt);assert.equal(h.q('[data-exam-materials] img'),null);
 }finally{h.dispose();}
});
