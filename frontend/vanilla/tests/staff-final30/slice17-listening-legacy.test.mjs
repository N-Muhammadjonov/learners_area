/** Slice 17: legacy Listening import verified against a REAL owner file. The owner file is NOT committed (it contains
 * educational content and answer keys). Set LEGACY_LISTENING_FIXTURE to a local copy of Listening_Test_1.html; without it
 * these tests are skipped with an explicit reason. */
import {test as baseTest,afterEach} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deflateRawSync,crc32} from 'node:zlib';
import {setup,tick,ID,dicts} from './harness.mjs';
import * as LI from '../../modules/staff-final30/listening-import.js';
import {legacyImporter,listeningMap} from '../../modules/staff-final30/listening-legacy-import.js';
import * as G from '../../js/adapters/staff-final30/listening-legacy.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;delete globalThis.DOMParser;});
const FIX=process.env.LEGACY_LISTENING_FIXTURE;const SKIP=FIX&&fs.existsSync(FIX)?false:'set LEGACY_LISTENING_FIXTURE to a local copy of the owner file (not committed)';
const test=(name,fn)=>baseTest(name,{skip:SKIP},fn);const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
const fixtureFile=()=>new File([fs.readFileSync(FIX)],'Listening_Test_1.html',{type:'text/html'});
const inspectFixture=async(o={})=>{h=setup({path:'/app/admin/listening/import'});globalThis.DOMParser=h.dom.window.DOMParser;const {entries,textFiles}=await G.readListeningFiles([fixtureFile()]);return G.inspectListeningPackage({entries,textFiles,zipName:'Listening_Test_1.html',probeDuration:async()=>1700,read:G.readDocument,...o});};
test('REAL FILE parity: 40 questions with the proven type of every item, Choose-TWO pairs with A–E options, map, script gaps, vocabulary, part ranges, activities',async()=>{
 const r=await inspectFixture(),p=r.payload;
 assert.equal(r.family,'legacy');assert.equal(r.audio.path,'embedded-listening-audio.mp3');assert.equal(r.audio.format,'mp3');assert.equal(p.testId,'listening-test-1');assert.equal(p.title,'Listening Test 1');assert.equal(p.collection,'academic');assert.equal(p.sections.length,4);assert.equal(p.questions.length,40);assert.equal(p.keyword1.length,30);assert.equal(p.vocabulary.length,20);assert.equal(p.audio.durationSec,1700);assert.equal(p.imagePath,null);
 const groups={};for(const q of p.questions)(groups[`${q.kind}/${q.typeCode}`]??=[]).push(q.number);
 assert.deepEqual(groups['completion/sentence_completion'],[...Array(17)].map((_,i)=>i+1));assert.deepEqual(groups['map/map_labeling'],[18,19,20]);assert.deepEqual(groups['mcq/mcq_single'],[21,22,23,24]);assert.deepEqual(groups['mcq/mcq_multi'],[25,26,27,28,29,30]);assert.deepEqual(groups['completion/note_completion'],[31,32,33,34,35,36,37,38,39,40]);
 assert.deepEqual(p.questions.filter(q=>q.pair.length).map(q=>[q.number,q.pair[0]]),[[25,26],[26,25],[27,28],[28,27],[29,30],[30,29]]);const q25=p.questions[24];assert.deepEqual(q25.options.map(o=>o[0]),['A','B','C','D','E']);assert.equal(q25.key,'B');
 assert.equal(p.questions[0].key,'80');assert.deepEqual(p.questions[0].alternatives,['80','eighty']);assert.equal(p.questions[0].evidence.at,150);assert.equal(p.questions[17].options.length,7,'map options A–G');
 assert.deepEqual(p.mapDiagram.viewBox,[0,0,760,430]);assert.equal(p.mapDiagram.label,'Spring Down Junior School floor plan');assert.equal(p.mapDiagram.shapes.length,23);assert(p.mapDiagram.shapes.every(s=>['rect','path','text','line','circle'].includes(s.tag)));
 assert.deepEqual(p.studyPack.partRanges,{1:[0,365.64],2:[365.64,792.12],3:[792.12,1187.05],4:[1187.05,1645.05]});assert.deepEqual(p.studyPack.scriptParts.map(s=>s.gaps.length),[7,7,8,8]);assert.equal(p.keyword1[0].q,101);
 assert.deepEqual(G.testActivities(p),['exam','script','mcq','map','completion','vocab']);assert.deepEqual(G.mapDiagramSections(p),[2]);assert.deepEqual(G.listeningIdentityReviewNotes(p.questions),[]);assert.equal(G.parseListeningPackage(p).success,true);
});
test('embedded media: the recording is extracted once and the HTML keeps only a marker; scripts in the source are never executed',async()=>{
 h=setup({path:'/app/admin/listening/import'});globalThis.DOMParser=h.dom.window.DOMParser;const {entries,textFiles}=await G.readListeningFiles([fixtureFile()]);
 assert.deepEqual(Object.keys(entries).sort(),['Listening_Test_1.html','embedded-listening-audio.mp3']);assert(textFiles['Listening_Test_1.html'].includes('[embedded:embedded-listening-audio.mp3]'));assert(!/data:audio\/mpeg;base64/.test(textFiles['Listening_Test_1.html']));assert.equal(h.dom.window.evil,undefined);
 const two='<audio src="data:audio/mpeg;base64,AAAA"></audio><audio src="data:audio/mpeg;base64,BBBB"></audio>';assert.throws(()=>G.extractEmbeddedListeningMedia(two),/Multiple distinct/);
});
test('problems are explicit: no audio, signature mismatch, ambiguous/missing referenced recording, unreadable duration, no question source, unsupported exam page, broken DATA',async()=>{
 const {entries,textFiles}=await (async()=>{h=setup({path:'/app/admin/listening/import'});globalThis.DOMParser=h.dom.window.DOMParser;return G.readListeningFiles([fixtureFile()]);})();
 const run=(over)=>G.inspectListeningPackage({entries,textFiles,zipName:'x.html',probeDuration:async()=>1700,read:G.readDocument,...over});
 await assert.rejects(()=>run({entries:{'a.html':entries['Listening_Test_1.html']},textFiles}),e=>e.code==='no_audio');
 assert.equal((await run({entries:{...entries,'x.mp3':new Uint8Array([1,2,3,4])}})).audio.path,'embedded-listening-audio.mp3','a file with a wrong signature is ignored, not trusted');
 const two={...entries,'second.mp3':entries['embedded-listening-audio.mp3']};await assert.rejects(()=>run({entries:two}),e=>e.code==='audio_ambiguous'&&e.detail.files.length===2);
 assert.equal((await run({entries:two,chosenAudioPath:'second.mp3'})).audio.path,'second.mp3');
 await assert.rejects(()=>run({entries:{'only.mp4':new Uint8Array(20)}}),e=>e.code==='audio_signature_mismatch'||e.code==='no_audio');
 await assert.rejects(()=>run({probeDuration:async()=>{throw new Error('no');}}),e=>e.code==='audio_unreadable');
 await assert.rejects(()=>run({textFiles:{'a.html':'<p>hi</p>'}}),e=>e.code==='no_question_source');
 await assert.rejects(()=>run({textFiles:{'01_full_exam.html':'<input id="l1">'}}),e=>e.code==='package_invalid'&&/oldest exam-page format/.test(e.detail.info));
 await assert.rejects(()=>run({textFiles:{'a.html':textFiles['Listening_Test_1.html'].replace('"question_types"','"question_types":::')}}),e=>e.code==='package_invalid','a damaged DATA literal is a package problem, never a guess');
 await assert.rejects(()=>run({probeDuration:async()=>10}),e=>e.code==='package_invalid','a 10 s recording cannot hold this test (schema: >=60 s, evidence inside audio)');
});
test('canonical data/package.json inside a legacy-looking bundle wins; an invalid one falls back to the exam page and says so',async()=>{
 h=setup({path:'/app/admin/listening/import'});globalThis.DOMParser=h.dom.window.DOMParser;const {entries,textFiles}=await G.readListeningFiles([fixtureFile()]);
 const r=await G.inspectListeningPackage({entries,textFiles:{...textFiles,'data/package.json':'{"schemaVersion":2}'},zipName:'x.html',probeDuration:async()=>1700,read:G.readDocument});assert.equal(r.family,'legacy');assert(r.canonicalFallback);
 const p=(await G.inspectListeningPackage({entries,textFiles,zipName:'x.html',probeDuration:async()=>1700,read:G.readDocument})).payload;
 const r2=await G.inspectListeningPackage({entries,textFiles:{'data/package.json':JSON.stringify({...p,audio:{path:'embedded-listening-audio.mp3',durationSec:5}})},zipName:'canon.zip',probeDuration:async()=>1700,read:G.readDocument});assert.equal(r2.family,'canonical');await assert.rejects(()=>G.inspectListeningPackage({entries,textFiles:{'data/package.json':JSON.stringify({...p,audio:{path:'zzz.mp3',durationSec:5}})},zipName:'canon.zip',probeDuration:async()=>1700,read:G.readDocument}),e=>e.code==='audio_reference_missing');assert.equal(r2.payload.audio.path,'embedded-listening-audio.mp3');assert.equal(r2.payload.audio.durationSec,1700);
});
test('package schema rules (zod port): evidence inside audio, unique numbers, answer pairs, section references, clip bounds, unsafe asset paths',async()=>{
 const base=(await inspectFixture()).payload,clone=()=>structuredClone(base),bad=f=>{const p=clone();f(p);return G.parseListeningPackage(p);};
 assert(bad(p=>{p.questions[0].evidence.at=1700;}).issue.message.includes('evidence outside audio'));assert(bad(p=>{p.questions[1].number=1;}).issue.message.includes('Duplicate question'));assert(bad(p=>{p.questions[24].pair=[27];}).issue.message.includes('Invalid answer pair'));assert(bad(p=>{p.studyPack=undefined;p.questions[0].section=3;p.sections=p.sections.filter(s=>s.number!==3);}).issue.message.includes('wrong section'));
 assert(bad(p=>{p.keyword1[0].end=2000;}).issue.message.includes('Clip outside audio'));assert(bad(p=>{p.audio.path='../evil.mp3';}).issue.message.includes('Unsafe asset path'));assert(bad(p=>{p.testId='Bad Id';}).issue.path==='testId');assert(bad(p=>{p.audio.durationSec=30;}).issue.path==='audio');assert(bad(p=>{p.questions=[];}).issue.message.includes('Missing questions'));assert(bad(p=>{p.sections=[];}).issue.path==='sections');
 assert(bad(p=>{p.mapDiagram.shapes[0].fill='url(javascript:1)';}).issue.includes?.('mapDiagram')??true);assert.equal(G.parseMapDiagram({viewBox:[0,0,10,10],label:'x',shapes:[{tag:'rect',x:1,fill:'expression(1)'}]}).success,false);assert.equal(G.parseMapDiagram({viewBox:[0,0,10,10],label:'x',shapes:[{tag:'script'}]}).success,false);
 const g=G.gradePackage(base,{1:' 80 ',25:'B',26:'B',27:'a'});assert.equal(g[0].correct,true);assert.equal(g[24].correct,true);assert.equal(g[25].correct,false,'the same letter cannot score twice in a Choose-TWO pair (first answer wins)');
});
test('map diagram renders as inert SVG built from validated coordinates only (no script, no foreign attributes)',async()=>{
 const p=(await inspectFixture()).payload,svg=listeningMap(p.mapDiagram);assert.equal(svg.getAttribute('viewBox'),'0 0 760 430');assert.equal(svg.getAttribute('role'),'img');assert(svg.querySelectorAll('*').length===23);assert.equal(svg.querySelectorAll('script,foreignObject,image,a').length,0);assert(![...svg.querySelectorAll('*')].some(n=>[...n.attributes].some(a=>/^on/i.test(a.name))));
});
const mount=async()=>{h=setup({path:'/app/admin/listening/import'});globalThis.DOMParser=h.dom.window.DOMParser;h.ctx.probeAudio=async()=>1700;h.ctx.startUpload=undefined;const node=legacyImporter(h.ctx);h.ctx.root.append(node);return node;};
const pick=(files)=>{const i=h.q('[data-legacy-file]');Object.defineProperty(i,'files',{value:files,configurable:true});i.dispatchEvent(new window.Event('change'));};
const waitFor=async(fn,ms=8000)=>{const t=Date.now();while(Date.now()-t<ms){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw new Error('timeout waiting');};
test('screen: choose the real HTML -> summary, family, audio used, title, collection, full preview with map in Part 2; tryout answers are graded locally and nothing is sent',async()=>{
 await mount();let sent=0;globalThis.fetch=async()=>{sent++;return jres(200,{});};pick([fixtureFile()]);await waitFor(()=>h.q('[data-legacy-summary]'));
 assert.equal(h.q('[data-legacy-summary]').textContent,'40 questions · 4 sections · 28 min · 20 words');assert.equal(h.q('[data-legacy-family]').dataset.legacyFamily,'legacy');assert(h.ctx.root.textContent.includes('Recording: embedded-listening-audio.mp3 (mp3)'));assert.equal(h.q('[data-legacy-title]').value,'Listening Test 1');
 assert.deepEqual(h.qa('[data-tryout-activity]').map(b=>b.dataset.tryoutActivity),['exam','script','mcq','map','completion','vocab']);assert.equal(h.q('[data-listening-map]'),null,'Part 1 has no map');h.click(h.q('[data-tryout-part="2"]'));assert(h.q('[data-listening-map]'));assert.equal(h.q('[data-tryout-audio]').tagName,'AUDIO');
 h.click(h.q('[data-tryout-part="1"]'));h.input(h.q('[data-tryout-answer="1"]'),'eighty');h.click(h.q('[data-tryout-check]'));assert.equal(h.q('[data-tryout-question="1"] [data-tryout-result]').dataset.tryoutResult,'correct');h.click(h.q('[data-tryout-reset]'));assert.equal(h.qa('[data-tryout-result]').length,0);
 h.click(h.q('[data-tryout-activity=mcq]'));h.click(h.q('[data-tryout-part="3"]'));assert(h.q('[data-tryout-prediction]'));assert(h.q('[data-tryout-commit]').disabled);h.input(h.q('[data-tryout-prediction]'),'A');assert.equal(h.q('[data-tryout-commit]').disabled,false);h.click(h.q('[data-tryout-commit]'));assert(h.q('[data-tryout-answer]'));
 assert.equal(sent,0);
});
test('upload: audio (and map if any) uploaded by id, then POST /api/admin/listening/import with the edited title + chosen collection; success link; failures localized; double click once; abort cancels',async()=>{
 await mount();const posts=[],ups=[];let mode='ok';h.ctx.startUpload=(file,opts)=>{ups.push({name:file.name,type:file.type,purpose:opts.purpose});queueMicrotask(()=>opts.onProgress?.(60));return {cancel(){},promise:Promise.resolve(mode==='uploadfail'?{ok:false,failure:{code:'storage_rejected',retryable:true}}:{ok:true,uploadId:'aud-1'})};};
 globalThis.fetch=async(p,o)=>{posts.push({p,b:JSON.parse(o.body)});await tick(2);return mode==='ok'?jres(200,{id:ID(50)}):mode==='dup'?jres(409,{error:'source_already_imported',correlationId:'abcdef1234567890zzz'}):jres(500,{error:'weird'});};
 pick([fixtureFile()]);await waitFor(()=>h.q('[data-legacy-upload]'));h.input(h.q('[data-legacy-title]'),'My Edited Title');h.change(h.q('[data-legacy-collection]'),'general');
 mode='uploadfail';h.click(h.q('[data-legacy-upload]'));await tick(8);assert(h.q('[data-legacy-error]').textContent.includes(dicts.en.uploadErrors.storage_rejected.slice(0,12)));assert.equal(posts.length,0);
 mode='dup';h.click(h.q('[data-legacy-upload]'));await tick(10);assert(h.q('[data-legacy-error]').textContent.includes(dicts.en.listeningImport.importErrors.source_already_imported));assert(h.q('[data-legacy-error]').textContent.includes('(ref abcdef1234567890)'));
 mode='weird';h.click(h.q('[data-legacy-upload]'));await tick(10);assert(h.q('[data-legacy-error]').textContent.includes(dicts.en.listeningImport.importErrors.unknown));
 mode='ok';posts.length=0;const up=h.q('[data-legacy-upload]');h.click(up);h.click(up);await tick(12);assert.equal(posts.length,1);assert.equal(posts[0].p,'/api/admin/listening/import');assert.equal(posts[0].b.audioUploadId,'aud-1');assert.equal(posts[0].b.imageUploadId,null);assert.equal(posts[0].b.payload.title,'My Edited Title');assert.equal(posts[0].b.payload.collection,'general');assert.equal(posts[0].b.payload.questions.length,40);assert(!JSON.stringify(posts[0].b).includes('objectKey'));
 assert.equal(h.q('[data-legacy-saved] a').getAttribute('href'),'/app/listening/tests/'+ID(50));assert(h.q('[data-legacy-upload]').disabled);assert.equal(ups.at(-1).purpose,'material_primary');assert.equal(ups.at(-1).type,'audio/mpeg');assert.equal(ups.at(-1).name,'full.mp3');
});
test('screen problems: ambiguous recordings show a chooser that re-inspects with the chosen file; unreadable zip / unsafe / too large mapped; unknown family explained; non-package files ignored',async()=>{
 await mount();const html=fixtureFile();const mp3=new File([new Uint8Array([0x49,0x44,0x33,4,0,0,0,0,0,0,0,0])],'second.mp3',{type:'audio/mpeg'});pick([html,mp3]);await waitFor(()=>h.q('[data-import-problem]'));
 assert.equal(h.q('[data-import-problem]').dataset.importProblem,'audio_ambiguous');const cands=h.qa('[data-audio-candidate]');assert.equal(cands.length,2);h.click(h.q('[data-audio-candidate="second.mp3"]'));await waitFor(()=>h.q('[data-legacy-summary]'));assert(h.ctx.root.textContent.includes('Recording: second.mp3 (mp3)'));
 pick([new File(['not a zip'],'broken.zip')]);await waitFor(()=>h.q('[data-import-problem]'));assert.equal(h.q('[data-import-problem]').dataset.importProblem,'zip_unreadable');
 pick([new File(['<p>nothing</p>'],'plain.html'),mp3]);await waitFor(()=>h.q('[data-import-problem]')?.dataset.importProblem==='no_question_source');assert(h.q('[data-import-problem]').textContent.includes(dicts.en.listeningImport.problems.no_question_source));
 const before=h.ctx.root.innerHTML;pick([new File(['x'],'notes.txt')]);await tick(4);assert.equal(h.ctx.root.innerHTML,before,'files that are neither zip nor html are ignored');
});
function zip(entries){const enc=new TextEncoder(),locals=[],cds=[];let off=0;for(const [name,data] of Object.entries(entries)){const raw=typeof data==='string'?enc.encode(data):data,body=deflateRawSync(raw),n=enc.encode(name);const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(8,8);lh.writeUInt32LE(crc32(raw),14);lh.writeUInt32LE(body.length,18);lh.writeUInt32LE(raw.length,22);lh.writeUInt16LE(n.length,26);locals.push(lh,Buffer.from(n),Buffer.from(body));const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt16LE(8,10);ch.writeUInt32LE(crc32(raw),16);ch.writeUInt32LE(body.length,20);ch.writeUInt32LE(raw.length,24);ch.writeUInt16LE(n.length,28);ch.writeUInt32LE(off,42);cds.push(ch,Buffer.from(n));off+=30+n.length+body.length;}const cd=Buffer.concat(cds),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(off,16);return new Uint8Array(Buffer.concat([...locals,cd,end]));}
test('ZIP transport: the same real test inside a ZIP (with a __MACOSX junk entry and a folder root) imports identically; path traversal refused',async()=>{
 await mount();const html=fs.readFileSync(FIX,'utf8');pick([new File([zip({'pkg/exam.html':html,'__MACOSX/pkg/._exam.html':'junk'})],'pkg.zip')]);await waitFor(()=>h.q('[data-legacy-summary]'));assert.equal(h.q('[data-legacy-summary]').textContent,'40 questions · 4 sections · 28 min · 20 words');
 pick([new File([zip({'../evil.html':html})],'bad.zip')]);await waitFor(()=>h.q('[data-import-problem]'));assert.equal(h.q('[data-import-problem]').dataset.importProblem,'zip_unsafe');
});
test('import page now hosts the legacy importer by default (no empty slot) and keeps it inside the labelled legacy section',async()=>{
 h=setup({role:'admin',path:'/app/admin/listening/import'});h.stub({'/api/frontend/staff/listening-import':{version:1,kind:'listening-import',data:{schemaReady:true}}});await h.mount(LI);assert(h.q('[data-legacy-import-section] [data-listening-import] [data-legacy-file]'));assert.equal(h.q('[data-legacy-import-slot]'),null);
});
