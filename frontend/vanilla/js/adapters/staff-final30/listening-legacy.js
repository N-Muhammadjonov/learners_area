import {isObj} from './core.js';
import {jsonLiteral,scrubDocument,readSafeArchiveAsync} from './reading-import.js';
/**
 * LEGACY Listening import — a faithful port of src/lib/listening/{discover,embedded-media,map-diagram,package,question-identity,
 * source-parser(structured + research families),inspect,activities,zip}.ts.
 *
 * SCOPE (honest): ported and verified against a REAL owner file (Listening_Test_1.html, "structured practice" family):
 *   • canonical data/package.json, • `const DATA`+`PARTS` structured practice, • `const D` research practice, • single HTML with embedded
 *   audio/map, • ZIP transport.
 * NOT ported: the oldest "exam page" family (01_full_exam.html with #l1 controls) and the authored-runtime fallback (sandboxed
 * `allow-scripts` frame). Those are refused with an explicit, localized problem instead of being guessed.
 * Nothing uploaded is executed: only JSON literals and inert DOM are read; the server re-validates everything.
 */
export class ListeningImportProblem extends Error{constructor(code,detail={}){super(code);this.name='ListeningImportProblem';this.code=code;this.detail=detail;}}
const IGNORED=/(^|\/)(__MACOSX\/|\._|\.DS_Store$|Thumbs\.db$)/i,TEXT_EXT=/\.(json|html?|txt|md|csv|xml|vtt|srt)$/i,AUDIO_EXT=/\.(mp3|m4a|mp4a|wav|aac|ogg|oga|opus|webm|weba|flac)$/i;
export const isIgnoredEntry=p=>IGNORED.test(p);export const isTextEntry=p=>TEXT_EXT.test(p)&&!IGNORED.test(p);
export const visibleFileList=(names,limit=25)=>names.filter(n=>!IGNORED.test(n)).sort().slice(0,limit);
export const AUDIO_MIME={mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',aac:'audio/aac',ogg:'audio/ogg',opus:'audio/ogg',webm:'audio/webm',flac:'audio/flac'};
export function sniffAudio(b){
 const at=i=>b[i]??-1,ascii=(s,t)=>[...t].every((c,i)=>at(s+i)===c.charCodeAt(0));
 if(ascii(0,'ID3'))return 'mp3';if(ascii(0,'RIFF')&&ascii(8,'WAVE'))return 'wav';if(ascii(0,'fLaC'))return 'flac';
 if(ascii(0,'OggS')){const head=String.fromCharCode(...b.slice(0,Math.min(b.length,128)));return head.includes('OpusHead')?'opus':'ogg';}
 if(at(0)===0x1a&&at(1)===0x45&&at(2)===0xdf&&at(3)===0xa3)return 'webm';if(ascii(4,'ftyp'))return 'm4a';
 if(at(0)===0xff&&(at(1)&0xf6)===0xf0)return 'aac';if(at(0)===0xff&&(at(1)&0xe0)===0xe0)return 'mp3';return null;
}
function extFormat(path){const m=AUDIO_EXT.exec(path);if(!m)return null;const e=m[1].toLowerCase();return e==='mp4a'?'m4a':e==='oga'?'ogg':e==='weba'?'webm':e;}
const compatible=(ext,sniffed)=>ext===sniffed||[['m4a','aac'],['ogg','opus'],['mp3','aac']].some(g=>g.includes(ext)&&g.includes(sniffed));
export function audioCandidates(entries){
 const candidates=[],rejected=[];
 for(const path of Object.keys(entries).sort()){if(IGNORED.test(path))continue;const ext=extFormat(path);if(!ext)continue;const sn=sniffAudio(entries[path]);
  if(!sn||!compatible(ext,sn)){rejected.push({path,reason:'signature_mismatch'});continue;}
  const format=sn==='aac'&&ext==='m4a'?'m4a':ext;candidates.push({path,format,mimeType:AUDIO_MIME[format],size:entries[path].byteLength});}
 return {candidates,rejected};
}
const FULL_NAME=/(^|[\/_\-. ])(full|complete|whole|test|exam)([\/_\-. ]|$)/i;
export function chooseAudio(candidates,referenced){
 if(!candidates.length)return {kind:'none'};
 if(referenced){const want=referenced.toLowerCase(),hit=candidates.find(c=>c.path.toLowerCase()===want||c.path.toLowerCase().endsWith('/'+want));if(hit)return {kind:'chosen',audio:hit,reason:'referenced'};}
 if(candidates.length===1)return {kind:'chosen',audio:candidates[0],reason:'only'};
 const named=candidates.filter(c=>FULL_NAME.test(c.path.split('/').pop()??''));if(named.length===1)return {kind:'chosen',audio:named[0],reason:'named_full'};
 return {kind:'ambiguous',candidates};
}
export function findEntry(names,wanted){const w=wanted.toLowerCase();const hits=names.filter(n=>!IGNORED.test(n)).filter(n=>n.toLowerCase()===w||n.toLowerCase().endsWith('/'+w));hits.sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b));return hits[0]??null;}
export function textFile(files,wanted){const k=findEntry(Object.keys(files),wanted);return k?files[k]:undefined;}
export function packageRoot(names){
 const anchor=findEntry(names,'data/package.json')?.replace(/data\/package\.json$/i,'')??findEntry(names,'metadata.json')?.replace(/metadata\.json$/i,'')??findEntry(names,'manifest.json')?.replace(/manifest\.json$/i,'');
 if(anchor!==undefined)return anchor;
 const vis=names.filter(n=>!IGNORED.test(n)),tops=new Set(vis.map(n=>n.includes('/')?n.split('/')[0]:null));
 return tops.size===1&&!tops.has(null)?`${[...tops][0]}/`:'';
}
/** Extract only bounded data URLs; uploaded scripts are never executed. */
export function extractEmbeddedListeningMedia(html){
 const entries={};let audioPath,imagePath,audioSource,imageSource;
 const cleaned=html.replace(/data:(audio\/mpeg|audio\/mp3|image\/png);base64,([A-Za-z0-9+/=]+)/g,(source,mime,encoded)=>{
  if(encoded.length>100*1024*1024)throw new Error('Embedded media too large');const audio=mime.startsWith('audio/'),existingPath=audio?audioPath:imagePath,existingSource=audio?audioSource:imageSource;
  if(existingPath){if(encoded!==existingSource)throw new Error('Multiple distinct embedded media need an explicit ZIP package manifest');return `[embedded:${existingPath}]`;}
  const path=audio?'embedded-listening-audio.mp3':'embedded-listening-map.png';entries[path]=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  if(audio){audioPath=path;audioSource=encoded;}else{imagePath=path;imageSource=encoded;}return `[embedded:${path}]`;});
 return {html:cleaned,entries,audioPath,imagePath};
}
/* ---- ZIP / HTML transport (zip.ts) ---- */
export async function normalizeEntries(entries){
 const names=Object.keys(entries).filter(n=>!IGNORED.test(n)),root=packageRoot(names),normalized={};
 for(const path of names){const rel=root&&path.toLowerCase().startsWith(root.toLowerCase())?path.slice(root.length):path;if(normalized[rel])throw new Error('Duplicate ZIP filename');normalized[rel]=entries[path];}
 const textFiles={},dec=new TextDecoder();
 for(const [path,value] of Object.entries(normalized)){if(!isTextEntry(path))continue;if(value.byteLength>128*1024*1024)throw new Error('Text asset too large');
  const ex=/\.html?$/i.test(path)?extractEmbeddedListeningMedia(dec.decode(value)):{html:dec.decode(value),entries:{}};
  for(const [mp,bytes] of Object.entries(ex.entries)){if(normalized[mp])throw new Error('Duplicate embedded media');normalized[mp]=bytes;}
  if(ex.html.length>5*1024*1024)throw new Error('Text asset too large');textFiles[path]=ex.html;normalized[path]=new TextEncoder().encode(ex.html);}
 return {entries:normalized,textFiles,root};
}
export const readListeningZipAsync=async(bytes,signal)=>normalizeEntries(await readSafeArchiveAsync(bytes,signal));
/** HTML + companion files chosen together (the legacy screen's single-HTML mode). */
export async function readListeningFiles(files){
 const entries={},textFiles={};if(files.reduce((n,f)=>n+f.size,0)>128*1024*1024)throw new Error('too large');
 for(const input of files){if(!safePackagePath(input.name)||entries[input.name])throw new Error('unsafe or duplicate');entries[input.name]=new Uint8Array(await input.arrayBuffer());
  if(/\.html?$/i.test(input.name)){const ex=extractEmbeddedListeningMedia(await input.text());for(const [p,b] of Object.entries(ex.entries)){if(entries[p])throw new Error('duplicate embedded media');entries[p]=b;}textFiles[input.name]=ex.html;entries[input.name]=new TextEncoder().encode(ex.html);}}
 return {entries,textFiles};
}
export function safePackagePath(path){return path.length>0&&path.length<=400&&!/[\u0000-\u001f\u007f\\:*?"<>|]/.test(path)&&!path.startsWith('/')&&!path.split('/').includes('..')&&!path.includes('//');}
/* ---- map diagram (map-diagram.ts) ---- */
const num=(v,{min=-10000,max=10000}={})=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const COLOR=/^(none|#[0-9a-f]{3,8})$/i,PATH=/^[MmLlHhVvCcSsQqTtAaZz0-9.,+\-\sEe]*$/;
export function parseMapDiagram(d){
 const bad=m=>({success:false,issue:m});
 if(!isObj(d))return bad('mapDiagram');const vb=d.viewBox;if(!Array.isArray(vb)||vb.length!==4||!vb.every(n=>num(n))||!(vb[2]>0)||!(vb[3]>0))return bad('mapDiagram.viewBox');
 if(typeof d.label!=='string'||d.label.length<1||d.label.length>200)return bad('mapDiagram.label');
 if(!Array.isArray(d.shapes)||d.shapes.length<1||d.shapes.length>500)return bad('mapDiagram.shapes');
 for(const s of d.shapes){if(!isObj(s)||!['rect','path','text','line','circle'].includes(s.tag))return bad('mapDiagram.shapes.tag');
  for(const k of ['x','y','cx','cy','x1','x2','y1','y2'])if(s[k]!==undefined&&!num(s[k]))return bad('mapDiagram.shapes.'+k);
  for(const k of ['width','height','rx','r'])if(s[k]!==undefined&&!num(s[k],{min:0}))return bad('mapDiagram.shapes.'+k);
  if(s.d!==undefined&&(typeof s.d!=='string'||s.d.length>12000||!PATH.test(s.d)))return bad('mapDiagram.shapes.d');
  for(const k of ['fill','stroke'])if(s[k]!==undefined&&(typeof s[k]!=='string'||!COLOR.test(s[k])))return bad('mapDiagram.shapes.'+k);
  if(s.strokeWidth!==undefined&&!num(s.strokeWidth,{min:0,max:30}))return bad('mapDiagram.shapes.strokeWidth');
  if(s.strokeDasharray!==undefined&&(typeof s.strokeDasharray!=='string'||!/^[0-9. ,]*$/.test(s.strokeDasharray)||s.strokeDasharray.length>100))return bad('mapDiagram.shapes.strokeDasharray');
  if(s.textAnchor!==undefined&&!['start','middle','end'].includes(s.textAnchor))return bad('mapDiagram.shapes.textAnchor');
  if(s.fontSize!==undefined&&!(num(s.fontSize,{max:100})&&s.fontSize>0))return bad('mapDiagram.shapes.fontSize');
  if(s.text!==undefined&&(typeof s.text!=='string'||s.text.length>300))return bad('mapDiagram.shapes.text');}
 return {success:true,data:d};
}
/** Coordinates and literal text only; never serialize arbitrary SVG or execute source HTML. */
export function extractMapDiagram(svg){
 const shapes=[...svg.querySelectorAll('rect,path,text,line,circle')].map(node=>{
  const shape={tag:node.localName};
  for(const name of ['x','y','width','height','rx','cx','cy','r','x1','x2','y1','y2'])if(node.hasAttribute(name))shape[name]=Number(node.getAttribute(name));
  for(const [attribute,key] of [['d','d'],['fill','fill'],['stroke','stroke'],['stroke-width','strokeWidth'],['stroke-dasharray','strokeDasharray'],['text-anchor','textAnchor'],['font-size','fontSize']])if(node.hasAttribute(attribute))shape[key]=['strokeWidth','fontSize'].includes(key)?Number(node.getAttribute(attribute)):node.getAttribute(attribute);
  if(node.localName==='text')shape.text=node.textContent??'';return shape;});
 const r=parseMapDiagram({viewBox:(svg.getAttribute('viewBox')??'').trim().split(/\s+/).map(Number),label:svg.getAttribute('aria-label')??'Source map',shapes});
 if(!r.success)throw new Error(`Invalid map diagram: ${r.issue}`);return r.data;
}
/* ---- question identity (question-identity.ts) ---- */
const REGISTRY={mcq_single:['mcq','multiple_choice'],mcq_multi:['mcq_multi','choose_two','choose_three'],matching:['matching'],classification:['classification'],form_completion:['form','form_completion'],note_completion:['note','notes_completion','note_completion'],table_completion:['table','table_completion'],flow_chart_completion:['flow','flowchart','flow_chart_completion'],summary_completion:['summary','summary_completion'],sentence_completion:['sentence','sc','sentence_completion'],short_answer:['short_answer','saq'],plan_labeling:['plan','plan_labeling','plan_labelling'],map_labeling:['map','map_labeling','map_labelling'],diagram_labeling:['diagram','diag','diagram_labeling','diagram_labelling']};
const KIND_BY_TYPE={short_answer:'completion',form_completion:'completion',note_completion:'completion',table_completion:'completion',flow_chart_completion:'completion',summary_completion:'completion',sentence_completion:'completion',mcq_single:'mcq',mcq_multi:'mcq',matching:'matching',classification:'matching',map_labeling:'map',plan_labeling:'map',diagram_labeling:'map'};
export const listeningKindOfType=id=>KIND_BY_TYPE[id]??null;
export function canonicalListeningTypeId(stated){
 if(!stated)return null;const w=String(stated).trim().toLowerCase();if(!w)return null;if(REGISTRY[w])return w;
 const hits=Object.entries(REGISTRY).filter(([,al])=>al.includes(w));return hits.length===1?hits[0][0]:null;
}
export function listeningQuestionIdentity(q){
 const stated=canonicalListeningTypeId(q.typeCode);
 if(stated)return {typeCode:stated,storageType:['mcq_single','mcq_multi'].includes(stated)?'multiple_choice':'short_answer',review:null};
 const un=(q.typeCode??'').trim();
 switch(q.kind){
  case 'completion':return {typeCode:'short_answer',storageType:'short_answer',review:un?`the source declares question type "${un}", which is not a canonical Listening type; it is stored as a typed answer (short_answer) — confirm whether it is form/note/table/flow-chart/summary/sentence completion`:'the source states only "completion", which does not prove which completion kind this is; it is stored as a typed answer (short_answer) — confirm the specific kind'};
  case 'mcq':return {typeCode:'mcq_single',storageType:'multiple_choice',review:un?`the source declares question type "${un}"; it is stored as single-answer multiple choice — confirm the item is not a choose-TWO/THREE (mcq_multi)`:null};
  case 'matching':return {typeCode:'matching',storageType:'short_answer',review:null};
  case 'map':return {typeCode:'map_labeling',storageType:'short_answer',review:'the source groups this item as map/plan, which does not prove whether the drawing is a map or a plan; it is stored as map_labeling — confirm map_labeling vs plan_labeling'};
  default:return {typeCode:null,storageType:'short_answer',review:un?`the source declares question type "${un}", which is not a canonical Listening type, and no shape proves one; the question has no canonical identity yet`:'the source declares neither a question type nor a shape this product recognises; the question has no canonical identity yet'};
 }
}
export function listeningIdentityReviewNotes(qs){const notes=new Map();for(const q of qs){const {review}=listeningQuestionIdentity(q);if(!review)continue;notes.set(review,[...(notes.get(review)??[]),q.number]);}return [...notes.entries()].map(([n,nums])=>`Q${nums.join(', Q')}: ${n}.`);}
/* ---- package schema (package.ts): structure + semantics; returns the first issue ---- */
const ACTIVITY_IDS=['exam','review','script','mcq','recall','vocab','matching','completion','map','retry'];
const T=(v,max=12000)=>{if(typeof v!=='string')return null;const s=v.trim();return s.length>=1&&s.length<=max?s:null;};
const I=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const fail=(path,message)=>({success:false,issue:{path,message}});
function clip(c,path,extra){
 if(!isObj(c))return {e:[path,'object']};const o={};
 if(!I(c.q,1,200))return {e:[path+'.q','q']};o.q=c.q;if(c.part!==undefined){if(!I(c.part,1,4))return {e:[path+'.part','part']};o.part=c.part;}
 if(c.sourceQuestion!==undefined){if(!I(c.sourceQuestion,1,40))return {e:[path+'.sourceQuestion','sourceQuestion']};o.sourceQuestion=c.sourceQuestion;}
 if(typeof c.at!=='number'||!(c.at>=0))return {e:[path+'.at','at']};if(typeof c.end!=='number'||!(c.end>0))return {e:[path+'.end','end']};o.at=c.at;o.end=c.end;
 for(const k of ['heard','link']){const v=T(c[k]);if(v===null)return {e:[`${path}.${k}`,k]};o[k]=v;}
 if(extra==='text'){const v=T(c.text);if(v===null)return {e:[path+'.text','text']};o.text=v;}
 return {v:o};
}
export function parseListeningPackage(p){
 if(!isObj(p))return fail('','Expected object');const out={};
 if(p.schemaVersion!==1)return fail('schemaVersion','Invalid literal');out.schemaVersion=1;
 if(p.authoredRuntime!==undefined){if(!isObj(p.authoredRuntime)||typeof p.authoredRuntime.entryPath!=='string'||!isObj(p.authoredRuntime.files))return fail('authoredRuntime','Invalid authored runtime');out.authoredRuntime=p.authoredRuntime;}
 if(p.legacyRuntime!==undefined){if(typeof p.legacyRuntime!=='boolean')return fail('legacyRuntime','boolean');out.legacyRuntime=p.legacyRuntime;}
 if(p.collection!==undefined){if(!['essential','academic','general','question_types','mcq'].includes(p.collection))return fail('collection','enum');out.collection=p.collection;}
 if(p.programme!==undefined){const g=p.programme;if(!isObj(g)||Object.keys(g).some(k=>!['ref','day'].includes(k))||typeof g.ref!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(g.ref)||!I(g.day,1,400))return fail('programme','invalid');out.programme=g;}
 if(typeof p.testId!=='string'||!/^[a-z0-9-]{1,80}$/.test(p.testId))return fail('testId','Invalid test id');out.testId=p.testId;
 {const v=T(p.title,200);if(v===null)return fail('title','title');out.title=v;}
 if(p.category!=='full')return fail('category','Invalid literal');out.category='full';
 {const v=T(p.provenance);if(v===null)return fail('provenance','provenance');out.provenance=v;}
 if(!isObj(p.audio)||typeof p.audio.path!=='string'||p.audio.path.length>200||typeof p.audio.durationSec!=='number'||!(p.audio.durationSec>=60&&p.audio.durationSec<=7200))return fail('audio','audio');out.audio={path:p.audio.path,durationSec:p.audio.durationSec};
 if(p.imagePath===undefined||(p.imagePath!==null&&(typeof p.imagePath!=='string'||p.imagePath.length>200)))return fail('imagePath','imagePath');out.imagePath=p.imagePath;
 if(p.mapDiagram!==undefined){const r=parseMapDiagram(p.mapDiagram);if(!r.success)return fail('mapDiagram',r.issue);out.mapDiagram=r.data;}
 if(!Array.isArray(p.sections)||p.sections.length<1||p.sections.length>4)return fail('sections','sections');
 out.sections=[];for(const [i,s] of p.sections.entries()){if(!isObj(s)||!I(s.number,1,4))return fail(`sections.${i}.number`,'number');const title=T(s.title);if(title===null)return fail(`sections.${i}.title`,'title');const tr=s.transcript??'';if(typeof tr!=='string'||tr.length>100000)return fail(`sections.${i}.transcript`,'transcript');if(s.reviewRequired!==undefined&&typeof s.reviewRequired!=='boolean')return fail(`sections.${i}.reviewRequired`,'bool');out.sections.push({number:s.number,title,transcript:tr,reviewRequired:s.reviewRequired??false});}
 if(!Array.isArray(p.questions)||p.questions.length>40)return fail('questions','questions');out.questions=[];
 for(const [i,q] of p.questions.entries()){const P=`questions.${i}`;if(!isObj(q))return fail(P,'object');const o={};
  if(!I(q.number,1,40))return fail(P+'.number','number');o.number=q.number;if(!I(q.section,1,4))return fail(P+'.section','section');o.section=q.section;
  let v=T(q.text);if(v===null)return fail(P+'.text','text');o.text=v;if(typeof q.instruction!=='string'||q.instruction.length>2000)return fail(P+'.instruction','instruction');o.instruction=q.instruction;
  if(q.kind!==undefined){if(!['completion','mcq','matching','map'].includes(q.kind))return fail(P+'.kind','kind');o.kind=q.kind;}
  if(q.typeCode!==undefined){const t=typeof q.typeCode==='string'?q.typeCode.trim():null;if(t===null||t.length<3||t.length>40)return fail(P+'.typeCode','typeCode');o.typeCode=t;}
  if(!Array.isArray(q.options)||q.options.length>12||q.options.some(x=>typeof x!=='string'||x.length>2000))return fail(P+'.options','options');o.options=q.options;
  v=T(q.key);if(v===null)return fail(P+'.key','key');o.key=v;
  if(!Array.isArray(q.alternatives)||q.alternatives.length>20||q.alternatives.some(x=>typeof x!=='string'||x.length>500))return fail(P+'.alternatives','alternatives');o.alternatives=q.alternatives;
  if(!Array.isArray(q.pair)||q.pair.length>2||q.pair.some(x=>!I(x,1,40)))return fail(P+'.pair','pair');o.pair=q.pair;
  const e=q.evidence;if(!isObj(e)||typeof e.at!=='number'||!(e.at>=0)||(e.end!==undefined&&!(typeof e.end==='number'&&e.end>0))||typeof e.why!=='string'||e.why.length>12000)return fail(P+'.evidence','evidence');o.evidence={at:e.at,...(e.end!==undefined?{end:e.end}:{}),why:e.why};out.questions.push(o);}
 for(const [name,max] of [['keyword1',200],['keyword2',40]]){if(!Array.isArray(p[name])||p[name].length>max)return fail(name,name);out[name]=[];
  for(const [i,row] of p[name].entries()){const r=clip(row,`${name}.${i}`,name==='keyword1'?'text':null);if(r.e)return fail(...r.e);const o=r.v;
   if(name==='keyword2'){if(Array.isArray(row.options)){if(row.options.length<2||row.options.length>8||row.options.some(x=>T(x)===null)||!I(row.correct,0,Number.MAX_SAFE_INTEGER))return fail(`keyword2.${i}`,'keyword2');o.options=row.options.map(x=>T(x));o.correct=row.correct;}else{const a=T(row.answer);if(a===null)return fail(`keyword2.${i}.answer`,'answer');o.answer=a;}}
   out[name].push(o);}}
 if(!Array.isArray(p.vocabulary)||p.vocabulary.length>40)return fail('vocabulary','vocabulary');out.vocabulary=[];
 for(const [i,w] of p.vocabulary.entries()){const P=`vocabulary.${i}`;if(!isObj(w)||typeof w.word!=='string'||w.word.length<1||w.word.length>120||typeof w.pos!=='string'||w.pos.length>30||typeof w.uz!=='string'||w.uz.length>500||typeof w.def!=='string'||w.def.length<1||w.def.length>500||typeof w.ex!=='string'||w.ex.length>500||!Array.isArray(w.also)||w.also.length>20||w.also.some(x=>typeof x!=='string'||x.length>120))return fail(P,'vocabulary entry');
  const o={word:w.word,pos:w.pos,uz:w.uz,def:w.def,ex:w.ex,also:w.also};
  if(w.quiz!==undefined){const q=w.quiz;if(!isObj(q)||T(q.q)===null||!Array.isArray(q.options)||q.options.length<2||q.options.length>8||q.options.some(x=>T(x)===null)||!I(q.correct,0,q.options.length-1))return fail(P+'.quiz','Invalid quiz key');o.quiz={q:T(q.q),options:q.options.map(x=>T(x)),correct:q.correct};}out.vocabulary.push(o);}
 if(p.studyPack!==undefined){const sp=p.studyPack;if(!isObj(sp)||sp.kind!=='research-practice'||!isObj(sp.partRanges))return fail('studyPack','studyPack');const o={kind:sp.kind};
  if(sp.activities!==undefined){if(!Array.isArray(sp.activities)||sp.activities.length<1||sp.activities.length>ACTIVITY_IDS.length||sp.activities.some(a=>!ACTIVITY_IDS.includes(a)))return fail('studyPack.activities','activities');o.activities=sp.activities;}
  o.partRanges={};for(const [k,r] of Object.entries(sp.partRanges)){if(!Array.isArray(r)||r.length!==2||typeof r[0]!=='number'||!(r[0]>=0)||typeof r[1]!=='number'||!(r[1]>0))return fail('studyPack.partRanges','range');o.partRanges[k]=r;}
  if(sp.scriptParts!==undefined){if(!Array.isArray(sp.scriptParts)||sp.scriptParts.length>4)return fail('studyPack.scriptParts','scriptParts');o.scriptParts=[];
   for(const sc of sp.scriptParts){if(!isObj(sc)||!I(sc.part,1,4)||T(sc.transcript)===null||!Array.isArray(sc.gaps)||sc.gaps.length>200||sc.gaps.some(g=>!isObj(g)||!I(g.q,1,200)||T(g.match)===null||T(g.answer)===null))return fail('studyPack.scriptParts','scriptPart');o.scriptParts.push({part:sc.part,transcript:T(sc.transcript),gaps:sc.gaps.map(g=>({q:g.q,match:T(g.match),answer:T(g.answer)}))});}}
  const rec=sp.recall??[];if(!Array.isArray(rec)||rec.length>4||rec.some(r=>!isObj(r)||!I(r.part,1,4)||T(r.title)===null||!Array.isArray(r.points)||r.points.length<1||r.points.length>20||r.points.some(x=>T(x)===null)))return fail('studyPack.recall','recall');
  o.recall=rec.map(r=>({part:r.part,title:T(r.title),points:r.points.map(x=>T(x))}));out.studyPack=o;}
 /* semantic pass (listeningDomainIssues) */
 const issue=m=>fail('',m);
 if(!out.questions.length&&!out.authoredRuntime)return issue('Missing questions');
 if(out.studyPack){if(new Set(out.studyPack.recall.map(r=>r.part)).size!==out.studyPack.recall.length)return issue('Duplicate recall Part');
  for(const [part,range] of Object.entries(out.studyPack.partRanges))if(!out.sections.some(s=>String(s.number)===part)||range[1]<=range[0]||range[1]>out.audio.durationSec+1)return issue('Part range outside audio');
  for(const r of out.studyPack.recall)if(!out.studyPack.partRanges[String(r.part)])return issue('Recall Part has no audio range');}
 if(new Set(out.sections.map(s=>s.number)).size!==out.sections.length)return issue('Duplicate section');
 if(new Set(out.questions.map(q=>q.number)).size!==out.questions.length)return issue('Duplicate question number');
 for(const q of out.questions){if(!out.sections.some(s=>s.number===q.section))return issue(`Q${q.number}: wrong section`);if(q.evidence.at>=out.audio.durationSec)return issue(`Q${q.number}: evidence outside audio`);
  for(const n of q.pair)if(n===q.number||!out.questions.some(x=>x.number===n&&x.pair.includes(q.number)))return issue('Invalid answer pair');}
 for(const rows of [out.keyword1,out.keyword2]){if(new Set(rows.map(x=>x.q)).size!==rows.length)return issue('Duplicate keyword question');for(const row of rows)if(row.end<=row.at||row.end>out.audio.durationSec)return issue('Clip outside audio');}
 for(const row of out.keyword2)if('correct' in row&&row.correct>=row.options.length)return issue('Invalid Keyword II key');
 for(const path of [out.audio.path,out.imagePath].filter(Boolean))if(!safePackagePath(path))return issue('Unsafe asset path');
 return {success:true,data:out};
}
const parseOrThrow=p=>{const r=parseListeningPackage(p);if(!r.success)throw new Error(`${r.issue.path||'package'}: ${r.issue.message}`);return r.data;};
/* ---- source parser (structured + research families) ---- */
export function slugTestId(value){return String(value).replace(/\.(?:zip|html?)$/i,'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'listening-import';}
export function structuredQuestionType(label){
 const normalized=label.trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
 if(/^(?:map|plan|map\s*\/\s*plan)$/.test(normalized))return {kind:'map'};if(normalized==='completion')return {kind:'completion'};
 if(/^choose two(?:\s*\/\s*multiple answers?)?$/.test(normalized))return {kind:'mcq',typeCode:'mcq_multi'};if(normalized==='single answer mcq')return {kind:'mcq',typeCode:'mcq_single'};
 const stated=normalized.replace(/labelling/g,'labeling').replace(/ /g,'_');const typeCode=canonicalListeningTypeId(stated)??canonicalListeningTypeId(normalized);const kind=typeCode?listeningKindOfType(typeCode):null;
 return !kind||!typeCode?null:{kind,typeCode};
}
function convertStructuredPractice(html,durationSec,options,read){
 const source=jsonLiteral(html,'const DATA ='),parts=jsonLiteral(html,'const PARTS =');
 const typeOf=n=>{const labels=Object.entries(source.question_types).filter(([range])=>{const [a,b]=range.split('-').map(Number);return n>=a&&n<=(b??a);});const identity=labels.length===1?structuredQuestionType(labels[0][1]):null;
  if(!identity)throw new ListeningImportProblem('package_invalid',{info:`Q${n}: source type not canonically proven (${labels.map(([,l])=>l).join(', ')||'missing'}); staff review required`});return identity;};
 const documents=Object.fromEntries(Object.entries(parts).map(([part,h])=>[part,read(h)]));
 const questions=Object.values(source.questions).sort((a,b)=>a.q-b.q).map(row=>{const doc=documents[String(row.part)]??read(''),control=doc.getElementById(`q${row.q}`),instruction=control?.closest('.task-card')?.querySelector('.instructions-block')?.textContent?.replace(/\s+/g,' ').trim()??'';
  return {number:row.q,section:row.part,text:row.prompt,instruction,...typeOf(row.q),options:row.options?.map(o=>o.text.match(new RegExp(`^${o.code}[).\\s]`))?o.text:`${o.code}) ${o.text}`)??[],key:row.answer,alternatives:source.alternatives[String(row.q)]??[],pair:row.pair==null?[]:[row.pair],evidence:{at:row.timeStart,end:row.timeEnd,why:[row.why,row.trap].filter(Boolean).join('\n')}};});
 const mapParts=new Set(questions.filter(q=>q.kind==='map').map(q=>q.section));
 const diagrams=Object.entries(documents).flatMap(([part,doc])=>[...doc.querySelectorAll('svg')].filter(svg=>mapParts.has(Number(part))||svg.matches('.la-map, [data-map], [data-plan]')||/\b(map|plan)\b/i.test(svg.getAttribute('aria-label')??'')).map(svg=>extractMapDiagram(svg)));
 const distinct=new Map(diagrams.map(d=>[JSON.stringify([d.viewBox,d.shapes]),d]));
 if(distinct.size>1)throw new ListeningImportProblem('package_invalid',{info:'Multiple different map/plan visuals cannot be represented by this package; staff review required'});
 const mapDiagram=distinct.values().next().value;
 if(mapParts.size&&!mapDiagram)throw new ListeningImportProblem('map_missing',{info:'Map/Plan questions require an authored visual; no supported source SVG was found'});
 const activities=['exam','review'];if(source.script_completion?.length)activities.push('script');if(questions.some(q=>q.kind==='mcq'))activities.push('mcq');if(questions.some(q=>q.kind==='map')&&mapDiagram)activities.push('map');if(questions.some(q=>q.kind==='matching'))activities.push('matching');if(questions.some(q=>q.kind==='completion'))activities.push('completion');if(source.vocabulary?.length)activities.push('vocab');if(source.activities?.some(n=>/retry/i.test(n)))activities.push('retry');
 const cursors={},mustRemap=source.script_completion.some(r=>r.q>200);
 if(mustRemap&&source.script_completion.length>100)throw new ListeningImportProblem('package_invalid',{info:'Too many script gaps for canonical IDs; review the source.'});
 const gapId=(row,i)=>mustRemap?101+i:row.q;
 const gaps=source.script_completion.map((row,index)=>{const transcript=source.transcript[String(row.part)]??'',boundary=source.part_audio_boundaries[String(row.part)];if(!boundary)throw new Error('Script part missing');let snippet=row.prompt;
  if(row.match){const at=transcript.indexOf(row.match,cursors[row.part]??0);if(at<0)throw new Error(`Script gap ${row.q} absent from transcript`);cursors[row.part]=at+row.match.length;snippet=transcript.slice(Math.max(0,at-90),at)+'_____'+transcript.slice(at+row.match.length,at+row.match.length+90);}
  if(!snippet)throw new Error('Script gap has no source text');return {q:gapId(row,index),part:row.part,at:row.start??boundary.start,end:row.end??boundary.end,text:snippet,heard:snippet.replace(/_{2,}/,row.answer),link:row.answer};});
 const scriptParts=source.script_completion.every(r=>r.match)?source.sections.map((_,index)=>({part:index+1,transcript:source.transcript[String(index+1)],gaps:source.script_completion.map((row,ordinal)=>({...row,canonicalQ:gapId(row,ordinal)})).filter(row=>row.part===index+1).map(row=>({q:row.canonicalQ,match:row.match,answer:row.answer}))})):undefined;
 return parseOrThrow({schemaVersion:1,testId:slugTestId(source.test_id||options.fallbackTestId||source.title),title:source.title,category:'full',collection:'academic',provenance:'Owner-provided structured practice HTML; authored transcript, question types, evidence and activities; no scripts executed',audio:{path:options.audioPath,durationSec},imagePath:null,mapDiagram,
  sections:source.sections.map((title,index)=>({number:index+1,title,transcript:source.transcript[String(index+1)]??'',reviewRequired:false})),questions,keyword1:gaps,keyword2:[],
  vocabulary:source.vocabulary.map(row=>({word:row.headword,pos:/collocation/i.test(row.type)?'collocation':row.type.split('·')[0].trim(),def:row.definition,uz:row.uzbek,ex:row.context,also:row.paraphrases??[]})),
  studyPack:{kind:'research-practice',activities,scriptParts,recall:[],partRanges:Object.fromEntries(Object.entries(source.part_audio_boundaries).map(([part,r])=>[part,[r.start,r.end]]))}});
}
function convertResearchPractice(html,durationSec,options,read){
 const source=jsonLiteral(html,'const D =');
 return parseOrThrow({schemaVersion:1,testId:slugTestId(options.fallbackTestId??'listening-research-practice'),title:read(html).querySelector('h1')?.textContent?.trim()||options.fallbackTestId||'Listening',category:'full',collection:'academic',provenance:'Owner-provided research-practice HTML; parsed JSON without executing uploaded scripts',audio:{path:options.audioPath,durationSec},imagePath:/\[embedded:embedded-listening-map.png\]/.test(html)?'embedded-listening-map.png':null,
  questions:source.questions,sections:source.sections,keyword1:source.scriptCompletion?.map((row,index)=>({q:index+1,sourceQuestion:row.q,at:row.at,end:row.end,text:`${row.before}_____ ${row.after}`,heard:`${row.before}${row.answer}${row.after}`,link:row.answer}))??[],keyword2:[],
  vocabulary:source.vocab?.map(row=>({word:row.word,pos:row.type,uz:row.uz,def:row.def,ex:row.source,also:row.also}))??[],
  studyPack:{kind:'research-practice',activities:['exam','review','script','mcq','recall','vocab'],partRanges:source.partRanges,recall:source.focus}});
}
export function convertLegacyPackage(files,durationSec,read,options={}){
 const structured=Object.values(files).find(s=>/\b(?:const|let|var)\s+DATA\s*=\s*\{/.test(s)&&/part_audio_boundaries/.test(s));if(structured)return convertStructuredPractice(structured,durationSec,options,read);
 const modern=Object.values(files).find(s=>/\bconst\s+D\s*=\s*\{/.test(s));if(modern)return convertResearchPractice(modern,durationSec,options,read);
 const exam=Object.values(files).some(v=>/\.html?$/i.test('x.html')&&/(id|name)\s*=\s*["']l1["']/.test(v));
 if(exam)throw new ListeningImportProblem('package_invalid',{info:'The oldest exam-page format (01_full_exam.html) is not supported by this importer build; use the canonical package.'});
 throw new ListeningImportProblem('no_question_source');
}
/* ---- inspect (inspect.ts) ---- */
const hasExamPage=tf=>Object.entries(tf).some(([p,v])=>/\.html?$/i.test(p)&&(/(id|name)\s*=\s*["']l1["']/.test(v)||/\b(?:const|let|var)\s+(?:D|DATA)\s*=\s*\{/.test(v)));
function discoverTranscripts(textFiles){return {bySection:{},unassigned:[]};}
function referencedAudio(tf){for(const name of ['data/package.json','metadata.json','manifest.json']){const raw=textFile(tf,name);if(!raw)continue;try{const j=JSON.parse(raw);const ref=j?.audio?.path??j?.audio_file??j?.audioFile??j?.audio;if(typeof ref==='string'&&ref)return ref;}catch{/* reported by the parser that needs it */}}return null;}
export async function inspectListeningPackage(input){
 const {entries,textFiles}=input,names=Object.keys(entries),{candidates,rejected}=audioCandidates(entries),ref=referencedAudio(textFiles);
 if(ref&&!input.chosenAudioPath&&candidates.length>0){const hit=chooseAudio(candidates,ref);if(hit.kind!=='chosen'||hit.reason!=='referenced')throw new ListeningImportProblem('audio_reference_missing',{files:candidates.map(c=>c.path),info:ref});}
 const choice=input.chosenAudioPath?chooseAudio(candidates,input.chosenAudioPath):chooseAudio(candidates,ref);
 if(choice.kind==='none')throw new ListeningImportProblem(rejected.length?'audio_signature_mismatch':'no_audio',{files:visibleFileList(rejected.length?rejected.map(r=>r.path):names)});
 if(choice.kind==='ambiguous')throw new ListeningImportProblem('audio_ambiguous',{files:choice.candidates.map(c=>c.path)});
 const audio=choice.audio;let duration;try{duration=await input.probeDuration(audio,entries[audio.path]);}catch{throw new ListeningImportProblem('audio_unreadable',{files:[audio.path]});}
 const canonicalRaw=textFile(textFiles,'data/package.json');let payload,family,canonicalError;
 const canonical=()=>{const parsed=JSON.parse(canonicalRaw);const found=discoverTranscripts(textFiles).bySection;if(Array.isArray(parsed?.sections))for(const s of parsed.sections)if(s&&typeof s==='object'&&!String(s.transcript??'').trim()&&found[s.number])s.transcript=found[s.number];parsed.audio={...(parsed.audio??{}),path:audio.path,durationSec:duration};return parseOrThrow(parsed);};
 try{
  if(canonicalRaw){try{payload=canonical();family='canonical';}catch(e){canonicalError=e instanceof Error?e.message.slice(0,300):'invalid';if(!hasExamPage(textFiles))throw e;family='legacy';payload=convertLegacyPackage(textFiles,duration,input.read,{audioPath:audio.path,fallbackTestId:slugTestId(input.zipName)});}}
  else{family='legacy';payload=convertLegacyPackage(textFiles,duration,input.read,{audioPath:audio.path,fallbackTestId:slugTestId(input.zipName)});}
 }catch(e){
  if(e instanceof ListeningImportProblem){if(!e.detail.files)e.detail.files=visibleFileList(names);throw e;}
  throw new ListeningImportProblem('package_invalid',{files:visibleFileList(names),info:e instanceof Error?e.message.slice(0,300):undefined});
 }
 payload.audio.durationSec=duration;payload.audio.path=audio.path;parseOrThrow(payload);
 if(payload.imagePath&&!entries[payload.imagePath])throw new ListeningImportProblem('map_missing',{files:[payload.imagePath]});
 return {payload,audio,family,transcriptStatus:payload.sections.map(s=>({section:s.number,present:Boolean(s.transcript.trim())})),blockers:[],unassignedTranscriptFiles:discoverTranscripts(textFiles).unassigned,...(canonicalError?{canonicalFallback:canonicalError}:{})};
}
/* ---- activities + grading (activities.ts, package.ts) ---- */
export const normalized=v=>v.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export function gradePackage(p,values){return p.questions.map(q=>{const answer=normalized(values[q.number]??'');const keys=[q.key,...q.alternatives,...q.pair.map(n=>p.questions.find(x=>x.number===n).key)].map(normalized);const duplicate=q.pair.some(n=>n<q.number&&normalized(values[n]??'')===answer);return {number:q.number,correct:!!answer&&keys.includes(answer)&&!duplicate};});}
const authoredKind=(f,k)=>(f.authoredKinds??[]).includes(k);
const isMcq=q=>listeningQuestionIdentity(q).storageType==='multiple_choice';
export function activityFacts(p){const qs=p.questions??[],sp=p.studyPack?.scriptParts??[];return {mcq:qs.some(isMcq),map:qs.some(q=>q.kind==='map'),matching:qs.some(q=>q.kind==='matching'),completion:qs.some(q=>q.kind==='completion'),script:sp.some(x=>(x.transcript??'').trim()&&(x.gaps??[]).length>0),vocabulary:(p.vocabulary??[]).length>0,recall:(p.studyPack?.recall??[]).length>0,keyword1:(p.keyword1??[]).length>0,keyword2:(p.keyword2??[]).length>0,authored:p.studyPack?.activities??null,authoredKinds:p.studyPack?.activities??null};}
const ACTIVITIES=[['exam',()=>true,null],['review',()=>true,'submitted'],['script',f=>f.script,null],['keyword1',f=>f.keyword1&&!f.script,null],['recall',f=>f.recall,null],['keyword2',f=>f.keyword2&&!f.recall,null],['vocab',f=>f.vocabulary,null],['mcq',f=>f.mcq,null],['matching',f=>f.matching&&authoredKind(f,'matching'),null],['completion',f=>f.completion&&authoredKind(f,'completion'),null],['map',f=>f.map&&authoredKind(f,'map'),null],['retry',f=>authoredKind(f,'retry'),'weakness']];
/** WHAT THE TEST ITSELF SUPPORTS with no learner (the staff preview): review and retry need a learner, so they are absent. */
export function testActivities(p){const f=activityFacts(p),ok=id=>{const a=ACTIVITIES.find(x=>x[0]===id);return !!a&&a[1](f)&&a[2]===null;};return f.authored?f.authored.filter(ok):ACTIVITIES.map(a=>a[0]).filter(ok);}
export function mapDiagramSections(p){const s=[...new Set((p.questions??[]).filter(q=>q.kind==='map').map(q=>q.section))].sort((a,b)=>a-b);return s.length?s:[2];}
/** Browser-only: measure the real duration (object URL + media element, released on every path). */
export async function probeAudio(file,signal){
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');const url=URL.createObjectURL(file),audio=new Audio();audio.preload='metadata';
 return new Promise((resolve,reject)=>{let timer;const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);audio.onloadedmetadata=null;audio.onerror=null;audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);};
  const onAbort=()=>{cleanup();reject(new DOMException('Aborted','AbortError'));};timer=setTimeout(()=>{cleanup();reject(new Error('Audio metadata timeout'));},15000);
  audio.onloadedmetadata=()=>{const s=audio.duration;cleanup();Number.isFinite(s)&&s>0?resolve(s):reject(new Error('Audio duration invalid'));};audio.onerror=()=>{cleanup();reject(new Error('Audio unreadable'));};signal?.addEventListener('abort',onAbort,{once:true});audio.src=url;});
}
export const readDocument=html=>new DOMParser().parseFromString(scrubDocument(html),'text/html');
