import {ApiError} from '../api-client.js';
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const statuses=['active','pending','suspended','rejected'];
/** Existing source auth contracts, not proposed server endpoints. No local grant. */
export function accountResult(value,kind){
 if(!object(value)||value.ok===false||value.success===false||value.error!=null)throw new ApiError(502,'invalid_response');
 if(kind==='login'){
  if(value.ok!==true&&value.success!==true||typeof value.onboarded!=='boolean'||!statuses.includes(value.accountStatus))throw new ApiError(502,'invalid_response');
 }else if(value.ok!==true)throw new ApiError(502,'invalid_response');
 return value;
}
export function pendingResult(data){if(!object(data)||!('openRequest'in data)||data.openRequest!==null&&(!object(data.openRequest)||typeof data.openRequest.id!=='string'||!data.openRequest.id))throw new ApiError(502,'invalid_response');return data;}

/** Source login diagnostics: categories only, no input/body/path/driver strings. */
export function accountDiagnostic(error){return {event:'loginFailure',status:Number.isInteger(error?.status)&&error.status>=0&&error.status<=599?error.status:0,kind:error?.code==='invalid_response'?'parse':error?.status>=500?'server':error?.status?'http':'network',code:['service_unavailable','invalid_credentials','timeout','aborted'].includes(error?.code)?error.code:null,reason:null};}

/** Optional development-only link: never follow arbitrary API/external URLs. */
export function resetDevUrl(value){if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//'))return null;try{const u=new URL(value,'https://frontend.invalid');return u.origin==='https://frontend.invalid'&&u.pathname==='/reset-password/confirm'&&u.searchParams.get('token')?u.pathname+u.search+u.hash:null;}catch{return null;}}
