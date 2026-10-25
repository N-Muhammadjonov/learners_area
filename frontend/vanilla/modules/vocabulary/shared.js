import {readCatalogue} from '../../js/catalogue-cache.js';
/** Source-led, native DOM Vocabulary presentation; no Next/React, HTML injection, or private persistent storage. */
import {h} from '../../js/native.js';
import {api,ApiError} from '../../js/api-client.js';
export {h,ApiError};
export const TABS=['words','revision','games','use','board','dictionary'];
export const GAMES=['cards','choice','match','gap','race','translation','builder'];
export const SETS=['all','due','weak','reading','listening','topic','folder','assigned'];
export const PAGE_SIZE=50;
export const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const tx=(dict,...path)=>path.reduce((x,key)=>x?.[key],dict)??path.at(-1);
export const elem=(tag,props={},...children)=>h(tag,props,children);
export const card=(...content)=>h('section',{class:'card min-w-0 space-y-3 p-4'},content);
export const button=(label,handler,attrs={})=>h('button',{type:'button',class:'btn-secondary min-h-[40px]',...attrs,onClick:handler},label);
export const primary=(label,handler,attrs={})=>button(label,handler,{class:'btn-primary min-h-[40px]',...attrs});
export const select=(label,choices,onChange,value)=>h('label',{class:'flex flex-col gap-1 text-xs text-ink-500'},label,h('select',{class:'input w-full',onChange:e=>onChange(e.target.value),value},choices.map(x=>h('option',{value:x.value},x.label))));
export const notice=(text,kind='status')=>h('p',{role:kind,class:kind==='alert'?'text-sm text-band-bad':'text-sm text-ink-500'},text);
export const loading=(dict,key)=>h('div',{role:'status','aria-busy':'true','data-async-loading':`vocabulary-${key}`,class:'h-20 animate-pulse rounded-xl bg-ink-50'},dict.common.loading);
export const fail=(ctx,key,retry)=>h('div',{role:'alert','data-vocabulary-region-error':key,class:'flex flex-wrap gap-2 items-center rounded-md border border-band-bad/30 p-3'},notice(ctx.dict.errors.unknown),button(ctx.dict.errorPage.retry,()=>retry(),{'data-region-retry':key}));
export const chip=(value,active,click,attrs={})=>button(value,click,{class:`rounded-md px-3 py-2 text-xs ${active?'bg-signal-600 text-signal-contrast':'bg-paper-sunken text-ink-700'}`,'aria-pressed':String(active),...attrs});
export const fmt=(v,locale='en')=>{const d=new Date(v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(locale==='uz'?'uz-UZ':'en-GB',{year:'numeric',month:'short',day:'numeric',timeZone:'Asia/Tashkent'}).format(d):'—';};
export const collocations=s=>String(s??'').split(/\s*[·•|;]\s*/).map(v=>v.trim()).filter(Boolean);
export const parseBulk=s=>String(s).split(/\n+/).map(v=>v.trim()).filter(Boolean).map(line=>{const [term,definitionEn,translationUz]=line.split(/\s+[—–-]{1,2}\s+|\s*:\s*|\s*\|\s*/).map(x=>x.trim());return {term:term??'',definitionEn:definitionEn||term||'',translationUz:translationUz||null};}).filter(x=>x.term);
export const truth=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function inputLabel(label,opts={}){return h('label',{class:'flex min-w-0 flex-col gap-1 text-xs text-ink-500'},label,h('input',{class:'input w-full',...opts}));}
/** Strict JSON transport, server-owned score; no silent optimistic success. */
export async function request(path,{method='GET',body,signal,timeoutMs}={}){
 if(!/^\/api\/[A-Za-z0-9/?%=&._-]+$/.test(path))throw new TypeError('Invalid API path');
 const result=await (method==='GET'?readCatalogue(path,{signal,timeoutMs}):api.request(path,{method,body,signal,timeoutMs}));
 if(!truth(result)||result.ok===false||result.error)throw new ApiError(502,typeof result?.error==='string'?result.error:'invalid_response');
 return result;
}
/** Localized request status, no automatic retry. Cancellation prevents stale paint. */
export function region(ctx,host,key,loader,paint){let sequence=0;async function load(){const id=++sequence;host.replaceChildren(loading(ctx.dict,key));try{const data=await loader();if(ctx.signal.aborted||id!==sequence)return;host.replaceChildren(paint(data,load));}catch(e){if(ctx.signal.aborted||id!==sequence)return;host.replaceChildren(fail(ctx,key,load));}}ctx.signal.addEventListener('abort',()=>{++sequence;host.replaceChildren();},{once:true});void load();return load;}
export const params=q=>{const s=new URLSearchParams();for(const [key,v] of Object.entries(q))if(v!==undefined&&v!==null&&v!=='')s.set(key,String(v));return s.toString();};
export function guardArray(payload,name){if(!Array.isArray(payload?.[name]))throw new ApiError(502,'invalid_'+name);return payload[name];}
export function notifyLedger(){if(typeof window!=='undefined')window.dispatchEvent(new Event('vocab:ledger-changed'));}
export function keyboardButton(e,handler){if(e.key==='Enter'||e.key===' '){e.preventDefault();handler();}}
