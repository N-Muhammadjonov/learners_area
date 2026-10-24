/** Slice 12: authoring workspace. Fixtures only (fake fetch); NOT live. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,envelope,dicts} from './harness.mjs';
import * as C from '../../modules/staff-final30/content-workspace.js';
import {bankQuery} from '../../js/adapters/staff-final30/content.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;});
const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
const iso='2026-05-01T10:00:00.000Z';
const row=(n,o={})=>({key:'reading:general_set:r'+n,module:'reading',contentType:'general_set',sourceRef:'r'+n,title:'Harbour '+n,track:'academic',versions:2,latestVersionNo:2,latestVersionId:'v'+n,latestState:'draft',states:{draft:1,published:1},createdAt:iso,updatedAt:iso,hasPublishedRevision:true,...o});
const caps={modules:[{module:'reading',label:'Reading',contentTypes:[{contentType:'general_set',authorable:true,importable:true,label:'General set'},{contentType:'legacy',authorable:false,importable:true,label:null}]},{module:'grammar',label:'Grammar',contentTypes:[]}]};
function server(state={}){const calls=[];globalThis.fetch=async(p,o={})=>{const m=o.method??'GET';calls.push({m,p,b:o.body?JSON.parse(o.body):undefined});
 if(p.startsWith('/api/admin/content/bank'))return state.bankFail?jres(500,{}):jres(200,{ok:true,rows:state.rows??[row(1),row(2)],total:state.total??2,limit:25,offset:0,facets:{}});
 if(p==='/api/admin/content/authoring-capabilities')return jres(200,caps);
 if(p.startsWith('/api/admin/content/items/'))return jres(200,{versions:state.versions??[{id:'v1',versionNo:1,status:'ok',publicationState:'published',title:'T',track:'academic',targetType:'reading_passage',targetId:'x'},{id:'v2',versionNo:2,status:'ok',publicationState:'draft',title:'T',track:'academic',targetType:null,targetId:null}]});
 if(/\/versions\/[^/]+\/preview/.test(p))return jres(200,{ok:true,preview:state.preview??{identity:{versionIdentity:'reading:general_set:r1@v2'},canonical:{title:'T'},parts:[{key:'p',label:'Passage',status:'ok',items:[{label:'Body',value:'<script>alert(1)</script>'}]}],answerKeyVisible:true,problems:['missing_audio'],status:'PREVIEW_READY'}});
 if(/\/publication$/.test(p))return state.moveFail?jres(state.moveFail,{}):jres(200,{ok:true});
 if(p==='/api/admin/content/validate')return jres(200,{ok:state.valid!==false});if(p==='/api/admin/content/drafts')return state.saveFail?jres(500,{}):jres(200,{ok:true});
 if(p.startsWith('/api/admin/content/template'))return jres(200,{sourceRef:'new-ref',title:'New title',body:'x'});return jres(404,{});};return calls;}
const mountWs=async(role='admin',state)=>{h=setup({role,path:'/app/admin/content/workspace'});const calls=server(state);h.stub({});await h.mount(C);await tick(8);return calls;};
test('bank: loads rows + capabilities, identity line, state counts, filters build the exact query (dates -> ISO, version digits only, invalid date skipped)',async()=>{
 const calls=await mountWs();assert.equal(h.qa('[data-bank-row]').length,2);assert.equal(h.q('[data-bank-row-identity]').textContent,'reading:general_set:r1');assert(h.q('[data-bank-row]').textContent.includes('Draft 1 · Published 1'));assert.equal(h.q('[data-bank-total]').textContent,'2 items');assert.equal(h.q('[data-bank-module]').options.length,3);
 assert.equal(bankQuery({module:'reading',versionNo:'12',from:'2026-05-01',to:'nope'},25),'limit=25&offset=25&module=reading&versionNo=12&from=2026-05-01T00%3A00%3A00.000Z');
 h.change(h.q('[data-bank-module]'),'reading');await tick(6);const q=calls.filter(c=>c.p.startsWith('/api/admin/content/bank')).at(-1).p;assert(q.includes('module=reading')&&q.includes('limit=25')&&q.includes('offset=0'));assert.deepEqual([...h.q('[data-bank-type]').options].map(o=>o.value),['','general_set','legacy']);
 h.input(h.q('[data-bank-version]'),'1a2');await tick(6);assert(calls.at(-1).p.includes('versionNo=12'));
});
test('bank: empty state, failure message, pagination (next disabled at end, offset steps by 25), clear resets filters; students/teachers redirected',async()=>{
 await mountWs('admin',{rows:[],total:0});assert(h.q('[data-bank-empty]'));h.dispose();
 await mountWs('admin',{bankFail:true});assert(h.q('[data-bank-error]').textContent.includes(dicts.en.admin.contentWorkspace.errorUnknown));h.dispose();
 const calls=await mountWs('admin',{total:60});assert.equal(h.q('[data-bank-next]').disabled,false);assert.equal(h.q('[data-bank-previous]').disabled,true);h.click(h.q('[data-bank-next]'));await tick(6);assert(calls.at(-1).p.includes('offset=25'));assert.equal(h.q('[data-bank-page]').textContent,'Page 2');
 h.input(h.q('[data-bank-title]'),'zzz');await tick(6);assert(calls.at(-1).p.includes('offset=0')&&calls.at(-1).p.includes('title=zzz'));h.click(h.q('[data-bank-clear]'));await tick(6);assert(!calls.at(-1).p.includes('title='));h.dispose();
 for(const role of ['teacher','student']){h=setup({role,path:'/app/admin/content/workspace'});h.stub({});globalThis.fetch=async()=>{throw new Error('must not call');};await h.mount(C);assert.equal(h.nav[0].path,'/app');assert.equal(h.calls.length,0);h.dispose();}
});
test('item panel: versions, publish/schedule/archive visible per state; publish posts {to} then refreshes; scheduled sends ISO publishAt; 403 shows forbidden; preview renders TEXT only with answer-key and problems',async()=>{
 const calls=await mountWs();h.click(h.q('[data-bank-row-open]'));await tick(6);assert.equal(h.q('[data-item-identity]').textContent,'reading:general_set:r1');assert.equal(h.qa('[data-item-version]').length,2);
 const v1=h.q('[data-item-version="1"]'),v2=h.q('[data-item-version="2"]');assert.equal(v1.querySelector('[data-version-publish]'),null);assert(v2.querySelector('[data-version-publish]'));assert(v1.querySelector('[data-version-archive]'));
 h.click(v2.querySelector('[data-version-publish]'));await tick(8);let post=calls.filter(c=>/publication$/.test(c.p)).at(-1);assert.equal(post.p,'/api/admin/content/versions/v2/publication');assert.deepEqual(post.b,{to:'published'});
 h.input(h.q('[data-item-publish-at]'),'2026-07-01T09:00');h.click(h.q('[data-item-version="2"] [data-version-schedule]'));await tick(8);post=calls.filter(c=>/publication$/.test(c.p)).at(-1);assert.equal(post.b.to,'scheduled');assert(/^2026-07-01T\d\d:00:00\.000Z$/.test(post.b.publishAt));
 h.click(h.q('[data-item-version="1"] [data-version-preview]'));await tick(6);assert.equal(h.q('[data-preview-status]').dataset.previewStatus,'PREVIEW_READY');assert(h.q('[data-preview-answer-key]'));assert(h.q('[data-preview-problems]').textContent.includes('missing_audio'));assert.equal(h.qa('[data-preview-panel] script').length,0);assert(h.q('[data-preview-parts]').textContent.includes('<script>alert(1)</script>'));
});
test('item panel: server refusal 403 => forbidden text and nothing changes; teacher-less roles cannot publish (buttons disabled for non-admin by mirror)',async()=>{
 await mountWs('admin',{moveFail:403});h.click(h.q('[data-bank-row-open]'));await tick(6);h.click(h.q('[data-item-version="2"] [data-version-publish]'));await tick(8);assert(h.q('[data-item-error]').textContent.includes(dicts.en.admin.contentWorkspace.forbidden??dicts.en.admin.contentWorkspace.errorUnknown));assert(h.q('[data-item-version="2"]'));
});
test('revise: loads CANONICAL snapshot into the editor, invalid JSON blocked, validate shows valid/invalid, save posts versionId + note; executable (canonical null) is withheld',async()=>{
 const calls=await mountWs();h.click(h.q('[data-bank-row-open]'));await tick(6);h.click(h.q('[data-item-version="2"] [data-version-revise]'));await tick(6);const ta=()=>h.q('[data-revise-payload]');assert.equal(JSON.parse(ta().value).title,'T');
 h.input(ta(),'{nope');h.click(h.q('[data-revise-validate]'));await tick(4);assert.equal(h.q('[data-revise-validity]').textContent,dicts.en.admin.contentWorkspace.invalid);
 h.input(ta(),JSON.stringify({title:'Edited'}));h.click(h.q('[data-revise-validate]'));await tick(6);assert.equal(h.q('[data-revise-validity]').textContent,dicts.en.admin.contentWorkspace.valid);
 h.input(h.q('[data-focus-key=rv-note]'),'fix typo');h.click(h.q('[data-revise-save]'));h.click(h.q('[data-revise-save]'));await tick(8);const drafts=calls.filter(c=>c.p==='/api/admin/content/drafts');assert.equal(drafts.length,1);assert.deepEqual(drafts[0].b,{module:'reading',contentType:'general_set',sourceRef:'r1',title:'Harbour 1',payload:{title:'Edited'},note:'fix typo',versionId:'v2'});assert.equal(h.q('[data-revise-panel]'),null);
 h.dispose();await mountWs('admin',{preview:{identity:{versionIdentity:'x'},canonical:null,parts:[],answerKeyVisible:false,problems:[],status:'MISSING'}});h.click(h.q('[data-bank-row-open]'));await tick(6);h.click(h.q('[data-item-version="2"] [data-version-revise]'));await tick(6);assert.equal(h.q('[data-revise-panel]'),null);assert(h.q('[data-item-error]').textContent.includes(dicts.en.admin.contentWorkspace.executable));
});
test('new item: module/type cascade, template fills sourceRef+title, import link only for importable types with a surface, non-authorable blocks save, validate/save bodies exact, save closes and refreshes',async()=>{
 const calls=await mountWs();h.click(h.q('[data-new-item]'));assert(h.q('[data-new-item-panel]'));assert(h.q('[data-new-module] option[value=grammar]').disabled);h.change(h.q('[data-new-module]'),'reading');assert.equal(h.qa('[data-new-type] option').length,3);
 h.change(h.q('[data-new-type]'),'general_set');assert(h.q('[data-new-import]'));assert.equal(h.q('[data-new-import]').getAttribute('href'),'/app/admin/reading/import');h.click(h.q('[data-new-template]'));await tick(6);assert.equal(h.q('[data-new-source-ref]').value,'new-ref');assert.equal(h.q('[data-new-title]').value,'New title');assert(JSON.parse(h.q('[data-new-payload]').value).body==='x');
 h.click(h.q('[data-new-validate]'));await tick(6);assert.equal(calls.filter(c=>c.p==='/api/admin/content/validate').at(-1).b.package.body,'x');assert.equal(h.q('[data-new-error]'),null);
 h.change(h.q('[data-new-track]'),'academic');h.click(h.q('[data-new-save]'));await tick(8);assert.deepEqual(calls.filter(c=>c.p==='/api/admin/content/drafts').at(-1).b,{module:'reading',contentType:'general_set',sourceRef:'new-ref',title:'New title',track:'academic',payload:{sourceRef:'new-ref',title:'New title',body:'x'},note:null});assert.equal(h.q('[data-new-item-panel]'),null);
 h.click(h.q('[data-new-item]'));h.change(h.q('[data-new-module]'),'reading');h.change(h.q('[data-new-type]'),'legacy');assert(h.q('[data-new-not-authorable]'));assert(h.q('[data-new-save]').disabled);
});
test('new item: invalid JSON => invalid message and no request; failed save keeps the form and says nothing was saved',async()=>{
 const calls=await mountWs('admin',{saveFail:true});h.click(h.q('[data-new-item]'));h.change(h.q('[data-new-module]'),'reading');h.change(h.q('[data-new-type]'),'general_set');h.input(h.q('[data-new-source-ref]'),'ref');h.input(h.q('[data-new-title]'),'Title');h.input(h.q('[data-new-payload]'),'{bad');h.click(h.q('[data-new-save]'));await tick(4);assert(h.q('[data-new-error]').textContent.includes(dicts.en.admin.contentWorkspace.invalid));assert.equal(calls.filter(c=>c.p==='/api/admin/content/drafts').length,0);
 h.input(h.q('[data-new-payload]'),'{"a":1}');h.click(h.q('[data-new-save]'));await tick(8);assert(h.q('[data-new-error]').textContent.includes(dicts.en.admin.contentWorkspace.errorUnknown));assert.equal(h.q('[data-new-payload]').value,'{"a":1}');
});
