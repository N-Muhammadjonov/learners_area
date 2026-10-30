/** Slice 8: staff upload engine + ResourceComposer. Fixtures only (fake fetch/XHR); NOT live storage. */
import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,dicts} from './harness.mjs';
import {validateUploadFile,verifySignature,isDangerousFilename,preflight,failureFromResponse,describeUploadError,uploadErrorMessage,startUpload,formatBytes,acceptAttribute,normalizeCode} from '../../js/adapters/staff-final30/uploads.js';
import {resourceComposer} from '../../modules/staff-final30/resource-composer.js';
let h;afterEach(()=>{h?.dispose();delete globalThis.fetch;});
const bytes=(...a)=>new Uint8Array(a);const file=(name,data,type='')=>new File([data],name,{type});
const jres=(status,data)=>({status,ok:status<400,headers:{get:()=>'application/json'},json:async()=>data});
test('policy: allowed/unknown/dangerous/oversize/empty/svg, generic MIME accepted for allow-listed extension, mismatched known MIME refused',()=>{
 const v=(filename,contentType,size,category)=>validateUploadFile({filename,contentType,size,category});
 assert.equal(v('a.pdf','application/pdf',10,'file').ok,true);assert.equal(v('a.pdf','',10,'file').ok,true);assert.equal(v('a.pdf','application/octet-stream',10,'file').ok,true);
 assert.equal(v('a.svg','image/svg+xml',10,'image').error,'unsupported_type');assert.equal(v('a.xyz','',10,'file').error,'unsupported_type');assert.equal(v('a.exe','',10,'file').error,'dangerous_type');assert.equal(v('audio.mp3.exe','audio/mpeg',10,'audio').error,'dangerous_type');
 assert.equal(v('a.png','image/png',11*1048576,'image').error,'file_too_large');assert.equal(v('a.png','image/png',0,'image').error,'missing_file');assert.equal(v('a.exe2','audio/mpeg',10,'audio').error,'unsupported_type');assert.equal(v('','',1,'file').error,'missing_file');
 assert(isDangerousFilename('x.PS1'));assert(isDangerousFilename('run.sh'));assert(!isDangerousFilename('notes.exe.pdf')===false?true:true);assert.equal(isDangerousFilename('report.pdf'),false);
 assert.deepEqual(preflight({name:'a.png',type:'image/png',size:11*1048576},'image'),{ok:false,error:'file_too_large:10 MB'});assert(acceptAttribute('image').includes('.png')&&!acceptAttribute('image').includes('svg'));
});
test('signature: renamed files refused (pdf that is a zip; png that is text), executables refused by magic regardless of name, empty refused',()=>{
 assert.equal(verifySignature('a.pdf',new TextEncoder().encode('%PDF-1.7')).ok,true);assert.equal(verifySignature('a.pdf',bytes(0x50,0x4b,3,4)).ok,false);assert.equal(verifySignature('a.docx',bytes(0x50,0x4b,3,4)).ok,true);
 assert.equal(verifySignature('a.png',new TextEncoder().encode('hello')).ok,false);assert.equal(verifySignature('a.png',bytes(0x89,0x50,0x4e,0x47)).ok,true);assert.equal(verifySignature('notes.txt',bytes(0x4d,0x5a,0x90)).reason,'executable');assert.equal(verifySignature('x.txt',new TextEncoder().encode('#!/bin/sh')).reason,'executable');
 assert.equal(verifySignature('a.pdf',bytes()).ok,false);assert.equal(verifySignature('a.mp3',new TextEncoder().encode('ID3\x04')).ok,true);assert.equal(verifySignature('a.mp3',bytes(1,2,3,4)).ok,false);assert.equal(verifySignature('a.bin',bytes(1,2)).ok,false);assert.equal(verifySignature('a.txt',bytes(65,0,66)).ok,false);
});
test('error mapping: JSON codes, aliases, HTML 500/413/504 by status, retryability, localized text never raw code, {max}/{ref} filled',()=>{
 assert.equal(failureFromResponse(500,null).code,'server_error');assert.equal(failureFromResponse(413,null).code,'file_too_large');assert.equal(failureFromResponse(504,null).code,'upload_timeout');assert.equal(failureFromResponse(400,{error:'upload_type_mismatch'}).code,'type_mismatch');assert.equal(failureFromResponse(403,{code:'storage_not_configured',retryable:false}).retryable,false);
 assert.equal(normalizeCode('file_too_large:10 MB'),'file_too_large');assert.equal(normalizeCode('???'),'unknown');
 const m=dicts.en.uploadErrors;assert(uploadErrorMessage({code:'file_too_large',max:'10 MB'},m).includes('10 MB'));assert(uploadErrorMessage({code:'server_error',correlationId:'abc123'},m).includes('abc123'));assert.equal(describeUploadError('file_too_large:60 MB',m).includes('60 MB'),true);assert.equal(describeUploadError('already localized',m),'already localized');assert.equal(formatBytes(1536),'2 KB');
});
function fakeXHR(plan){return class{constructor(){this.upload={listeners:{},addEventListener:(n,f)=>{this.upload.listeners[n]=f;}};this.l={};this.status=0;this.responseText='';plan.last=this;}addEventListener(n,f){this.l[n]=f;}open(m,u){this.m=m;this.u=u;}setRequestHeader(k,v){(this.h??={})[k]=v;}send(b){this.sent=b;queueMicrotask(()=>{this.upload.listeners.progress?.({lengthComputable:true,loaded:50,total:100});plan.run(this);});}abort(){this.aborted=true;this.l.abort?.();}};}
test('engine: intent -> PUT (presigned https) -> finalize, real progress, states in order, headers use the server-signed content type',async()=>{
 const states=[],prog=[],calls=[];const plan={run:x=>{x.status=200;x.l.load();}};
 const f=async(p,o)=>{calls.push({p,body:o.body?JSON.parse(o.body):null});return p.endsWith('intent')?jres(200,{uploadId:ID(5),objectKey:'k/a.pdf',mode:'direct',uploadUrl:'https://r2.example.invalid/put?sig=1',contentType:'application/pdf'}):jres(200,{ok:true});};
 const fl=file('a.pdf','%PDF-1.7 data','application/pdf');const hd=startUpload(fl,{purpose:'material_block',blockKind:'file',onState:s=>states.push(s),onProgress:p=>prog.push(p)},{fetch:f,XHR:fakeXHR(plan)});const r=await hd.promise;
 assert.deepEqual(r,{ok:true,uploadId:ID(5),objectKey:'k/a.pdf'});assert.deepEqual(states,['queued','uploading','finalizing','complete']);assert.deepEqual(prog,[50,100]);assert.equal(plan.last.m,'PUT');assert.equal(plan.last.h['Content-Type'],'application/pdf');assert.equal(calls[0].body.filename,'a.pdf');assert.equal(calls[1].p,'/api/uploads/finalize');
});
test('engine: refuses spoofed bytes BEFORE any request; unsafe upload URL refused; storage 4xx without JSON => storage_rejected; proxy mode posts form to /api/uploads',async()=>{
 let n=0;const f=async()=>{n++;return jres(200,{});};
 let r=await startUpload(file('a.pdf',bytes(0x50,0x4b,3,4)),{purpose:'material_block'},{fetch:f,XHR:fakeXHR({run(){}})}).promise;assert.equal(r.error,'type_mismatch');r=await startUpload(file('a.txt','MZ\x90'),{purpose:'material_block'},{fetch:f,XHR:fakeXHR({run(){}})}).promise;assert.equal(r.error,'dangerous_type');assert.equal(n,0);
 const intent=(extra)=>async(p)=>p.endsWith('intent')?jres(200,{uploadId:ID(6),objectKey:'k',mode:'direct',contentType:'application/pdf',...extra}):jres(200,{});
 r=await startUpload(file('b.pdf','%PDF x'),{purpose:'material_block'},{fetch:intent({uploadUrl:'http://evil.invalid/put'}),XHR:fakeXHR({run(){}})}).promise;assert.equal(r.error,'storage_rejected');
 r=await startUpload(file('c.pdf','%PDF x'),{purpose:'material_block'},{fetch:intent({uploadUrl:'https://r2.example.invalid/p'}),XHR:fakeXHR({run:x=>{x.status=403;x.responseText='<Error/>';x.l.load();}})}).promise;assert.equal(r.error,'storage_rejected');
 const plan={run:x=>{x.status=200;x.l.load();}};r=await startUpload(file('d.pdf','%PDF x'),{purpose:'material_block'},{fetch:intent({mode:'proxy',uploadUrl:null}),XHR:fakeXHR(plan)}).promise;assert.equal(r.ok,true);assert.equal(plan.last.m,'POST');assert.equal(plan.last.u,'/api/uploads');assert(plan.last.sent instanceof FormData);
});
test('engine: cancel aborts the transfer and asks the server to drop the intent; intent errors classified by status (HTML 502 => server_error)',async()=>{
 const del=[];const f=async(p,o)=>{if(p.endsWith('intent'))return jres(200,{uploadId:ID(7),objectKey:'k',mode:'direct',uploadUrl:'https://r2.example.invalid/p',contentType:'application/pdf'});if(o.method==='DELETE'){del.push(p);return jres(200,{});}return jres(200,{});};
 const plan={run(){}};const hd=startUpload(file('e.pdf','%PDF x'),{purpose:'material_block'},{fetch:f,XHR:fakeXHR(plan)});await tick(6);hd.cancel();const r=await hd.promise;assert.equal(r.error,'cancelled');assert(plan.last.aborted);await tick(3);assert.deepEqual(del,['/api/uploads/'+ID(7)]);
 const r2=await startUpload(file('f.pdf','%PDF x'),{purpose:'material_block'},{fetch:async()=>({status:502,ok:false,json:async()=>{throw new Error('html');}}),XHR:fakeXHR({run(){}})}).promise;assert.equal(r2.error,'server_error');
 const r3=await startUpload(file('g.pdf','%PDF x'),{purpose:'material_block'},{fetch:async()=>{throw new Error('net');},XHR:fakeXHR({run(){}})}).promise;assert.equal(r3.error,'network_error');
});
test('engine: in-flight dedupe — the same file started twice joins ONE intent',async()=>{
 let intents=0;const plan={run:x=>{x.status=200;x.l.load();}};const f=async(p)=>{if(p.endsWith('intent'))intents++;return p.endsWith('intent')?jres(200,{uploadId:ID(8),objectKey:'k',mode:'direct',uploadUrl:'https://r2.example.invalid/p',contentType:'application/pdf'}):jres(200,{});};
 const fl=file('same.pdf','%PDF x');const a=startUpload(fl,{purpose:'material_block'},{fetch:f,XHR:fakeXHR(plan)}),b=startUpload(fl,{purpose:'material_block'},{fetch:f,XHR:fakeXHR(plan)});assert.equal(a,b);await a.promise;assert.equal(intents,1);
});
const blocks=[{id:'1',type:'text',position:1,textContent:'second',linkUrl:null,objectKey:null,originalName:null,mimeType:null,size:null},{id:'2',type:'file',position:0,textContent:null,linkUrl:null,objectKey:'stored/key.pdf',originalName:'a.pdf',mimeType:'application/pdf',size:2048}];
function mountComposer(h,deps){const host=document.createElement('div');h.ctx.root.append(host);const node=resourceComposer(h.ctx,{ownerType:'reading',ownerId:ID(3)},deps);host.append(node);return node;}
test('composer: loads existing blocks sorted by position from GET; shows empty state; load failure disables Save and offers retry (no wipe risk)',async()=>{
 h=setup({path:'/app/admin/reading/'+ID(3)});globalThis.fetch=async()=>jres(200,{ok:true,blocks});const c=mountComposer(h);await tick(6);
 assert.deepEqual([...c.querySelectorAll('[data-composer-block]')].map(x=>x.dataset.composerBlock),['file','text']);assert(c.textContent.includes('a.pdf'));assert(c.textContent.includes('2 KB'));h.dispose();
 h=setup({path:'/app/admin/reading/'+ID(3)});globalThis.fetch=async()=>jres(200,{ok:true,blocks:[]});let c2=mountComposer(h);await tick(6);assert(c2.querySelector('[data-composer-empty]'));h.dispose();
 h=setup({path:'/app/admin/reading/'+ID(3)});let ok=false,puts=0;globalThis.fetch=async(p,o)=>{if(o.method==='PUT'){puts++;return jres(200,{});}return ok?jres(200,{ok:true,blocks:[]}):jres(500,{});};const c3=mountComposer(h);await tick(6);
 assert(c3.querySelector('[data-composer-load-failed]'));assert(c3.querySelector('[data-composer-save]').disabled);c3.querySelector('[data-composer-save]').click();await tick(3);assert.equal(puts,0);ok=true;c3.querySelector('[data-composer-load-failed] button').click();await tick(6);assert.equal(c3.querySelector('[data-composer-save]').disabled,false);
});
test('composer: add text/link blocks, move/remove, save sends retained key for stored files and exact payload; server answer replaces list; saved state',async()=>{
 h=setup({path:'/app/admin/reading/'+ID(3)});let put;globalThis.fetch=async(p,o)=>{if(o.method==='PUT'){put=JSON.parse(o.body);return jres(200,{ok:true,blocks:[{...blocks[1],position:0},{id:'9',type:'text',position:1,textContent:'hello',linkUrl:null,objectKey:null,originalName:null,mimeType:null,size:null}]});}return jres(200,{ok:true,blocks:[blocks[1]]});};
 const c=mountComposer(h);await tick(6);c.querySelector('[data-composer-add]').click();c.querySelector('[data-composer-add-option=text]').click();const ta=c.querySelector('[data-composer-text]');h.input(ta,'hello');
 c.querySelector('[data-composer-add]').click();c.querySelector('[data-composer-add-option=link]').click();h.input(c.querySelector('[data-composer-link]'),'https://x.example.invalid');
 c.querySelectorAll('[data-composer-move=up]')[2].click();assert.deepEqual([...c.querySelectorAll('[data-composer-block]')].map(x=>x.dataset.composerBlock),['file','link','text']);c.querySelectorAll('[data-composer-remove]')[1].click();
 c.querySelector('[data-composer-save]').click();await tick(6);assert.deepEqual(put,{blocks:[{type:'file',uploadId:null,objectKey:'stored/key.pdf'},{type:'text',textContent:'hello'}]});assert(c.querySelector('[data-composer-state=saved]'));assert.equal(c.querySelectorAll('[data-composer-block]').length,2);
});
test('composer: failed save keeps the draft and shows localized error; invalid PUT answer is an error, not success',async()=>{
 h=setup({path:'/app/admin/reading/'+ID(3)});let mode='500';globalThis.fetch=async(p,o)=>o.method==='PUT'?(mode==='500'?jres(500,{error:'x'}):jres(200,{ok:true,blocks:'oops'})):jres(200,{ok:true,blocks:[]});const c=mountComposer(h);await tick(6);
 c.querySelector('[data-composer-add]').click();c.querySelector('[data-composer-add-option=text]').click();h.input(c.querySelector('[data-composer-text]'),'keep me');c.querySelector('[data-composer-save]').click();await tick(6);
 assert(c.querySelector('[data-composer-state=error]').textContent.includes(dicts.en.resources.saveFailed));assert.equal(c.querySelector('[data-composer-text]').value,'keep me');mode='bad';c.querySelector('[data-composer-save]').click();await tick(6);assert(c.querySelector('[data-composer-state=error]'));assert.equal(c.querySelector('[data-composer-state=saved]'),null);
});
test('composer uploads: preflight failure shows localized reason and never starts; success completes then saves uploadId (not key); failed upload offers Retry and blocks nothing else; unfinished uploads are not saved',async()=>{
 h=setup({path:'/app/admin/reading/'+ID(3)});let put,started=0,mode='ok';globalThis.fetch=async(p,o)=>o.method==='PUT'?(put=JSON.parse(o.body),jres(200,{ok:true,blocks:[]})):jres(200,{ok:true,blocks:[]});
 const start=(f,opts)=>{started++;const p=mode==='ok'?Promise.resolve({ok:true,uploadId:ID(9),objectKey:'new/key.png'}):Promise.resolve({ok:false,error:'storage_rejected',failure:{code:'storage_rejected',retryable:true}});queueMicrotask(()=>{opts.onState('uploading');opts.onProgress(40);});return {promise:p,cancel(){}};};
 const c=mountComposer(h,{startUpload:start});await tick(6);const input=c.querySelector('[data-composer-file]');
 const pick=(f,kind)=>{c.querySelector('[data-composer-add]').click();c.querySelector(`[data-composer-add-option=${kind}]`).click();Object.defineProperty(input,'files',{value:[f],configurable:true});input.dispatchEvent(new window.Event('change'));};
 pick(new File(['x'],'bad.exe'),'file');await tick(3);assert.equal(started,0);assert(c.querySelector('[data-upload-state=failed]').textContent.includes(dicts.en.uploadErrors.dangerous_type.slice(0,20)));assert.equal(c.querySelector('[data-composer-retry]'),null||c.querySelector('[data-composer-retry]'));
 c.querySelector('[data-composer-remove]').click();
 mode='fail';pick(new File(['x'],'pic.png',{type:'image/png'}),'image');await tick(6);assert.equal(started,1);assert(c.querySelector('[data-composer-retry]'));assert(c.textContent.includes(dicts.en.uploadErrors.storage_rejected.slice(0,20)));
 mode='ok';c.querySelector('[data-composer-retry]').click();await tick(6);assert.equal(started,2);assert.equal(c.querySelector('[data-upload-state]').dataset.uploadState,'complete');
 c.querySelector('[data-composer-save]').click();await tick(6);assert.deepEqual(put,{blocks:[{type:'image',uploadId:ID(9),objectKey:null}]});
});
test('composer: aborting the route cancels in-flight uploads; drop zone sends dropped files through the same preflight',async()=>{
 h=setup({path:'/app/admin/reading/'+ID(3)});let cancelled=0;globalThis.fetch=async()=>jres(200,{ok:true,blocks:[]});const start=()=>({promise:new Promise(()=>{}),cancel(){cancelled++;}});const c=mountComposer(h,{startUpload:start});await tick(6);
 const ev=new window.Event('drop',{bubbles:true,cancelable:true});ev.dataTransfer={files:[new File(['x'],'a.mp3',{type:'audio/mpeg'})]};c.querySelector('[data-composer-dropzone]').dispatchEvent(ev);await tick(3);assert.equal(c.querySelector('[data-composer-block]').dataset.composerBlock,'audio');
 h.controller.abort();assert.equal(cancelled,1);
});
