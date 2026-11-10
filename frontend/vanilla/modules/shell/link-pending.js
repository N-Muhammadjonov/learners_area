import {el} from '../../js/dom.js';
/** Native source LinkPending; fast/cancelled navigation produces no spinner. */
export function LinkPending({label}){return el('span',{'data-link-pending-slot':'','data-pending-label':label,style:{display:'contents'}});}
export function beginLinkPending(anchor,signal){const slot=anchor?.querySelector('[data-link-pending-slot]');if(!slot||signal.aborted)return ()=>{};let finished=false;
 const stop=()=>{finished=true;clearTimeout(timer);slot.replaceChildren();signal.removeEventListener('abort',stop);};
 const timer=setTimeout(()=>{if(!finished&&!signal.aborted&&slot.isConnected)slot.replaceChildren(el('span',{role:'status',class:'ml-auto shrink-0','data-navigation-pending':''},el('span',{'aria-hidden':'true',class:'block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent'}),el('span',{class:'sr-only'},slot.dataset.pendingLabel)));},60);
 signal.addEventListener('abort',stop,{once:true});return stop;
}
