import {SectionEntryFrame} from './generated/SectionEntryFrame.js';
import {sectionEntryFrames} from './generated/section-entry.js';
import {workspaceKey} from './generated/interaction-navigation.js';
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
export function createWorkspace(root){let pendingScroll,lastPresentation;let shell,shellController,session,key,locationKey,authorityController,authorityKey,release;const scroll=new Map();
 let lastDailyClaim='';
 function claimDailyCoins(current){
  if(current?.user?.role!=='student'||current.user.accountStatus!=='active')return;
  const stamp=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const identity=current.user.id+':'+stamp;
  if(lastDailyClaim===identity)return;
  lastDailyClaim=identity;
  void api.request('/api/coins/daily/claim',{method:'POST'}).catch(()=>{
   if(lastDailyClaim===identity)lastDailyClaim='';
  });
 }
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
  if(url.pathname.replace(/\/+$/,'')==='/app/management/guardians'&&session.user.role!=='owner')return {redirect:'/app/management'};
  if(session.user.role==='guardian'&&!['/app/progress','/app/leaderboard'].includes(url.pathname.replace(/\/+$/,'')))return {redirect:'/app/progress'};
  if(/^\/app\/owner(?:\/|$)/.test(url.pathname)&&session.user.role!=='owner')return {redirect:'/app'};
  if(/^\/app\/(teacher|management|admin)(?:\/|$)/.test(url.pathname)&&session.user.role==='student')return {redirect:'/app'};
  // Opening another document is not an account mutation. Broadcasting here
  // remounted active exams in every other tab, interrupting media and inputs.
  // Login, logout and profile mutations already publish their explicit hints;
  // the unchanged authority watcher still handles revocation and expiry.
  privateScope.setScope(session.user.id);return {dict,locale,session,invalidateSession:()=>{session=null;}};
 }
 function ensureAuthority(context){const current=context.session;if(!current)return;claimDailyCoins(current);const next=current.user.id+':'+current.user.role+':'+current.user.accountStatus+':'+current.expiresAt;
  if(authorityKey===next)return;closeAuthority();authorityController=new AbortController();authorityKey=next;const persistent={...context,signal:authorityController.signal,scope:privateScope,refresh:()=>{invalidate();return context.refresh();}};
  release=privateScope.own(()=>{session=null;api.clear();scroll.clear();closeShell();closeAuthority();root.replaceChildren();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')claimDailyCoins(current);},{signal:persistent.signal});
  watchAuthority(current,persistent);watchPresence(persistent);watchStudyTime(persistent);
 }
 function commit(staging,context){const {url}=context,protectedRoute=!!context.session;const ordinary=protectedRoute&&url.pathname.startsWith('/app')&&context.route?.layout!=='focus';
  if(!protectedRoute){closeShell();closeAuthority();session=null;privateScope.setScope(null);scroll.clear();root.replaceChildren(...staging.childNodes);return;}
  ensureAuthority(context);if(context.session.diagnostics)void enableDiagnostics(context.signal);
  if(!ordinary){closeShell();const frame=context.route?.layout==='focus'?focusFrame(context,staging):staging;root.replaceChildren(...(frame===staging?staging.childNodes:[frame]));return;}
  const nextKey=context.session.user.id+':'+context.session.user.role+':'+context.locale;
  const priorScroll=pendingScroll??shell?.main.scrollTop??0;pendingScroll=undefined;shell?.end(true);
  if(shell&&locationKey)scroll.set(locationKey,priorScroll);while(scroll.size>40)scroll.delete(scroll.keys().next().value);
  if(!shell||nextKey!==key){const sidebarScroll=shell?.sidebar.scrollTop??0,focusIntent=shell?.preferenceFocus?.(),restoreLocaleFocus=!!shell?.host.contains(document.activeElement)&&document.activeElement.matches('[data-locale-switcher] button[lang]')||focusIntent?.locale===context.locale&&focusIntent?.path===url.pathname+url.search;closeShell();shellController=new AbortController();shell=createShell({...context,signal:shellController.signal,refresh:()=>{invalidate();return context.refresh();}});key=nextKey;root.replaceChildren(shell.host);shell.sidebar.scrollTop=sidebarScroll;if(restoreLocaleFocus)shell.host.querySelector('button[lang="'+context.locale+'"]')?.focus({preventScroll:true});}else shell.update(url,context.session.user,context.state);
  shell.outlet.replaceChildren(moduleLayout(context,[...staging.childNodes]));shell.attachModuleHeader?.(shell.outlet);locationKey=(context.historyKey??'')+url.pathname+url.search;const saved=context.preserveScroll?priorScroll:scroll.get(locationKey)??0;const target=shell.main;
  // Restoring scrollTop forces a synchronous layout of the content inserted above, so the
  // write is skipped when neither the outgoing page nor this destination is scrolled, and
  // the offset is never read back here. Verification happens on the next frames, where a
  // clamped write is re-applied once the destination's height has settled.
  if(saved!==0||priorScroll!==0)target.scrollTop=saved;if(saved>0){let frames=0;const reached=()=>!context.signal.aborted&&shell?.main===target&&target.scrollTop>=saved;const apply=()=>{if(context.signal.aborted||shell?.main!==target)return true;if(target.scrollTop<saved&&target.scrollHeight-target.clientHeight>=saved)target.scrollTop=saved;return reached();};const observer=new MutationObserver(()=>{if(apply()){observer.disconnect();clearTimeout(timer);}}),timer=setTimeout(()=>observer.disconnect(),5000);observer.observe(shell.outlet,{childList:true,subtree:true});
  // A retained view is already hydrated, so no later mutation signals that its height settled.
  // Re-apply on the next frames (bounded) instead of waiting only for a childList change.
  const reframe=()=>{if(apply())return;if(++frames<6)requestAnimationFrame(reframe);};requestAnimationFrame(reframe);
  context.signal.addEventListener('abort',()=>{observer.disconnect();clearTimeout(timer);},{once:true});}
 }
 function begin(url,signal,source){if(!shell)return;if(!url.pathname.startsWith('/app')){closeShell();closeAuthority();session=null;privateScope.setScope(null);api.clear();scroll.clear();root.replaceChildren();return;}pendingScroll??=shell.main.scrollTop;if(locationKey)scroll.set(locationKey,pendingScroll);shell.begin(url,signal,source);}
 return {prepare,commit,begin,updateLocation(context){if(!shell)return;if(locationKey)scroll.set(locationKey,shell.main.scrollTop);shell.updateLocation(context.url);locationKey=(context.historyKey??'')+context.url.pathname+context.url.search;},destroy(){closeShell();closeAuthority();session=null;privateScope.setScope(null);api.clear();},invalidate};
}
