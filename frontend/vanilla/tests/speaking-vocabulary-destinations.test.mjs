import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {vocabularySaver} from '../modules/speaking/vocabulary-save.js';

const promptId=ID(601),folderId=ID(602);
const words=[{term:'bustling',definitionEn:'full of busy activity',translationUz:'gavjum'},
 {term:'historic',definitionEn:'important in history',translationUz:'tarixiy'}];
function fixture(locale='en',save){
 const h=setup({role:'student',locale});
 h.stub({'/api/vocabulary/folders':{folders:[{id:folderId,name:'My words'}]},
  '/api/speaking/prompts/vocabulary':save??((path,{body})=>({ok:true,added:0,duplicates:body.indices.length,
   moved:body.indices.length,ids:body.indices.map(i=>ID(610+i)),folder:{id:folderId,name:'My words'}}))});
 h.ctx.root.append(vocabularySaver(h.ctx,{promptId,words,copy:h.ctx.dict.speakingStudy}));return h;
}
for(const locale of ['en','uz'])for(const mode of ['all','0'])test(`${locale}: ${mode} saves the exact source selection into the chosen folder`,async()=>{
 const h=fixture(locale);try{await tick();h.change(h.q('[data-practice-folder]'),folderId);h.click(h.q(`[data-practice-save="${mode}"]`));await tick();
  const post=h.calls.find(c=>c.method==='POST');assert.deepEqual(post.body,{promptId,indices:mode==='all'?[0,1]:[0],folderId});
  assert(h.q('[data-practice-save-status]').textContent.includes('My words'));
  assert.equal(h.q('[data-practice-save="all"]').disabled,false);
 }finally{h.dispose();}
});

test('new folders require a name and preserve the trimmed name in the source save',async()=>{
 const h=fixture();try{await tick();h.change(h.q('[data-practice-folder]'),'new');
  h.click(h.q('[data-practice-save="0"]'));await tick();assert(!h.calls.some(c=>c.method==='POST'));
  h.input(h.q('[data-practice-folder-name]'),'  New practice  ');h.click(h.q('[data-practice-save="0"]'));await tick();
  assert.deepEqual(h.calls.find(c=>c.method==='POST').body,{promptId,indices:[0],folderName:'New practice'});
 }finally{h.dispose();}
});

test('double click sends one mutation and blocks destination changes while saving',async()=>{
 let resolve;const h=fixture('en',()=>new Promise(r=>resolve=r));try{await tick();
  h.click(h.q('[data-practice-save="all"]'));h.click(h.q('[data-practice-save="0"]'));
  assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert(h.q('[data-practice-folder]').disabled);
  resolve({ok:true,added:2,duplicates:0,ids:[ID(611),ID(612)],folder:{id:folderId,name:'Saved'}});await tick();
  assert(!h.q('[data-practice-folder]').disabled);
 }finally{h.dispose();}
});

test('incomplete server confirmation is shown as failure and can be retried',async()=>{
 const h=fixture('en',()=>({ok:true,added:2,duplicates:0,ids:[]}));try{await tick();h.click(h.q('[data-practice-save="all"]'));await tick();
  assert.equal(h.q('[data-practice-save-status]').textContent,h.ctx.dict.speakingStudy.saveFailed);
  assert(!h.q('[data-practice-save="all"]').disabled);
 }finally{h.dispose();}
});

test('an aborted source panel never announces a late save as success',async()=>{
 let resolve;const h=fixture('en',()=>new Promise(r=>resolve=r));try{await tick();h.click(h.q('[data-practice-save="0"]'));h.controller.abort();
  resolve({ok:true,added:1,duplicates:0,ids:[ID(611)],folder:{id:folderId,name:'Late success'}});await tick();
  assert(!h.q('[data-practice-save-status]').textContent.includes('Late success'));
 }finally{h.dispose();}
});
