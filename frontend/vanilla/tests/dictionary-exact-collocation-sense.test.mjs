import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {mountDictionary} from '../modules/vocabulary/dictionary.js';

for(const scenario of ['exact','missing-target-sense','ambiguous','unique']){
 test('collocation save: '+scenario+' target keeps exact meaning boundaries',async()=>{
  const h=setup({path:'/app/vocabulary?tab=dictionary',role:'student'});
  try{
   const parent=ID(90),target=ID(91),one=ID(92),two=ID(93),release='rel-frozen';
   const sense=(id,label)=>({sense_id:id,definition_en:label,definition_uz:label,translations:[{text:label}],examples:[]});
   const item={text:'happy ending',lexemeId:target,...(scenario==='exact'?{senseId:two}:scenario==='missing-target-sense'?{senseId:ID(99)}:{})};
   const targetSenses=scenario==='unique'?[sense(two,'desired sense')]:[sense(one,'other sense'),sense(two,'desired sense')];
   h.stub({
    '/api/dictionary/recent':{recent:[{lexeme_id:parent,display_lemma:'happy',query_display:'happy',direction:'EN'}]},
    '/api/vocabulary/folders':{folders:[{id:ID(94),name:'Words'}]},
    ['/api/dictionary/entries/'+parent]:(p,o)=>o.method==='POST'?{ok:true}:{entry:{lexeme_id:parent,release_id:release,display_lemma:'happy',part_of_speech:'a',senses:[sense(ID(95),'joyful')]},presentation:{collocations:[item]}},
    ['/api/dictionary/entries/'+target]:{entry:{lexeme_id:target,release_id:release,display_lemma:'happy ending',senses:targetSenses},presentation:{primarySenseId:one}},
    '/api/dictionary/save':{ok:true},
    '/api/vocabulary':{ok:true},
   });
   mountDictionary(h.ctx,h.ctx.root);await tick(5);
   h.click(h.q('[data-dictionary-recent-row]'));await tick(6);
   h.click(h.q('[data-dictionary-collocation-save="happy ending"]'));await tick(6);
   const dialog=document.querySelector('dialog');
   if(scenario==='missing-target-sense'){
    assert.equal(dialog,null);
    assert(h.ctx.root.textContent.includes(h.ctx.dict.globalDictionary.unavailable));
    assert(!h.calls.some(c=>c.path==='/api/dictionary/save'||c.path==='/api/vocabulary'));
   }else{
    assert(dialog?.open);
    h.click(dialog.querySelector('[data-dictionary-confirm-folder]'));await tick(6);
    if(scenario==='ambiguous'){
     assert(!h.calls.some(c=>c.path==='/api/dictionary/save'));
     assert.deepEqual(h.calls.find(c=>c.path==='/api/vocabulary').body.items,[{term:'happy ending',definitionEn:'happy ending'}]);
    }else{
     const saved=h.calls.find(c=>c.path==='/api/dictionary/save').body;
     assert.equal(saved.lexemeId,target);assert.equal(saved.senseId,two);assert.equal(saved.releaseId,release);
     assert(!h.calls.some(c=>c.path==='/api/vocabulary'));
    }
   }
  }finally{h.dispose();}
 });
}
