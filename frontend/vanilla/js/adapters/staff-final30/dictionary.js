import {bad,isObj,str,int,arr,rawJson,UUID} from './core.js';
/** Existing owner dictionary handlers: /api/owner/dictionary/{summary,drafts,history,publish,entries/:id,rollback}. Error body: {error:'code'}. */
const OPS=['edit_sense','add_sense','add_lexeme'];
export async function dictCall(path,method='GET',body,signal){
 const r=await rawJson(method,'/api/owner/dictionary/'+path,body,signal);
 if(!r.ok)throw Object.assign(new Error(typeof r.data?.error==='string'?r.data.error:'unavailable'),{status:r.status,code:typeof r.data?.error==='string'?r.data.error:'request_failed'});
 if(!isObj(r.data))throw bad('invalid_response');return r.data;
}
export function validateOverview(s){
 const m=s?.release?.manifest;if(!isObj(m)||!isObj(s.channel)||!isObj(s.custom))throw bad();
 return {channel:{active_release_id:str(s.channel.active_release_id,{max:100}),previous_release_id:str(s.channel.previous_release_id??null,{nullable:true,max:100})},release:{manifest:{lexemes:int(m.lexemes),senses:int(m.senses),examples:int(m.examples),search_terms:int(m.search_terms)},manifest_sha:str(s.release.manifest_sha,{max:200})},drafts:int(s.drafts),custom:{lexemes:int(s.custom.lexemes),senses:int(s.custom.senses)},published_at:s.published_at==null?null:str(s.published_at,{max:60}),index_state:str(s.index_state,{max:40})};
}
export function validateDrafts(d){return arr(d?.drafts,100).map(x=>{if(!isObj(x)||!UUID.test(x.id)||!isObj(x.changes)||!OPS.includes(x.changes.operation))throw bad();return {id:x.id,changes:x.changes};});}
export function validateHistory(d){return arr(d?.history,50).map(x=>{if(!isObj(x))throw bad();return {id:str(x.id,{max:100}),operation:str(x.operation,{max:60}),created_at:str(String(x.created_at),{max:60}),result_release_id:str(x.result_release_id??null,{nullable:true,max:100})};});}
export function validateJob(j){if(j==null)return null;if(!isObj(j)||!UUID.test(j.id))throw bad();return {id:j.id,phase:str(j.phase,{max:40}),error:str(j.error??null,{nullable:true,max:500}),candidate_release_id:str(j.candidate_release_id??'',{max:100})};}
export const isDone=j=>['complete','failed'].includes(j.phase);
