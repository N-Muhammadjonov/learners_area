import {bad,isObj,str,int,oneOf,arr,date,staffData,rawJson,UUID} from './core.js';
/** Reading admin. Reads PROPOSED; writes = existing /api/admin/reading/* handlers (bounds copied from lib/validation/admin.ts). */
export const PUB=['draft','scheduled','published','archived'];
export function validatePassages(d){return {passages:arr(d.passages,5000).map(p=>{if(!isObj(p)||!UUID.test(p.id))throw bad();return {id:p.id,title:str(p.title,{max:300}),difficultyLevel:str(p.difficultyLevel,{max:20}),suggestedMinutes:int(p.suggestedMinutes,{max:1000}),publicationState:oneOf(p.publicationState,PUB),publishAt:p.publishAt==null?null:(date(p.publishAt),p.publishAt)};})};}
export const passages=signal=>staffData('reading-passages',{},signal).then(validatePassages);
const QTYPES=['true_false_not_given','yes_no_not_given','multiple_choice','short_answer'];
export function validatePassage(d){const p=d.passage;if(!isObj(p)||!UUID.test(p.id))throw bad();return {passage:{id:p.id,title:str(p.title,{max:300}),bodyText:str(p.bodyText,{max:200000})},questions:arr(d.questions,5000).map(q=>{if(!isObj(q)||!UUID.test(q.id))throw bad();return {id:q.id,order:int(q.order),questionText:str(q.questionText,{max:20000}),type:oneOf(q.type,QTYPES),correctAnswer:str(q.correctAnswer,{max:2000})};})};}
export const passage=(id,signal)=>UUID.test(id)?staffData('reading-passage',{id},signal).then(validatePassage):Promise.reject(Object.assign(new Error('not_found'),{status:404}));
const fail=r=>Object.assign(new Error('reading'),{status:r.status,code:typeof r.data?.error==='string'?r.data.error:'request_failed'});
const invalid=()=>Object.assign(new TypeError('invalid'),{status:400,code:'invalid_input'});
/** createPassageSchema: title 3..200, bodyText >=50, level 2..10, minutes int 5..90. */
export async function createPassage({title,bodyText,difficultyLevel,suggestedMinutes},signal){
 const m=Number(suggestedMinutes);if(title.length<3||title.length>200||bodyText.length<50||difficultyLevel.length<2||difficultyLevel.length>10||!Number.isInteger(m)||m<5||m>90)throw invalid();
 const r=await rawJson('POST','/api/admin/reading/passages',{title,bodyText,difficultyLevel,suggestedMinutes:String(m)},signal);if(!r.ok)throw fail(r);if(typeof r.data?.id!=='string'||!UUID.test(r.data.id))throw bad('invalid_response');return r.data;
}
/** createReadingQuestionSchema (+ source form behaviour: options only for MCQ, empty evidence omitted). `revision_managed` 409 = passage is revision-managed. */
export async function createQuestion(passageId,{type,questionText,options,correctAnswer,evidenceQuote,explanation},signal){
 if(!UUID.test(passageId)||!QTYPES.includes(type))throw new TypeError('invalid');const clean=(options??[]).map(o=>o.trim()).filter(Boolean);
 if(questionText.length<5||correctAnswer.length<1||explanation.length<1||(type==='multiple_choice'&&clean.length<2))throw invalid();
 const r=await rawJson('POST',`/api/admin/reading/passages/${passageId}/questions`,{type,questionText,options:type==='multiple_choice'?clean:undefined,correctAnswer,evidenceQuote:evidenceQuote||undefined,explanation},signal);if(!r.ok)throw fail(r);return r.data;
}
/** Materials (staff: teacher/admin/owner). Reads PROPOSED; the editor's block list/save use the EXISTING GET/PUT /api/materials/:type/:id. */
export const OWNER_TYPES=Object.freeze(['lesson','reading','listening','writing','speaking','grammar','assignment','live_class']);
export const isOwnerType=v=>OWNER_TYPES.includes(v);
const KIND_KEY={lesson:'materialsKindLesson',reading:'materialsKindReading',listening:'materialsKindListening',writing:'materialsKindWriting',speaking:'materialsKindSpeaking',grammar:'materialsKindGrammar',assignment:'materialsKindAssignment',live_class:'materialsKindLiveClass'};
export const kindLabel=(dict,type)=>dict.admin[KIND_KEY[type]];
export const materialsKind=(type,signal)=>isOwnerType(type)?staffData('materials-kind',{type},signal).then(d=>({rows:arr(d.rows,5000).map(r=>{if(!isObj(r)||!UUID.test(r.id))throw bad();return {id:r.id,title:str(r.title,{max:500}),studentVisible:r.studentVisible===true};})})):Promise.reject(Object.assign(new Error('not_found'),{status:404}));
export const materialsOwner=(type,id,signal)=>isOwnerType(type)&&UUID.test(id)?staffData('materials-owner',{type,id},signal).then(d=>{const o=d.owner;if(!isObj(o))throw bad();return {owner:{title:str(o.title,{max:500}),studentVisible:o.studentVisible===true}};}):Promise.reject(Object.assign(new Error('not_found'),{status:404}));
