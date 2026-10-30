import {el,listen} from '../../js/dom.js';
import {rawJson} from '../../js/adapters/staff-final30/core.js';
import {privateScope} from '../../js/private-scope.js';
import {RegionFailureNotice,BackLink} from '../shared/presentation.js';
export {el,listen,BackLink};
/**
 * Shared FINAL30 staff presentation kit. Everything here is presentation: role gates only
 * mirror the source redirect (`/app`); the server re-derives authority for every request.
 */
let uid=0;export const nextId=p=>`${p}-${++uid}`;
/** Source apiErrorMessage(): localized sentence, raw codes never shown. */
export function errorText(error,dict,overrides){
 const t=dict.apiErrors,code=typeof error?.code==='string'?error.code:'';
 if(overrides&&code&&overrides[code])return overrides[code];
 if(['database_unavailable','storage_not_configured','storage_unavailable'].includes(code)&&dict.uploadErrors?.[code])return dict.uploadErrors[code];
 if(code==='unauthenticated')return t.unauthenticated;if(code==='forbidden')return t.forbidden;if(code==='not_found')return t.notFound;if(code==='rate_limited')return t.rateLimited;
 if(code==='conflict'||code==='already_decided')return t.conflict;if(code==='upload_not_owned_or_finalized')return t.uploadNotReady;if(code==='revision_managed')return t.revisionManaged;
 const s=error?.status;
 if(s===401)return t.unauthenticated;if(s===403)return t.forbidden;if(s===404)return t.notFound;if(s===409)return t.conflict;if(s===429)return t.rateLimited;
 if(s===400||s===422||code==='invalid_input')return t.invalid;return t.generic;
}
export const dateOnly=d=>d instanceof Date&&Number.isFinite(d.getTime())?d.toISOString().slice(0,10):'—';
/** Source lib/time.ts: centre timezone Asia/Tashkent, locale-aware (uz-UZ / en-GB). */
export function centreDateTime(d,locale){if(!(d instanceof Date)||!Number.isFinite(d.getTime()))return '';return new Intl.DateTimeFormat(locale==='uz'?'uz-UZ':'en-GB',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d);}
export const dateTime=d=>d instanceof Date&&Number.isFinite(d.getTime())?d.toISOString().slice(0,16).replace('T',' '):'—';
export const fill=(tpl,vars)=>Object.entries(vars).reduce((s,[k,v])=>s.split(`{${k}}`).join(String(v)),tpl);
export const loadingBlock=(dict,key)=>el('div',{role:'status','aria-busy':'true','aria-label':dict.common.loading,'data-async-loading':key,class:'h-40 animate-pulse rounded-xl bg-ink-50'});
export const heading=(title,sub)=>el('div',{},el('h1',{class:'font-display text-2xl text-ink-900'},title),sub?el('p',{class:'text-sm text-ink-500'},sub):null);
export const badge=(text,tone='neutral',attrs={})=>el('span',{class:'badge '+({good:'bg-band-good/10 text-band-good',bad:'bg-band-bad/10 text-band-bad',warn:'bg-band-warn/10 text-band-warn'}[tone]??'bg-ink-100 text-ink-500'),...attrs},text);
export function opening(d){typeof d.showModal==='function'?d.showModal():d.setAttribute('open','');}
export function closing(d){if(typeof d.close==='function')d.close();else{d.removeAttribute('open');d.dispatchEvent(new Event('close'));}}
/** Native ConfirmSelect: the select never shows the new value until the server accepted it. */
export function confirmSelect({signal,value,options,ariaLabel,disabled=false,title,description,confirmLabel,cancelLabel,pendingLabel,failureMessage,onConfirm,className='input w-32 text-xs'}){
 const id=nextId('cs');
 const select=el('select',{class:className,'aria-label':ariaLabel,disabled,'data-confirm-select':''},options.map(o=>el('option',{value:o.value,selected:o.value===value},o.label)));
 select.value=value;
 const failure=el('p',{role:'alert'},failureMessage),cancel=el('button',{type:'button'},cancelLabel),confirm=el('button',{type:'button',class:'btn-primary','data-confirm-action':'','data-interaction-type':'destructive'},confirmLabel);
 const dialog=el('dialog',{class:'interaction-confirm-dialog','aria-labelledby':id+'-t','aria-describedby':id+'-d'},el('h2',{id:id+'-t'},title),el('p',{id:id+'-d'},description),el('div',{class:'interaction-confirm-dialog__actions'},cancel,confirm));
 let requested=null,pending=false,current=value;
 const node=el('span',{'data-native-confirm':'',style:{display:'contents'}},select,dialog);
 const finish=restore=>{if(pending)return;requested=null;select.value=current;failure.remove();if(dialog.open||dialog.hasAttribute('open'))closing(dialog);if(restore&&select.isConnected)select.focus();};
 listen(select,'change',()=>{if(pending||signal?.aborted){select.value=current;return;}const next=select.value;select.value=current;if(next===current)return;requested=next;failure.remove();opening(dialog);confirm.focus();},signal);
 listen(cancel,'click',()=>finish(true),signal);listen(dialog,'cancel',e=>{e.preventDefault();finish(true);},signal);
 listen(confirm,'click',async()=>{if(pending||requested===null||signal?.aborted)return;pending=true;cancel.disabled=confirm.disabled=true;confirm.setAttribute('aria-busy','true');confirm.textContent=pendingLabel;const next=requested;
  try{await onConfirm(next);if(signal?.aborted)return;current=next;select.value=next;pending=false;finish(true);}
  catch{if(!signal?.aborted)dialog.insertBefore(failure,dialog.lastChild);}
  finally{pending=false;cancel.disabled=confirm.disabled=false;confirm.removeAttribute('aria-busy');confirm.textContent=confirmLabel;}},signal);
 signal?.addEventListener('abort',()=>{if(dialog.open||dialog.hasAttribute('open'))closing(dialog);dialog.remove();},{once:true});
 return {node,select,dialog,confirm,cancel};
}
/** Pagination navigation, source `<nav aria-label>` with previous/next anchors. */
export function pager({label,page,totalPages,href,pageOf,previous,next,attr}){
 if(totalPages<=1)return null;
 return el('nav',{class:'flex flex-wrap items-center justify-between gap-3','aria-label':label,[attr]:''},el('span',{class:'text-sm text-ink-500'},fill(pageOf,{page,total:totalPages})),el('div',{class:'flex gap-2'},page>1?el('a',{href:href(page-1),class:'btn-secondary'},previous):null,page<totalPages?el('a',{href:href(page+1),class:'btn-secondary'},next):null));
}
export function pageParam(url,key='page'){const n=Number(url.searchParams.get(key));return Number.isSafeInteger(n)&&n>0?Math.min(n,100000):1;}
/**
 * mountStaff: role gate -> loading -> data -> render, with retry, auth failure handling, stale-response
 * protection and abort cleanup. `render(ctx,data,api)` returns a Node; api.reload({quiet}) refetches
 * (router.refresh() equivalent) and api.rerender() repaints from current data.
 */
