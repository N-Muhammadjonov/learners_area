import {bad,isObj,str,int,bool,oneOf,arr,date,staffData,rawJson,UUID} from './core.js';
/**
 * Reading Retention bank (administrator/owner). Reads PROPOSED; writes = existing /api/admin/retention/* handlers.
 * Pure rules (levels, word counter, measurement schema) are PORTED from src/lib/retention/* so the editor shows exactly
 * what the server enforces; the server remains authoritative (the live check calls the SAME validate endpoint as save).
 */
export const LEVELS=Object.freeze(['A2','B1','B2','C1','C2']);
export const LEVEL_CONFIG=Object.freeze({A2:{minWords:100,maxWords:125},B1:{minWords:160,maxWords:195},B2:{minWords:240,maxWords:285},C1:{minWords:280,maxWords:330},C2:{minWords:390,maxWords:450}});
export const isLevel=v=>LEVELS.includes(v);
const WORD=/[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu;
/** The canonical word counter (src/lib/retention/word-count.ts): grouped digits collapse, NFKC, word = letters/digits with ' ’ - joiners. */
export function countWords(text){if(typeof text!=='string'||!text.length)return 0;const m=text.replace(/(?<=\d)[,\u00a0\u202f\u2009](?=\d)/gu,'').normalize('NFKC').match(WORD);return m?m.length:0;}
const KINDS=['concept','entity','number','date'],SCOPES=['sentence','answer'];
const rec=o=>o&&typeof o==='object'&&!Array.isArray(o);
const only=(o,keys)=>Object.keys(o).every(k=>keys.includes(k));
/** FORM-draft decoder (measurement-draft.ts): tolerant of incomplete forms, strict about shape; null => keep raw JSON, never discard. */
export function decodeMeasurementDraft(raw){
 if(raw.length>200000)return null;if(!raw.trim())return {schemaVersion:1,maxScore:100,claims:[]};
 let v;try{v=JSON.parse(raw);}catch{return null;}
 if(!rec(v)||!only(v,['schemaVersion','maxScore','claims'])||v.schemaVersion!==1||v.maxScore!==100||!Array.isArray(v.claims)||v.claims.length>40)return null;
 const claims=[];
 for(const c of v.claims){
  if(!rec(c)||!only(c,['id','label','points','scope','groups','acceptedPhrases','rejectPhrases'])||typeof c.id!=='string'||typeof c.label!=='string'||!Number.isFinite(c.points)||!SCOPES.includes(c.scope)||!Array.isArray(c.groups)||c.groups.length>20)return null;
  for(const k of ['acceptedPhrases','rejectPhrases'])if(c[k]!==undefined&&(!Array.isArray(c[k])||c[k].length>20||c[k].some(x=>typeof x!=='string')))return null;
  const groups=[];
  for(const g of c.groups){if(!rec(g)||!only(g,['id','points','kind','anyOf','critical'])||typeof g.id!=='string'||!Number.isFinite(g.points)||!KINDS.includes(g.kind)||!Array.isArray(g.anyOf)||g.anyOf.length>30||g.anyOf.some(x=>typeof x!=='string')||(g.critical!==undefined&&typeof g.critical!=='boolean'))return null;groups.push({...g,critical:g.critical??false});}
  claims.push({...c,groups,acceptedPhrases:c.acceptedPhrases??[],rejectPhrases:c.rejectPhrases??[]});
 }
 return {schemaVersion:1,maxScore:100,claims};
}
export const measurementLines=raw=>raw===''?[]:raw.split('\n');
/** Authoritative-shape check (measurement.ts, strict). Returns issue codes; [] => valid. Used only for the form's "Ready" badge. */
export function measurementIssues(v){
 const out=[],id=s=>typeof s==='string'&&s.trim().length>=1&&s.trim().length<=60&&/^[A-Za-z0-9_-]+$/.test(s.trim());
 if(!rec(v)||!only(v,['schemaVersion','maxScore','claims']))return ['root_unexpected_field'];
 if(v.schemaVersion!==1)out.push('schema_version_unsupported');if(v.maxScore!==100)out.push('max_score_not_100');
 if(!Array.isArray(v.claims)||v.claims.length<1)return [...out,'claims_empty'];if(v.claims.length>40)return [...out,'claims_too_many'];
 const cids=new Set();let total=0;
 for(const c of v.claims){
  if(!rec(c)||!only(c,['id','label','points','scope','groups','acceptedPhrases','rejectPhrases'])){out.push('claim_unexpected_field');continue;}
  if(!id(c.id))out.push('id_invalid');else{if(cids.has(c.id.trim()))out.push('claim_id_duplicate');cids.add(c.id.trim());}
  if(typeof c.label!=='string'||c.label.trim().length<3)out.push('claim_label_too_short');else if(c.label.trim().length>300)out.push('claim_label_too_long');
  if(!Number.isInteger(c.points)||c.points<=0||c.points>100)out.push('claim_points_invalid');if(!SCOPES.includes(c.scope))out.push('claim_scope_unsupported');
  for(const k of ['acceptedPhrases','rejectPhrases'])if(c[k]!==undefined&&(!Array.isArray(c[k])||c[k].length>20||c[k].some(x=>typeof x!=='string'||x.trim().length<2||x.trim().length>220)))out.push(k==='acceptedPhrases'?'accepted_phrases_invalid':'reject_phrases_invalid');
  if(!Array.isArray(c.groups)||c.groups.length<1){out.push('claim_groups_empty');continue;}if(c.groups.length>20)out.push('claim_groups_too_many');
  const gids=new Set();let gt=0;
  for(const g of c.groups){
   if(!rec(g)||!only(g,['id','points','kind','anyOf','critical'])){out.push('group_unexpected_field');continue;}
   if(!id(g.id))out.push('id_invalid');else{if(gids.has(g.id.trim()))out.push('group_id_duplicate');gids.add(g.id.trim());}
   if(!Number.isInteger(g.points)||g.points<=0||g.points>100)out.push('group_points_invalid');else gt+=g.points;
   if(!KINDS.includes(g.kind))out.push('group_kind_unsupported');
   if(!Array.isArray(g.anyOf)||g.anyOf.length<1)out.push('anyof_empty');else{if(g.anyOf.length>30)out.push('anyof_too_many');if(g.anyOf.some(x=>typeof x!=='string'||x.trim().length<1))out.push('anyof_empty_alternative');else if(g.anyOf.some(x=>x.trim().length>180))out.push('anyof_alternative_too_long');}
   if(g.critical!==undefined&&typeof g.critical!=='boolean')out.push('group_critical_invalid');
  }
  if(gt!==c.points)out.push('claim_group_points_mismatch');if(Number.isInteger(c.points))total+=c.points;
 }
 if(total!==100)out.push('claims_total_not_100');return out;
}
/** Server validation answer -> localized-neutral lines (path + code only; never server internals). */
export function formatValidationIssues(details){
 if(!details||typeof details!=='object')return [];const issues=details.issues;if(!Array.isArray(issues))return [];
 return issues.slice(0,20).map(i=>{if(typeof i==='string')return i;if(i&&typeof i==='object'){const w=typeof i.path==='string'&&i.path?i.path:'(root)';return `${w}: ${typeof i.code==='string'?i.code:'invalid'}`;}return 'invalid';});
}
export function validateBank(d){
 const inv=arr(d.inventory,10).map(r=>{if(!isObj(r))throw bad();return {level:oneOf(r.level,LEVELS),activeCount:int(r.activeCount),target:int(r.target),remainingToTarget:int(r.remainingToTarget),lifetimeUses:int(r.lifetimeUses),archivedCount:int(r.archivedCount)};});
 const b=d.bank;if(!isObj(b))throw bad();
 return {inventory:inv,level:oneOf(d.level,LEVELS),filter:oneOf(d.filter,['all','active','archived']),sort:oneOf(d.sort,['label','uses','newest']),bank:{page:int(b.page,{min:1}),pageCount:int(b.pageCount,{min:1}),total:int(b.total),rows:arr(b.rows,500).map(r=>{if(!isObj(r)||!UUID.test(r.textId))throw bad();return {textId:r.textId,internalLabel:str(r.internalLabel,{max:300}),level:oneOf(r.level,LEVELS),active:bool(r.active),preview:str(r.preview??'',{max:2000}),wordCount:int(r.wordCount),versionNumber:int(r.versionNumber,{min:1}),currentVersionUses:int(r.currentVersionUses),lifetimeUses:int(r.lifetimeUses),updatedAt:(date(r.updatedAt),r.updatedAt)};})}};
}
export const bank=(q,signal)=>staffData('reading-retention',q,signal).then(validateBank);
export function validateStaged(d){
 const r=d.report;if(!isObj(r))throw bad();
 return {level:oneOf(d.level,LEVELS),report:{heldTextCount:int(r.heldTextCount),mismatchCount:int(r.mismatchCount),items:arr(r.items,200).map(i=>{if(!isObj(i))throw bad();return {sourceId:str(i.sourceId,{max:100}),wordCount:int(i.wordCount),held:bool(i.held),bodyText:str(i.bodyText,{max:20000}),sourceScore:int(i.sourceScore,{max:100}),canonicalScore:int(i.canonicalScore,{max:100}),missingGroups:arr(i.missingGroups??[],100).map(m=>{if(!isObj(m))throw bad();return {claimId:str(m.claimId,{max:100}),missingGroupIds:arr(m.missingGroupIds,100).map(x=>str(x,{max:100}))};})};})}};
}
export const staged=(level,signal)=>staffData('retention-staged',{level},signal).then(validateStaged);
const READ=12000,WRITE=20000;
export class Timeout extends Error{}
async function call(method,path,body,signal,timeout){try{return await rawJson(method,path,body,signal,{timeout});}catch(e){if(e?.name==='TimeoutError'||e?.name==='AbortError'&&!signal?.aborted)throw new Timeout();throw e;}}
/** PATCH {active}. Any non-OK => failed (the screen is unchanged). */
/** Current-main owner-only destructive endpoint; server enforces owner role and exact label. */
export async function permanentlyDelete(textId,expectedLabel,signal){
 if(!UUID.test(textId)||typeof expectedLabel!=='string'||!expectedLabel||expectedLabel.length>300)throw new TypeError('invalid deletion');
 const r=await call('DELETE',`/api/admin/retention/texts/${textId}`,{expectedLabel},signal,WRITE);
 if(r.status===409)return {blocked:true};
 if(!r.ok)throw Object.assign(new Error('delete_failed'),{status:r.status});
 return {blocked:false};
}
export async function setActive(textId,active,signal){if(!UUID.test(textId)||typeof active!=='boolean')throw new TypeError('invalid');const r=await call('PATCH',`/api/admin/retention/texts/${textId}`,{active},signal,WRITE);if(!r.ok)throw Object.assign(new Error('archive'),{status:r.status});}
/** GET current version for Change; any problem is an explicit failure (never an empty form that could overwrite the real text). */
export async function loadText(textId,signal){const r=await call('GET',`/api/admin/retention/texts/${textId}`,undefined,signal,READ);const t=r.data?.text;if(!r.ok||!isObj(t)||typeof t.bodyText!=='string'||typeof t.currentVersionId!=='string')throw new Error('load failed');return {bodyText:t.bodyText,structure:t.scoringStructure,currentVersionId:t.currentVersionId};}
/** Live check = the SAME endpoint the save uses. Returns {valid:true,wordCount}|{valid:false,error,issues}|{unavailable:true}|{invalidInput:true}. */
export async function validateRemote({level,bodyText,structure},signal){
 const r=await call('POST','/api/admin/retention/validate',{level,bodyText,scoringStructure:structure},signal,READ);
 if(!r.ok||!isObj(r.data))return r.status===400?{invalidInput:true}:{unavailable:true};
 if(r.data.valid===true&&Number.isFinite(r.data.wordCount))return {valid:true,wordCount:r.data.wordCount};
 return {valid:false,error:String(r.data.error??'invalid'),issues:formatValidationIssues(r.data.details)};
}
/** Add (level) or Change (new version, with optimistic-concurrency token). 409 => {conflict:true}. Never retried: a timeout has an unknown outcome. */
export async function saveText({mode,textId,level,bodyText,structure,currentVersionId},signal){
 const isChange=mode==='change';if(isChange&&!UUID.test(textId))throw new TypeError('invalid');
 const body=isChange?{bodyText,scoringStructure:structure,expectedCurrentVersionId:currentVersionId??undefined}:{level,bodyText,scoringStructure:structure};
 const r=await call('POST',isChange?`/api/admin/retention/texts/${textId}/versions`:'/api/admin/retention/texts',body,signal,WRITE);
 if(r.status===409)return {conflict:true};
 if(!r.ok){const e=r.data?.error;if(e==='retention_invalid_structure'||e==='retention_word_count_out_of_range')return {invalid:true,error:e,issues:formatValidationIssues(r.data?.details)};throw Object.assign(new Error('save'),{status:r.status});}
 return {ok:true};
}
