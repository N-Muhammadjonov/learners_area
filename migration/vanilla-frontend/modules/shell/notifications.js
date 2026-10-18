import {el,listen} from '../../js/dom.js';
import {IconBell} from '../../js/generated/icons.js';
import {api} from '../../js/api-client.js';
export const CHANGED='learners-area:notifications-changed';
export function notificationBell({dict,signal}){
 const link=el('a',{href:'/app/notifications',class:'relative flex shrink-0 items-center justify-center rounded-[10px] border border-ink-100 text-ink-500 hover:bg-paper-sunken hover:text-ink-900',style:{width:'var(--icon-btn)',height:'var(--icon-btn)'}},IconBell({}));let request,revision=0;
 function count(n){link.setAttribute('aria-label',`${dict.notifications.title} (${n})`);link.querySelector('[data-unread-count]')?.remove();if(n>0)link.append(el('span',{'data-unread-count':n,class:'absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-signal-600 px-1 text-[0.6875rem] font-medium text-signal-contrast'},n>99?'99+':n));}
 async function refresh(){if(document.visibilityState!=='visible')return;const v=++revision;request?.abort();request=new AbortController();const s=AbortSignal.any([signal,request.signal]);try{const data=await api.request('/api/notifications?count=1',{signal:s});if(v===revision&&!s.aborted&&Number.isSafeInteger(data.unread)&&data.unread>=0)count(data.unread);}catch{}}
 listen(window,CHANGED,e=>{revision++;request?.abort();if(Number.isSafeInteger(e.detail))count(e.detail);},signal);listen(document,'visibilitychange',refresh,signal);const channel=typeof BroadcastChannel==='function'?new BroadcastChannel(CHANGED):null;if(channel)channel.onmessage=refresh;
 const timer=setTimeout(refresh,0);signal.addEventListener('abort',()=>{clearTimeout(timer);request?.abort();channel?.close();},{once:true});count(0);return link;
}
