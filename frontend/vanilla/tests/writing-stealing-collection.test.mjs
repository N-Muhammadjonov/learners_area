import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {setup,tick,ID} from './staff-final30/harness.mjs';import {mountTab,mount} from '../modules/writing/stealing.js';
const data=JSON.parse(readFileSync(new URL('../../../services/backend/app/writing_stealing_collection.json',import.meta.url)));
const patterns=mid=>data.patterns.filter(p=>!mid||p.modelId===mid).map(p=>({...p,fn:p.function,saved:false}));
const sources=data.models.map(m=>({...m,patternCount:10}));
for(const locale of ['en','uz']){
 test(`All 15 sources, 150 chunks and original study method are available together (${locale})`,async()=>{
  const h=setup({path:'/app/writing?tab=language-stealing',role:'student',locale});try{
   h.stub({'/api/frontend/view':{version:1,route:h.ctx.url.pathname+h.ctx.url.search,data:{sources,sourceCollection:{method:data.method,notice:data.notice},sessions:[],library:{patterns:patterns(),topics:[],bands:[],savedCount:0,hasMore:false},aiReady:false}}});
   mountTab(h.ctx,h.ctx.root);await tick();assert.equal(h.qa('[data-stealing-pattern]').length,150);
   for(const m of data.models)assert(h.ctx.root.textContent.includes(m.title));
   assert(h.ctx.root.textContent.includes(locale==='uz'?'Taxminiy band 8.5':'Estimated band 8.5'));
   const method=h.q('[data-stealing-collection-method]');assert(method);for(const text of data.method)assert(method.textContent.includes(text));
   assert(method.textContent.includes(data.notice[locale]));assert(!h.ctx.root.textContent.includes('Band null'));
   assert(!h.qa('a').some(a=>a.textContent.includes(h.ctx.dict.writingWorkspace.stealing.morePatterns)));
  }finally{h.dispose();}
 });
 test(`Each original essay, prompt and estimated feedback stays paired (${locale})`,async()=>{
  for(const m of data.models)for(const step of [1,4]){const id=ID(m.number),h=setup({path:'/app/writing/language-stealing/'+id,role:'student',locale});try{
   const view={id,step,source:{...m},modelBody:m.body,modelFeedback:step===4?m.feedback:null,patterns:step===4?patterns(m.id):null,selectedPatternIds:[],memorisedPatternIds:[]};
   h.stub({'/api/frontend/view':{version:1,route:h.ctx.url.pathname,data:{view}}});mount(h.ctx);await tick();
   assert.equal(h.q('[data-stealing-source-prompt]').textContent,m.prompt);assert.equal(h.q('[data-stealing-model-body]').textContent,m.body);
   assert.equal(h.qa('[data-step-state]').length,7);assert.equal(h.q('[data-step-state=current]').textContent.startsWith(String(step)),true);
   if(step===4){assert(h.q('[data-stealing-model-feedback]').textContent.includes(m.feedback));for(const p of patterns(m.id))assert(h.ctx.root.textContent.includes(p.pattern));}
   else assert.equal(h.q('[data-stealing-model-feedback]'),null);
   assert(h.qa('a').some(a=>a.getAttribute('href')===m.promptSourceUrl));
  }finally{h.dispose();}}
 });
}
test('Draft and delayed rewrite preserve the hidden-model stages',async()=>{
 const m=data.models[0];for(const step of [2,3,7]){const h=setup({path:'/app/writing/language-stealing/'+ID(1),role:'student'});try{
  h.stub({'/api/frontend/view':{version:1,route:h.ctx.url.pathname,data:{view:{id:ID(1),step,source:{...m},modelBody:null,modelFeedback:null,patterns:[],selectedPatternIds:[],rewriteUnlocked:false}}}});mount(h.ctx);await tick();
  assert.equal(h.q('[data-stealing-model-body]'),null);assert.equal(h.q('[data-stealing-model-feedback]'),null);assert.equal(h.q('[data-stealing-source-prompt]').textContent,m.prompt);
  if(step===7)assert(h.q('[data-stealing-rewrite-locked]'));else assert(h.q('[data-stealing-text]'));
 }finally{h.dispose();}}
});
test('A learner can select 50 or 70 chunks; the next selection is blocked',async()=>{
 const m=data.models[0],h=setup({path:'/app/writing/language-stealing/'+ID(1),role:'student'});
 try{
  const many=Array.from({length:71},(_,i)=>({id:ID(i+100),pattern:'Reusable chunk '+i,fn:'collocation',example:'Example '+i}));
  h.stub({'/api/frontend/view':{version:1,route:h.ctx.url.pathname,data:{view:{id:ID(1),step:4,source:m,modelBody:m.body,patterns:many,selectedPatternIds:[]}}}});mount(h.ctx);await tick();
  const boxes=h.qa('input[type=checkbox]');for(const box of boxes.slice(0,50))h.click(box);
  assert.equal(h.q('[data-stealing-selection-count]').textContent,'50 / 70');
  for(const box of boxes.slice(50,70))h.click(box);assert.equal(h.q('[data-stealing-selection-count]').textContent,'70 / 70');
  h.click(boxes[70]);assert.equal(boxes[70].checked,false);assert.equal(h.q('[data-stealing-selection-count]').textContent,'70 / 70');
  assert(!h.q('[data-stealing-step="4"] button').disabled);
 }finally{h.dispose();}
});
