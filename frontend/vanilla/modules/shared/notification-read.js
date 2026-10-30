import {el,listen} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {CHANGED} from '../shell/notifications.js';
/** View-owned, visibility-bound acknowledgements. Never optimistic badge counts. */
export function notificationRead({ids,label,errorLabel,signal}){
 const host=el('div',{class:'flex flex-col items-start gap-2'}),button=el('button',{type:'button',class:'btn-secondary'},label),error=el('p',{role:'alert',hidden:true,class:'text-sm text-band-bad'});host.append(button,error);
 let observer,attachment,timer,attachDeadline,stopped=false,sending=false,allQueued=false;
 const queued=new Set(),seen=new Set(),unread=new Set(ids);
 function publish(n){const id=globalThis.crypto?.randomUUID?.()??Date.now()+'-'+Math.random();window.dispatchEvent(new CustomEvent(CHANGED,{detail:n}));try{if(typeof BroadcastChannel==='function'){const c=new BroadcastChannel(CHANGED);try{c.postMessage({id});}finally{c.close();}}}catch{}try{localStorage.setItem(CHANGED,id);localStorage.removeItem(CHANGED);}catch{}}
 async function flush(){
  if(stopped||signal.aborted||sending||(!allQueued&&(document.visibilityState!=='visible'||!queued.size)))return;
  sending=true;const all=allQueued;allQueued=false;const batch=[...queued];queued.clear();
  if(all){button.disabled=true;error.textContent='';error.hidden=true;button.setAttribute('aria-busy','true');}
  try{const data=await api.request('/api/notifications',{method:'POST',body:all?{all:true}:{ids:batch},signal});if(stopped||signal.aborted)return;
   if(data?.ok===false||!Number.isSafeInteger(data?.unread)||data.unread<0)throw Error('Invalid unread count');
   if(all){unread.clear();queued.clear();observer?.disconnect();}else for(const id of batch)unread.delete(id);
   publish(data.unread);
  }catch{if(!stopped&&!signal.aborted){error.textContent=errorLabel;error.hidden=false;}}
  finally{sending=false;if(!stopped){button.disabled=false;button.removeAttribute('aria-busy');if(allQueued||queued.size&&document.visibilityState==='visible')void flush();}}
 }
 listen(button,'click',()=>{if(button.disabled||allQueued||signal.aborted)return;allQueued=true;button.disabled=true;void flush();},signal);
 function attach(){if(stopped||signal.aborted)return;if(!host.isConnected||observer)return;
  attachment?.disconnect();clearTimeout(attachDeadline);if(typeof IntersectionObserver!=='function'||!unread.size)return;
  observer=new IntersectionObserver(entries=>{if(stopped||signal.aborted||document.visibilityState!=='visible')return;
   for(const e of entries){const id=e.target.dataset.notificationId;if(e.isIntersecting&&e.intersectionRatio>=.5&&unread.has(id)&&!seen.has(id)&&e.target.isConnected){queued.add(id);seen.add(id);observer.unobserve(e.target);}}
   clearTimeout(timer);timer=setTimeout(()=>void flush(),300);
  },{threshold:.5});
  // Scope to this inbox rather than another staged/previous route's rows.
  host.parentElement.querySelectorAll('[data-notification-id]').forEach(n=>{if(unread.has(n.dataset.notificationId)&&!seen.has(n.dataset.notificationId))observer.observe(n);});
 }
 if(unread.size){attachment=new MutationObserver(attach);attachment.observe(document.documentElement,{childList:true,subtree:true});attachDeadline=setTimeout(()=>attachment?.disconnect(),25000);queueMicrotask(attach);}
 listen(document,'visibilitychange',()=>{if(document.visibilityState==='visible'){observer?.disconnect();observer=null;attach();void flush();}},signal);
 signal.addEventListener('abort',()=>{stopped=true;clearTimeout(timer);clearTimeout(attachDeadline);observer?.disconnect();attachment?.disconnect();queued.clear();},{once:true});return host;
}
