/** Slice 13: reading import (schema, safe ZIP, source reader, tryout, send). Fixtures only; NOT live. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {deflateRawSync,crc32} from 'node:zlib';
import {setup,tick,dicts} from './harness.mjs';
import * as RI from '../../modules/staff-final30/reading-import.js';
import {parseGeneralReadingBundle,readReadingSource,readSafeArchiveAsync,jsonLiteral,scrubDocument,safeArchivePath,readingQuestionTypeId} from '../../js/adapters/staff-final30/reading-import.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;delete globalThis.DOMParser;});
const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
const bundle=(o={})=>({sourceRef:'set-1',title:'Harbour',passages:[{passageNo:1,title:'P1',body:'Body text',questions:[{questionNo:1,type:'TFNG',text:'It is true.',answer:'TRUE'},{questionNo:2,type:'short_answer',text:'Name it',answer:'Port',accepted:['harbour']}]}],...o});
function zip(entries,{method=8,flags=0,lie}={}){
 const enc=new TextEncoder(),locals=[],cds=[];let off=0;
 for(const [name,data] of Object.entries(entries)){const raw=typeof data==='string'?enc.encode(data):data,body=method===8?deflateRawSync(raw):raw,n=enc.encode(name),usize=lie?.[name]??raw.length;
  const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(flags,6);lh.writeUInt16LE(method,8);lh.writeUInt32LE(crc32(raw),14);lh.writeUInt32LE(body.length,18);lh.writeUInt32LE(usize,22);lh.writeUInt16LE(n.length,26);
  locals.push(lh,Buffer.from(n),Buffer.from(body));
  const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt16LE(flags,8);ch.writeUInt16LE(method,10);ch.writeUInt32LE(crc32(raw),16);ch.writeUInt32LE(body.length,20);ch.writeUInt32LE(usize,24);ch.writeUInt16LE(n.length,28);ch.writeUInt32LE(off,42);cds.push(ch,Buffer.from(n));
  off+=30+n.length+body.length;}
 const cd=Buffer.concat(cds),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(off,16);
 return new Uint8Array(Buffer.concat([...locals,cd,end]));
}
const fileOf=(name,data,type='')=>new File([data],name,{type});
test('schema parity: defaults, aliases (TFNG), stripping, group rules, duplicates, limits, first-issue path',()=>{
 const p=parseGeneralReadingBundle(bundle());assert(p.success);assert.equal(p.data.publish,false);assert.deepEqual(p.data.passages[0].vocabulary,[]);assert.deepEqual(p.data.passages[0].questions[0].accepted,[]);assert.equal(p.data.passages[0].questions[0].explanation,'');assert.equal(readingQuestionTypeId('mcq'),'multiple_choice');assert.equal(readingQuestionTypeId('nope'),null);
 assert.equal(parseGeneralReadingBundle({...bundle(),junk:1}).data.junk,undefined);
 const bad=(f)=>{const b=bundle();f(b);return parseGeneralReadingBundle(b);};
 assert.equal(bad(b=>{b.passages[0].questions[0].type='essay';}).issue.path,'passages.0.questions.0.type');assert(!bad(b=>{b.passages[0].questions[1].questionNo=1;}).success);assert(!bad(b=>{b.passages[0].questions[0].groupKey='zz';}).success);assert(!bad(b=>{b.passages=[];}).success);assert(!bad(b=>{b.passages=[1,2,3,4].map(n=>({...b.passages[0],passageNo:Math.min(n,3)}));}).success);
 assert(!bad(b=>{b.passages.push({...b.passages[0]});}).success,'duplicate passageNo');assert(!bad(b=>{b.sourceRef='x'.repeat(81);}).success);assert(!bad(b=>{b.passages[0].questions[0].answer='';}).success);assert(!bad(b=>{b.passages[0].passageNo=4;}).success);assert(!parseGeneralReadingBundle(null).success);
 assert(bad(b=>{b.passages[0].groups=[{key:'a',typeCode:'MH'},{key:'a',typeCode:'MH'}];}).issue.message.includes('Duplicate group'));
});
test('archive path rules and jsonLiteral never evaluate code',()=>{
 for(const bad of ['../x','/abs','C:\\x','a/../b','a\\b','','x'.repeat(241),'./x'])assert.equal(safeArchivePath(bad),false,bad);assert.equal(safeArchivePath('dir/file.json'),true);
 assert.deepEqual(jsonLiteral('<script>const KEY = {"1":"A"};alert(1)</script>','const KEY ='),{1:'A'});assert.throws(()=>jsonLiteral('const KEY = alert(1);','const KEY ='));assert.throws(()=>jsonLiteral('x','const KEY ='));assert.throws(()=>jsonLiteral('const KEY = {"a":','const KEY ='));
 assert(!/onclick|<iframe|DOCTYPE/i.test(scrubDocument('<!DOCTYPE html><div onclick="x()"><iframe src=a></iframe>t</div>')));
});
test('source reader: JSON, fenced JSON, plain text -> supplemental preview, HTML JSON block, controls+KEY with content-hash sourceRef, ambiguous blocks refused, unsupported kinds are supplemental, scripts never run',async()=>{
 h=setup({path:'/app/admin/reading/import'});globalThis.DOMParser=h.dom.window.DOMParser;
 assert.equal((await readReadingSource(fileOf('a.json',JSON.stringify(bundle())))).kind,'structured');assert.equal((await readReadingSource(fileOf('a.md','```json\n'+JSON.stringify(bundle())+'\n```'))).kind,'structured');
 const t=await readReadingSource(fileOf('n.txt','just notes'));assert.equal(t.kind,'supplemental');assert.equal(t.textPreview,'just notes');
 const html=`<html><body><script type="application/json" data-reading-bundle>${JSON.stringify(bundle())}</script></body></html>`;assert.equal((await readReadingSource(fileOf('b.html',html))).kind,'structured');
 await assert.rejects(()=>readReadingSource(fileOf('c.html',html+html.replace('<html><body>','<div>').replace('</body></html>','</div>'))),/ambiguous_source/);
 const exam=`<html><head><title>Exam</title></head><body><article class="reading-passage"><h2>Passage A</h2><p>Text of passage</p></article><div class="question"><span class="qtext">Is it so?</span><select id="q1"><option value="">-</option><option value="TRUE">TRUE</option><option value="FALSE">FALSE</option></select></div><div class="question"><span class="qtext">Name it</span><input id="q2"></div><script>const KEY = {"1":"TRUE","2":"Port"};window.evil=1;</script></body></html>`;
 const e1=await readReadingSource(fileOf('exam.html',exam)),e2=await readReadingSource(fileOf('exam2.html',exam));assert.equal(e1.kind,'structured');assert.match(e1.bundle.sourceRef,/^html-reading-[0-9a-f]{64}$/);assert.equal(e1.bundle.sourceRef,e2.bundle.sourceRef);assert.equal(e1.bundle.passages[0].questions[0].type,'true_false_not_given');assert.equal(e1.bundle.passages[0].questions[1].type,'short_answer');assert.equal(h.dom.window.evil,undefined);assert(parseGeneralReadingBundle(e1.bundle).success);
 assert.equal((await readReadingSource(fileOf('d.html','<p>hi</p><script>const KEY = {"1":"A"}</script>'))).kind,'supplemental');
 await assert.rejects(()=>readReadingSource(fileOf('x.exe','MZ')),/dangerous_type/);await assert.rejects(()=>readReadingSource(fileOf('s.mp3','ID3')),/unsupported_type/);
 await assert.rejects(()=>readReadingSource(fileOf('p.pdf','%PDF-1.4')),/pdf_reader_unavailable/);const pdf=await readReadingSource(fileOf('p.pdf','%PDF-1.4'),undefined,{readPdfTextLayer:async()=>JSON.stringify(bundle())});assert.equal(pdf.kind,'structured');
});
test('ZIP: bundle found in a zip (deflate and stored), macOS junk ignored, two bundles refused, docx text layer, path traversal/duplicates/encrypted/zip-bomb/too-many refused',async()=>{
 h=setup({path:'/app/admin/reading/import'});globalThis.DOMParser=h.dom.window.DOMParser;const J=JSON.stringify(bundle());
 for(const method of [8,0]){const r=await readReadingSource(fileOf('s.zip',zip({'set/bundle.json':J,'__MACOSX/._bundle.json':'junk','img.png':'x'},{method})));assert.equal(r.kind,'structured');assert.equal(r.bundle.title,'Harbour');}
 await assert.rejects(()=>readReadingSource(fileOf('s.zip',zip({'a.json':J,'b.json':J}))),/ambiguous_source/);
 assert.equal((await readReadingSource(fileOf('s.zip',zip({'notes.txt':'hi'})))).kind,'supplemental');
 const docx=await readReadingSource(fileOf('d.docx',zip({'word/document.xml':`<w:document><w:body><w:p>${J.replace(/</g,'&lt;')}</w:p></w:body></w:document>`})));assert.equal(docx.kind,'structured');assert.equal((await readReadingSource(fileOf('e.docx',zip({'word/document.xml':'<w:document>plain</w:document>'})))).kind,'supplemental');await assert.rejects(()=>readReadingSource(fileOf('f.docx',zip({'x':'y'}))),/invalid_document/);
 await assert.rejects(()=>readSafeArchiveAsync(zip({'../evil.json':J})),/Unsafe ZIP/);await assert.rejects(()=>readSafeArchiveAsync(zip({'A.json':J,'a.JSON':J})),/Duplicate/);await assert.rejects(()=>readSafeArchiveAsync(zip({'a.json':J},{flags:1})),/encrypted/);
 await assert.rejects(()=>readSafeArchiveAsync(zip({'big.txt':'a'.repeat(100000)},{lie:{'big.txt':10}})),/zip_bomb|invalid_zip/);await assert.rejects(()=>readSafeArchiveAsync(zip(Object.fromEntries(Array.from({length:201},(_,i)=>[`f${i}.txt`,'x'])))),/too many/);await assert.rejects(()=>readSafeArchiveAsync(new Uint8Array([1,2,3,4])),/invalid_zip/);
 const ctl=new AbortController();ctl.abort();await assert.rejects(()=>readSafeArchiveAsync(zip({'a.json':J}),ctl.signal),e=>e.name==='AbortError');
});
const pickFile=(h,f)=>{const input=h.q('[data-reading-import-file]');Object.defineProperty(input,'files',{value:[f],configurable:true});input.dispatchEvent(new window.Event('change'));};
test('screen: choose JSON -> tryout + Import enabled; invalid file -> invalid_bundle message and Import disabled; non-bundle -> supplemental notice with materials link; teacher redirected',async()=>{
 h=setup({path:'/app/admin/reading/import'});globalThis.DOMParser=h.dom.window.DOMParser;h.stub({});await h.mount(RI);const send=()=>h.q('[data-reading-import-send]');assert(send().disabled);
 pickFile(h,fileOf('a.json',JSON.stringify(bundle())));await tick(8);assert(h.q('[data-reading-tryout]'));assert.equal(send().disabled,false);assert.equal(h.q('[data-reading-import-name]').textContent,'a.json');
 pickFile(h,fileOf('bad.exe','MZ'));await tick(8);assert(h.q('[data-reading-import-error]').textContent.includes(dicts.en.readingImport.errors.invalid_bundle));assert(send().disabled);assert.equal(h.q('[data-reading-tryout]'),null);
 pickFile(h,fileOf('n.txt','notes'));await tick(8);assert(h.q('[data-reading-import-supplemental] a[href="/app/admin/materials"]'));assert(send().disabled);h.dispose();
 h=setup({role:'teacher',path:'/app/admin/reading/import'});h.stub({});await h.mount(RI);assert.equal(h.nav[0].path,'/app');
});
test('tryout: local-only check/reset, option letter values, alternates and NFKC folding; nothing is sent while trying',async()=>{
 h=setup({path:'/app/admin/reading/import'});globalThis.DOMParser=h.dom.window.DOMParser;let n=0;globalThis.fetch=async()=>{n++;return jres(200,{});};h.stub({});await h.mount(RI);
 const b=bundle();b.passages[0].questions[0].type='true_false_not_given';b.passages[0].questions.push({questionNo:3,type:'MCQ',text:'Pick',options:['A) one','B) two'],answer:'B'});pickFile(h,fileOf('a.json',JSON.stringify(b)));await tick(8);
 const q1=h.q('[data-tryout-answer="1:1"]'),q2=h.q('[data-tryout-answer="1:2"]'),q3=h.q('[data-tryout-answer="1:3"]');assert.deepEqual([...q3.options].map(o=>o.value),['','A','B']);
 h.change(q1,'TRUE');h.input(q2,'  HARBOUR ');h.change(q3,'A');h.click(h.q('[data-tryout-check]'));assert.deepEqual(h.qa('[data-tryout-result]').map(x=>x.dataset.tryoutResult),['correct','correct','wrong']);
 h.click(h.q('[data-tryout-reset]'));assert.equal(h.qa('[data-tryout-result]').length,0);assert.equal(h.q('[data-tryout-answer="1:1"]').value,'');assert.equal(n,0);
});
test('import: POST exact body (publish:true because dryRun:false, as in the source), result shown, button locks; server codes mapped (forbidden/schema_not_ready/unknown); double click sends once',async()=>{
 h=setup({path:'/app/admin/reading/import'});globalThis.DOMParser=h.dom.window.DOMParser;let mode='ok',sent=[];globalThis.fetch=async(p,o)=>{sent.push({p,b:JSON.parse(o.body)});await tick(2);return mode==='ok'?jres(201,{setId:'s1',created:true,dryRun:false,passages:[{passageNo:1,resolved:3,unresolved:1}]}):mode==='forbidden'?jres(403,{error:'forbidden'}):mode==='schema'?jres(503,{error:'schema_not_ready'}):mode==='weird'?jres(500,{error:'boom'}):jres(200,{nope:true});};
 h.stub({});await h.mount(RI);pickFile(h,fileOf('a.json',JSON.stringify(bundle({publish:false}))));await tick(8);const send=()=>h.q('[data-reading-import-send]');
 mode='forbidden';h.click(send());await tick(8);assert(h.q('[data-reading-import-error]').textContent.includes(dicts.en.readingImport.errors.forbidden));mode='schema';h.click(send());await tick(8);assert(h.q('[data-reading-import-error]').textContent.includes(dicts.en.readingImport.errors.schema_not_ready));mode='weird';h.click(send());await tick(8);assert(h.q('[data-reading-import-error]').textContent.includes(dicts.en.readingImport.errors.unknown));mode='bad';h.click(send());await tick(8);assert(h.q('[data-reading-import-error]'));
 mode='ok';sent=[];h.click(send());h.click(send());await tick(10);assert.equal(sent.length,1);assert.equal(sent[0].p,'/api/admin/reading/import');assert.equal(sent[0].b.dryRun,false);assert.equal(sent[0].b.bundle.publish,true);assert.equal(sent[0].b.bundle.sourceRef,'set-1');
 assert(h.q('[data-reading-import-result]').textContent.includes(dicts.en.readingImport.created));assert(h.q('[data-reading-import-result]').textContent.includes('Passage 1: 3 vocabulary items linked, 1 unresolved'));assert.equal(send().disabled,true);assert(h.q('[data-reading-import-result] a[href="/app/admin/reading"]'));
});
test('stale/abort: choosing a second file cancels the first read; source timeout shows the generic failure; leaving the page aborts',async()=>{
 h=setup({path:'/app/admin/reading/import'});globalThis.DOMParser=h.dom.window.DOMParser;h.stub({});await h.mount(RI);
 const slow=fileOf('slow.txt','x');slow.text=()=>new Promise(()=>{});const inp=h.q('[data-reading-import-file]');pickFile(h,slow);await tick(2);assert.equal(inp.disabled,true);h.controller.abort();await tick(3);assert.equal(inp.disabled,true,'no repaint after abort');
 h.dispose();h=setup({path:'/app/admin/reading/import'});globalThis.DOMParser=h.dom.window.DOMParser;h.ctx.readingSourceTimeoutMs=20;h.stub({});await h.mount(RI);const hang=fileOf('hang.zip',zip({'a.json':'{}'}));hang.arrayBuffer=()=>new Promise(()=>{});pickFile(h,hang);await new Promise(r=>setTimeout(r,60));await tick(3);
 assert(h.q('[data-reading-import-error]'));assert.equal(h.q('[data-reading-import-file]').disabled,false);
});
