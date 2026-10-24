import {anySignal} from '../../js/signals.js';
import {el,listen} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {RegionFailureNotice,BackLink} from '../shared/presentation.js';

export {el,listen,BackLink};
export const WRITING_TABS=['lessons','exam','translation','typing','topic-vocabulary','grade','activation','language-stealing'];
export const uuid=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export const d=(source,path,fallback='')=>path.split('.').reduce((v,k)=>v?.[k],source)??fallback;
export const label=(ctx,path,fallback='')=>d(ctx.dict,path,fallback);
export const txt=v=>v==null?'':String(v);
export const words=s=>String(s??'').trim().split(/\s+/).filter(Boolean).length;
export const fill=(s,v={})=>String(s??'').replace(/\{(\w+)\}/g,(_,k)=>txt(v[k]));
export const state=(message,role='status')=>el('p',{role,class:'text-sm text-ink-500'},txt(message));
export const link=(href,text,className='btn-secondary')=>el('a',{href,class:className},text);
export const button=(text,cb,{cls='btn-primary',signal,attrs={}}={})=>{const b=el('button',{type:'button',class:cls,...attrs},text);b.addEventListener('click',cb,{signal});return b;};
export const card=(...content)=>el('section',{class:'card flex flex-col gap-4 p-5'},...content);
export const notice=(ctx,region,retry)=>RegionFailureNotice({region,message:ctx.dict.auth?.errorServer??ctx.dict.common?.error??'Unable to load',retryLabel:ctx.dict.errorPage?.retry??ctx.dict.common?.retry??'Retry',refresh:retry});
export const missing=ctx=>el('section',{class:'card flex flex-col gap-3 p-6','data-writing-not-found':''},el('h1',{class:'font-display text-xl'},ctx.dict.notFoundPage?.title??'Not found'),link('/app/writing',ctx.dict.common?.back??'Back'));
export async function view(ctx){return viewData(ctx.url.pathname+ctx.url.search,ctx.signal);}
export function viewRegion(ctx,host,region,render){let busy=false;async function load(){if(busy||ctx.signal.aborted)return;busy=true;host.replaceChildren(state(ctx.dict.common.loading));try{const data=await view(ctx);if(ctx.signal.aborted)return;if(data?.kind==='not_found'){host.replaceChildren(missing(ctx));return;}await render(data,load);}catch(error){if(ctx.signal.aborted)return;if(error.status===404)host.replaceChildren(missing(ctx));else host.replaceChildren(notice(ctx,region,load));}finally{busy=false;}}void load();return load;}
/** Writing's original APIs return both string and {code,message} error envelopes.
 * Preserve those codes without altering the shared Listening/Reading API client.
 * Mutations are never auto-retried; a 200 {ok:false,id} grade result is a
 * persisted, navigable request and is returned as data (not as an exception).
 */
export async function post(ctx,path,body,method='POST',timeoutMs=25000){
 if(typeof path!=='string'||!path.startsWith('/api/')||/[\\\u0000-\u001f]/.test(path))throw new TypeError('Only same-origin API requests are permitted');
 const timeout=AbortSignal.timeout(timeoutMs);
 const signal=ctx.signal?anySignal([ctx.signal,timeout]):timeout;
 const res=await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal});
 const data=await res.json().catch(()=>null);
 if(!res.ok){
  const code=typeof data?.error==='string'?data.error:(typeof data?.error?.code==='string'?data.error.code:'request_failed');
  const err=new Error(code);err.code=code;err.status=res.status;throw err;
 }
 if(!data||typeof data!=='object'){const err=new Error('invalid_response');err.code='invalid_response';err.status=res.status;throw err;}
 return data;
}
export const errMessage=(ctx,e)=>d(ctx.dict,`apiErrors.${e?.code}`)||d(ctx.dict,`auth.${e?.code}`)||ctx.dict.common?.error||'Request failed';
export function navBack(ctx,href='/app/writing'){return BackLink({fallbackHref:href,label:ctx.dict.common.back});}
export function inputLabel(name,value,cb,{type='text',rows=0,attrs={},signal}={}){
 const ctrl=rows?el('textarea',{class:'input w-full',rows,...attrs}):el('input',{class:'input w-full',type,...attrs});ctrl.value=txt(value);ctrl.addEventListener('input',()=>cb(ctrl.value),{signal});return el('label',{class:'flex flex-col gap-2 text-sm'},el('span',{class:'font-medium'},name),ctrl);
}
export function safeArray(v){return Array.isArray(v)?v:[];}
export function loadStyle(){if(document.querySelector('[data-writing-css]'))return;const l=el('link',{rel:'stylesheet',href:'/modules/writing/writing.css','data-writing-css':''});document.head.append(l);}
export function preventStale(ctx){let generation=0;return{issue(){return ++generation},current(token){return token===generation&&!ctx.signal.aborted},invalidate(){generation++}};}
