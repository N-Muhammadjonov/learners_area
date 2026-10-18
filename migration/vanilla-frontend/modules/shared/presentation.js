import {h} from '../../js/native.js';
export function BackLink({fallbackHref,label,className,...data}){const a=h('a',{...data,href:fallbackHref,className:className??'btn-ghost inline-flex min-h-11 w-fit items-center gap-1','data-back-link':true},h('span',{'aria-hidden':true},'←'),label);a.addEventListener('click',e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||history.length<=1)return;try{if(new URL(document.referrer).origin!==location.origin)return;}catch{return;}e.preventDefault();history.back();});return a;}
export function Button({variant='primary',children,...props}){return h('button',{type:'button',...props,className:`btn-${variant} ${props.className??''}`},children);}
export function RegionFailureNotice({region,message,retryLabel,refresh}){
 const b=h('button',{type:'button',className:'btn-secondary shrink-0','data-region-retry':region},retryLabel);
 let busy=false;b.addEventListener('click',async()=>{if(busy)return;busy=true;b.disabled=true;b.setAttribute('aria-busy','true');try{if(refresh)await refresh();else location.reload();}catch{ /* Existing notice remains visible for a deliberate retry. */ }finally{busy=false;b.disabled=false;b.removeAttribute('aria-busy');}});
 return h('div',{'data-region-failure':region,'data-secondary-region-error':region,role:'alert',className:'flex flex-wrap items-center justify-between gap-3 rounded-md border border-band-bad/30 bg-band-bad/5 px-3 py-2 text-sm'},h('span',{className:'text-ink-700'},message),b);
}
