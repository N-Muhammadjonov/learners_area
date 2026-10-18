import {LinkPending} from './link-pending.js';
import {el,listen} from '../../js/dom.js';
import {IconBell} from '../../js/generated/icons.js';
import {api} from '../../js/api-client.js';
export const CHANGED='learners-area:notifications-changed';
export function notificationBell({dict,signal}){
 const link=el('a',{href:'/app/notifications',class:'relative flex shrink-0 items-center justify-center rounded-[10px] border border-ink-100 text-ink-500 hover:bg-paper-sunken hover:text-ink-900',style:{width:'var(--icon-btn)',height:'var(--icon-btn)'}},IconBell({}));let request,revision=0;link.append(el('span',{class:'absolute bottom-0 right-0 rounded-full bg-paper-raised'},LinkPending({label:dict.common.loading})));
 function count(n){link.setAttribute('aria-label',`${dict.notifications.title} (${n})`);link.querySelector('[data-unread-count]')?.remove();if(n>0)link.append(el('span',{'data-unread-count':n,class:'absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-signal-600 px-1 text-[0.6875rem] font-medium text-signal-contrast'},n>99?'99+':n));}
 async function refresh(){if(document.visibilityState!=='visible')return;const v=++revision;request?.abort();request=new AbortController();const s=AbortSignal.any([signal,request.signal]);try{const data=await api.request('/api/notifications?count=1',{signal:s});if(v===revision&&!s.aborted&&data.ok!==false&&Number.isSafeInteger(data.unread)&&data.unread>=0)count(data.unread);}catch{}}
 listen(window,CHANGED,e=>{if(!Number.isSafeInteger(e.detail)||e.detail<0)return;revision++;request?.abort();count(e.detail);},signal);listen(document,'visibilitychange',refresh,signal);let channel=null;try{if(typeof BroadcastChannel==='function')channel=new BroadcastChannel(CHANGED);}catch{}const seen=new Set(),notice=id=>{if(typeof id==='string'){if(seen.has(id))return;seen.add(id);if(seen.size>64)seen.delete(seen.values().next().value);}void refresh();};if(channel)channel.onmessage=e=>notice(e.data?.id);listen(window,'storage',e=>{if(e.key===CHANGED&&e.newValue)notice(e.newValue);},signal);
 const timer=setTimeout(refresh,0),cleanup=()=>{clearTimeout(timer);request?.abort();channel?.close();};if(signal.aborted)cleanup();else signal.addEventListener('abort',cleanup,{once:true});count(0);return link;
}
