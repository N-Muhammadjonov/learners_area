import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mountWords} from '../modules/vocabulary/words.js';

const item=n=>({id:ID(n),term:'word '+n,definitionEn:'meaning',mastery:'new',folderId:null});
const summary={total:2,due:0,byMastery:{new:2},bySource:{manual:2}};
test('Deleting only selected words requires explicit confirmation and checks acknowledged IDs',async()=>{
 const h=setup({path:'/app/vocabulary',role:'student'});let deleted=false;
 try{
 h.stub({'/api/vocabulary/summary':{summary},'/api/vocabulary/folders':{folders:[]},'/api/vocabulary/packs':{packs:[]},
 '/api/vocabulary':()=>({words:deleted?[item(2)]:[item(1),item(2)],hasMore:false}),
 '/api/vocabulary/remove':(_path,options)=>{assert.equal(options.method,'POST');assert.deepEqual(options.body,{ids:[ID(1)]});deleted=true;return {ok:true,deleted:1,deletedIds:[ID(1)]};}});
 mountWords(h.ctx,h.ctx.root);await tick(7);
 assert(h.q('[data-word-delete]').disabled);
 h.click(h.q('[data-pick="'+ID(1)+'"]'));assert(!h.q('[data-word-delete]').disabled);
 h.click(h.q('[data-word-delete]'));const d=document.querySelector('[data-vocabulary-dialog]');
 assert(d?.open);assert.equal(h.calls.filter(x=>x.path==='/api/vocabulary/remove').length,0);
 h.submit(d.querySelector('form'));await tick(8);
 assert.equal(h.calls.filter(x=>x.path==='/api/vocabulary/remove').length,1);
 assert.equal(h.q('[data-pick="'+ID(1)+'"]'),null);
 assert(h.q('[data-pick="'+ID(2)+'"]'));
 }finally{h.dispose();}
});
test('Delete cancel and server mismatch preserve words and selection',async()=>{
 const h=setup({path:'/app/vocabulary',role:'student'});let posts=0;
 try{
 h.stub({'/api/vocabulary/summary':{summary},'/api/vocabulary/folders':{folders:[]},'/api/vocabulary/packs':{packs:[]},
 '/api/vocabulary':{words:[item(1),item(2)],hasMore:false},
 '/api/vocabulary/remove':()=>{posts++;return {ok:true,deleted:1,deletedIds:[ID(2)]};}});
 mountWords(h.ctx,h.ctx.root);await tick(7);
 h.click(h.q('[data-pick="'+ID(1)+'"]'));h.click(h.q('[data-word-delete]'));
 let d=document.querySelector('[data-vocabulary-dialog]');h.click([...d.querySelectorAll('button')].find(x=>x.textContent==='Cancel'));
 assert.equal(posts,0);assert(h.q('[data-pick="'+ID(1)+'"]').getAttribute('aria-pressed')==='true');
 h.click(h.q('[data-word-delete]'));d=document.querySelector('[data-vocabulary-dialog]');
 h.submit(d.querySelector('form'));await tick(5);
 assert.equal(posts,1);assert(d.open);assert(!d.querySelector('[role=alert]').hidden);
 assert(h.q('[data-pick="'+ID(1)+'"]').getAttribute('aria-pressed')==='true');
 }finally{h.dispose();}
});
test('A delayed library response preserves a failed folder request and retry',async()=>{
 const h=setup({path:'/app/vocabulary',role:'student'});let resolveLibrary;
 try{
 const library=new Promise(resolve=>{resolveLibrary=resolve;});
 h.stub({'/api/vocabulary/summary':{summary},'/api/vocabulary/folders':new Error('synthetic folder failure'),'/api/vocabulary/packs':{packs:[]},'/api/vocabulary':()=>library});
 mountWords(h.ctx,h.ctx.root);await tick(5);
 const folders=h.q('[data-vocabulary-secondary="folders"]'),before=folders.textContent;
 assert(folders.querySelector('button'));assert.equal(h.q('[data-word-delete]'),null);
 resolveLibrary({words:[item(1)],hasMore:false});await tick(5);
 assert.equal(folders.textContent,before);assert(folders.querySelector('button'));
 assert.equal(h.q('[data-word-delete]'),null);
 }finally{h.dispose();}
});
