import {bad,isObj,str,int,oneOf,arr,staffData,call,ok,rawJson,UUID} from './core.js';
/** Grammar admin. Reads PROPOSED; writes = existing /api/admin/grammar/* handlers. */
export function validateTopics(d){return {topics:arr(d.topics,1000).map(t=>{if(!isObj(t)||!UUID.test(t.id))throw bad();return {id:t.id,title:str(t.title,{max:300}),skillArea:oneOf(t.skillArea,['writing','speaking'])};})};}
export const topics=signal=>staffData('grammar-topics',{},signal).then(validateTopics);
export function validateTopic(d){const t=d.topic;if(!isObj(t)||!UUID.test(t.id))throw bad();return {topic:{id:t.id,title:str(t.title,{max:300}),explanation:str(t.explanation,{max:20000})},exercises:arr(d.exercises,1000).map(e=>{if(!isObj(e)||!UUID.test(e.id))throw bad();return {id:e.id,order:int(e.order),promptText:str(e.promptText,{max:12000}),correctOption:str(e.correctOption,{max:600})};})};}
export const topic=(id,signal)=>UUID.test(id)?staffData('grammar-topic',{id},signal).then(validateTopic):Promise.reject(Object.assign(new Error('not_found'),{status:404}));
const fail=(r)=>Object.assign(new Error('grammar'),{status:r.status,code:typeof r.data?.error==='string'?r.data.error:'request_failed'});
/** Source createGrammarTopicSchema: skillArea writing|speaking, title 3..200, explanation >=5. */
export async function createTopic({skillArea,title,explanation},signal){
 if(!['writing','speaking'].includes(skillArea)||title.length<3||title.length>200||explanation.length<5)throw Object.assign(new TypeError('invalid'),{status:400,code:'invalid_input'});
 const r=await rawJson('POST','/api/admin/grammar/topics',{skillArea,title,explanation},signal);if(!r.ok)throw fail(r);return r.data;
}
/** Source createGrammarExerciseSchema + route rule: correctOption must be one of options. Options trimmed, empties dropped (as the form does). */
export async function createExercise(topicId,{promptText,options,correctOption,explanation},signal){
 if(!UUID.test(topicId))throw new TypeError('invalid');const opts=options.map(o=>o.trim()).filter(Boolean);
 if(promptText.length<3||opts.length<2||opts.length>6||!opts.includes(correctOption)||explanation.length<3)throw Object.assign(new TypeError('invalid'),{status:400,code:'invalid_input'});
 const r=await rawJson('POST',`/api/admin/grammar/topics/${topicId}/exercises`,{promptText,options:opts,correctOption,explanation},signal);if(!r.ok)throw fail(r);return r.data;
}
/** Port of grammarBundleSchema (zod, strict). Returns the parsed bundle or null — same acceptance rules. */
const trimmed=(v,max)=>{if(typeof v!=='string')return null;const s=v.trim();return s.length>=3&&s.length<=max?s:null;};
const exactKeys=(o,keys)=>isObj(o)&&Object.keys(o).every(k=>keys.includes(k))&&keys.every(k=>k in o);
export function parseGrammarBundle(text){
 let b;try{b=JSON.parse(text);}catch{return null;}
 if(!exactKeys(b,['schemaVersion','provenance','topics'])||b.schemaVersion!==1||trimmed(b.provenance,500)===null||!Array.isArray(b.topics)||b.topics.length<1||b.topics.length>20)return null;
 const seen=new Set();const topics=[];
 for(const t of b.topics){
  if(!exactKeys(t,['skillArea','title','explanation','exercises'])||!['writing','speaking'].includes(t.skillArea))return null;
  const title=trimmed(t.title,200),explanation=trimmed(t.explanation,12000);if(title===null||explanation===null||!Array.isArray(t.exercises)||t.exercises.length<1||t.exercises.length>100)return null;
  const key=`${t.skillArea}:${title.toLowerCase()}`;if(seen.has(key))return null;seen.add(key);
  const exercises=[];
  for(const e of t.exercises){
   if(!exactKeys(e,['promptText','options','correctOption','explanation','translatePromptUz','targetStructures','activationPrompt']))return null;
   const promptText=trimmed(e.promptText,12000),correct=trimmed(e.correctOption,600),ex=trimmed(e.explanation,12000),uz=trimmed(e.translatePromptUz,1000),act=trimmed(e.activationPrompt,1000);
   if([promptText,correct,ex,uz,act].includes(null)||!Array.isArray(e.options)||e.options.length<2||e.options.length>6||!Array.isArray(e.targetStructures)||e.targetStructures.length<1||e.targetStructures.length>10)return null;
   const options=e.options.map(o=>trimmed(o,600));const ts=e.targetStructures.map(o=>trimmed(o,100));
   if(options.includes(null)||ts.includes(null)||new Set(options).size!==options.length||!options.includes(correct))return null;
   exercises.push({promptText,options,correctOption:correct,explanation:ex,translatePromptUz:uz,targetStructures:ts,activationPrompt:act});
  }
  topics.push({skillArea:t.skillArea,title,explanation,exercises});
 }
 return {schemaVersion:1,provenance:b.provenance.trim(),topics};
}
/** Source POST /api/admin/grammar/import {dryRun,bundle} => {ok,topics,exercises}; 409 when !ok. */
export async function importGrammar(bundle,dryRun,signal){
 const r=await rawJson('POST','/api/admin/grammar/import',{dryRun,bundle},signal);
 if(!r.ok)throw fail(r);if(!isObj(r.data)||!Number.isSafeInteger(r.data.topics)||!Number.isSafeInteger(r.data.exercises))throw bad('invalid_response');return {topics:r.data.topics,exercises:r.data.exercises};
}
