import {audioResource,listeningAudio} from './audio-preload.js';
import {el} from '../../js/dom.js';

/** Reuse catalogue bytes, then recheck permission before native controls receive a Blob URL. */
export function mcqAudio({signal,dict},audioUrl){
 const resource=audioResource(audioUrl);if(!resource)return null;
 let host,url=null,retained=null,pending=false,failed=false,held=false,disposed=false;
 const wired=new WeakSet(),uz=()=>document.documentElement.lang.startsWith('uz');
 function bind(root){
  host=root;if(disposed)return;
  for(const audio of host.querySelectorAll('[data-mcq-audio]')){
   if(!wired.has(audio)){wired.add(audio);audio.addEventListener('error',()=>{if(disposed)return;url=null;failed=true;status();});}
   if(url){const target=url+'#t='+(Number(audio.dataset.mcqAt)||0);if(audio.getAttribute('src')!==target||audio.error){audio.src=target;audio.preload='auto';audio.load();}}
  }
  status();
 }
 function status(){
  if(!host||disposed)return;
  for(const audio of host.querySelectorAll('[data-mcq-audio]')){
   const old=audio.nextElementSibling?.hasAttribute('data-mcq-audio-status')?audio.nextElementSibling:null;
   if(url){old?.remove();continue;}
   const box=old??el('div',{'data-mcq-audio-status':'',role:'status',class:'mb-3 text-sm'});
   box.replaceChildren(document.createTextNode(failed?(uz()?'Audio yuklanmadi. ':'Audio could not load. '):(uz()?'Audio yuklanmoqda…':'Loading audio…')));
   if(failed){const retry=el('button',{type:'button',class:'btn-secondary'},dict.common.retry??dict.globalDictionary.retry);retry.addEventListener('click',()=>void prepare());box.append(retry);}
   if(!old)audio.after(box);
  }
 }
 async function prepare(){
  if(pending||disposed||signal.aborted)return;pending=true;failed=false;status();
  try{
   if(!held){const ready=await listeningAudio.acquire(resource,signal);if(!ready)throw Error('Audio unavailable');if(disposed||signal.aborted){listeningAudio.release(resource);return;}held=true;retained=ready;}
   const reply=await fetch(resource+'?capability=1',{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
   if(reply.status===401)window.dispatchEvent(new Event('learners-area:auth-failure'));
   if(!reply.ok)throw Error('Audio access unavailable');
   const grant=await reply.json();if(disposed||signal.aborted)return;
   if(!Number.isFinite(grant.expiresAt)||grant.expiresAt<=Date.now())throw Error('Expired audio access');
   // acquire pins this session-owned URL; grant.url never becomes a media src.
   url=retained;
   if(!url)throw Error('Audio unavailable');if(host)bind(host);
  }catch{if(!disposed&&!signal.aborted){failed=true;status();}}
  finally{pending=false;}
 }
 function dispose(){if(disposed)return;disposed=true;for(const a of host?.querySelectorAll('[data-mcq-audio]')??[]){a.pause();a.removeAttribute('src');a.load();}if(held)listeningAudio.release(resource);held=false;url=null;}
 signal.addEventListener('abort',dispose,{once:true});void prepare();return {bind,dispose};
}
