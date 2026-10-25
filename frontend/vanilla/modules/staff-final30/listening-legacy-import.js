import {anySignal} from '../../js/signals.js';
import {el,listen,put,setChildren,fill} from './kit.js';
import {startUpload,uploadErrorMessage} from '../../js/adapters/staff-final30/uploads.js';
import {rawJson} from '../../js/adapters/staff-final30/core.js';
import {readListeningZipAsync,readListeningFiles,inspectListeningPackage,ListeningImportProblem,audioCandidates,probeAudio,readDocument,gradePackage,normalized,testActivities,mapDiagramSections,listeningQuestionIdentity} from '../../js/adapters/staff-final30/listening-legacy.js';
const NS='http://www.w3.org/2000/svg';
const ATTR={strokeWidth:'stroke-width',strokeDasharray:'stroke-dasharray',textAnchor:'text-anchor',fontSize:'font-size'};
/** components/listening/ListeningMap.tsx — coordinates and literal text only (the diagram was schema-validated). */
export function listeningMap(diagram){
 const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox',diagram.viewBox.join(' '));svg.setAttribute('role','img');svg.setAttribute('aria-label',diagram.label);svg.setAttribute('class','h-auto w-full bg-white text-black');svg.setAttribute('data-listening-map','');
 for(const {tag,text,...attrs} of diagram.shapes){const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(ATTR[k]??k,String(v));if(tag==='text')n.textContent=text??'';svg.append(n);}
 return svg;
}
const zipProblem=m=>/exceeds|too large/i.test(m)?'zip_too_large':/unsafe|duplicate/i.test(m)?'zip_unsafe':'zip_unreadable';
/** components/import/ListeningTryout.tsx — in-memory author preview of source media and every authored activity; no writes. */
export function listeningTryout(ctx,{payload,audioFile,image}){
 const {dict,signal}=ctx,t=dict.importPreview,r=dict.fullListeningHub.research,A=dict.fullListeningHub.activity;
 const S={activity:'exam',part:1,answers:{},checked:false,predictions:{},revealed:{}},mk=f=>typeof URL.createObjectURL==='function'?URL.createObjectURL(f):'';
 const url=mk(audioFile),imageUrl=image?mk(image):'';signal.addEventListener('abort',()=>{if(URL.revokeObjectURL){if(url)URL.revokeObjectURL(url);if(imageUrl)URL.revokeObjectURL(imageUrl);}},{once:true});
 const labels={exam:t.full,review:t.review,script:r.script,keyword1:t.keyword1,keyword2:t.keyword2,recall:r.recall,mcq:r.mcq,matching:r.matching,completion:r.completion,map:r.map,vocab:r.vocabulary,retry:r.retry};
 const node=el('section',{class:'listening-workspace space-y-4 rounded-2xl border border-ink-100 p-5','data-listening-tryout':''}),mapParts=mapDiagramSections(payload);
 let player=null,clipEnd=null;
 const clip=(at,end)=>{if(!player)return;clipEnd=end;player.currentTime=at;void player.play?.()?.catch?.(()=>{});};
 const btn=(text,cls,fn,attrs={})=>{const b=el('button',{type:'button',class:cls,...attrs},text);listen(b,'click',fn,signal);return b;};
 const bind=(n,get,set,evt='input')=>{n.value=get()??'';listen(n,evt,()=>set(n.value),signal);return n;};
 function paint(){
  const grade=S.checked?gradePackage(payload,S.answers):[],a=S.activity;
  const questions=payload.questions.filter(q=>{if(q.section!==S.part)return false;if(a==='matching')return q.kind==='matching';if(a==='completion')return q.kind==='completion';if(a==='map')return q.kind==='map';if(a==='mcq')return listeningQuestionIdentity(q).storageType==='multiple_choice';return true;});
  const kids=[el('h2',{class:'text-xl font-semibold'},t.title),el('p',{},t.hint),el('nav',{'aria-label':t.tabs,class:'flex flex-wrap gap-2'},testActivities(payload).map(k=>btn(labels[k],a===k?'btn-primary':'btn-secondary',()=>{player?.pause?.();clipEnd=null;Object.assign(S,{activity:k,checked:false,answers:{},revealed:{},predictions:{}});paint();},{'data-tryout-activity':k})))];
  if(url&&a!=='vocab'){const au=el('audio',{src:url,controls:'',class:'w-full','data-tryout-audio':''});listen(au,'timeupdate',()=>{if(clipEnd!==null&&au.currentTime>=clipEnd){au.pause();clipEnd=null;}},signal);player=au;kids.push(au);}
  if(a!=='vocab')kids.push(el('nav',{class:'flex flex-wrap gap-2'},payload.sections.map(s=>btn(`PART ${s.number}`,S.part===s.number?'btn-primary':'btn-secondary',()=>{S.part=s.number;S.checked=false;paint();},{'data-tryout-part':String(s.number)}))));
  if(['exam','review','mcq','matching','completion','map','retry'].includes(a)){
   if(['exam','review','map'].includes(a)){if(payload.mapDiagram&&mapParts.includes(S.part))kids.push(listeningMap(payload.mapDiagram));if(imageUrl&&mapParts.includes(S.part))kids.push(el('img',{src:imageUrl,alt:t.image,class:'h-auto max-h-96 w-auto max-w-full'}));}
   if(a==='retry')kids.push(el('p',{},r.weakEmpty));
   for(const q of questions){const g=grade.find(x=>x.number===q.number);
    const field=a==='mcq'&&!S.revealed[q.number]?el('div',{},el('label',{},r.prediction,bind(el('textarea',{class:'input mt-2',maxlength:'500','data-tryout-prediction':String(q.number)}),()=>S.predictions[q.number],v=>{S.predictions[q.number]=v;paintCommit();})),commitBtn(q)):el('label',{class:'block'},t.choose,q.options.length?(()=>{const s=el('select',{class:'input mt-2','data-tryout-answer':String(q.number)},el('option',{value:''},t.choose),q.options.map(o=>el('option',{value:/^([A-Z])[).\s]/.exec(o)?.[1]??o},o)));return bind(s,()=>S.answers[q.number],v=>{S.answers[q.number]=v;},'change');})():bind(el('input',{class:'input mt-2','data-tryout-answer':String(q.number)}),()=>S.answers[q.number],v=>{S.answers[q.number]=v;}));
    kids.push(el('div',{class:'card space-y-3 p-4','data-tryout-question':String(q.number)},el('p',{},q.instruction),el('p',{},el('strong',{},`${q.number}.`),` ${q.text}`),a!=='exam'?btn(`▶ ${t.playMoment}`,'btn-secondary',()=>clip(q.evidence.at,q.evidence.end??q.evidence.at+25)):null,field,S.checked&&(S.answers[q.number]??'').trim()?el('div',{role:'status','data-tryout-result':g?.correct?'correct':'wrong'},el('p',{},`${g?.correct?'✓':'✗'} ${q.key}`),a!=='exam'?el('p',{},q.evidence.why):null):null));}
   if(a==='review'){const tr=payload.sections.find(s=>s.number===S.part)?.transcript;if(tr)kids.push(el('details',{class:'card p-4'},el('summary',{},A.transcript),el('p',{class:'whitespace-pre-wrap'},tr)));}
  }
  if(['script','keyword1'].includes(a))for(const row of payload.keyword1.filter(x=>(x.part??payload.questions.find(q=>q.number===(x.sourceQuestion??x.q))?.section)===S.part))kids.push(el('div',{class:'card space-y-2 p-4','data-tryout-gap':String(row.q)},el('p',{},row.text),btn(`▶ ${t.playMoment}`,'btn-secondary',()=>clip(row.at,row.end)),!payload.studyPack?el('blockquote',{},row.heard):null,bind(el('input',{class:'input','aria-label':`Gap ${row.q}`}),()=>S.answers[row.q],v=>{S.answers[row.q]=v;}),S.checked?el('p',{},`${normalized(S.answers[row.q]??'')===normalized(row.link.split(';')[0])?'✓':'✗'} ${row.link}`):null));
  if(a==='keyword2')for(const row of payload.keyword2)kids.push(el('div',{class:'card p-4'},btn(`▶ ${t.hearMoment}`,'btn-secondary',()=>clip(row.at,row.end)),'options' in row?bind(el('select',{class:'input','aria-label':`Meaning ${row.q}`},el('option',{value:''},t.choose),row.options.map((o,i)=>el('option',{value:String(i)},o))),()=>S.answers[row.q],v=>{S.answers[row.q]=v;},'change'):bind(el('input',{class:'input'}),()=>S.answers[row.q],v=>{S.answers[row.q]=v;}),S.checked?el('p',{},`${row.heard} · ${'answer' in row?row.answer:row.options[row.correct]}`):null));
  if(a==='recall')for(const row of payload.studyPack?.recall.filter(x=>x.part===S.part)??[])kids.push(el('div',{class:'card space-y-3 p-4'},el('h3',{},row.title),el('p',{},r.recallPrompt),btn(r.listenPart,'btn-secondary',()=>{const range=payload.studyPack.partRanges[String(row.part)];if(range)clip(...range);}),bind(el('textarea',{class:'input min-h-32'}),()=>S.answers[row.part],v=>{S.answers[row.part]=v;}),S.checked?el('ul',{},row.points.map(p=>el('li',{},p))):null));
  if(a==='vocab')kids.push(el('ul',{class:'space-y-3'},payload.vocabulary.map((w,i)=>el('li',{class:'card space-y-2 p-4'},el('strong',{},w.word),` (${w.pos})`,el('p',{},w.def),el('p',{},w.uz),el('p',{},w.ex),w.quiz?el('label',{},w.quiz.q,bind(el('select',{class:'input'},el('option',{value:''},t.choose),w.quiz.options.map((o,n)=>el('option',{value:String(n)},o))),()=>S.answers[i],v=>{S.answers[i]=v;},'change'),S.checked?el('p',{},w.quiz.options[w.quiz.correct]):null):null))));
  kids.push(el('div',{class:'flex gap-2'},btn(t.check,'btn-primary',()=>{S.checked=true;paint();},{'data-tryout-check':''}),btn(t.reset,'btn-secondary',()=>{S.answers={};S.checked=false;paint();},{'data-tryout-reset':''})));
  setChildren(node,kids);
 }
 function commitBtn(q){const b=btn(A.commitReveal,'btn-primary',()=>{S.revealed[q.number]=true;paint();},{'data-tryout-commit':String(q.number)});b.disabled=!S.predictions[q.number]?.trim();return b;}
 function paintCommit(){for(const b of node.querySelectorAll('[data-tryout-commit]'))b.disabled=!S.predictions[b.dataset.tryoutCommit]?.trim();}
 paint();return node;
}
const imageFile=bytes=>{const png=bytes[0]===137&&bytes[1]===80,jpg=bytes[0]===255&&bytes[1]===216,webp=bytes[8]===0x57&&bytes[9]===0x45&&bytes[10]===0x42&&bytes[11]===0x50;if(!png&&!jpg&&!webp)return null;const [n,ty]=png?['map.png','image/png']:jpg?['map.jpg','image/jpeg']:['map.webp','image/webp'];return new File([bytes],n,{type:ty});};
/** components/listening/ListeningLegacyImport.tsx — staff preview then upload; kept separate from the canonical flow (it ends in /api/admin/listening/import). */
export function legacyImporter(ctx){
 const {dict,signal}=ctx,t=dict.listeningImport,start=(...a)=>(ctx.startUpload??startUpload)(...a),probe=(...a)=>(ctx.probeAudio??probeAudio)(...a);
 const W={loaded:null,result:null,problem:null,collection:'academic',error:'',busy:'',progress:0,id:'',flight:false,handles:[],reqCtl:null};
 const node=el('div',{class:'space-y-4','data-listening-import':''}),body=el('div',{class:'space-y-4'});
 signal.addEventListener('abort',()=>{for(const h of W.handles)h.cancel();W.reqCtl?.abort();},{once:true});
 const alive=()=>!signal.aborted;
 async function inspect(source,chosen){
  W.problem=null;W.busy='check';paint();
  try{try{const ins=await inspectListeningPackage({entries:source.entries,textFiles:source.textFiles,zipName:source.file.name,chosenAudioPath:chosen,probeDuration:(audio,bytes)=>probe(new File([bytes],audio.path.split('/').pop(),{type:audio.mimeType}),signal),read:readDocument});if(!alive())return;
   const audioFile=new File([source.entries[ins.audio.path]],`full.${ins.audio.format}`,{type:ins.audio.mimeType}),ib=ins.payload.imagePath?source.entries[ins.payload.imagePath]:null,image=ib?imageFile(ib):null;
   if(ib&&!image){W.problem={code:'map_missing',files:[ins.payload.imagePath]};return;}W.collection=ins.payload.collection??'academic';W.result={...ins,audioFile,image};}
  catch(e){if(!alive())return;if(e instanceof ListeningImportProblem){const candidates=e.code==='audio_ambiguous'||e.code==='audio_reference_missing'?audioCandidates(source.entries).candidates:undefined;W.problem={code:e.code,files:e.detail.files??[],candidates,info:e.detail.info};}else W.problem={code:'unknown',files:[]};}}
  finally{if(alive()){W.busy='';paint();}}
 }
 async function read(file,companions){
  W.loaded=null;W.result=null;W.problem=null;W.id='';W.error='';W.busy='check';paint();
  try{let src;if(/\.html?$/i.test(file.name))src=await readListeningFiles([file,...companions]);else src=await readListeningZipAsync(new Uint8Array(await file.arrayBuffer()),signal);if(!alive())return;W.loaded={file,...src};await inspect(W.loaded);}
  catch(e){if(!alive())return;W.problem={code:zipProblem(e instanceof Error?e.message:''),files:[]};W.busy='';paint();}
 }
 async function upload(){
  if(!W.result||W.flight||!alive())return;W.flight=true;W.busy='upload';W.error='';W.progress=0;paint();
  try{const a=start(W.result.audioFile,{purpose:'material_primary',onProgress:p=>{if(alive()){W.progress=p;paintStatus();}}});W.handles.push(a);const ar=await a.promise;if(!alive())return;if(!ar.ok){W.error=uploadErrorMessage(ar.failure,dict.uploadErrors);return;}
   let imageUploadId=null;if(W.result.image){const h=start(W.result.image,{purpose:'material_primary'});W.handles.push(h);const ir=await h.promise;if(!alive())return;if(!ir.ok){W.error=uploadErrorMessage(ir.failure,dict.uploadErrors);return;}imageUploadId=ir.uploadId;}
   W.reqCtl=new AbortController();const link=anySignal([signal,W.reqCtl.signal]);
   const res=await rawJson('POST','/api/admin/listening/import',{payload:{...W.result.payload,collection:W.collection},audioUploadId:ar.uploadId,imageUploadId},link,{timeout:20000});if(!alive())return;
   if(!res.ok){const code=String(res.data?.error??'unknown'),ref=typeof res.data?.correlationId==='string'?` (ref ${res.data.correlationId.slice(0,16)})`:'';W.error=(t.importErrors[code]??t.importErrors.unknown)+ref;return;}
   W.id=String(res.data?.id??'');}
  catch{if(alive())W.error=t.importErrors.unknown;}
  finally{W.flight=false;if(alive()){W.busy='';paint();}}
 }
 const status=el('p',{role:'status','data-legacy-status':''});const paintStatus=()=>{status.hidden=!W.busy;status.textContent=W.busy==='check'?t.checking:fill(t.uploading,{pct:W.progress>0?`${W.progress}%`:''});};
 const sel=el('select',{class:'input','data-legacy-collection':''},[['essential','Essential Recordings'],['academic','Academic Listening'],['general','General Listening']].map(([v,l])=>el('option',{value:v},l)));
 listen(sel,'change',()=>{W.collection=sel.value;},signal);
 const input=el('input',{class:'mt-2 block',type:'file',accept:'.zip,.html,.htm,.mp3,.m4a,.wav,.ogg,.webm,.png,.jpg,.webp',multiple:'','data-legacy-file':''});
 listen(input,'change',()=>{const files=[...(input.files??[])],file=files.find(f=>/\.(zip|html?)$/i.test(f.name));if(file)void read(file,files.filter(f=>f!==file));},signal);
 function paint(){
  input.disabled=sel.disabled=!!W.busy;sel.value=W.collection;paintStatus();const p=W.problem,r=W.result;
  setChildren(body,
   p?el('div',{role:'alert',class:'space-y-2 rounded-lg border border-red-300 p-3','data-import-problem':p.code},el('p',{class:'font-medium text-band-bad'},fill(t.problems[p.code]??t.problems.unknown,{ref:p.info??''})),
    (p.code==='audio_ambiguous'||p.code==='audio_reference_missing')&&W.loaded&&p.candidates?el('fieldset',{class:'space-y-2','data-audio-selector':''},el('legend',{},t.chooseAudio),p.candidates.map(c=>{const b=el('button',{type:'button',class:'btn-secondary block min-h-11 w-full text-left',disabled:!!W.busy,'data-audio-candidate':c.path},`${c.path} · ${c.format} · ${(c.size/1048576).toFixed(1)} MB — ${t.useAudio}`);listen(b,'click',()=>void inspect(W.loaded,c.path),signal);return b;})):null,
    p.files.length&&!p.candidates?el('div',{},el('p',{class:'text-sm'},t.filesInZip),el('ul',{class:'list-disc pl-5 text-sm','data-import-files':''},p.files.map(f=>el('li',{},f)))):null):null,
   W.error?el('p',{role:'alert',class:'text-band-bad','data-legacy-error':''},W.error):null,
   r?(()=>{const title=el('input',{class:'input mt-1','data-legacy-title':''});title.value=r.payload.title;listen(title,'input',()=>{r.payload.title=title.value;},signal);const up=el('button',{type:'button',class:'btn-primary',disabled:!!W.busy||!!W.id,'data-legacy-upload':''},t.upload);listen(up,'click',()=>void upload(),signal);
    return el('div',{class:'space-y-4'},el('label',{class:'block'},t.testTitle,title),el('p',{'data-legacy-summary':''},fill(t.summary,{q:r.payload.questions.length,s:r.payload.sections.length,m:Math.round(r.payload.audio.durationSec/60),v:r.payload.vocabulary.length})),el('p',{class:'text-sm','data-legacy-family':r.family},fill(t.family,{family:r.family==='canonical'?t.familyCanonical:t.familyLegacy})),r.canonicalFallback?el('p',{role:'status',class:'text-sm','data-canonical-fallback':''},t.canonicalFallback):null,el('p',{class:'text-sm'},fill(t.audioUsed,{path:r.audio.path,format:r.audio.format})),listeningTryout(ctx,{payload:r.payload,audioFile:r.audioFile,image:r.image}),up);})():null,
   W.id?el('p',{role:'status','data-legacy-saved':''},`${t.saved} `,el('a',{class:'btn-secondary',href:`/app/listening/tests/${W.id}`},t.open)):null);
 }
 put(node,el('label',{class:'block'},t.collection,sel),el('label',{class:'block'},t.zipLabel,input),status,body);paint();return node;
}
