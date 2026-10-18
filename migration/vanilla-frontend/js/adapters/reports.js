import {ApiError} from '../api-client.js';
import {resolvePeriod} from '../generated/report-period.js';
export const REPORT_FORMATS=['json','csv','xlsx','docx','pdf','zip'];
export const CONTENT_TYPES={json:'application/json',csv:'text/csv',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf',zip:'application/zip'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** UI restrictions only. Existing /api/reports independently authorizes every call. */
export const reportScopes=role=>({owner:['owner','teacher','student'],admin:['teacher','student'],teacher:['teacher','student'],student:['student']})[role]??[];
export function reporterDTO(data,role,query){const p=data?.reporter,scopes=reportScopes(role);if(!p||!scopes.length||p.query!==query||!Array.isArray(p.scopes)||p.scopes.join(',')!==scopes.join(',')||!Array.isArray(p.students)||role==='student'&&p.students.length||['owner','admin'].includes(role)&&p.students.length>1000||role==='teacher'&&p.students.length>500||p.students.some(s=>!s||!uuid.test(s.id)||typeof s.name!=='string'||!s.name||s.name.length>200)||new Set(p.students.map(s=>s.id)).size!==p.students.length)throw new ApiError(502,'invalid_reporter_adapter');return p;}
export function reportParams(values,{role,students},now=new Date()){
 const scope=values.scope,period=values.period,format=values.format,lang=values.lang;
 if(!reportScopes(role).includes(scope))throw new ApiError(400,'forbidden');
 if(!['on_demand','weekly','monthly','yearly','custom'].includes(period)||!REPORT_FORMATS.includes(format)||!['en','uz'].includes(lang))throw new ApiError(400,'invalid_input');
 const resolved=resolvePeriod(period,now,{from:values.from,to:values.to});if(!resolved.ok)throw new ApiError(400,resolved.error);
 const p=new URLSearchParams({scope,period,format,lang});
 if(role==='student'){if(values.subject)throw new ApiError(400,'forbidden');}
 else if(scope==='student'){if(!uuid.test(values.subject??'')||!students.some(s=>s.id===values.subject))throw new ApiError(400,'not_found');p.set('subject',values.subject);}
 if(period==='custom'){p.set('from',values.from);p.set('to',values.to);}return p;
}
export async function fetchReport(params,{signal,fetcher=globalThis.fetch,onUnauthorized=()=>{}}){
 const response=await fetcher('/api/reports?'+params,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(120000)]),headers:{Accept:CONTENT_TYPES[params.get('format')]}});
 if(response.status===401)onUnauthorized();
 if(!response.ok){let code;try{code=(await response.json())?.error?.code;}catch{}throw new ApiError(response.status,typeof code==='string'?code:'generation_failed');}
 const format=params.get('format'),type=(response.headers.get('Content-Type')??'').split(';')[0].toLowerCase(),disposition=response.headers.get('Content-Disposition')??'';
 if(type!==CONTENT_TYPES[format]||!/^attachment\s*;/i.test(disposition))throw new ApiError(502,'generation_failed');
 const blob=await response.blob();if(signal.aborted)throw new DOMException('Aborted','AbortError');if(!blob.size)throw new ApiError(502,'generation_failed');
 const candidate=/filename="([^"]+)"/.exec(disposition)?.[1],filename=candidate&&/^[A-Za-z0-9._-]{1,180}$/.test(candidate)&&candidate.endsWith('.'+format)?candidate:'report.'+format;
 return {blob,filename};
}
