import {sessionPresentation} from './adapters/frontend.js';
import {dictionary,readPreferences} from './preferences.js';
import {privateScope} from './private-scope.js';
import {api} from './api-client.js';
import {watchAuthority} from './authority.js';
import {createShell} from '../modules/shell/layout.js';
/** Shell and authority are separate lifetimes: focus routes retain the access gate. */
export function createWorkspace(root){let shell,shellController,session,key,locationKey,authorityController,authorityKey,release;const scroll=new Map();
 function closeShell(){shellController?.abort();shell=null;shellController=null;key=null;locationKey=null;}
 function closeAuthority(){authorityController?.abort();authorityController=null;authorityKey=null;release?.();release=null;}
 function invalidate(){session=null;privateScope.clear('authority-change');}
 async function prepare(context){const {url,signal}=context,{locale}=readPreferences(),dict=await dictionary(locale);
  if(!session||session.expiresAt*1000<=Date.now())try{session=await sessionPresentation(signal);}catch(e){if(e.status===401)return {redirect:'/login'};throw e;}
  if(signal.aborted)return {};
  if(session.expiresAt*1000<=Date.now()){session=null;return {redirect:'/login'};}
  if(url.pathname==='/pending'&&session.user.accountStatus==='active')return {redirect:'/app'};
  if(url.pathname!=='/pending'&&session.user.accountStatus!=='active')return {redirect:'/pending'};
  if(/^\/app\/owner(?:\/|$)/.test(url.pathname)&&session.user.role!=='owner')return {redirect:'/app'};
  if(/^\/app\/(teacher|management|admin)(?:\/|$)/.test(url.pathname)&&session.user.role==='student')return {redirect:'/app'};
  privateScope.setScope(session.user.id);return {dict,locale,session};
 }
 function ensureAuthority(context){const current=context.session;if(!current)return;const next=current.user.id+':'+current.user.role+':'+current.expiresAt;
  if(authorityKey===next)return;closeAuthority();authorityController=new AbortController();authorityKey=next;const persistent={...context,signal:authorityController.signal,scope:privateScope,refresh:()=>{invalidate();return context.refresh();}};
  release=privateScope.own(()=>{session=null;api.clear();scroll.clear();closeShell();closeAuthority();root.replaceChildren();});watchAuthority(current,persistent);
 }
 function commit(staging,context){const {url}=context,protectedRoute=!!context.session;const ordinary=protectedRoute&&url.pathname.startsWith('/app')&&context.route?.layout!=='focus';
  if(!protectedRoute){closeShell();closeAuthority();session=null;privateScope.setScope(null);scroll.clear();root.replaceChildren(...staging.childNodes);return;}
  ensureAuthority(context);
  if(!ordinary){closeShell();root.replaceChildren(...staging.childNodes);return;}
  const nextKey=context.session.user.id+':'+context.session.user.role+':'+context.locale;
  if(shell&&locationKey)scroll.set(locationKey,shell.main.scrollTop);while(scroll.size>40)scroll.delete(scroll.keys().next().value);
  if(!shell||nextKey!==key){closeShell();shellController=new AbortController();shell=createShell({...context,signal:shellController.signal,refresh:()=>{invalidate();return context.refresh();}});key=nextKey;root.replaceChildren(shell.host);}else shell.update(url);
  shell.outlet.replaceChildren(...staging.childNodes);locationKey=url.pathname+url.search;const saved=scroll.get(locationKey)??0;const target=shell.main;shell.main.scrollTop=saved;if(saved>0&&target.scrollTop<saved){const observer=new MutationObserver(()=>{if(!context.signal.aborted&&shell?.main===target&&target.scrollHeight-target.clientHeight>=saved){target.scrollTop=saved;observer.disconnect();clearTimeout(timer);}}),timer=setTimeout(()=>observer.disconnect(),5000);observer.observe(shell.outlet,{childList:true,subtree:true});context.signal.addEventListener('abort',()=>{observer.disconnect();clearTimeout(timer);},{once:true});}
 }
 return {prepare,commit,destroy(){closeShell();closeAuthority();session=null;privateScope.setScope(null);},invalidate};
}