export function mountStaff({name,roles,load,render,notFoundBack,pollMs=0}){
 return async function mount(ctx){
  const {root,signal,dict,session,navigate}=ctx;
  if(!roles.includes(session.user.role)){void navigate('/app',{replace:true});return;}
  const host=el('div',{'data-staff-view':name});root.append(host);
  let serial=0,data,focusKey;
  const paint=()=>{const active=document.activeElement,key=active?.getAttribute?.('data-focus-key');host.replaceChildren(render(ctx,data,api));if(key){const n=host.querySelector(`[data-focus-key="${key}"]`);n?.focus();try{if(n&&typeof n.value==='string'&&n.setSelectionRange)n.setSelectionRange(n.value.length,n.value.length);}catch{/* type=number/email have no selection API */}}};
  async function reload({quiet=false}={}){
   const id=++serial;if(!quiet||data===undefined)host.replaceChildren(loadingBlock(dict,name));
   try{const next=await load(ctx);if(signal.aborted||id!==serial)return;data=next;paint();}
   catch(e){if(signal.aborted||id!==serial)return;
    if(e?.status===401){privateScope.setScope(null);void navigate('/login',{replace:true});return;}
    if(e?.status===403){void navigate('/app',{replace:true});return;}
    if(e?.status===404){host.replaceChildren(el('div',{'data-staff-not-found':name,class:'mx-auto flex max-w-xl flex-col gap-3'},el('h1',{class:'font-display text-2xl text-ink-900'},dict.errors.notFound),notFoundBack?BackLink({fallbackHref:notFoundBack.href,label:notFoundBack.label}):null));return;}
    if(quiet&&data!==undefined){return;}
    host.replaceChildren(el('div',{'data-integration-required':name},RegionFailureNotice({region:name,message:dict.auth.errorServer,retryLabel:dict.common.retry,refresh:()=>reload()})));}
  }
  const api={reload,rerender:()=>{if(data!==undefined&&!signal.aborted)paint();},get data(){return data;}};
  signal.addEventListener('abort',()=>{serial++;host.remove();},{once:true});
  await reload();
  if(pollMs&&!signal.aborted){const timer=setInterval(()=>{if(document.visibilityState!=='hidden'&&!(host.contains(document.activeElement)&&document.activeElement.matches('input,textarea,select,[contenteditable=true]'))&&!host.querySelector('dialog[open],[aria-busy=true]'))void reload({quiet:true});},pollMs);signal.addEventListener('abort',()=>clearInterval(timer),{once:true});}
 };
}
/**
 * Publication control (source components/admin/PublicationControl.tsx) — ONE control for every content type.
 * The server owns the transition rule (canTransition), the schedule rule, publish-blockers and the audit row; this only
 * collects intent and reports the refusal. Issue sentences are localized here; raw codes are never shown.
 */
