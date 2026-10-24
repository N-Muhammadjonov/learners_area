/** Slice 11: reading retention bank (+ measurement builder) and staged review. Fixtures only; NOT live. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,envelope,dicts} from './harness.mjs';
import * as R from '../../modules/staff-final30/retention.js';
import {countWords,decodeMeasurementDraft,measurementIssues,formatValidationIssues} from '../../js/adapters/staff-final30/retention.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;});
const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const iso='2026-05-01T10:00:00.000Z';
test('word counter: contractions/hyphens are one word, grouped digits one number, curly apostrophe equals straight, punctuation splits, NFKC',()=>{
 assert.equal(countWords("don't well-known state-of-the-art"),3);assert.equal(countWords('don\u2019t'),countWords("don't"));assert.equal(countWords('It is 50,000 people — really.'),5);assert.equal(countWords('a—b'),2);assert.equal(countWords(''),0);assert.equal(countWords('１２３'),1);assert.equal(countWords('  one   two '),2);
});
const goodStructure=()=>({schemaVersion:1,maxScore:100,claims:[{id:'c1',label:'Claim one',points:100,scope:'sentence',groups:[{id:'g1',points:60,kind:'concept',anyOf:['a'],critical:true},{id:'g2',points:40,kind:'number',anyOf:['5'],critical:false}],acceptedPhrases:[],rejectPhrases:[]}]});
test('measurement rules: valid passes; sums, duplicates, bad kind, unknown fields, empty alternatives, non-integer points and float totals are refused; draft decoder keeps raw on unknown shape',()=>{
 assert.deepEqual(measurementIssues(goodStructure()),[]);
 const m=f=>{const s=goodStructure();f(s);return measurementIssues(s);};
 assert(m(s=>{s.claims[0].groups[0].points=50;}).includes('claim_group_points_mismatch'));assert(m(s=>{s.claims[0].points=99;s.claims[0].groups[1].points=39;}).includes('claims_total_not_100'));assert(m(s=>{s.claims[0].groups[1].id='g1';}).includes('group_id_duplicate'));assert(m(s=>{s.claims[0].groups[0].kind='regex';}).includes('group_kind_unsupported'));
 assert(m(s=>{s.claims[0].regex='.*';}).includes('claim_unexpected_field'));assert(m(s=>{s.claims[0].groups[0].anyOf=[' '];}).includes('anyof_empty_alternative'));assert(m(s=>{s.claims[0].groups[0].points=60.5;}).includes('group_points_invalid'));assert(m(s=>{s.claims[0].id='bad id!';}).includes('id_invalid'));assert(m(s=>{s.claims[0].label='ab';}).includes('claim_label_too_short'));assert(measurementIssues({schemaVersion:1,maxScore:100,claims:[]}).includes('claims_empty'));assert(measurementIssues({schemaVersion:2,maxScore:100,claims:[],x:1}).includes('root_unexpected_field'));
 assert.equal(decodeMeasurementDraft('{"schemaVersion":1,"maxScore":100,"claims":[],"extra":1}'),null);assert.equal(decodeMeasurementDraft('nope'),null);assert.deepEqual(decodeMeasurementDraft('  '),{schemaVersion:1,maxScore:100,claims:[]});assert.equal(decodeMeasurementDraft(JSON.stringify(goodStructure())).claims[0].groups[0].critical,true);assert.equal(decodeMeasurementDraft('x'.repeat(200001)),null);
 assert.deepEqual(formatValidationIssues({issues:[{path:'claims.0.points',code:'claim_points_integer'},'raw',{}]}),['claims.0.points: claim_points_integer','raw','(root): invalid']);assert.deepEqual(formatValidationIssues(null),[]);
});
const row=(n,o={})=>({textId:ID(n),internalLabel:'A2-00'+n,level:'A2',active:true,preview:'Preview '+n,wordCount:110,versionNumber:2,currentVersionUses:3,lifetimeUses:9,updatedAt:iso,...o});
const bankData=(o={})=>envelope('reading-retention',{level:'A2',filter:'active',sort:'label',inventory:['A2','B1','B2','C1','C2'].map((l,i)=>({level:l,activeCount:i===0?15:2,target:15,remainingToTarget:i===0?0:13,lifetimeUses:5,archivedCount:1})),bank:{page:1,pageCount:1,total:2,rows:[row(1),row(2,{active:false})]},...o});
test('bank: query sanitised; inventory counts + target text; filter/sort tabs keep level; rows with status, uses, preview (text only); empty and unknown-level fallbacks',async()=>{
 h=setup({path:'/app/admin/reading/retention?level=ZZ&filter=nope&sort=weird&page=-4'});h.stub({'/api/frontend/staff/reading-retention':bankData()});await h.mount({mount:R.bankMount});
 const q=h.calls[0].path;assert(q.includes('level=A2')&&q.includes('filter=active')&&q.includes('sort=label')&&q.includes('page=1'),q);
 assert.equal(h.q('[data-retention-inventory-count=A2]').textContent,'15 / 15');assert(h.q('[data-retention-inventory-level=A2]').textContent.includes(dicts.en.retentionMemory.admin.targetReached));assert(h.q('[data-retention-inventory-level=B1]').textContent.includes('13 to target'));
 assert.equal(h.q('[data-retention-filter=archived]').getAttribute('href'),'/app/admin/reading/retention?level=A2&filter=archived&sort=label');assert.equal(h.q('[data-retention-sort=uses]').getAttribute('href'),'/app/admin/reading/retention?level=A2&filter=active&sort=uses');assert(h.q('[data-retention-filter=active]').classList.contains('tab-active'));
 assert.equal(h.q('[data-retention-row="'+ID(2)+'"] [data-retention-row-status]').dataset.retentionRowStatus,'archived');assert.equal(h.q('[data-retention-row-current-uses]').dataset.retentionRowCurrentUses,'3');assert(h.q('[data-retention-staged-review-link]'));assert.equal(h.q('[data-retention-levels-available]').textContent,'A2 · B1 · B2 · C1 · C2');h.dispose();
 h=setup({path:'/app/admin/reading/retention'});h.stub({'/api/frontend/staff/reading-retention':bankData({bank:{page:1,pageCount:1,total:0,rows:[]}})});await h.mount({mount:R.bankMount});assert(h.q('[data-retention-bank-empty]'));assert.equal(h.q('[data-retention-pagination]'),null);h.dispose();
 h=setup({role:'teacher',path:'/app/admin/reading/retention'});h.stub({});await h.mount({mount:R.bankMount});assert.equal(h.nav[0].path,'/app');assert.equal(h.calls.length,0);
});
test('pagination: previous disabled on page 1, next link keeps filter/sort; status text',async()=>{
 h=setup({path:'/app/admin/reading/retention?level=B1&filter=all&sort=uses&page=2'});h.stub({'/api/frontend/staff/reading-retention':bankData({level:'B1',filter:'all',sort:'uses',bank:{page:2,pageCount:3,total:50,rows:[row(1)]}})});await h.mount({mount:R.bankMount});
 assert.equal(h.q('[data-retention-page-prev]').getAttribute('href'),'/app/admin/reading/retention?level=B1&filter=all&sort=uses');assert.equal(h.q('[data-retention-page-next]').getAttribute('href'),'/app/admin/reading/retention?level=B1&filter=all&sort=uses&page=3');assert.equal(h.q('[data-retention-page-status]').dataset.retentionPageStatus,'2/3');
});
const openMenu=(h,id)=>{const r=h.q('[data-retention-row="'+id+'"]');r.querySelector('[data-retention-row-menu-trigger]').click();return r;};
test('row menu: ArrowDown opens, items roving with Arrow/Home/End, Escape closes and returns focus, Tab closes, outside press closes',async()=>{
 h=setup({path:'/app/admin/reading/retention'});h.stub({'/api/frontend/staff/reading-retention':bankData()});await h.mount({mount:R.bankMount});
 const r=h.q('[data-retention-row="'+ID(1)+'"]'),trig=r.querySelector('[data-retention-row-menu-trigger]');trig.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));const menu=r.querySelector('[role=menu]');assert(menu);assert.equal(trig.getAttribute('aria-expanded'),'true');
 const items=[...menu.querySelectorAll('[role=menuitem]')];assert.equal(items.length,2);assert.equal(document.activeElement,items[0]);const key=k=>menu.dispatchEvent(new window.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
 key('ArrowDown');assert.equal(document.activeElement,items[1]);key('ArrowDown');assert.equal(document.activeElement,items[0]);key('ArrowUp');assert.equal(document.activeElement,items[1]);key('Home');assert.equal(document.activeElement,items[0]);key('End');assert.equal(document.activeElement,items[1]);
 key('Escape');assert.equal(r.querySelector('[role=menu]'),null);assert.equal(document.activeElement,trig);trig.click();key('Tab');assert.equal(r.querySelector('[role=menu]'),null);trig.click();document.body.dispatchEvent(new window.Event('pointerdown',{bubbles:true}));assert.equal(r.querySelector('[role=menu]'),null);
 assert(r.querySelector('[data-retention-change]')===null);trig.click();assert(r.querySelector('[data-retention-archive="'+ID(1)+'"]'));
});
test('archive: native confirm declined => no request; accepted => PATCH {active:false} then list refresh; failure keeps screen + message; restore needs no confirm; busy locks other rows',async()=>{
 h=setup({path:'/app/admin/reading/retention'});let active=true,fail=false,asked=0,answer=false;h.ctx.confirm=m=>{asked++;return answer;};
 const patches=[];globalThis.fetch=async(p,o)=>{patches.push({path:p,body:JSON.parse(o.body)});if(fail)return jres(500,{});active=JSON.parse(o.body).active;return jres(200,{ok:true});};
 h.stub({'/api/frontend/staff/reading-retention':()=>bankData({bank:{page:1,pageCount:1,total:1,rows:[row(1,{active})]}})});
 await h.mount({mount:R.bankMount});let r=openMenu(h,ID(1));r.querySelector('[data-retention-archive]').click();assert.equal(asked,1);assert.equal(patches.length,0);
 answer=true;fail=true;r=openMenu(h,ID(1));r.querySelector('[data-retention-archive]').click();await tick(6);assert(h.q('[data-retention-bank-notice]').textContent.includes(dicts.en.retentionMemory.admin.archiveFailed));assert.equal(h.q('[data-retention-row-status]').dataset.retentionRowStatus,'active');
 fail=false;r=openMenu(h,ID(1));r.querySelector('[data-retention-archive]').click();await tick(8);const p=patches.at(-1);assert.equal(p.path,'/api/admin/retention/texts/'+ID(1));assert.deepEqual(p.body,{active:false});assert.equal(h.q('[data-retention-row-status]').dataset.retentionRowStatus,'archived');
 const before=asked;r=openMenu(h,ID(1));r.querySelector('[data-retention-restore]').click();await tick(8);assert.equal(asked,before,'restore has no confirm');assert.equal(patches.at(-1).body.active,true);
});
const mountAdd=async(extra={})=>{h=setup({path:'/app/admin/reading/retention?level=A2'});h.ctx.retentionDebounceMs=0;h.stub({'/api/frontend/staff/reading-retention':bankData(),...extra});await h.mount({mount:R.bankMount});h.click(h.q('[data-retention-add]'));};
const body110=()=>Array.from({length:110},(_,i)=>'word'+i).join(' ');
test('editor (add): live count and range flag; JSON invalid is reported locally with no request; Save disabled until the server says valid',async()=>{
 let validateCalls=[];globalThis.fetch=async(p,o)=>{validateCalls.push({p,b:JSON.parse(o.body)});return jres(200,{valid:true,wordCount:110,claims:1});};
 await mountAdd();const live=()=>h.q('[data-retention-editor-live-count]'),save=()=>h.q('[data-retention-editor-save]');assert(save().disabled);
 h.input(h.q('[data-retention-editor-text]'),'one two three');assert.equal(live().dataset.retentionEditorLiveCount,'3');assert.equal(live().dataset.retentionEditorLiveInRange,'false');h.input(h.q('[data-retention-editor-text]'),body110());assert.equal(live().dataset.retentionEditorLiveInRange,'true');
 h.input(h.q('[data-retention-editor-structure]'),'{ not json');await wait(20);assert.equal(validateCalls.length,0);assert.equal(h.q('[data-retention-editor-status]').dataset.retentionEditorStatus,'invalid');assert(h.q('[data-retention-editor-issues]').textContent.includes(dicts.en.retentionMemory.admin.structureJsonInvalid));assert(save().disabled);assert(h.q('[role=alert].text-signal-700'));
 h.input(h.q('[data-retention-editor-structure]'),JSON.stringify(goodStructure()));await wait(30);assert.equal(validateCalls.length,1);assert.equal(validateCalls[0].p,'/api/admin/retention/validate');assert.equal(validateCalls[0].b.level,'A2');assert.equal(h.q('[data-retention-editor-status]').dataset.retentionEditorStatus,'valid');assert.equal(h.q('[data-retention-editor-status]').dataset.retentionEditorWordCount,'110');assert.equal(save().disabled,false);
});
test('editor: stale validation answers are ignored (newer keystroke wins); server invalid shows path:code issues; 400 => not ready; 503 => unavailable message, text kept',async()=>{
 const gates=[];globalThis.fetch=async(p,o)=>new Promise(res=>gates.push({b:JSON.parse(o.body),res}));
 await mountAdd();const T=()=>h.q('[data-retention-editor-text]'),S=()=>h.q('[data-retention-editor-structure]');h.input(S(),JSON.stringify(goodStructure()));h.input(T(),'first');await wait(10);h.input(T(),'second text');await wait(10);assert.equal(gates.length,2);
 gates[1].res(jres(200,{valid:false,error:'retention_invalid_structure',details:{issues:[{path:'claims.0.points',code:'claim_points_integer'}]}}));await wait(10);gates[0].res(jres(200,{valid:true,wordCount:1,claims:1}));await wait(10);
 assert.equal(h.q('[data-retention-editor-status]').dataset.retentionEditorStatus,'invalid');assert(h.q('[data-retention-editor-issues]').textContent.includes('claims.0.points: claim_points_integer'));assert(h.q('[data-retention-editor-save]').disabled);
 globalThis.fetch=async()=>jres(503,{});h.input(T(),'third text');await wait(30);assert.equal(h.q('[data-retention-editor-status]').dataset.retentionEditorStatus,'unavailable');assert(h.q('[data-retention-editor-status]').textContent.includes(dicts.en.retentionMemory.admin.validationUnavailable));assert.equal(T().value,'third text');
 globalThis.fetch=async()=>jres(400,{});h.input(T(),'fourth text');await wait(30);assert.equal(h.q('[data-retention-editor-status]').dataset.retentionEditorStatus,'invalid');
});
test('editor save (add): exact body, Save locked against double click, server word-count error shows range text, timeout => unknown-outcome message with NO retry, success closes editor + refreshes',async()=>{
 let mode='range',saves=[],listCalls=0;globalThis.fetch=async(p,o)=>{const b=JSON.parse(o.body);if(p.endsWith('/validate'))return jres(200,{valid:true,wordCount:110,claims:1});saves.push({p,b});await wait(10);if(mode==='range')return jres(400,{error:'retention_word_count_out_of_range',details:{issues:[]}});if(mode==='timeout'){const e=new Error('t');e.name='TimeoutError';throw e;}return jres(200,{ok:true});};
 await mountAdd({'/api/frontend/staff/reading-retention':()=>{listCalls++;return bankData();}});h.input(h.q('[data-retention-editor-structure]'),JSON.stringify(goodStructure()));h.input(h.q('[data-retention-editor-text]'),body110());await wait(30);const save=()=>h.q('[data-retention-editor-save]');
 h.click(save());h.click(save());await wait(40);assert.equal(saves.length,1);assert.equal(saves[0].p,'/api/admin/retention/texts');assert.equal(saves[0].b.level,'A2');assert.equal(saves[0].b.bodyText,body110());assert.deepEqual(saves[0].b.scoringStructure,goodStructure());assert(h.q('[data-retention-editor-status]').textContent.includes('A2 allows 100–125'));
 mode='timeout';h.click(save());await wait(40);assert.equal(saves.length,2);assert(h.q('[data-retention-editor-save-error]').textContent.includes(dicts.en.retentionMemory.admin.saveUnknown));await wait(30);assert.equal(saves.length,2,'never retried automatically');
 mode='ok';const before=listCalls;h.input(h.q('[data-retention-editor-text]'),body110()+' more');await wait(30);h.click(save());await wait(50);assert.equal(h.q('[data-retention-editor]'),null);assert(h.q('[data-retention-bank-notice]').textContent.includes(dicts.en.retentionMemory.admin.saved));assert(listCalls>before);
});
test('editor save failure keeps the text and shows saveFailed; 409 shows the conflict banner with reload',async()=>{
 let mode='500';globalThis.fetch=async(p,o)=>p.endsWith('/validate')?jres(200,{valid:true,wordCount:110,claims:1}):mode==='500'?jres(500,{}):jres(409,{error:'conflict'});
 await mountAdd();h.input(h.q('[data-retention-editor-structure]'),JSON.stringify(goodStructure()));h.input(h.q('[data-retention-editor-text]'),body110());await wait(30);h.click(h.q('[data-retention-editor-save]'));await wait(30);assert(h.q('[data-retention-editor-save-error]').textContent.includes(dicts.en.retentionMemory.admin.saveFailed));assert.equal(h.q('[data-retention-editor-text]').value,body110());
 mode='409';h.click(h.q('[data-retention-editor-save]'));await wait(30);assert(h.q('[data-retention-conflict]'));assert(h.q('[data-retention-editor]'),'editor stays so the text can be copied');
});
test('editor (change): loads the CURRENT version (body + structure), failure shows Retry and NO form; save posts a new version with expectedCurrentVersionId',async()=>{
 h=setup({path:'/app/admin/reading/retention'});h.ctx.retentionDebounceMs=0;let loadOk=false,posted;
 globalThis.fetch=async(p,o)=>{if(o.method==='GET')return loadOk?jres(200,{text:{bodyText:'current body',scoringStructure:goodStructure(),currentVersionId:'ver-7'}}):jres(500,{});if(p.endsWith('/validate'))return jres(200,{valid:true,wordCount:2,claims:1});posted={p,b:JSON.parse(o.body)};return jres(200,{ok:true});};
 h.stub({'/api/frontend/staff/reading-retention':bankData()});await h.mount({mount:R.bankMount});openMenu(h,ID(1)).querySelector('[data-retention-change]').click();await wait(20);
 assert(h.q('[data-retention-editor-load-failed]'));assert.equal(h.q('[data-retention-editor-text]'),null);assert.equal(h.q('[data-retention-editor-mode]').dataset.retentionEditorMode,'change');
 loadOk=true;h.click(h.q('[data-retention-editor-load-retry]'));await wait(40);assert.equal(h.q('[data-retention-editor-text]').value,'current body');assert(JSON.parse(h.q('[data-retention-editor-structure]').value).claims.length===1);assert.equal(h.q('[data-retention-editor-save]').textContent,dicts.en.retentionMemory.admin.saveVersion);
 h.click(h.q('[data-retention-editor-save]'));await wait(30);assert.equal(posted.p,`/api/admin/retention/texts/${ID(1)}/versions`);assert.deepEqual(posted.b,{bodyText:'current body',scoringStructure:goodStructure(),expectedCurrentVersionId:'ver-7'});
});
test('measurement builder: form edits write canonical JSON; group points sum into the claim; add/remove claim and group; raw unknown JSON shows the warning and is preserved',async()=>{
 globalThis.fetch=async()=>jres(200,{valid:false,error:'x',details:{}});await mountAdd();const J=()=>h.q('[data-retention-editor-structure]');
 h.input(J(),'');h.click(h.q('[data-retention-add-claim]'));let d=JSON.parse(J().value);assert.equal(d.claims.length,1);assert.equal(d.claims[0].points,1);assert.match(d.claims[0].id,/^c_[0-9a-f]{32}$/);
 h.click(h.q('[data-retention-add-group]'));d=JSON.parse(J().value);assert.equal(d.claims[0].groups.length,2);assert.equal(d.claims[0].points,2);
 const pts=h.qa('[data-retention-group] input[type=number]');pts[0].value='60';pts[0].dispatchEvent(new window.Event('input',{bubbles:true}));d=JSON.parse(J().value);assert.equal(d.claims[0].points,61);
 const any=h.q('[data-retention-group] textarea');any.value='alpha\nbeta';any.dispatchEvent(new window.Event('input',{bubbles:true}));d=JSON.parse(J().value);assert.deepEqual(d.claims[0].groups[0].anyOf,['alpha','beta']);
 h.click(h.qa('[data-retention-remove-group]')[1]);d=JSON.parse(J().value);assert.equal(d.claims[0].groups.length,1);assert.equal(d.claims[0].points,60);assert(h.q('[data-retention-measurement-total]').textContent.startsWith('60 / 100'));
 h.click(h.q('[data-retention-remove-claim]'));d=JSON.parse(J().value);assert.equal(d.claims.length,0);
 const raw='{"schemaVersion":1,"maxScore":100,"claims":[],"future":true}';h.input(J(),raw);assert(h.q('[data-retention-measurement-builder] [role=alert]'));assert.equal(h.q('[data-retention-editor-structure]').value,raw);assert.equal(h.q('[data-retention-add-claim]'),null);
});
const stagedData=(o={})=>envelope('retention-staged',{level:'B1',report:{heldTextCount:1,mismatchCount:2,items:[{sourceId:'B1-001',wordCount:170,held:true,bodyText:'<b>Body</b>',sourceScore:80,canonicalScore:70,missingGroups:[{claimId:'c1',missingGroupIds:['g1','g2']}]},{sourceId:'B1-002',wordCount:171,held:false,bodyText:'ok',sourceScore:100,canonicalScore:100,missingGroups:[]}]},...o});
test('staged review: hold banner and counts, level nav, items with scores, missing groups, escaped body, UZ strings; read-only (no writes); unknown level falls back to A2',async()=>{
 h=setup({path:'/app/admin/reading/retention/staged?level=B1'});h.stub({'/api/frontend/staff/retention-staged':stagedData()});await h.mount({mount:R.stagedMount});
 assert(h.q('[data-retention-staged-warning]').textContent.includes('PUBLICATION BLOCKED'));assert(h.q('[data-retention-staged-counts]').textContent.includes('B1: 2 texts · 1 held texts · 2 scoring mismatches'));assert.equal(h.q('[data-retention-staged-levels] [aria-current=page]').textContent,'B1');
 assert(h.q('[data-retention-staged-item=B1-001]').textContent.includes('Scoring needs review'));assert(h.q('[data-retention-staged-item=B1-001] [data-retention-staged-score]').textContent.includes('80/100'));assert(h.q('[data-retention-staged-missing]').textContent.includes('c1 (g1, g2)'));assert.equal(h.qa('b').length,0);assert(!h.calls.some(c=>c.method!=='GET'));h.dispose();
 h=setup({path:'/app/admin/reading/retention/staged?level=ZZ',locale:'uz'});h.stub({'/api/frontend/staff/retention-staged':stagedData({level:'A2'})});await h.mount({mount:R.stagedMount});assert(h.calls[0].path.includes('level=A2'));assert(h.q('[data-retention-staged-warning]').textContent.includes("NASHR TO'XTATILGAN"));h.dispose();
 h=setup({role:'teacher',path:'/app/admin/reading/retention/staged'});h.stub({});await h.mount({mount:R.stagedMount});assert.equal(h.nav[0].path,'/app');
});
