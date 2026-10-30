import {bad,isObj,str,int,oneOf,arr,date,staffData,rawJson,UUID} from './core.js';
import {PUB} from './reading.js';
/** Writing Management (admin/owner). Reads PROPOSED; writes = existing /api/admin/writing/:kind[/:id] (POST/PUT). */
export const KINDS=Object.freeze(['lesson','prompt','translation','model-text','pattern']);
export const PUBLICATION_TYPE=Object.freeze({lesson:'writing-lesson',prompt:'writing',translation:'writing-translation','model-text':'writing-model-text',pattern:'writing-pattern'});
export const LESSON_CATEGORIES=Object.freeze(['task1','task2','structure','ideas','coherence','vocabulary','grammar','mistakes']);
export const MODEL_TEXT_BANDS=Object.freeze([8,8.5,9]);
export const PATTERN_FUNCTIONS=Object.freeze(['collocation','sentence_frame','cohesion','comparison','concession','trend','argument']);
export const TRANSLATION_QUESTION_TYPES=Object.freeze(['opinion','discussion','problem_solution','advantages_disadvantages','two_part']);
export const TRANSLATION_BANDS=Object.freeze([6,7,8]);
export const isKind=v=>KINDS.includes(v);
export const wordsIn=t=>(t.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu)??[]).length;
/** `?section=` accepts the legacy alias "exam" for prompts and "topic" (no rows). */
export const parseSection=v=>v==='exam'?'prompt':v==='topic'?'topic':isKind(v)?v:'lesson';
const counts=c=>{if(!isObj(c))throw bad();return Object.fromEntries(['total','draft','scheduled','published','archived'].map(k=>[k,int(c[k])]));};
export function validateOverview(d){
 const section=d.section==='topic'?'topic':oneOf(d.section,KINDS);
 return {section,counts:Object.fromEntries(KINDS.map(k=>[k,counts(d.counts?.[k])])),unavailable:d.unavailable===true,
  rows:arr(d.rows??[],5000).map(r=>{if(!isObj(r)||!UUID.test(r.id))throw bad();return {id:r.id,title:str(r.title,{max:500}),subtitle:str(r.subtitle,{max:500}),publicationState:oneOf(r.publicationState,PUB),publishAt:r.publishAt==null?null:(date(r.publishAt),r.publishAt)};})};
}
export const overview=(section,signal)=>staffData('writing-admin',{section},signal).then(validateOverview);
const src=a=>arr(a??[],1000).map(s=>{if(!isObj(s)||!UUID.test(s.id))throw bad();return {id:s.id,title:str(s.title,{max:500})};});
export const newPage=(kind,signal)=>isKind(kind)?staffData('writing-admin-new',{kind},signal).then(d=>({sources:src(d.sources)})):Promise.reject(Object.assign(new Error('not_found'),{status:404}));
export function validateItem(d){if(!isObj(d.item))throw bad();const it=d.item;oneOf(it.publicationState,PUB);if(it.publishAt!=null)date(it.publishAt);return {item:it,sources:src(d.sources)};}
export const item=(kind,id,signal)=>isKind(kind)&&UUID.test(id)?staffData('writing-admin-item',{kind,id},signal).then(validateItem):Promise.reject(Object.assign(new Error('not_found'),{status:404}));
/** Exactly the source payload() mapping: empty string -> null, numbers coerced, multi-line fields split. */
const lines=s=>s.split('\n').map(x=>x.trim()).filter(Boolean);
export function buildPayload(kind,v,sentences){
 const pick=keys=>Object.fromEntries(keys.map(k=>[k,v[k]===''?null:v[k]]));
 switch(kind){
  case 'lesson':return {...pick(['title','category','summary','body']),durationMinutes:v.durationMinutes?Number(v.durationMinutes):null,position:Number(v.position??0)};
  case 'prompt':return {...pick(['taskType','category','prompt']),targetWordCount:Number(v.targetWordCount)};
  case 'translation':return {...pick(['title','topic','questionType','taskType','promptText','provenance']),targetBand:Number(v.targetBand),sentences:sentences.map(s=>({position:Number(s.position),uzbekSource:s.uzbekSource,modelEnglish:s.modelEnglish,acceptedAlternatives:lines(s.acceptedAlternatives),notes:lines(s.notes),targetLexicalItems:lines(s.targetLexicalItems)}))};
  case 'model-text':return {...pick(['title','taskType','topic','body','provenance']),targetBand:Number(v.targetBand)};
  case 'pattern':return {...pick(['pattern','function','taskType','topic','example','usageNote','provenance']),targetBand:v.targetBand?Number(v.targetBand):null,sourceRef:v.sourceRef||null};
 }
 throw new TypeError('kind');
}
/** Result: {id}. Failure carries `issues` (staff problem codes) from `{error:{issues}}`; unknown => ['write_failed']. */
export async function save(kind,id,payload,signal){
 if(!isKind(kind)||(id!==null&&!UUID.test(id)))throw new TypeError('invalid');
 const r=await rawJson(id?'PUT':'POST',id?`/api/admin/writing/${kind}/${id}`:`/api/admin/writing/${kind}`,payload,signal);
 const issues=Array.isArray(r.data?.error?.issues)?r.data.error.issues.filter(x=>typeof x==='string'):[];
 if(!r.ok||typeof r.data?.id!=='string')throw Object.assign(new Error('write'),{issues:issues.length?issues:['write_failed']});
 return {id:r.data.id};
}
