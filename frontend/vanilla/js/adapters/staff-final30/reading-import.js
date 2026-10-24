import {rawJson,isObj} from './core.js';
import {extensionOf,validateUploadFile,acceptAttribute} from './uploads.js';
/**
 * Reading set import — ports src/lib/import/{reading-source,archive,pdf-text}.ts, lib/listening/source-parser.ts#jsonLiteral
 * and lib/reading/import-schema.ts so the screen previews and pre-checks exactly what the server will accept.
 * Differences (documented, none weaken the server): ZIP inflation uses the platform DecompressionStream instead of fflate
 * (no bundled library needed); PDF text needs pdf.js, which is NOT bundled here, so PDFs are read through an injectable
 * `readPdfTextLayer` and refused with `pdf_reader_unavailable` when it is absent. Nothing uploaded is ever executed:
 * HTML is scrubbed (handlers, src/href, iframes, DTDs) before parsing, scripts are removed after, answer keys are read as
 * JSON literals only.
 */
export const READING_SOURCE_ACCEPT=acceptAttribute('file');
const MAX_TEXT=5*1024*1024,MAX_TOTAL=200*1024*1024,TEXT_EXT=['.json','.txt','.md','.html','.htm','.xml'];
const abort=()=>new DOMException('Aborted','AbortError');
/* ---- schema (zod port) ---- */
const READING_TYPES={true_false_not_given:['TFNG','true_false_ng'],yes_no_not_given:['YNNG','yes_no_ng'],multiple_choice:['MCQ'],multiple_choice_multi:['MCQ_MULTI'],matching_headings:['MH'],matching_information:['MI'],matching_features:['MF'],matching_sentence_endings:['MSE'],sentence_completion:['SC'],summary_completion:['summary','SUMMARY'],note_completion:['NOTE','notes'],table_completion:['table','TABLE'],flow_chart_completion:['FLOW'],diagram_label_completion:['DIAG'],short_answer:['SAQ'],classification:['CLASSIFICATION']};
const ALIASES=new Map();for(const [id,al] of Object.entries(READING_TYPES)){ALIASES.set(id,id);for(const a of al)ALIASES.set(a.toLowerCase(),id);}
export const readingQuestionTypeId=code=>typeof code==='string'?(ALIASES.get(code.trim().toLowerCase())??null):null;
const E=(path,message)=>({path,message});
const str=(v,path,{min=0,max=Infinity,req=false}={})=>{if(v===undefined&&!req)return {v:undefined};if(typeof v!=='string')return {e:E(path,'Expected string')};if(v.length<min)return {e:E(path,'Too small')};if(v.length>max)return {e:E(path,'Too big')};return {v};};
const intIn=(v,path,min,max)=>Number.isInteger(v)&&v>=min&&v<=max?{v}:{e:E(path,'Invalid integer')};
const list=(v,path,max,dflt)=>v===undefined&&dflt!==undefined?{v:dflt}:Array.isArray(v)&&v.length<=max?{v}:{e:E(path,'Invalid array')};
/** Returns {success:true,data}|{success:false,issue:{path,message}} — first issue only, like the server's detail. Unknown keys are stripped. */
export function parseGeneralReadingBundle(b){
 const fail=(e)=>({success:false,issue:e});
 if(!isObj(b))return fail(E('','Expected object'));
 const out={};let r;
 for(const [k,o] of [['sourceRef',{min:1,max:80,req:true}],['title',{min:1,max:200,req:true}],['description',{max:2000}],['level',{max:10}]]){r=str(b[k],k,o);if(r.e)return fail(r.e);if(r.v!==undefined)out[k]=r.v;}
 if(b.publish!==undefined&&typeof b.publish!=='boolean')return fail(E('publish','Expected boolean'));out.publish=b.publish??false;
 if(!Array.isArray(b.passages)||b.passages.length<1||b.passages.length>3)return fail(E('passages','Invalid passages'));
 out.passages=[];const nos=new Set();
 for(const [pi,p] of b.passages.entries()){
  const P=`passages.${pi}`;if(!isObj(p))return fail(E(P,'Expected object'));const q={};
  r=intIn(p.passageNo,P+'.passageNo',1,3);if(r.e)return fail(r.e);q.passageNo=r.v;
  for(const [k,o] of [['title',{min:1,max:200,req:true}],['body',{min:1,max:40000,req:true}]]){r=str(p[k],`${P}.${k}`,o);if(r.e)return fail(r.e);q[k]=r.v;}
  r=p.groups===undefined?{v:undefined}:list(p.groups,P+'.groups',40);if(r.e)return fail(r.e);const keys=[];
  if(r.v){q.groups=[];for(const [gi,g] of r.v.entries()){const G=`${P}.groups.${gi}`;if(!isObj(g))return fail(E(G,'Expected object'));const x={};
   let s=str(g.key,G+'.key',{min:1,max:40,req:true});if(s.e)return fail(s.e);x.key=s.v;keys.push(s.v);
   s=str(g.typeCode,G+'.typeCode',{min:1,max:40,req:true});if(s.e)return fail(s.e);if(!readingQuestionTypeId(s.v))return fail(E(G+'.typeCode','Unknown Reading question type'));x.typeCode=s.v;
   for(const [k,o] of [['displayTitle',{max:120}],['instructionsText',{max:4000}]]){s=str(g[k],`${G}.${k}`,o);if(s.e)return fail(s.e);if(s.v!==undefined)x[k]=s.v;}
   if(g.sharedChoices!==undefined){const c=list(g.sharedChoices,G+'.sharedChoices',30);if(c.e||c.v.some(v=>typeof v!=='string'||v.length>500))return fail(E(G+'.sharedChoices','Invalid choices'));x.sharedChoices=c.v;}
   for(const k of ['fromQuestionNo','toQuestionNo'])if(g[k]!==undefined){const n=intIn(g[k],`${G}.${k}`,1,60);if(n.e)return fail(n.e);x[k]=n.v;}
   q.groups.push(x);}}
  if(new Set(keys).size!==keys.length)return fail(E(P,'Duplicate group key'));
  r=list(p.questions,P+'.questions',40,[]);if(r.e)return fail(r.e);q.questions=[];
  for(const [qi,x] of r.v.entries()){const Q=`${P}.questions.${qi}`;if(!isObj(x))return fail(E(Q,'Expected object'));const y={};
   let n=intIn(x.questionNo,Q+'.questionNo',1,60);if(n.e)return fail(n.e);y.questionNo=n.v;
   let s=str(x.type,Q+'.type',{min:1,max:40,req:true});if(s.e)return fail(s.e);if(!readingQuestionTypeId(s.v))return fail(E(Q+'.type','Unknown Reading question type'));y.type=s.v;
   s=str(x.groupKey,Q+'.groupKey',{max:40});if(s.e)return fail(s.e);if(s.v!==undefined){if(!keys.includes(s.v))return fail(E(P,'Unknown question group'));y.groupKey=s.v;}
   if(x.answerConstraint!==undefined){const c=x.answerConstraint;if(!isObj(c))return fail(E(Q+'.answerConstraint','Expected object'));y.answerConstraint=c;}
   if(x.renderMode!==undefined){if(!['shared_stimulus_slot','inline','standalone'].includes(x.renderMode))return fail(E(Q+'.renderMode','Invalid enum'));y.renderMode=x.renderMode;}
   s=str(x.text,Q+'.text',{min:1,max:2000,req:true});if(s.e)return fail(s.e);y.text=s.v;
   if(x.options!==undefined){const o=list(x.options,Q+'.options',10);if(o.e||o.v.some(v=>typeof v!=='string'||v.length<1||v.length>300))return fail(E(Q+'.options','Invalid options'));y.options=o.v;}
   s=str(x.answer,Q+'.answer',{min:1,max:300,req:true});if(s.e)return fail(s.e);y.answer=s.v;
   const a=list(x.accepted,Q+'.accepted',10,[]);if(a.e||a.v.some(v=>typeof v!=='string'||v.length<1||v.length>300))return fail(E(Q+'.accepted','Invalid accepted'));y.accepted=a.v;
   s=str(x.evidence,Q+'.evidence',{max:1000});if(s.e)return fail(s.e);if(s.v!==undefined)y.evidence=s.v;
   s=str(x.explanation??'',Q+'.explanation',{max:2000});if(s.e)return fail(s.e);y.explanation=s.v;q.questions.push(y);}
  if(new Set(q.questions.map(z=>z.questionNo)).size!==q.questions.length)return fail(E(P,'Duplicate question number'));
  r=list(p.vocabulary,P+'.vocabulary',300,[]);if(r.e)return fail(r.e);q.vocabulary=[];
  for(const [vi,w] of r.v.entries()){const V=`${P}.vocabulary.${vi}`;if(!isObj(w))return fail(E(V,'Expected object'));const z={};
   for(const [k,o,dflt] of [['word',{min:1,max:120,req:true}],['pos',{max:30},''],['def',{min:1,max:600,req:true}],['uz',{max:300},''],['ex',{max:600},'']]){const s=str(w[k]??dflt,`${V}.${k}`,o);if(s.e)return fail(s.e);z[k]=s.v;}
   if(w.surfaces!==undefined){const s=list(w.surfaces,V+'.surfaces',10);if(s.e||s.v.some(v=>typeof v!=='string'||v.length<1||v.length>120))return fail(E(V+'.surfaces','Invalid surfaces'));z.surfaces=s.v;}q.vocabulary.push(z);}
  if(nos.has(q.passageNo))return fail(E('passages','passage numbers must be unique'));nos.add(q.passageNo);out.passages.push(q);
 }
 return {success:true,data:out};
}
/* ---- safe ZIP (no library): central directory first, then bounded inflation ---- */
export function safeArchivePath(p){return p.length>0&&p.length<=240&&!/^[\\/]|^[a-z]:/i.test(p)&&!/[\\\x00-\x1f]/.test(p)&&!p.split('/').some(x=>x==='..'||x==='.');}
function directory(bytes){
 if(bytes.byteLength>MAX_TOTAL)throw new Error('ZIP exceeds 200 MB');
 const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=-1;
 for(let i=bytes.byteLength-22;i>=Math.max(0,bytes.byteLength-22-65535);i--)if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}
 if(eocd<0)throw new Error('invalid_zip');
 const total=dv.getUint16(eocd+10,true),size=dv.getUint32(eocd+12,true),off=dv.getUint32(eocd+16,true);
 if(total===0xffff||size===0xffffffff||off===0xffffffff)throw new Error('zip64_unsupported');
 if(total>200+2000)throw new Error('Unsafe ZIP path or too many files');
 const entries=[],seen=new Set();let pos=off,count=0,sum=0;
 for(let i=0;i<total;i++){
  if(pos+46>bytes.byteLength||dv.getUint32(pos,true)!==0x02014b50)throw new Error('invalid_zip');
  const flags=dv.getUint16(pos+8,true),method=dv.getUint16(pos+10,true),csize=dv.getUint32(pos+20,true),usize=dv.getUint32(pos+24,true),nl=dv.getUint16(pos+28,true),xl=dv.getUint16(pos+30,true),cl=dv.getUint16(pos+32,true),local=dv.getUint32(pos+42,true);
  const name=new TextDecoder('utf-8').decode(bytes.subarray(pos+46,pos+46+nl));pos+=46+nl+xl+cl;
  const key=name.normalize('NFC').toLowerCase();if(seen.has(key))throw new Error('Duplicate ZIP filename');seen.add(key);
  if(++count>200||!safeArchivePath(name))throw new Error('Unsafe ZIP path or too many files');sum+=usize;if(sum>MAX_TOTAL)throw new Error('Expanded ZIP exceeds 200 MB');
  if(name.endsWith('/'))continue;if(flags&1)throw new Error('encrypted_zip');if(method!==0&&method!==8)throw new Error('zip_method_unsupported');
  entries.push({name,method,csize,usize,local});
 }
 return entries;
}
async function inflate(raw,limit,signal){
 const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')),reader=stream.getReader(),parts=[];let n=0;
 try{for(;;){if(signal?.aborted)throw abort();const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>limit)throw new Error('zip_bomb');parts.push(value);}}
 catch(e){try{await reader.cancel();}catch{}throw e;}
 const out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.byteLength;}return out;
}
export async function readSafeArchiveAsync(bytes,signal){
 const entries=directory(bytes),dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out={};
 let tid;const timer=new Promise((_,rej)=>{tid=setTimeout(()=>rej(new Error('ZIP parsing timed out')),30000);signal?.addEventListener('abort',()=>rej(abort()),{once:true});});
 const work=(async()=>{for(const e of entries){
  if(signal?.aborted)throw abort();if(dv.getUint32(e.local,true)!==0x04034b50)throw new Error('invalid_zip');
  const start=e.local+30+dv.getUint16(e.local+26,true)+dv.getUint16(e.local+28,true);if(start+e.csize>bytes.byteLength)throw new Error('invalid_zip');
  const raw=bytes.subarray(start,start+e.csize);const data=e.method===0?raw.slice():await inflate(raw,e.usize,signal);
  if(data.byteLength!==e.usize)throw new Error('invalid_zip');out[e.name]=data;}return out;})();
 try{return await Promise.race([work,timer]);}finally{clearTimeout(tid);}
}
/* ---- source reading ---- */
const IGNORED=/(^|\/)(__MACOSX\/|\._|\.DS_Store$|Thumbs\.db$)/i;
export const isIgnoredEntry=p=>IGNORED.test(p);
export function jsonLiteral(html,marker){
 const name=marker.replace(/^(?:const|let|var)\s+|^window\./,'').replace(/\s*=\s*$/,'').trim();if(!/^[A-Za-z_$][\w$]*$/.test(name))throw new Error('Invalid source marker');
 const m=new RegExp(`(?:\\b(?:const|let|var)\\s+|[,;]\\s*|\\bwindow\\.)${name}\\s*=`).exec(html);if(!m)throw new Error(`Missing source data: ${marker}`);
 let pos=m.index+m[0].length;while(/\s/.test(html[pos]??''))pos++;if(html[pos]!=='['&&html[pos]!=='{')throw new Error('Source is not a JSON literal');
 let depth=0,quoted=false,escaped=false;
 for(let i=pos;i<html.length;i++){const c=html[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='['||c==='{')depth++;else if(c===']'||c==='}'){depth--;if(!depth)return JSON.parse(html.slice(pos,i+1));}}
 throw new Error('Incomplete source JSON');
}
export const scrubDocument=t=>t.replace(/<!DOCTYPE[\s\S]*?>/gi,'').replace(/\s(?:on\w+|src|href|srcset|action|data)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/<(iframe|object|embed|link)[\s\S]*?>/gi,'');
const bundleFromText=text=>{const clean=text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1');try{const v=JSON.parse(clean);return v&&typeof v==='object'&&Array.isArray(v.passages)?v:null;}catch{return null;}};
async function stamp(bundle,raw){if(!bundle||typeof bundle!=='object'||bundle.sourceRef!=='html-reading-pending')return bundle;const h=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)));return {...bundle,sourceRef:`html-reading-${Array.from(h,b=>b.toString(16).padStart(2,'0')).join('')}`};}
export function readingBundleFromControls(doc,raw){
 const marker=/\b(?:const|let|var)\s+(KEY|ANSWER_KEY)\s*=/.exec(raw)?.[1];if(!marker)return null;let keys;try{keys=jsonLiteral(raw,`const ${marker} =`);}catch{return null;}
 const SEL='[data-reading-passage],.reading-passage,.passage-text,article[id^="passage"]';
 const candidates=[...doc.querySelectorAll(SEL)].filter(n=>!n.parentElement?.closest(SEL));if(!candidates.length||candidates.length>3)return null;
 const controls=[...doc.querySelectorAll('input,select,textarea')],num=n=>Number(/^(?:q|r|l)(\d+)$/.exec(n.id||n.getAttribute('name')||'')?.[1]);
 const numbers=[...new Set(controls.map(num).filter(n=>n>0&&n<=60))];if(!numbers.length)return null;
 const title=doc.querySelector('h1')?.textContent?.trim()||doc.title||'Reading';
 const passages=candidates.map((node,i)=>{const copy=node.cloneNode(true);copy.querySelectorAll('script,style,input,select,textarea,button').forEach(n=>n.remove());return {passageNo:i+1,title:node.querySelector('h2,h3')?.textContent?.trim()||`${title} ${i+1}`,body:(copy.textContent??'').trim(),questions:[],vocabulary:[]};});
 for(const number of numbers.sort((a,b)=>a-b)){
  const input=controls.find(n=>num(n)===number),host=input.closest('.question,.q,.exam-question,.question-item,li,p,tr,label');
  if(!host||typeof keys[number]!=='string'||!keys[number].trim())return null;
  const no=Number(input.getAttribute('data-passage-no')||host.closest('[data-passage-no]')?.getAttribute('data-passage-no')||(candidates.length===1?1:0)),passage=passages[no-1];if(!passage)return null;
  const clone=host.cloneNode(true);clone.querySelectorAll('input,select,textarea,button').forEach(n=>n.remove());
  const text=host.querySelector('.qtext,.question-text')?.textContent?.trim()||clone.textContent?.trim();if(!text)return null;
  const options=input.tagName==='SELECT'?[...input.querySelectorAll('option')].filter(o=>o.getAttribute('value')).map(o=>o.textContent?.trim()||o.getAttribute('value')):[...host.querySelectorAll('.q-opt,.q-choice,label')].map(o=>o.textContent?.trim()??'').filter(Boolean);
  const answer=keys[number],up=answer.toUpperCase();
  const type=['TRUE','FALSE','NOT GIVEN'].includes(up)?'true_false_not_given':['YES','NO'].includes(up)?'yes_no_not_given':options.length?'multiple_choice':'short_answer';
  passage.questions.push({questionNo:number,type,text,options,answer,accepted:[],explanation:''});
 }
 return {sourceRef:'html-reading-pending',title,publish:false,passages};
}
export function readingTextSource(text,extension,read){
 if(text.length>MAX_TEXT)throw new Error('source_too_large');const direct=bundleFromText(text);if(direct)return {bundle:direct,textPreview:''};
 if(!['.html','.htm','.xml'].includes(extension))return {bundle:null,textPreview:text.slice(0,2000)};
 const doc=read(scrubDocument(text)),c=[...doc.querySelectorAll('script[type="application/json"][data-reading-bundle], reading-bundle')];if(c.length>1)throw new Error('ambiguous_source');
 const bundle=c.length?bundleFromText(c[0].textContent??''):readingBundleFromControls(doc,text);doc.querySelectorAll('script,style,iframe,object,embed').forEach(n=>n.remove());
 return {bundle,textPreview:(doc.body?.textContent??doc.documentElement.textContent??'').trim().slice(0,2000)};
}
const defaultRead=s=>new DOMParser().parseFromString(s,'text/html');
/** structured only when the file carries explicit authored canonical data; everything else is supplemental (no question is ever invented). */
export async function readReadingSource(file,signal,deps={}){
 const read=deps.read??defaultRead,check=validateUploadFile({filename:file.name,contentType:file.type,size:file.size,category:'file'});if(!check.ok)throw new Error(check.error);
 const ext=extensionOf(file.name),files=[file.name];if(signal?.aborted)throw abort();
 if(ext==='.zip'||ext==='.docx'){
  const entries=await readSafeArchiveAsync(new Uint8Array(await file.arrayBuffer()),signal),names=Object.keys(entries).filter(n=>!isIgnoredEntry(n));
  if(ext==='.docx'){const xml=entries['word/document.xml'];if(!xml||xml.length>MAX_TEXT)throw new Error('invalid_document');const text=read(scrubDocument(new TextDecoder().decode(xml))).documentElement.textContent??'';const b=bundleFromText(text);return b?{kind:'structured',bundle:b,files}:{kind:'supplemental',textPreview:text.slice(0,2000),files};}
  const found=[];
  for(const name of names){if(signal?.aborted)throw abort();const s=extensionOf(name);if(!TEXT_EXT.includes(s))continue;if(entries[name].byteLength>MAX_TEXT)throw new Error('source_too_large');const p=readingTextSource(new TextDecoder().decode(entries[name]),s,read);if(p.bundle)found.push({bundle:p.bundle,name});}
  if(found.length>1)throw new Error('ambiguous_source');
  return found.length?{kind:'structured',bundle:await stamp(found[0].bundle,new TextDecoder().decode(entries[found[0].name])),files:names}:{kind:'supplemental',textPreview:'',files:names};
 }
 if(TEXT_EXT.includes(ext)){if(file.size>MAX_TEXT)throw new Error('source_too_large');const raw=await file.text(),p=readingTextSource(raw,ext,read);return p.bundle?{kind:'structured',bundle:await stamp(p.bundle,raw),files}:{kind:'supplemental',textPreview:p.textPreview,files};}
 if(ext==='.pdf'){if(file.size>20*1024*1024)throw new Error('source_too_large');if(typeof deps.readPdfTextLayer!=='function')throw new Error('pdf_reader_unavailable');const text=await deps.readPdfTextLayer(new Uint8Array(await file.arrayBuffer()),signal),b=bundleFromText(text);return b?{kind:'structured',bundle:b,files}:{kind:'supplemental',textPreview:text.slice(0,2000),files};}
 return {kind:'supplemental',textPreview:'',files};
}
/** POST /api/admin/reading/import {bundle:{...,publish:!dryRun},dryRun}. Errors are {error:code[,detail]}; unknown codes fall back to `unknown`. */
export async function sendReadingImport(bundle,dryRun,signal){
 const parsed=parseGeneralReadingBundle(bundle);if(!parsed.success)throw Object.assign(new Error('invalid_bundle'),{code:'invalid_bundle'});
 const r=await rawJson('POST','/api/admin/reading/import',{bundle:{...parsed.data,publish:!dryRun},dryRun},signal);
 if(!r.ok)throw Object.assign(new Error('import'),{code:typeof r.data?.error==='string'?r.data.error:'unknown',status:r.status});
 const d=r.data;if(!isObj(d)||typeof d.setId!=='string'||typeof d.created!=='boolean'||typeof d.dryRun!=='boolean'||!Array.isArray(d.passages))throw Object.assign(new Error('bad'),{code:'unknown'});
 return {setId:d.setId,created:d.created,dryRun:d.dryRun,passages:d.passages.map(p=>({passageNo:Number(p.passageNo),resolved:Number(p.resolved),unresolved:Number(p.unresolved)}))};
}
