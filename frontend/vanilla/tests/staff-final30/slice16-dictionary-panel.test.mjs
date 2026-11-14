/** Slice 16: owner dictionary panel (search -> entry -> sense actions). Fixtures only; NOT live. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,envelope,dicts} from './harness.mjs';
import * as OD from '../../modules/staff-final30/owner-dictionary.js';
import {dictionaryPanel,dictionaryPos} from '../../modules/staff-final30/dictionary-panel.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;});
const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const T=dicts.en.globalDictionary;
const entry=(o={})=>({lexeme_id:'L1',release_id:'r2',display_lemma:'<b>run</b>',part_of_speech:'v',lexical_type:'phrasal_verb',pronunciations:[{ipa:'rʌn'}],
 senses:[{sense_id:'S1',definition_en:'move fast',definition_uz:'yugurmoq',translations:[{text:'yugurmoq'},{text:'chopmoq'}],examples:[{example_id:'e1',text_en:'I run.',text_uz:'Men yuguraman.'},{example_id:'e2',text_en:'e2',text_uz:'u2'},{example_id:'e3',text_en:'e3',text_uz:'u3'}],cefr:'A1',register:null,usage_label:'informal',domain_tags:['sport']},{sense_id:'S2',definition_en:'manage',definition_uz:'boshqarmoq',translations:[{text:'boshqarmoq'}],examples:[]}],
 forms:[{surface_form:'runs'},{surface_form:'ran'}],collocations:[{text:'run a business'}],relations:[{relation_type:'synonym',target_lexeme_id:'L2',display_lemma:'sprint',part_of_speech:'v'},{relation_type:'antonym',target_lexeme_id:'L3',display_lemma:'walk',part_of_speech:'v'}],attribution:[{snapshot_id:'a',source_name:'Wordnet',attribution_text:'Upstream text'}],...o});
function server(state={}){const calls=[];globalThis.fetch=async(p,o={})=>{const m=o.method??'GET',path=p.replace('/api/owner/dictionary/','');calls.push({m,path});const ok=d=>jres(200,d);
 if(path.startsWith('search?')){if(state.searchFail)return jres(500,{});const q=new URL('https://x/'+path).searchParams.get('q');return ok({release_id:'r1',results:state.hits??[{lexeme_id:'L1',display_lemma:'run',part_of_speech:'v',translation_uz:'yugurmoq'},{lexeme_id:'L2',display_lemma:'<i>runway</i>',part_of_speech:'n',translation_uz:'uchish yo\'li'}].filter(()=>q!=='none')});}
 if(path.startsWith('entries/')){if(state.entryFail)return jres(500,{});const id=path.split('?')[0].split('/')[1];return ok({entry:id==='L1'?entry(state.entry):entry({lexeme_id:id,display_lemma:id==='L2'?'sprint':'walk',senses:[],relations:[],forms:[],collocations:[],attribution:[]})});}
 if(path==='summary')return ok({channel:{active_release_id:'r2',previous_release_id:null},release:{manifest:{lexemes:1,senses:1,examples:1,search_terms:1},manifest_sha:'x'},drafts:0,custom:{lexemes:0,senses:0},published_at:null,index_state:'validated'});
 if(path==='drafts')return ok({drafts:[]});if(path==='history')return ok({history:[]});if(path==='publish')return ok({job:null});return jres(404,{});};return calls;}
const mountPanel=async(cb={})=>{h=setup({role:'owner',path:'/app/owner/dictionary'});h.ctx.dictionaryDebounceMs=0;const calls=server(cb.state);const node=dictionaryPanel(h.ctx,{onEdit:cb.onEdit,onAddSense:cb.onAddSense,onAddWord:cb.onAddWord});h.ctx.root.append(node);return {calls,node};};
test('pos labels',()=>{assert.equal(dictionaryPos('n'),'noun');assert.equal(dictionaryPos('s'),'adjective');assert.equal(dictionaryPos('phrase'),'phrase');});
test('panel: empty prompt state, debounced search with direction, escaped hits, empty-results text, clear, direction toggle re-searches and drops the release pin',async()=>{
 const {calls}=await mountPanel();assert(h.ctx.root.textContent.includes(T.startTitle));h.input(h.q('[data-dictionary-search]'),'run');await wait(30);await tick(3);
 const s=calls.filter(c=>c.path.startsWith('search?'));assert.equal(s.length,1);assert(s[0].path.includes('q=run')&&s[0].path.includes('direction=EN'));assert.equal(h.qa('[data-dictionary-hit]').length,2);assert.equal(h.qa('i').length,0);assert(h.ctx.root.textContent.includes('<i>runway</i>'));
 h.click(h.q('[data-dictionary-direction=UZ]'));await wait(30);await tick(3);assert(calls.filter(c=>c.path.startsWith('search?')).at(-1).path.includes('direction=UZ'));assert.equal(h.q('[data-dictionary-direction=UZ]').getAttribute('aria-pressed'),'true');
 h.input(h.q('[data-dictionary-search]'),'none');await wait(30);await tick(3);assert(h.q('[data-dictionary-empty]'));h.click(h.q('[data-dictionary-clear]'));assert(h.ctx.root.textContent.includes(T.startTitle));
});
test('panel: keyboard (Arrow/Enter) opens the active hit; stale search responses never overwrite a newer query',async()=>{
 const {calls}=await mountPanel();const gates=[];globalThis.fetch=async(p)=>{if(p.includes('/search?')){return new Promise(res=>gates.push({p,res}));}return jres(200,{entry:entry()});};
 h.input(h.q('[data-dictionary-search]'),'ru');await wait(20);h.input(h.q('[data-dictionary-search]'),'run');await wait(20);assert.equal(gates.length,2);
 gates[1].res(jres(200,{release_id:'r1',results:[{lexeme_id:'L1',display_lemma:'run',part_of_speech:'v',translation_uz:'u'}]}));await wait(10);gates[0].res(jres(200,{release_id:'r0',results:[{lexeme_id:'OLD',display_lemma:'ru-old',part_of_speech:'n',translation_uz:'x'}]}));await wait(10);assert.deepEqual(h.qa('[data-dictionary-hit]').map(x=>x.dataset.dictionaryHit),['L1']);
 const inp=h.q('[data-dictionary-search]');inp.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.equal(inp.getAttribute('aria-expanded'),'true');inp.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(10);await tick(3);assert(h.q('[data-dictionary-entry=L1]'));
});
test('entry: safe text, senses, examples, tags and relations; private provenance stays hidden; expand-all and back work',async()=>{
 await mountPanel({state:{entry:{attribution:[{snapshot_id:'private',source_name:'Oxford',attribution_text:'Oxford Cambridge Collins https://private-source.invalid/'}]}}});h.input(h.q('[data-dictionary-search]'),'run');await wait(30);await tick(3);h.click(h.q('[data-dictionary-hit=L1]'));await wait(10);await tick(4);
 assert.equal(h.qa('b').length,0);assert(h.q('h2').textContent.includes('<b>run</b>'));assert(h.ctx.root.textContent.includes('/rʌn/'));assert(h.ctx.root.textContent.includes('verb'));assert(h.ctx.root.textContent.includes('phrasal verb'));assert.equal(h.q('[data-dictionary-sense=S1] [data-dictionary-sense-toggle]').getAttribute('aria-expanded'),'false');assert.equal(h.q('[data-dictionary-sense=S1] h4'),null);
 h.click(h.q('[data-dictionary-expand-all]'));assert(h.q('[data-dictionary-sense=S1]').textContent.includes('move fast'));assert(h.q('[data-dictionary-sense=S1]').textContent.includes('yugurmoq · chopmoq'));assert.equal(h.qa('[data-dictionary-sense=S1] blockquote').length,3);assert(h.q('[data-dictionary-sense=S1]').textContent.includes('informal'));assert(h.q('[data-dictionary-sense=S1]').textContent.includes('sport'));assert(h.q('[data-dictionary-sense=S1]').textContent.includes(T.upstream));assert.equal(h.q('[data-dictionary-expand-all]').textContent,T.collapseAll);
 assert(h.ctx.root.textContent.includes('runs · ran'));assert(h.ctx.root.textContent.includes('run a business'));assert(h.q('[data-dictionary-relation=L2]'));assert(h.q('[data-dictionary-relation=L3]'));assert(!h.ctx.root.textContent.includes(T.attribution));
 for(const privateText of ['Oxford','Cambridge','Collins','https://private-source.invalid/'])assert(!h.ctx.root.textContent.includes(privateText));
 h.click(h.q('[data-dictionary-expand-all]'));assert.equal(h.q('[data-dictionary-sense=S1] h4'),null);h.click(h.q('[data-dictionary-back]'));assert(h.q('[data-dictionary-search]'));assert.equal(h.q('[data-dictionary-search]').value,'run');
});
test('entry: custom entries are labelled custom; relation buttons open the related entry; open failure => localized alert with Retry that returns to search; owner actions call back with entry+sense',async()=>{
 const got=[];await mountPanel({onEdit:(e,s)=>got.push(['edit',e.lexeme_id,s.sense_id]),onAddSense:e=>got.push(['sense',e.lexeme_id]),onAddWord:()=>got.push(['word'])});
 h.input(h.q('[data-dictionary-search]'),'run');await wait(30);await tick(3);h.click(h.q('[data-dictionary-hit=L1]'));await wait(10);await tick(4);h.click(h.q('[data-dictionary-sense-toggle=S2]'));h.click(h.q('[data-dictionary-edit=S2]'));h.click(h.q('[data-dictionary-add-sense]'));assert.deepEqual(got,[['edit','L1','S2'],['sense','L1']]);
 h.click(h.q('[data-dictionary-relation=L2]'));await wait(10);await tick(4);assert(h.q('[data-dictionary-entry=L2]'));h.click(h.q('[data-dictionary-back]'));h.click(h.q('[data-dictionary-add-word]'));assert.deepEqual(got.at(-1),['word']);
 h.dispose();globalThis.fetch=undefined;
 return (async()=>{const {calls}=await mountPanel({state:{entryFail:true}});h.input(h.q('[data-dictionary-search]'),'run');await wait(30);await tick(3);h.click(h.q('[data-dictionary-hit=L1]'));await wait(10);await tick(4);assert(h.q('[data-dictionary-error]').textContent.includes(T.unavailable));assert.equal(h.q('[data-dictionary-entry]'),null);h.click(h.q('[data-dictionary-retry]'));await wait(30);await tick(4);assert(calls.filter(c=>c.path.startsWith('search?')).length>=2);})();
});
test('search failure shows the localized alert and no results; custom (Learners Area) entry is labelled custom',async()=>{
 await mountPanel({state:{searchFail:true}});h.input(h.q('[data-dictionary-search]'),'run');await wait(30);await tick(4);assert(h.q('[data-dictionary-error]').textContent.includes(T.unavailable));assert.equal(h.qa('[data-dictionary-hit]').length,0);assert.equal(h.q('[data-dictionary-empty]'),null,'no misleading "no results" while failing');h.dispose();
 await mountPanel({state:{entry:{attribution:[{snapshot_id:'x',source_name:'Learners Area',attribution_text:'Custom'}]}}});h.input(h.q('[data-dictionary-search]'),'run');await wait(30);await tick(3);h.click(h.q('[data-dictionary-hit=L1]'));await wait(10);await tick(4);h.click(h.q('[data-dictionary-sense-toggle=S1]'));assert(h.q('[data-dictionary-sense=S1]').textContent.includes(T.custom));
});
test('owner dictionary page uses the panel by default: edit on an upstream sense opens the draft editor read-only on English; add new word opens a blank editor',async()=>{
 h=setup({role:'owner',path:'/app/owner/dictionary'});h.ctx.dictionaryDebounceMs=0;server();h.stub({});await h.mount(OD);await tick(8);
 assert(h.q('[data-global-dictionary]'));h.input(h.q('[data-dictionary-search]'),'run');await wait(30);await tick(3);h.click(h.q('[data-dictionary-hit=L1]'));await wait(10);await tick(4);h.click(h.q('[data-dictionary-sense-toggle=S1]'));h.click(h.q('[data-dictionary-edit=S1]'));await tick(3);
 const form=h.q('[data-owner-dict-form]');assert(form);assert.equal(form.querySelector('textarea[readonly]').value,'move fast');
 h.click(h.q('[data-dictionary-add-word]'));assert(h.q('[data-owner-dict-form]'));assert(h.q('[data-owner-dict-form] input').value==='');
});
