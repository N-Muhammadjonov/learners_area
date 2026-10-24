import {bad,isObj,str,int,bool,arr,rawJson,staffData} from './core.js';
import {readSafeArchiveAsync} from './reading-import.js';
/**
 * Canonical Listening import (ListeningImport.tsx, zip-transport.ts). Order is part of the safety story:
 * validate JSON (server, no writes) -> upload the declared binaries -> dry run -> transactional import.
 * The browser never sends an object key; it sends upload ids the server issued. A ZIP is only a transport container.
 */
const MANIFESTS=['manifest.json','package.json','data/package.json'];
export function findManifestPath(paths){
 const n=paths.map(p=>p.replace(/^\.\//,''));
 for(const m of MANIFESTS){const hit=n.find(p=>p.toLowerCase()===m);if(hit)return hit;}
 for(const m of MANIFESTS){const hit=n.find(p=>p.toLowerCase().endsWith(`/${m}`));if(hit)return hit;}
 return null;
}
export async function readTransportArchive(bytes,signal){
 const entries=await readSafeArchiveAsync(bytes,signal),path=findManifestPath(Object.keys(entries));
 if(!path)throw new Error('Archive has no canonical manifest.json');
 let manifest;try{manifest=JSON.parse(new TextDecoder().decode(entries[path]));}catch{throw new Error('Archive manifest is not valid JSON');}
 return {manifest,manifestPath:path,files:entries};
}
export function archiveFile(files,path){
 const wanted=path.replace(/^\.\//,'').toLowerCase();
 for(const [c,v] of Object.entries(files)){const n=c.replace(/^\.\//,'').toLowerCase();if(n===wanted||n.endsWith(`/${wanted}`))return v;}
 const base=wanted.split('/').pop();if(!base)return null;
 const m=Object.entries(files).filter(([c])=>c.toLowerCase().endsWith(`/${base}`)||c.toLowerCase()===base);return m.length===1?m[0][1]:null;
}
export const categoryFor=role=>role==='audio'?'audio':role==='image'?'image':'file';
const issue=i=>{if(!isObj(i))throw bad();return {level:int(i.level??0),code:str(i.code,{max:80}),path:i.path==null?undefined:str(i.path,{max:300}),message:str(i.message??'',{max:2000}),blocking:bool(i.blocking??false)};};
export function validateValidation(d){
 return {ok:true,module:str(d.module??'listening',{max:40}),contentType:str(d.contentType??'',{max:60}),schemaVersion:int(d.schemaVersion??1),title:str(d.title??'',{max:300}),sourceRef:str(d.sourceRef??'',{max:200}),migratedFrom:d.migratedFrom==null?undefined:int(d.migratedFrom),
  capabilities:(()=>{if(!isObj(d.capabilities))throw bad();return {key:str(d.capabilities.key,{max:80}),label:str(d.capabilities.label,{max:200})};})(),
  requiredAssets:arr(d.requiredAssets??[],200).map(a=>{if(!isObj(a))throw bad();return {key:str(a.key,{max:100}),role:str(a.role,{max:30}),required:bool(a.required??false),label:a.label==null?null:str(a.label,{max:200}),mimeTypes:arr(a.mimeTypes??[],20).map(x=>str(x,{max:100})),maxBytes:int(a.maxBytes??0),declared:bool(a.declared),path:a.path==null?null:str(a.path,{max:300})};}),
  sourceStatus:d.sourceStatus==null?undefined:(()=>{if(!isObj(d.sourceStatus)||!['new','identical','changed'].includes(d.sourceStatus.status))throw bad();return {status:d.sourceStatus.status};})(),
  preview:d.preview==null?null:(()=>{if(!isObj(d.preview))throw bad();return {title:str(d.preview.title??'',{max:300}),lines:arr(d.preview.lines??[],100).map(l=>{if(!isObj(l))throw bad();return {label:str(l.label,{max:200}),value:str(l.value,{max:2000})};}),warnings:arr(d.preview.warnings??[],50).map(w=>str(w,{max:500}))};})(),
  issues:arr(d.issues??[],500).map(issue),warnings:arr(d.warnings??[],100).map(w=>str(w,{max:500}))};
}
/** POST /api/admin/content/validate {package}. Returns {validation}|{fatal:{code,issues}}. Unknown codes are mapped to `unknown` at the boundary. */
export async function validatePackage(pkg,signal,known){
 const r=await rawJson('POST','/api/admin/content/validate',{package:pkg},signal);
 const d=r.data;if(!r.ok||!isObj(d)||d.ok===false||'error' in d){const code=typeof d?.error==='string'&&known.has(d.error)?d.error:'unknown';let issues=[];try{issues=arr(d?.issues??[],500).map(issue);}catch{}return {fatal:{code,issues}};}
 try{return {validation:validateValidation(d)};}catch{return {fatal:{code:'unknown',issues:[]}};}
}
/** POST /api/admin/content/import. Success => {action,targetId,publicationState,warnings}; otherwise {fatal:{code,issues}} (the server's own `code`). */
export async function importPackage({pkg,assetUploads,dryRun,publish,acknowledgeGradeImpact,originalFilename},signal){
 const r=await rawJson('POST','/api/admin/content/import',{package:pkg,assetUploads,dryRun,publish:!dryRun&&publish,acknowledgeGradeImpact,originalFilename},signal,{timeout:60000});
 const d=r.data;
 if(!r.ok||!isObj(d)||d.ok!==true){let issues=[];try{issues=arr(d?.report?.issues??[],500).map(issue);}catch{}return {fatal:{code:typeof d?.code==='string'?d.code:'unknown',issues}};}
 if(!['created','updated','unchanged'].includes(d.action)||typeof d.targetId!=='string')return {fatal:{code:'unknown',issues:[]}};
 return {result:{action:d.action,targetId:d.targetId,publicationState:str(d.publicationState??'',{max:20}),warnings:arr(d.warnings??[],100).map(w=>str(w,{max:500}))}};
}
export const importReady=signal=>staffData('listening-import',{},signal).then(d=>({schemaReady:d.schemaReady===true}));
