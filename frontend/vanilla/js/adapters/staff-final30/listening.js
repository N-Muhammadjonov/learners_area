import {bad,isObj,str,int,bool,arr,staffData,rawJson,UUID} from './core.js';
/** Listening admin (administrator/owner). Reads PROPOSED; writes = existing /api/admin/listening/tests/:id (PATCH rename / DELETE). */
export const COLLECTIONS=Object.freeze(['essential','academic','general','question_types','mcq','uncatalogued']);
export function validateLibrary(d){
 return {unavailable:d.unavailable===true,hasMore:d.hasMore===true,cards:arr(d.cards??[],5000).map(c=>{if(!isObj(c)||!UUID.test(c.id))throw bad();return {id:c.id,title:str(c.title,{max:300}),duration:int(c.duration),sectionNumbers:c.sectionNumbers==null?undefined:arr(c.sectionNumbers,4).map(n=>int(n,{min:1,max:4})),activityCount:c.activityCount==null?undefined:int(c.activityCount,{min:1}),questions:c.questions==null?undefined:int(c.questions),completed:int(c.completed??0),started:bool(c.started??false),collection:c.collection==null?undefined:str(c.collection,{max:40}),legacy:c.legacy===true,authoredRuntime:c.authoredRuntime===true,publicationState:c.publicationState==null?undefined:str(c.publicationState,{max:20})};})};
}
export const library=(page,signal)=>staffData('listening-library',{page},signal).then(validateLibrary);
export function validateTest(d){
 if(d.redirectToFull===true)return {redirectToFull:true};
 const t=d.test;if(!isObj(t)||!UUID.test(t.id))throw bad();
 return {redirectToFull:false,test:{id:t.id,title:str(t.title,{max:300}),audioUrl:t.audioUrl==null?null:safeMedia(t.audioUrl),audioType:t.audioType==null?null:str(t.audioType,{max:20})},questions:arr(d.questions,500).map(q=>{if(!isObj(q)||typeof q.id!=='string')throw bad();return {id:q.id,order:int(q.order),questionText:str(q.questionText,{max:20000}),type:str(q.type,{max:60}),correctAnswer:str(q.correctAnswer,{max:2000})};})};
}
const safeMedia=v=>{if(typeof v!=='string')throw bad();if(v.startsWith('/')&&!v.startsWith('//'))return v;try{const u=new URL(v);if(u.protocol==='https:')return v;}catch{}throw bad();};
export const test=(id,signal)=>UUID.test(id)?staffData('listening-test',{id},signal).then(validateTest):Promise.reject(Object.assign(new Error('not_found'),{status:404}));
/** PATCH {title (trimmed, 1..200)} or DELETE (server refuses with 409 when learners have history: archive instead). */
export async function renameTest(id,title,signal){const t=String(title).trim();if(!UUID.test(id)||t.length<1||t.length>200)throw new TypeError('invalid');const r=await rawJson('PATCH',`/api/admin/listening/tests/${id}`,{title:t},signal,{timeout:12000});if(!r.ok)throw Object.assign(new Error('rename'),{status:r.status,code:typeof r.data?.error==='string'?r.data.error:'request_failed'});}
export async function deleteTest(id,signal){if(!UUID.test(id))throw new TypeError('invalid');const r=await rawJson('DELETE',`/api/admin/listening/tests/${id}`,undefined,signal,{timeout:12000});if(!r.ok)throw Object.assign(new Error('delete'),{status:r.status,code:typeof r.data?.error==='string'?r.data.error:'request_failed'});}