export function publicationControl(ctx,{type,id,state,publishAt,issueLabels,onSaved}){
 const {dict,signal}=ctx,t=dict.admin.publication;
 const toLocal=v=>{if(!v)return '';const d=new Date(v);if(Number.isNaN(d.getTime()))return '';const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;};
 const S={next:state,moment:toLocal(publishAt),busy:false,message:null,issues:[]};
 const host=el('div',{class:'flex flex-wrap items-center gap-2','data-publication-control':id});
 const tone={published:'bg-band-good/15 text-band-good',scheduled:'bg-gold/20 text-ink-900',draft:'bg-paper-sunken text-ink-500',archived:'bg-paper-sunken text-ink-300'};
 const paint=()=>{
  const sel=el('select',{class:'input max-w-[9rem] py-1 text-xs','aria-label':t.changeState,disabled:S.busy},['draft','scheduled','published','archived'].map(s=>el('option',{value:s},t.states[s])));sel.value=S.next;
  listen(sel,'change',()=>{S.next=sel.value;S.message=null;paint();},signal);
  const when=S.next==='scheduled'?el('input',{type:'datetime-local',class:'input max-w-[12rem] py-1 text-xs','aria-label':t.publishAt,disabled:S.busy}):null;if(when){when.value=S.moment;listen(when,'input',()=>{S.moment=when.value;},signal);}
  const save=el('button',{type:'button',class:'btn-secondary px-3 py-1 text-xs','data-publication-save':'',disabled:S.busy},S.busy?t.saving:t.save);listen(save,'click',()=>void doSave(),signal);
  host.replaceChildren(el('span',{class:`badge ${tone[state]}`,'data-publication-state':state},t.states[state]),sel,when,save,
   S.message==='saved'?el('span',{class:'text-xs text-band-good','data-publication-result':'saved'},t.saved):null,S.message==='error'?el('span',{class:'text-xs text-band-bad','data-publication-result':'error'},t.failed):null,
   S.issues.length?el('ul',{class:'w-full list-disc pl-5 text-xs text-band-bad','data-publication-issues':''},S.issues.map(i=>el('li',{},i))):null);
 };
 async function doSave(){
  if(S.busy||signal.aborted)return;
  let at=null;if(S.next==='scheduled'&&S.moment){const d=new Date(S.moment);if(!Number.isFinite(d.getTime())){S.message='error';paint();return;}at=d.toISOString();}
  S.busy=true;S.message=null;S.issues=[];paint();
  try{
   const r=await rawJson('POST',`/api/admin/content/${encodeURIComponent(type)}/${id}/publication`,{state:S.next,publishAt:at},signal);
   if(signal.aborted)return;S.busy=false;
   if(!r.ok){const d=r.data??{};
    if(d.error==='incomplete_mcq_day')S.issues=[dict.listening.mcqProgram.publishRequiresFive,...(Number.isFinite(d.present)&&Number.isFinite(d.required)?[dict.listening.mcqProgram.publishHolds.replace('{present}',String(d.present)).replace('{required}',String(d.required))]:[]),...(Array.isArray(d.issues)?d.issues.filter(x=>typeof x==='string'):[])];
    else if(Array.isArray(d.blockers)&&d.blockers.length){const l=dict.listeningImport;S.issues=d.blockers.map(b=>(b?.kind==='transcript_missing'?l.blockMissing:l.blockReview).replace('{n}',String(b?.section??'?')));}
    else if(issueLabels&&Array.isArray(d.issues))S.issues=d.issues.map(c=>issueLabels[c]).filter(Boolean);
    S.message='error';paint();return;}
   S.message='saved';paint();await onSaved?.();
  }catch{if(signal.aborted)return;S.busy=false;S.message='error';paint();}
 }
 paint();return host;
}

/** Safe append: flattens arrays, skips null/undefined/false, turns strings into text (native append() would print "null" and "[object …]"). */
export function put(parent,...kids){for(const k of kids.flat(Infinity)){if(k===null||k===undefined||k===false)continue;parent.append(k instanceof Node?k:String(k));}return parent;}

/** Safe replaceChildren: same null/array handling as put(). */
export function setChildren(parent,...kids){parent.replaceChildren();return put(parent,...kids);}
