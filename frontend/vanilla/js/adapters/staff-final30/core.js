import {anySignal} from '../../signals.js';
import {api,ApiError} from '../../api-client.js';
/**
 * FINAL30 staff adapter core.
 *
 * READ adapters are PROPOSED (they do not exist in the backend): the original staff pages
 * read their data inside React Server Components, so there is no existing HTTP read contract.
 * Every consumer fails closed: wrong version/kind/shape => ApiError 502.
 * MUTATIONS never use a proposed path; they call the original API handlers inspected in the
 * source snapshot (see docs/final30/ADAPTERS_REQUIRED.md).
 */
export const STAFF_VIEW='/api/frontend/staff';
export const ROLES=Object.freeze(['student','teacher','admin','owner','guardian']);
export const STATUSES=Object.freeze(['pending','active','rejected','suspended']);
export const ROLE_LABELS=Object.freeze({student:{en:'Student',uz:'Talaba'},teacher:{en:'Teacher',uz:"O'qituvchi"},admin:{en:'Admin',uz:'Administrator'},owner:{en:'Owner',uz:'Egasi'},guardian:{en:'Guardian',uz:'Ota-ona'}});
export const STATUS_LABELS=Object.freeze({pending:{en:'Pending review',uz:"Ko'rib chiqilmoqda",tone:'warn'},active:{en:'Active',uz:'Faol',tone:'good'},rejected:{en:'Rejected',uz:'Rad etilgan',tone:'bad'},suspended:{en:'Suspended',uz:"To'xtatilgan",tone:'bad'}});
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const bad=(code='invalid_staff_adapter')=>new ApiError(502,code);
export const isObj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
export const str=(v,{max=100000,nullable=false}={})=>{if(v===null&&nullable)return null;if(typeof v!=='string'||v.length>max)throw bad();return v;};
export const int=(v,{min=0,max=Number.MAX_SAFE_INTEGER}={})=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw bad();return v;};
export const bool=v=>{if(typeof v!=='boolean')throw bad();return v;};
export const oneOf=(v,list)=>{if(!list.includes(v))throw bad();return v;};
export const arr=(v,max=5000)=>{if(!Array.isArray(v)||v.length>max)throw bad();return v;};
export function date(v,{nullable=false}={}){if(v===null&&nullable)return null;if(typeof v!=='string')throw bad();const d=new Date(v);if(!Number.isFinite(d.getTime()))throw bad();return d;}
/** Fetch a proposed read DTO: {version:1,kind,data}. */
export async function staffData(kind,query={},signal){
 if(!/^[a-z0-9-]+$/.test(kind))throw new TypeError('Unknown staff view');
 const qs=new URLSearchParams();for(const [k,v] of Object.entries(query))if(v!==undefined&&v!==null&&v!=='')qs.set(k,String(v));
 const res=await api.request(`${STAFF_VIEW}/${kind}${[...qs].length?'?'+qs:''}`,{signal});
 if(!isObj(res)||res.version!==1||res.kind!==kind||!isObj(res.data))throw bad();
 return res.data;
}
/** Original source API call (existing handler). JSON only; the server stays authoritative. */
export function call(method,path,body,signal){return api.request(path,{method,body,signal});}
export function ok(res){if(!isObj(res)||res.ok===false||res.error!=null)throw bad('invalid_response');return res;}
/**
 * Raw JSON call that PRESERVES the response body (status + parsed JSON). The shared api-client keeps only
 * `error` when it is a string; several original handlers answer `{error:{code}}` (owner AI control) or a
 * redirect/non-JSON body, so a thin, equally strict transport is needed. Same-origin /api only, no-store,
 * no redirect following, bounded timeout, 401 => auth-failure event (same as api-client).
 */
export async function rawJson(method,path,body,signal,{fetcher=globalThis.fetch?.bind(globalThis),timeout=25000}={}){
 if(typeof path!=='string'||!path.startsWith('/api/')||/[\\\u0000-\u001f]/.test(path))throw new TypeError('Only same-origin /api paths accepted');
 const t=AbortSignal.timeout(timeout),s=signal?anySignal([signal,t]):t;
 const res=await fetcher(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:s});
 let data=null;if((res.headers.get('content-type')??'').includes('application/json')){try{data=await res.json();}catch{if(signal?.aborted)throw signal.reason;data=null;}}
 // A 401 normally means the session ended (global logout). `invalid_credentials` is the ownership-transfer
 // password re-check: a mistyped password must show a form error, NOT sign the owner out.
 if(res.status===401&&data?.error!=='invalid_credentials'&&typeof window!=='undefined')window.dispatchEvent(new Event('learners-area:auth-failure'));
 return {status:res.status,ok:res.ok,data};
}
export const brandPath=v=>{if(typeof v!=='string'||!/^\/brand\/[A-Za-z0-9._\-\/]+$/.test(v)||v.includes('..'))throw bad();return v;};
