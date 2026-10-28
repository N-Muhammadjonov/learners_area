import {SectionEntryFrame} from './generated/SectionEntryFrame.js';
import {sectionEntryFrames} from './generated/section-entry.js';
import {workspaceKey} from './generated/interaction-navigation.js';
import {publishSessionEvent} from './session-events.js';
import {enableDiagnostics} from './diagnostics.js';
import {sessionPresentation} from './adapters/frontend.js';
import {dictionary,readPreferences} from './preferences.js';
import {privateScope} from './private-scope.js';
import {api} from './api-client.js';
import {watchAuthority} from './authority.js';
import {watchPresence} from './presence.js';
import {watchStudyTime} from './study-time.js';
import {moduleLayout} from '../modules/shell/module-layout.js';
import {createShell,focusFrame} from '../modules/shell/layout.js';
/** Shell and authority are separate lifetimes: focus routes retain the access gate. */
export function createWorkspace(root){let pendingScroll,lastPresentation,announced=false;let shell,shellController,session,key,locationKey,authorityController,authorityKey,release;const scroll=new Map();
 function closeShell(){shellController?.abort();shell=null;shellController=null;key=null;locationKey=null;pendingScroll=undefined;}
 function closeAuthority(){authorityController?.abort();authorityController=null;authorityKey=null;release?.();release=null;}
 function invalidate(){session=null;}
 async function prepare(context){const {url,signal}=context,{locale}=readPreferences(),dict=await dictionary(locale);
  if(signal.aborted)return {};if(!shell&&!root.childNodes.length){const routeKey=workspaceKey(url.pathname),frames=sectionEntryFrames(dict);root.replaceChildren(SectionEntryFrame({routeKey,frame:frames[routeKey]??frames.other,privateBoundary:true}));}
  if(!session||session.expiresAt*1000<=Date.now())try{session=await sessionPresentation(signal);}catch(e){if(e.status===401)return {redirect:'/login'};throw e;}
  if(signal.aborted)return {};
  const resolved=session,presentation=resolved.user.id+':'+resolved.user.role+':'+resolved.user.accountStatus;if(lastPresentation&&lastPresentation!==presentation){if(context.state)for(const k of Object.keys(context.state))delete context.state[k];privateScope.clear('authority-change');session=resolved;}lastPresentation=presentation;document.documentElement.lang=locale;
  if(session.expiresAt*1000<=Date.now()){session=null;return {redirect:'/login'};}
  if(url.pathname==='/pending'&&session.user.accountStatus==='active')return {redirect:'/app'};
  if(url.pathname!=='/pending'&&session.user.accountStatus!=='active')return {redirect:'/pending'};
  if(/^\/app\/owner(?:\/|$)/.test(url.pathname)&&session.user.role!=='owner')return {redirect:'/app'};
  if(/^\/app\/(teacher|management|admin)(?:\/|$)/.test(url.pathname)&&session.user.role==='student')return {redirect:'/app'};
  if(!announced){announced=true;publishSessionEvent('refresh');}privateScope.setScope(session.user.id);return {dict,locale,session,invalidateSession:()=>{session=null;}};
 }
 function ensureAuthority(context){const current=context.session;if(!current)return;const next=current.user.id+':'+current.user.role+':'+current.user.accountStatus+':'+current.expiresAt;
  if(authorityKey===next)return;closeAuthority();authorityController=new AbortController();authorityKey=next;const persistent={...context,signal:authorityController.signal,scope:privateScope,refresh:()=>{invalidate();return context.refresh();}};
  release=privateScope.own(()=>{session=null;api.clear();scroll.clear();closeShell();closeAuthority();root.replaceChildren();});watchAuthority(current,persistent);watchPresence(persistent);watchStudyTime(persistent);
 }
 function commit(staging,context){const {url}=context,protectedRoute=!!context.session;const ordinary=protectedRoute&&url.pathname.startsWith('/app')&&context.route?.layout!=='focus';
  if(!protectedRoute){closeShell();closeAuthority();session=null;privateScope.setScope(null);scroll.clear();root.replaceChildren(...staging.childNodes);return;}
  ensureAuthority(context);window.dispatchEvent(new Event('la:study-route'));if(context.session.diagnostics)void enableDiagnostics(context.signal);
  if(!ordinary){closeShell();const frame=context.route?.layout==='focus'?focusFrame(context,staging):staging;root.replaceChildren(...(frame===staging?staging.childNodes:[frame]));return;}
  const nextKey=context.session.user.id+':'+context.session.user.role+':'+context.locale;
  const priorScroll=pendingScroll??shell?.main.scrollTop??0;pendingScroll=undefined;shell?.end(true);
  if(shell&&locationKey)scroll.set(locationKey,priorScroll);while(scroll.size>40)scroll.delete(scroll.keys().next().value);
  if(!shell||nextKey!==key){const sidebarScroll=shell?.sidebar.scrollTop??0,focusIntent=shell?.preferenceFocus?.(),restoreLocaleFocus=!!shell?.host.contains(document.activeElement)&&document.activeElement.matches('[data-locale-switcher] button[lang]')||focusIntent?.locale===context.locale&&focusIntent?.path===url.pathname+url.search;closeShell();shellController=new AbortController();shell=createShell({...context,signal:shellController.signal,refresh:()=>{invalidate();return context.refresh();}});key=nextKey;root.replaceChildren(shell.host);shell.sidebar.scrollTop=sidebarScroll;if(restoreLocaleFocus)shell.host.querySelector('button[lang="'+context.locale+'"]')?.focus({preventScroll:true});}else shell.update(url,context.session.user,context.state);
  shell.outlet.replaceChildren(moduleLayout(context,[...staging.childNodes]));shell.attachModuleHeader?.(shell.outlet);locationKey=(context.historyKey??'')+url.pathname+url.search;const saved=context.preserveScroll?priorScroll:scroll.get(locationKey)??0;const target=shell.main;shell.main.scrollTop=saved;if(saved>0&&target.scrollTop<saved){const observer=new MutationObserver(()=>{if(!context.signal.aborted&&shell?.main===target&&target.scrollHeight-target.clientHeight>=saved){target.scrollTop=saved;observer.disconnect();clearTimeout(timer);}}),timer=setTimeout(()=>observer.disconnect(),5000);observer.observe(shell.outlet,{childList:true,subtree:true});context.signal.addEventListener('abort',()=>{observer.disconnect();clearTimeout(timer);},{once:true});}
 }
 function begin(url,signal,source){window.dispatchEvent(new Event('la:study-pause'));if(!shell)return;if(!url.pathname.startsWith('/app')){closeShell();closeAuthority();session=null;privateScope.setScope(null);api.clear();scroll.clear();root.replaceChildren();return;}pendingScroll??=shell.main.scrollTop;if(locationKey)scroll.set(locationKey,pendingScroll);shell.begin(url,signal,source);}
 return {prepare,commit,begin,updateLocation(context){if(!shell)return;if(locationKey)scroll.set(locationKey,shell.main.scrollTop);shell.updateLocation(context.url);locationKey=(context.historyKey??'')+context.url.pathname+context.url.search;},destroy(){closeShell();closeAuthority();session=null;privateScope.setScope(null);api.clear();},invalidate};
}
