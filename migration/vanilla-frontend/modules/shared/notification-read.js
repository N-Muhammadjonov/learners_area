import {el,listen} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {CHANGED} from '../shell/notifications.js';
export function notificationRead({ids,label,errorLabel,signal}){
 const host=el('div',{class:'flex flex-col items-start gap-2'}),button=el('button',{type:'button',class:'btn-secondary'},label),error=el('p',{role:'alert',class:'text-sm text-band-bad'});host.append(button,error);let observer,timer,stopped=false;const queued=new Set(),unread=new Set(ids);
 function publish(n){window.dispatchEvent(new CustomEvent(CHANGED,{detail:n}));if(typeof BroadcastChannel==='function'){const c=new BroadcastChannel(CHANGED);c.postMessage('refresh');c.close();}}
 async function send(body){try{const data=await api.request('/api/notifications',{method:'POST',body,signal});if(!signal.aborted)publish(data.unread);}catch{if(!signal.aborted)error.textContent=errorLabel;}}
 const flush=()=>{if(document.visibilityState!=='visible'||!queued.size)return;const ids=[...queued];queued.clear();void send({ids});};
 listen(button,'click',async()=>{button.disabled=true;error.textContent='';try{await send({all:true});}finally{button.disabled=false;}},signal);
 // Views are built off-DOM. Observe only after the router commits the nodes.
 function attach(){if(stopped)return;if(!host.isConnected){timer=setTimeout(attach,16);return;}if(typeof IntersectionObserver!=='function'||!unread.size)return;observer=new IntersectionObserver(entries=>{for(const e of entries){const id=e.target.dataset.notificationId;if(e.isIntersecting&&unread.has(id)){queued.add(id);observer.unobserve(e.target);}}clearTimeout(timer);timer=setTimeout(flush,300);},{threshold:.5});document.querySelectorAll('[data-notification-id]').forEach(n=>observer.observe(n));}
 attach();listen(document,'visibilitychange',flush,signal);signal.addEventListener('abort',()=>{stopped=true;clearTimeout(timer);observer?.disconnect();},{once:true});return host;
}
