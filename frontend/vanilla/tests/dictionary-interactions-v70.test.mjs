import test from 'node:test';import assert from 'node:assert/strict';
import {setup,tick} from './staff-final30/harness.mjs';
import {mountDictionary} from '../modules/vocabulary/dictionary.js';
const entry={lexeme_id:'bank',release_id:'release-v1',display_lemma:'bank',part_of_speech:'n',lexical_type:'word',pronunciations:[{ipa:'bæŋk'}],forms:[{surface_form:'banks'}],collocations:[{text:'bank account'}],relations:[{relation_type:'synonym',target_lexeme_id:'edge',display_lemma:'edge',part_of_speech:'n'}],attribution:[{snapshot_id:'licence',source_name:'Learners Area',attribution_text:'Authored dictionary'}],senses:[0,1].map(n=>({sense_id:'sense-'+n,translations:[{text:n?'qirg‘oq':'bank'}],definition_en:'English meaning '+n,definition_uz:'Uzbek meaning '+n,cefr:'B1',domain_tags:[],examples:[{example_id:'ex-'+n,text_en:'Example '+n,text_uz:'Misol '+n}]}))};
function fixture(){const h=setup({path:'/app/vocabulary?tab=dictionary',role:'student'});h.ctx.dictionaryDebounceMs=0;h.stub({'/api/dictionary/search':{release_id:'release-v1',results:[{lexeme_id:'bank',display_lemma:'bank',part_of_speech:'n',translation_uz:'bank'}]},'/api/dictionary/entries/bank':(path,o)=>o.method==='POST'?{ok:true}:{entry,saved:[]},'/api/dictionary/recent':{recent:[{lexeme_id:'bank',query_display:'bank',direction:'EN',display_lemma:'bank',part_of_speech:'n',cefr:'B1',translation_uz:'bank'}]},'/api/vocabulary/folders':(path,o)=>o.method==='POST'?{ok:true,folder:{id:'new-folder',name:o.body.name}}:{folders:[{id:'travel',name:'Travel',count:4}]},'/api/dictionary/save':{ok:true}});return h;}
async function open(h){mountDictionary(h.ctx,h.ctx.root);await tick(4);h.input(h.q('[role=combobox]'),'bank');await tick(5);const input=h.q('[role=combobox]');input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick(5);}
const textButton=(h,text,root=h.ctx.root)=>[...root.querySelectorAll('button')].find(n=>n.textContent===text);
test('learner dictionary matches the search/recent/entry layout and keeps sense expansion separate from saving',async()=>{
 const h=fixture();try{await open(h);assert(h.q('[data-global-dictionary]'));assert.equal(h.q('[role=combobox]').value,'bank');assert(h.q('[data-dictionary-entry]').textContent.includes('noun'));assert.equal(document.querySelector('dialog'),null);assert.equal(h.q('[data-dictionary-sense="sense-0"] h4'),null);h.click(h.q('[data-dictionary-sense-toggle="sense-1"]'));assert(h.q('[data-dictionary-sense="sense-1"]').textContent.includes('English meaning 1'));assert.equal(h.q('[data-dictionary-sense="sense-0"] h4'),null);h.click(h.q('[data-dictionary-save="sense-1"]'));const modal=document.querySelector('dialog');assert(modal.open);assert(modal.textContent.includes('qirg‘oq'));assert(modal.textContent.includes('Travel4'));h.click(modal.querySelector('[aria-label=Close]'));assert.equal(document.querySelector('dialog'),null);assert.equal(h.calls.filter(x=>x.path==='/api/dictionary/save').length,0);}finally{h.dispose();}
});
test('confirming an existing folder saves precisely the selected sense and release, then disables its Add control',async()=>{
 const h=fixture();try{await open(h);h.click(h.q('[data-dictionary-sense-toggle="sense-1"]'));h.click(h.q('[data-dictionary-save="sense-1"]'));const modal=document.querySelector('dialog');h.change(modal.querySelector('[value=travel]'),'travel');h.click(modal.querySelector('[data-dictionary-confirm-folder]'));await tick(5);assert.equal(document.querySelector('dialog'),null);assert.deepEqual(h.calls.find(c=>c.path==='/api/dictionary/save').body,{lexemeId:'bank',senseId:'sense-1',releaseId:'release-v1',folderId:'travel'});assert(h.q('[data-dictionary-save="sense-1"]').disabled);}finally{h.dispose();}
});
test('the folder dialog creates and selects a new folder; recent cards open entries directly',async()=>{
 const h=fixture();try{mountDictionary(h.ctx,h.ctx.root);await tick(4);const row=h.q('[data-dictionary-recent-row]');assert(row.textContent.includes('bank'));h.click(row);await tick(5);assert(h.q('[data-dictionary-entry]'));assert.equal(h.calls.filter(x=>x.path.startsWith('/api/dictionary/search')).length,0);h.click(h.q('[data-dictionary-sense-toggle="sense-0"]'));h.click(h.q('[data-dictionary-save="sense-0"]'));let modal=document.querySelector('dialog');h.click(textButton(h,'＋ '+h.ctx.dict.globalDictionary.newFolder,modal));h.input(modal.querySelector('[data-dictionary-folder-name]'),'My words');h.submit(modal.querySelector('form'));await tick(5);assert(modal.querySelector('[value=new-folder]').checked);h.click(modal.querySelector('[data-dictionary-confirm-folder]'));await tick(5);assert.equal(h.calls.find(c=>c.path==='/api/dictionary/save').body.folderId,'new-folder');}finally{h.dispose();}
});
test('dictionary direction, clearing and teardown cancel stale UI work without an auth-state request',async()=>{
 const h=fixture();try{mountDictionary(h.ctx,h.ctx.root);await tick(4);h.input(h.q('[role=combobox]'),'bank');await tick(5);assert(!h.q('[data-dictionary-clear]').hidden);h.click(h.q('[data-dictionary-direction=UZ]'));await tick(5);assert(h.calls.filter(c=>c.path.startsWith('/api/dictionary/search')).at(-1).path.includes('direction=UZ'));h.click(h.q('[data-dictionary-clear]'));assert(h.q('[data-dictionary-recent-row]'));assert(h.q('[data-dictionary-clear]').hidden);h.click(h.q('[data-dictionary-recent-row]'));await tick(5);h.click(h.q('[data-dictionary-sense-toggle="sense-0"]'));h.click(h.q('[data-dictionary-save="sense-0"]'));h.controller.abort();assert.equal(document.querySelector('dialog'),null);assert.equal(h.calls.filter(x=>x.path==='/api/auth/state').length,0);}finally{h.dispose();}
});


test('dictionary back/expand controls and all part-of-speech labels use legible scoped styling',async()=>{
 const h=fixture();
 try{
  await open(h);
  const back=h.q('[data-dictionary-back]'),expand=h.q('[data-dictionary-expand-all]');
  assert(back.classList.contains('dictionary-back-button'));
  assert(expand.classList.contains('dictionary-expand-all'));
  assert.equal(h.q('.dictionary-entry-meta .dictionary-pos').textContent,'noun');
  assert.equal(h.qa('.dictionary-meaning-toggle .dictionary-pos').length,2);
  const {readFileSync}=await import('node:fs');
  const css=readFileSync(new URL('../css/source.css',import.meta.url),'utf8');
  assert(css.includes('.dictionary-entry-nav .dictionary-back-button'));
  assert(css.includes('.dictionary-expand-all'));
  assert(css.includes('.dictionary-pos{'));
  assert(css.includes('white-space:nowrap'));
  assert(css.includes('flex:0 0 auto'));
  assert(css.includes('border-radius:999px'));
 }finally{h.dispose();}
});
