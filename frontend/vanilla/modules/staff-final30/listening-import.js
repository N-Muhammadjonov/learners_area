import {el,listen,mountStaff,BackLink,fill,put,setChildren} from './kit.js';
import {startUpload,preflight,uploadErrorMessage} from '../../js/adapters/staff-final30/uploads.js';
import {legacyImporter} from './listening-legacy-import.js';
import {readTransportArchive,archiveFile,categoryFor,validatePackage,importPackage,importReady} from '../../js/adapters/staff-final30/listening-import.js';
/**
 * Source: admin/listening/import/page.tsx + components/listening/ListeningImport.tsx (CANONICAL FLOW).
 * select package -> validate (server, no writes) -> upload the declared binaries -> dry run -> transactional import -> open test.
 * The legacy HTML/ZIP section is ported in listening-legacy-import.js (structured practice, research practice, canonical data/package.json;
 * the oldest exam-page format and the authored-runtime frame are refused explicitly). `ctx.listeningLegacyImport` may override it. Role gate: administrators and the owner (mayImportListening).
 */
function importer(ctx){
 const {dict,signal}=ctx,t=dict.contentImport,start=(...a)=>(ctx.startUpload??startUpload)(...a),known=new Set(Object.keys(t.problems));
 const W={flight:false,pkg:null,name:'',validation:null,fatal:null,files:{},uploads:{},published:false,acknowledged:false,busy:'',progress:0,dryRun:null,result:null,error:'',handles:[]};
 const node=el('div',{class:'card space-y-4','data-canonical-listening-import':''}),body=el('div',{class:'space-y-4'});
 const pkgInput=el('input',{class:'mt-2 block',type:'file',accept:'.json,.zip,application/json,application/zip','data-canonical-package-input':''});
 signal.addEventListener('abort',()=>{for(const h of W.handles)h.cancel();},{once:true});
 const alive=()=>!signal.aborted;
 const reset=()=>{W.validation=null;W.fatal=null;W.files={};W.uploads={};W.dryRun=null;W.result=null;W.error='';W.acknowledged=false;};
 async function validate(candidate,name){reset();W.pkg=candidate;W.name=name;W.busy='validate';paint();
  try{const r=await validatePackage(candidate,signal,known);if(!alive())return;if(r.fatal)W.fatal=r.fatal;else W.validation=r.validation;}catch{if(alive())W.fatal={code:'unknown',issues:[]};}
  W.busy='';if(alive())paint();}
 async function load(file){
  W.error='';
  if(/\.json$/i.test(file.name)){try{await validate(JSON.parse(await file.text()),file.name);}catch{if(!alive())return;W.pkg=null;W.validation=null;W.fatal={code:'invalid_json',issues:[]};W.busy='';paint();}return;}
  if(/\.zip$/i.test(file.name)){W.busy='validate';paint();
   try{const archive=await readTransportArchive(new Uint8Array(await file.arrayBuffer()),signal),extracted={};
    for(const a of (archive.manifest?.assets??[])){if(typeof a?.key!=='string'||typeof a?.path!=='string')continue;const bytes=archiveFile(archive.files,a.path);if(!bytes)continue;extracted[a.key]=new File([bytes],a.path.split('/').pop()??a.key,{type:''});}
    W.busy='';await validate(archive.manifest,file.name);if(alive()){W.files={...extracted,...W.files};paint();}}
   catch{if(!alive())return;W.busy='';W.pkg=null;W.validation=null;W.fatal={code:'invalid_input',issues:[]};paint();}
   return;}
  W.fatal={code:'invalid_input',issues:[]};paint();
 }
 async function uploadDeclared(){
  const v=W.validation;if(!v)return null;const next={...W.uploads},pending=v.requiredAssets.filter(a=>a.declared&&W.files[a.key]&&!next[a.key]);if(!pending.length)return next;
  W.busy='upload';W.progress=0;paint();
  for(const a of pending){const file=W.files[a.key],pre=preflight(file,categoryFor(a.role));
   if(!pre.ok){W.error=t.problems.asset_mime_invalid;W.busy='';paint();return null;}
   const h=start(file,{purpose:'material_primary',onProgress:p=>{if(alive()){W.progress=p;paintStatus();}}});W.handles.push(h);const o=await h.promise;if(!alive())return null;
   if(!o.ok){W.error=uploadErrorMessage(o.failure,dict.uploadErrors);W.busy='';paint();return null;}
   next[a.key]=o.uploadId;}
  W.uploads=next;W.progress=0;return next;
 }
 async function submit(mode){
  if(!W.pkg||!W.validation||W.busy||W.flight)return;W.flight=true;W.error='';
  try{const ids=await uploadDeclared();if(!ids||!alive())return;
   W.busy=mode==='dry'?'dry':'import';paint();
   try{const r=await importPackage({pkg:W.pkg,assetUploads:ids,dryRun:mode==='dry',publish:W.published,acknowledgeGradeImpact:W.acknowledged,originalFilename:W.name},signal);if(!alive())return;
    if(r.fatal)W.fatal=r.fatal;else if(mode==='dry')W.dryRun=r.result;else W.result=r.result;}
   catch{if(alive())W.error=t.problems.unknown;}
   W.busy='';if(alive())paint();}
  finally{W.flight=false;}
 }
 const status=el('p',{role:'status','data-canonical-import-status':''});
 function paintStatus(){status.hidden=!W.busy;status.textContent=W.busy==='validate'?t.validating:W.busy==='upload'?fill(t.uploadPhase,{pct:W.progress>0?`${W.progress}%`:''}):W.busy==='dry'?t.dryRunPhase:W.busy==='import'?t.importPhase:'';}
 const problem=code=>t.problems[code]??t.problems.unknown,msg=i=>`${problem(i.code)}${i.path?` (${i.path})`:''}`;
 function paint(){
  pkgInput.disabled=!!W.busy;paintStatus();const v=W.validation,files=W.files;
  const missing=v?v.requiredAssets.filter(a=>a.declared&&!files[a.key]):[],undeclared=v?v.requiredAssets.filter(a=>!a.declared):[],lock=!!W.busy||missing.length>0||undeclared.length>0;
  const kids=[];
  if(W.fatal)kids.push(el('div',{role:'alert',class:'space-y-2 rounded-lg border border-red-300 p-3','data-canonical-import-problem':W.fatal.code},el('p',{class:'font-medium text-red-700'},t.invalidTitle),el('p',{},problem(W.fatal.code)),W.fatal.issues.length?el('ul',{class:'list-disc pl-5 text-sm','data-canonical-import-issues':''},W.fatal.issues.slice(0,8).map(i=>el('li',{},msg(i)))):null));
  if(v){
   kids.push(el('section',{class:'space-y-2','data-canonical-import-summary':''},el('h2',{class:'font-display text-lg'},t.summaryTitle),el('p',{class:'font-medium'},v.preview?.title??v.title),el('p',{class:'text-sm'},`${v.capabilities.label} · v${v.schemaVersion}`),
    v.migratedFrom!==undefined?el('p',{class:'text-sm',role:'status','data-canonical-migrated':''},`${v.migratedFrom} → ${v.schemaVersion}`):null,
    v.sourceStatus?el('p',{class:'text-sm','data-canonical-source-status':v.sourceStatus.status},v.sourceStatus.status==='new'?t.sourceStatusNew:v.sourceStatus.status==='identical'?t.sourceStatusIdentical:t.sourceStatusChanged):null,
    v.preview?el('dl',{class:'grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2'},v.preview.lines.map(l=>el('div',{class:'flex gap-2 text-sm'},el('dt',{class:'font-medium'},l.label),el('dd',{},l.value)))):null));
   if(v.requiredAssets.length)kids.push(el('section',{class:'space-y-2','data-canonical-import-assets':''},el('h2',{class:'font-display text-lg'},t.assetsTitle),v.requiredAssets.map(a=>{const inp=el('input',{type:'file',class:'block',accept:a.role==='audio'?'audio/*,video/webm':a.role==='image'?'image/*':null,disabled:!!W.busy,'aria-label':`${t.chooseFile}: ${a.key}`,'data-asset-input':a.key});listen(inp,'change',()=>{const f=inp.files?.[0];if(f){W.files={...W.files,[a.key]:f};delete W.uploads[a.key];paint();}},signal);
    return el('div',{class:'space-y-1 rounded-lg border border-black/10 p-2','data-asset-key':a.key},el('p',{class:'text-sm font-medium'},`${a.label??a.key} · ${a.role} · ${a.mimeTypes.join(', ')}`),el('p',{class:'text-sm'},files[a.key]?`${t.assetProvided}: ${files[a.key].name}`:t.assetMissing),inp);})));
   if(undeclared.length)kids.push(el('div',{role:'alert',class:'rounded-lg border border-amber-300 p-3','data-canonical-undeclared-assets':''},el('p',{},t.problems.asset_missing),el('ul',{class:'list-disc pl-5 text-sm'},undeclared.map(a=>el('li',{},`${a.key} (${a.role})`)))));
   if(v.issues.length)kids.push(el('div',{role:'alert',class:'space-y-1 rounded-lg border border-red-300 p-3','data-canonical-import-issues':''},el('p',{class:'font-medium text-red-700'},t.issuesTitle),el('ul',{class:'list-disc pl-5 text-sm'},v.issues.map(i=>el('li',{},msg(i))))));
   if(v.warnings.length)kids.push(el('div',{class:'space-y-1 rounded-lg border border-amber-300 p-3','data-canonical-import-warnings':''},el('p',{class:'font-medium'},t.warningsTitle),el('ul',{class:'list-disc pl-5 text-sm'},v.warnings.map(w=>el('li',{},w)))));
   if(W.error)kids.push(el('p',{role:'alert',class:'text-red-700','data-canonical-import-error':''},W.error));
   const cb=(label,key,attr)=>{const c=el('input',{type:'checkbox',disabled:!!W.busy,[attr]:''});c.checked=W[key];listen(c,'change',()=>{W[key]=c.checked;},signal);return el('label',{class:'flex items-center gap-2'},c,label);};
   kids.push(el('div',{class:'space-y-2'},cb(t.publishNow,'published','data-canonical-publish'),cb(t.acknowledgeGrades,'acknowledged','data-canonical-acknowledge')));
   const dry=el('button',{type:'button',class:'btn-secondary',disabled:lock,'data-canonical-dry-run':''},t.dryRun),imp=el('button',{type:'button',class:'btn-primary',disabled:lock||!W.dryRun,'data-canonical-import-button':''},t.importButton);
   listen(dry,'click',()=>void submit('dry'),signal);listen(imp,'click',()=>void submit('apply'),signal);kids.push(el('div',{class:'flex flex-wrap gap-2'},dry,imp));
   if(W.dryRun)kids.push(el('div',{role:'status',class:'text-sm','data-canonical-dry-run-result':''},t.dryRunPassed,W.dryRun.warnings.length?el('ul',{class:'list-disc pl-5'},W.dryRun.warnings.map(w=>el('li',{},w))):null));
  }
  if(W.result)kids.push(el('p',{role:'status','data-canonical-import-result':W.result.action},`${W.result.action==='unchanged'?t.unchanged:W.result.action==='updated'?t.updated:W.result.publicationState==='published'?t.createdPublished:t.createdDraft} `,el('a',{class:'btn-secondary',href:`/app/listening/tests/${W.result.targetId}`},t.open)));
  setChildren(body,...kids.filter(Boolean).flat());
 }
 listen(pkgInput,'change',()=>{const f=pkgInput.files?.[0];if(f)void load(f);},signal);
 const legacy=ctx.listeningLegacyImport?.(ctx)??legacyImporter(ctx);
 put(node,el('h1',{class:'font-display text-xl'},t.title),el('p',{},t.intro),
  el('div',{class:'flex flex-wrap gap-2'},el('a',{class:'btn-secondary',href:'/api/admin/content/template?module=listening&contentType=full_test&kind=template',download:'','data-native':''},t.downloadTemplate),el('a',{class:'btn-secondary',href:'/api/admin/content/template?module=listening&contentType=full_test&kind=example',download:'','data-native':''},t.downloadExample)),
  el('label',{class:'block'},t.packageLabel,pkgInput),status,body,el('details',{class:'rounded-lg border border-black/10 p-3','data-legacy-import-section':''},el('summary',{class:'cursor-pointer font-medium'},t.legacyTitle),el('p',{class:'mt-2 text-sm'},t.legacyIntro),el('div',{class:'mt-3'},legacy)));
 paint();return node;
}
export const mount=mountStaff({name:'listening-import',roles:['admin','owner'],load:c=>importReady(c.signal),
 render(ctx,d){const {dict}=ctx;
  return el('div',{class:'mx-auto flex max-w-4xl flex-col gap-4'},BackLink({fallbackHref:'/app/admin/listening',label:dict.common.back}),
   d.schemaReady?(ctx.state.listeningImportNode??=importer(ctx)):el('div',{class:'card space-y-4','data-listening-import-not-ready':''},el('h1',{class:'font-display text-2xl'},dict.listeningImport.title),el('p',{role:'status'},dict.listeningImport.importErrors.qa_migration_0028_required)));}});
