import {bad,isObj,str,int,oneOf,arr,date,rawJson,UUID} from './core.js';
/**
 * Authoring workspace (administrator/owner). Every call is an EXISTING admin handler:
 * GET /api/admin/content/{bank,authoring-capabilities,template,items/:m/:t/:ref,versions/:id/preview}
 * POST /api/admin/content/{validate,drafts,versions/:id/publication}. Nothing here owns a publication rule: the service decides.
 * Like the source `requestJson`, this never throws for transport problems; it returns {ok:false,status}.
 */
export async function api(method,path,body,signal){
 try{const r=await rawJson(method,path,body,signal);return r.ok?{ok:true,status:r.status,data:r.data}:{ok:false,status:r.status,data:r.data};}
 catch(e){if(signal?.aborted)throw e;return {ok:false,status:0};}
}
export const STATES=['draft','scheduled','published','archived'];
export const PAGE_SIZE=25;
export const bankQuery=(f,offset)=>{
 const p=new URLSearchParams({limit:String(PAGE_SIZE),offset:String(offset)});
 for(const k of ['module','contentType','state','hasState','track','sourceRef','title','q','versionNo'])if(f[k])p.set(k,f[k]);
 for(const k of ['from','to'])if(f[k]){const d=new Date(f[k]);if(Number.isFinite(d.getTime()))p.set(k,d.toISOString());}
 return p.toString();
};
const facets=a=>arr(a??[],200).map(x=>{if(!isObj(x))throw bad();return {value:str(x.value,{max:200}),count:int(x.count)};});
export function validateBank(d){
 if(!isObj(d)||d.ok!==true)throw bad();
 return {total:int(d.total),rows:arr(d.rows,200).map(r=>{if(!isObj(r))throw bad();return {key:str(r.key,{max:500}),module:str(r.module,{max:60}),contentType:str(r.contentType,{max:80}),sourceRef:str(r.sourceRef,{max:300}),title:str(r.title,{max:500}),track:str(r.track??'',{max:40}),versions:int(r.versions),latestVersionNo:int(r.latestVersionNo),latestVersionId:str(r.latestVersionId??'',{max:80}),latestState:str(r.latestState,{max:30}),states:Object.fromEntries(Object.entries(isObj(r.states)?r.states:{}).map(([k,v])=>[k,int(v)])),createdAt:str(r.createdAt??'',{max:60}),updatedAt:str(r.updatedAt??'',{max:60}),hasPublishedRevision:r.hasPublishedRevision===true};})};
}
export function validateCapabilities(d){
 if(!isObj(d))throw bad();
 return arr(d.modules,50).map(m=>{if(!isObj(m))throw bad();return {module:str(m.module,{max:60}),label:str(m.label,{max:100}),contentTypes:arr(m.contentTypes,100).map(c=>{if(!isObj(c))throw bad();return {contentType:str(c.contentType,{max:80}),authorable:c.authorable===true,importable:c.importable===true,label:typeof c.label==='string'?c.label:null};})};});
}
export function validateVersions(d){
 if(!isObj(d))throw bad();
 return arr(d.versions,500).map(v=>{if(!isObj(v))throw bad();return {id:str(v.id,{max:80}),versionNo:int(v.versionNo),status:str(v.status??'',{max:40}),publicationState:str(v.publicationState,{max:30}),title:str(v.title??'',{max:500}),track:str(v.track??'',{max:40}),targetType:v.targetType==null?null:str(v.targetType,{max:60}),targetId:v.targetId==null?null:str(v.targetId,{max:80})};});
}
export function validatePreview(d){
 if(!isObj(d)||!isObj(d.preview))throw bad();const p=d.preview;if(!isObj(p.identity))throw bad();
 return {identity:{versionIdentity:str(p.identity.versionIdentity,{max:300})},canonical:p.canonical===undefined?null:p.canonical,parts:arr(p.parts,200).map(x=>{if(!isObj(x))throw bad();return {key:str(x.key,{max:100}),label:typeof x.label==='string'?x.label:undefined,status:typeof x.status==='string'?x.status:undefined,note:typeof x.note==='string'?x.note:undefined,items:Array.isArray(x.items)?x.items.slice(0,500).map(i=>{if(!isObj(i))throw bad();return {label:str(i.label,{max:300}),value:str(i.value,{max:50000})};}):undefined};}),answerKeyVisible:p.answerKeyVisible===true,problems:arr(p.problems??[],200).map(x=>str(x,{max:500})),status:str(p.status,{max:30})};
}
export const enc=encodeURIComponent;
export const itemPath=r=>`/api/admin/content/items/${enc(r.module)}/${enc(r.contentType)}/${enc(r.sourceRef)}`;
