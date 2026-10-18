import {restoreWhenAttached,fieldSelection} from '../js/focus-restore.js';
import {el,listen} from '../js/dom.js';
import {viewData} from '../js/adapters/frontend.js';
import {reporterDTO,reportParams,fetchReport} from '../js/adapters/reports.js';
import {RegionFailureNotice} from './shared/presentation.js';
export async function mount(context){
 const {root,url,dict,locale,signal}=context,t=dict.reporter,role=context.session.user.role,query=(url.searchParams.get('q')??'').trim().slice(0,60);
 const {render}=await import('../js/generated/reports.js');if(signal.aborted)return;
 const host=el('div',{'data-reports-native':''});root.append(host);let loading=false,download=null,objectUrl=null,revokeTimer;
 function revoke(){clearTimeout(revokeTimer);if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}}
 signal.addEventListener('abort',()=>{download?.abort();revoke();},{once:true});
 async function load(){if(signal.aborted||loading)return;loading=true;host.setAttribute('aria-busy','true');host.replaceChildren(el('div',{role:'status','data-reports-loading':'',class:'h-32 animate-pulse rounded-xl bg-ink-50','aria-label':dict.common.loading}));
  try{const dto=reporterDTO(await viewData(url.pathname+url.search,signal),role,query);if(signal.aborted)return;
   const errorCode=url.searchParams.get('error'),node=render({dict,locale,role,query,...dto,errorText:Object.hasOwn(t.errors,errorCode)?t.errors[errorCode]:null});host.replaceChildren(node);
   const state=context.state??{},draft=state.reportDraft?.role===role?state.reportDraft.values:null;
   const search=node.querySelector('[data-reporter-student-search]');if(search){const input=search.querySelector('[name=q]');if(typeof state.reportSearchDraft==='string')input.value=state.reportSearchDraft;listen(input,'input',()=>state.reportSearchDraft=input.value,signal);}
   if(search)listen(search,'submit',e=>{e.preventDefault();const q=new FormData(search).get('q').trim().slice(0,60);void context.navigate('/app/reports'+(q?'?'+new URLSearchParams({q}):''));},signal);
   const form=node.querySelector('[data-reporter-form]'),button=form.querySelector('button[type=submit]'),error=el('p',{role:'alert','data-report-download-error':'',class:'text-sm text-band-bad'}),status=el('p',{role:'status','data-report-download-status':'',class:'text-sm text-ink-500'});let busy=false;
   const keys=['scope','subject','period','from','to','format','lang'];if(draft)for(const key of keys){const nodes=[...form.querySelectorAll('[name="'+key+'"]')],value=draft[key];for(const n of nodes){if(n.type==='radio')n.checked=n.value===value;else if(typeof value==='string'&&(n.tagName!=='SELECT'||[...n.options].some(o=>o.value===value)))n.value=value;}}
   const remember=()=>state.reportDraft={role,values:Object.fromEntries([...new FormData(form)].filter(([k])=>keys.includes(k)))};listen(form,'input',remember,signal);listen(form,'change',remember,signal);
   if(state.reportFocus){const saved=state.reportFocus;delete state.reportFocus;restoreWhenAttached([...node.querySelectorAll('[name]')].find(n=>n.name===saved.name&&(n.type!=='radio'||n.value===saved.value)),signal,saved);}
   signal.addEventListener('abort',()=>{const focused=document.activeElement;if(signal.reason==='route-refresh'&&node.contains(focused)&&focused.name)state.reportFocus={name:focused.name,value:focused.value,...fieldSelection(focused)};else delete state.reportFocus;},{once:true});
   listen(form,'submit',async e=>{e.preventDefault();if(busy||signal.aborted)return;error.remove();status.remove();let params;
    try{params=reportParams(Object.fromEntries(new FormData(form)),{role,students:dto.students});}catch(err){error.textContent=Object.hasOwn(t.errors,err.code)?t.errors[err.code]:t.errors.invalid_input;form.append(error);form.querySelector(err.code==='not_found'?'[name=subject]':err.code.startsWith('range_')||err.code==='invalid_date'?'[name=from]':'[name=scope]')?.focus();return;}
    busy=true;button.disabled=true;form.setAttribute('aria-busy','true');status.textContent=dict.common.loading;form.append(status);download=new AbortController();const flight=AbortSignal.any([signal,download.signal]);
    const cancel=el('button',{type:'button',class:'btn-secondary','data-report-cancel':''},dict.common.cancel);form.append(cancel);listen(cancel,'click',()=>download?.abort(),signal);
    try{const {blob,filename}=await fetchReport(params,{signal:flight,onUnauthorized:()=>window.dispatchEvent(new Event('learners-area:auth-failure'))});if(flight.aborted)return;revoke();objectUrl=URL.createObjectURL(blob);const link=el('a',{href:objectUrl,download:filename,hidden:true});document.body.append(link);try{link.click();}finally{link.remove();}revokeTimer=setTimeout(revoke,1000);
    }catch(err){if(!flight.aborted){error.textContent=Object.hasOwn(t.errors,err.code)?t.errors[err.code]:t.errors.generation_failed;form.append(error);}}
    finally{busy=false;download=null;cancel.remove();status.remove();if(!signal.aborted){button.disabled=false;form.removeAttribute('aria-busy');if(document.activeElement===document.body)button.focus({preventScroll:true});}}
   },signal);
  }catch{if(!signal.aborted)host.replaceChildren(RegionFailureNotice({region:'reports',message:dict.auth.errorServer,retryLabel:dict.common.retry,refresh:load}));}
  finally{loading=false;if(!signal.aborted)host.setAttribute('aria-busy','false');}
 }
 void load();
}
export function preload(){return import('../js/generated/reports.js');}
