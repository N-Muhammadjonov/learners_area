import {api,ApiError} from '../api-client.js';
/** These three paths are PROPOSED adapters, not existing backend APIs.
 * No fallback identity/policy/data. The disconnected server returns 503. */
export const ADAPTERS=Object.freeze({public:'/api/frontend/public',session:'/api/frontend/session',view:'/api/frontend/view'});
const roles=['student','teacher','admin','owner'];
export function validateSession(value){
 const s=value?.session,u=s?.user;
 if(value?.version!==1||!u||typeof u.id!=='string'||!u.id||typeof u.name!=='string'||!roles.includes(u.role)||!['active','pending','suspended','rejected'].includes(u.accountStatus)||!Number.isSafeInteger(s.expiresAt)||typeof s.accessEventsEnabled!=='boolean'||typeof u.photoPresent!=='boolean')throw new ApiError(502,'invalid_session_adapter');
 return s;
}
export function validatePublic(value){const p=value?.public,a=p?.auth;
 if(value?.version!==1||!a||['passwordEnabled','telegramOnly','telegramIntentEnabled','telegramConfigured','googleConfigured'].some(k=>typeof a[k]!=='boolean')||a.telegramOnly&&a.passwordEnabled||a.telegramConfigured&&(!a.botUsername||!/^[A-Za-z0-9_]{5,32}$/.test(a.botUsername)))throw new ApiError(502,'invalid_public_adapter');return p;
}
export async function publicPresentation(signal){return validatePublic(await api.request(ADAPTERS.public,{signal}));}
export async function sessionPresentation(signal){return validateSession(await api.request(ADAPTERS.session,{signal}));}
export async function viewData(route,signal,region){if(region!==undefined&&!['dashboard','openLessons','mock'].includes(region))throw new TypeError('Unknown view region');const result=await api.request(ADAPTERS.view+'?route='+encodeURIComponent(route)+(region?'&region='+region:''),{signal});if(region&&result?.region!==undefined&&result.region!==region)throw new ApiError(502,'mismatched_view_region');if(result?.version!==1||result.route!==route||!result.data||typeof result.data!=='object')throw new ApiError(502,'invalid_view_adapter');return result.data;}
export function requireFields(data,fields){for(const field of fields)if(!(field in data))throw new ApiError(502,'missing_view_field:'+field);return data;}
