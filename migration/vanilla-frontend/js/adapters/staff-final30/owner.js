import {bad,isObj,str,int,bool,oneOf,arr,date,staffData,call,ok,rawJson,brandPath,ROLES} from './core.js';
/** Owner overview. Source: owner/page.tsx (countPeople, pending requests, integrationReport, brand config). PROPOSED read DTO. */
const STATES=['connected','not_configured','error','unverified'];
export function validateOverview(d){
 return {counts:arr(d.counts,100).map(r=>{if(!isObj(r))throw bad();return {role:oneOf(r.role,ROLES),status:oneOf(r.status,['pending','active','rejected','suspended']),count:int(r.count)};}),pendingCount:int(d.pendingCount),
  integrations:arr(d.integrations,20).map(r=>{if(!isObj(r))throw bad();return {key:str(r.key,{max:40}),state:oneOf(r.state,STATES)};}),
  brand:(()=>{const b=d.brand;if(!isObj(b))throw bad();return {siteName:str(b.siteName,{max:100}),favicon:brandPath(b.favicon),assets:arr(b.assets,12).map(a=>{if(!isObj(a))throw bad();return {key:oneOf(a.key,['logoMasterDark','logoMarkDark','logoMarkLight','logoHorizontalDark','logoHorizontalLight','favicon']),path:brandPath(a.path)};})};})()};
}
export const overview=signal=>staffData('owner-overview',{},signal).then(validateOverview);
/** Integration state report. Source: lib/services/integrations.ts. States + non-sensitive detail only. */
export function validateIntegrations(d){return {report:arr(d.report,20).map(r=>{if(!isObj(r))throw bad();return {key:str(r.key,{max:40}),state:oneOf(r.state,STATES),detail:str(r.detail??null,{nullable:true,max:300}),checkedAt:str(r.checkedAt,{max:40})};})};}
export const integrations=signal=>staffData('owner-integrations',{},signal).then(validateIntegrations);
/** Existing handler GET/POST /api/owner/ai-control. Status mirrors OwnerAiStatus; no secret values exist in it. */
export function validateAiStatus(s){
 if(!isObj(s)||!isObj(s.owner)||!isObj(s.effective))throw bad();
 const prov=arr(s.providers,50).map(p=>{if(!isObj(p))throw bad();return {id:str(p.id,{max:32}),displayName:str(p.displayName,{max:100}),type:oneOf(p.type,['internal','external']),model:str(p.model??null,{nullable:true,max:100}),capabilities:arr(p.capabilities??[],50).map(c=>str(c,{max:60})),secretsPresent:bool(p.secretsPresent),missingSecretNames:arr(p.missingSecretNames??[],20).map(c=>str(c,{max:80}))};});
 return {deploymentCeiling:bool(s.deploymentCeiling),owner:{externalEnabled:bool(s.owner.externalEnabled),providerId:str(s.owner.providerId??null,{nullable:true,max:32}),model:str(s.owner.model??null,{nullable:true,max:100}),fallback:oneOf(s.owner.fallback,['riwi','none']),updatedAt:s.owner.updatedAt==null?null:date(typeof s.owner.updatedAt==='string'?s.owner.updatedAt:String(s.owner.updatedAt)),source:oneOf(s.owner.source,['owner','default','unavailable'])},
  effective:{externalEnabled:bool(s.effective.externalEnabled),providerId:str(s.effective.providerId,{max:32}),providerIsExternal:bool(s.effective.providerIsExternal),ready:bool(s.effective.ready),model:str(s.effective.model??null,{nullable:true,max:100}),fallback:oneOf(s.effective.fallback,['riwi','none'])},providers:prov,configIssues:arr(s.configIssues??[],50).map(i=>{if(!isObj(i))throw bad();return {index:int(i.index),reason:str(i.reason,{max:200})};})};
}
export async function aiStatus(signal){const r=await rawJson('GET','/api/owner/ai-control',undefined,signal);if(!r.ok)throw Object.assign(new Error('ai'),{status:r.status,code:typeof r.data?.error?.code==='string'?r.data.error.code:'request_failed'});return validateAiStatus(r.data);}
/** Source body: {externalEnabled,providerId,model:string|null,fallback}. Error codes are nested: {error:{code}}. */
export async function saveAi({externalEnabled,providerId,model,fallback},signal){
 const m=(model??'').trim();if(m.length>100)throw new TypeError('model too long');
 const r=await rawJson('POST','/api/owner/ai-control',{externalEnabled:!!externalEnabled,providerId,model:m||null,fallback},signal);
 if(!r.ok)throw Object.assign(new Error('ai'),{status:r.status,code:typeof r.data?.error?.code==='string'?r.data.error.code:'request_failed'});
 return validateAiStatus(r.data);
}
/** Retention policy numbers. Source: readRetentionConfig() — configuration, not secrets. PROPOSED read DTO. */
export function validateRetentionConfig(d){const c=d.config;if(!isObj(c))throw bad();const n=k=>int(c[k],{min:0,max:100000});return {config:{inactiveStudentMonths:n('inactiveStudentMonths'),rawEventMonths:n('rawEventMonths'),structuredResultMonths:n('structuredResultMonths'),auditMonths:n('auditMonths'),generatedExportDays:n('generatedExportDays')}};}
export const retentionConfig=signal=>staffData('owner-retention',{},signal).then(validateRetentionConfig);
/** Existing POST /api/owner/retention {dryRun:boolean} => {ok,dryRun,config,results:[{rule,affected,applied,note?}]}. */
export async function runRetention(dryRun,signal){
 if(typeof dryRun!=='boolean')throw new TypeError('dryRun must be boolean');
 const r=ok(await call('POST','/api/owner/retention',{dryRun},signal));
 if(typeof r.dryRun!=='boolean')throw bad('invalid_response');
 return {dryRun:r.dryRun,results:arr(r.results,100).map(x=>{if(!isObj(x))throw bad('invalid_response');return {rule:str(x.rule,{max:120}),affected:int(x.affected),applied:bool(x.applied),note:x.note===undefined?undefined:str(x.note,{max:300})};})};
}
/** Ownership transfer. Existing POST /api/owner/transfer {email,password,keepRole}. Read DTO only supplies the owner e-mail hint. */
export const transferInfo=signal=>staffData('owner-transfer',{},signal).then(d=>({ownerEmail:str(d.ownerEmail??'',{max:320})}));
export async function transferOwnership({email,password,keepRole},signal,opts){
 const e=String(email??'').trim();if(!e||!password||!['admin','teacher','student'].includes(keepRole))throw new TypeError('invalid');
 const r=await rawJson('POST','/api/owner/transfer',{email:e,password,keepRole},signal,opts);
 if(!r.ok)throw Object.assign(new Error('transfer'),{status:r.status,code:typeof r.data?.error==='string'?r.data.error:'request_failed'});
 return ok(r.data);
}
