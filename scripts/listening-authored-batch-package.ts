/** Trusted owner batch: the native index grades answers; versioned HTML owns study UI.
 * No uploaded script is evaluated here. No transcript or timestamp is invented.
 */
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {jsonLiteral,structuredQuestionType} from '../src/lib/listening/source-parser';
import {validateCanonicalListeningPackage} from '../src/lib/import/listening/canonical';
import {createHash} from 'node:crypto';

export function authoredBatchPackage(number:number) {
 if(!Number.isInteger(number)||number<2||number>32)throw Error('Not in the owner batch');
 const dir=new URL(`../content/listening/academic/test-${String(number).padStart(2,'0')}/`,import.meta.url);
 const source=readFileSync(new URL('source.html',dir),'utf8');
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',dir),'utf8'));
 const data=JSON.parse(readFileSync(new URL('data.json',dir),'utf8'));
 if(data.test_id!==`listening-test-${number}`||manifest.id!==data.test_id||manifest.sourceSha256!==createHash('sha256').update(source).digest('hex')||JSON.stringify(jsonLiteral(source,'const DATA ='))!==JSON.stringify(data))throw Error('Source identity/hash mismatch');
 const parts=jsonLiteral(source,'const PARTS =') as Record<string,string>;
 const docs=Object.fromEntries(Object.entries(parts).map(([key,html])=>[key,new JSDOM(html).window.document]));
 const matchingLiteral=/function renderMatching\(\)\{[^{}\n]*?\bconst qs=(\[[\d,\s]+\])/.exec(source)?.[1];
 const matchingQuestions:number[]=matchingLiteral?JSON.parse(matchingLiteral):[];
 const groups:number[][]=[];
 for(const doc of Object.values(docs))for(const el of doc.querySelectorAll('[data-pair-qs],.multi-group-select[data-group]')){
  const value=el.getAttribute('data-pair-qs')??el.getAttribute('data-group')??'';
  if(/^\d+(,\d+)+$/.test(value)){const nums=value.split(',').map(Number);if(!groups.some(g=>g.join()===nums.join()))groups.push(nums);}
 }
 for(const group of data.pair_groups??[])if(!groups.some(g=>g.join()===group.nums.join()))groups.push(group.nums);
 const questions=Object.values(data.questions).map((value)=>{
  const row=value as {q:number;part:number;prompt:string;answer:string;type?:string;why?:string;trap?:string;options?:{code:string;text:string}[]};
  const doc=docs[String(row.part)]!;
  const group=groups.find(g=>g.includes(row.q));
  let label=row.type??Object.entries(data.question_types??{}).find(([range])=>{const [a,b]=range.split('-').map(Number);return row.q>=a!&&row.q<=(b??a!);})?.[1];
  // Test 4 states its types in the actual IELTS task instructions, not DATA.
  if(!label){const control=doc.getElementById(`q${row.q}`)??doc.querySelector(`[name="q${row.q}"],[data-q="${row.q}"],[data-question="${row.q}"]`);const host=control?.closest('.task-card')??doc.body;const instructions=host.querySelector('.instructions-block')?.textContent??'';
   if(group)label='Choose TWO';else if(matchingQuestions.includes(row.q))label='Matching';else if(doc.querySelector(`input[type="radio"][name="q${row.q}"]`))label='MCQ';else if(control?.matches('input[type="text"]')&&/complete|word|number/i.test(instructions))label='Completion';
  }
  const identity=typeof label==='string'&&(/choose (two|three)|multi-select/i.test(label)?{kind:'mcq' as const,typeCode:'mcq_multi' as const}:label==='Diagram Completion'?{kind:'completion' as const,typeCode:'diagram_labeling' as const}:label==='Classification'?{kind:'matching' as const,typeCode:'matching_classification' as const}:structuredQuestionType(label));
  if(!identity)throw Error(`Test ${number} Q${row.q}: unproven type ${label}`);
  let options=(row.options??[]).map(o=>o.text.match(new RegExp(`^${o.code}[).\\s]`))?o.text:`${o.code}) ${o.text}`);
  if(!options.length){const controls=group?doc.querySelectorAll(`[data-pair-qs="${group.join(',')}"],select[data-group="${group.join(',')}"] option[value]`):doc.querySelectorAll(`input[name="q${row.q}"],select#q${row.q} option[value]`);options=[...new Set([...controls].map(el=>(el.closest('label')??el).textContent?.trim()??'').filter(Boolean))];}
  let key=String(data.answers?.[row.q]??row.answer);
  if(group&&!/^[A-Z]$/.test(key)){
   const authored=data.pair_groups?.find((g:{nums:number[]})=>g.nums.join()===group.join())?.answers??data.alternatives?.[row.q];
   if(!Array.isArray(authored)||authored.length!==group.length||new Set(authored).size!==group.length||authored.some(v=>!/^\w$/.test(v)))throw Error('Unproven multi-answer key');
   key=authored[group.indexOf(row.q)];
  }
  return {number:row.q,section:row.part,text:row.prompt,instruction:'',...identity,options,key,alternatives:data.alternatives?.[row.q]??[],pair:group?.filter(q=>q!==row.q)??[],evidence:{at:0,why:[row.why,row.trap].filter(Boolean).join('\n')}};
 });
 if(questions.length!==40||new Set(questions.map(q=>q.number)).size!==40)throw Error('Not forty unique questions');
 const vocabulary=data.vocabulary.map((v:Record<string,unknown>)=>({word:v.headword??v.word,pos:/collocation/i.test(String(v.type??v.pos??''))?'collocation':String(v.type??v.pos??v.lexical_type??'').split(/[·/]/)[0]!.trim(),def:v.definition??v.def,uz:v.uzbek??v.uz,ex:v.context,also:v.paraphrases??[]}));
 const image=manifest.media.find((m:{contentType:string})=>m.contentType.startsWith('image/'));
 const result=validateCanonicalListeningPackage({schemaVersion:2,module:'listening',contentType:'full_test',sourceRef:manifest.id,title:manifest.title,language:'en',provenance:{source:'owner_authored',note:'Owner batch 2-32. Native answer/lexical index only; source HTML retains the full study activities. Evidence timestamps and script gaps are not imported into this index because source families carry incompatible or unverified coordinates; the exact authored values remain in versioned source/data.'},publication:{state:'draft'},assets:manifest.media.map((m:{path:string;contentType:string;sha256:string},i:number)=>({key:i===0?'audio.full':m.contentType.startsWith('audio/')?`audio.part${i+1}`:'image.map',role:m.contentType.startsWith('audio/')?'audio':'image',required:true,mimeTypes:[m.contentType],maxBytes:60*1024*1024,path:m.path,sha256:m.sha256})),content:{collection:'academic',audio:{durationSec:manifest.durationSeconds,assetKey:'audio.full',path:manifest.audio.path},image:image?{assetKey:'image.map'}:null,imagePath:image?.path??null,sections:data.sections.map((title:string,i:number)=>({number:i+1,title,transcript:data.transcript?.[String(i+1)]??'',reviewRequired:!data.transcript?.[String(i+1)]||number===8})),questions,keyword1:[],keyword2:[],vocabulary}});
 if(!result.ok)throw Error(`Test ${number}: `+result.issues.map(i=>i.message).join('; '));
 Object.values(docs).forEach(d=>d.defaultView?.close());
 return {manifest,canonical:result.pkg,stored:result.stored};
}
