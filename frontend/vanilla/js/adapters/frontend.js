import {privateScope} from '../private-scope.js';
import {api,ApiError} from '../api-client.js';
/** Versioned FastAPI presentation adapters. Identity and permissions come from the server. */
export const ADAPTERS=Object.freeze({public:'/api/frontend/public',session:'/api/frontend/session',view:'/api/frontend/view'});
const roles=['student','teacher','admin','owner'];
export function validateSession(value){
 const s=value?.session,u=s?.user;
 if(value?.version!==1||s?.diagnostics!==undefined&&typeof s.diagnostics!=='boolean'||!u||typeof u.id!=='string'||!u.id||typeof u.name!=='string'||u.email!=null&&typeof u.email!=='string'||!roles.includes(u.role)||!['active','pending','suspended','rejected'].includes(u.accountStatus)||!Number.isSafeInteger(s.expiresAt)||typeof s.accessEventsEnabled!=='boolean'||typeof u.photoPresent!=='boolean')throw new ApiError(502,'invalid_session_adapter');
 return s;
}
export function validatePublic(value){const p=value?.public,a=p?.auth;
 if(value?.version!==1||p?.diagnostics!==undefined&&typeof p.diagnostics!=='boolean'||!a||['passwordEnabled','telegramOnly','telegramIntentEnabled','telegramConfigured','googleConfigured'].some(k=>typeof a[k]!=='boolean')||a.diagnostics!==undefined&&typeof a.diagnostics!=='boolean'||a.telegramOnly&&a.passwordEnabled||a.telegramConfigured&&(!a.botUsername||!/^[A-Za-z0-9_]{5,32}$/.test(a.botUsername)))throw new ApiError(502,'invalid_public_adapter');return p;
}
export async function publicPresentation(signal){return validatePublic(await api.request(ADAPTERS.public,{signal}));}
export async function sessionPresentation(signal){return validateSession(await api.request(ADAPTERS.session,{signal}));}
export async function viewData(route,signal,region){if(region!==undefined&&!['dashboard','openLessons','mock','progressSummary','progressStreak','progressTrends','progressMocks'].includes(region))throw new TypeError('Unknown view region');const path=ADAPTERS.view+'?route='+encodeURIComponent(route)+(region?'&region='+region:''),key='view:'+path;
 const cached=cacheableView(route)?privateScope.get(key):undefined;
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(cached!==undefined)return structuredClone(cached);
 const scope=privateScope.scope,generation=privateScope.generation,revision=privateScope.revision;
 const result=await api.request(path,{signal});if(region&&result?.region!==undefined&&result.region!==region)throw new ApiError(502,'mismatched_view_region');if(result?.version!==1||result.route!==route||!result.data||typeof result.data!=='object')throw new ApiError(502,'invalid_view_adapter');if(cacheableView(route)&&scope&&scope===privateScope.scope&&generation===privateScope.generation&&revision===privateScope.revision)privateScope.put(key,structuredClone(result.data));return result.data;}
export function requireFields(data,fields){for(const field of fields)if(!(field in data))throw new ApiError(502,'missing_view_field:'+field);return data;}

// Short-lived memory only. Never retain exam sessions, attempts, answers, searches,
// staff views or realtime state. Every mutation invalidates these snapshots.
const CACHED_VIEWS=new Set(['/app/dashboard','/app/listening/lessons','/app/listening/academic','/app/listening/general','/app/listening/mcq','/app/reading/lessons','/app/reading/academic','/app/reading/general','/app/reading/question-types','/app/writing','/app/speaking','/app/speaking/lessons','/app/speaking/practice','/app/grammar/lessons','/app/video-lessons','/app/progress']);
export const cacheableView=route=>CACHED_VIEWS.has(route);
