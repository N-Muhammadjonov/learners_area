import {navigationIntent} from '../../js/navigation-intent.js';
import {viewPrewarm} from '../../js/view-prewarm.js';
import {campusHeader} from '../campus/chrome.js';
import {workspaceAccent} from '../campus/workspace-palette.js';
import {enableDiagnostics,rootDiagnosticsEnabled} from '../../js/diagnostics.js';
import {beginLinkPending} from './link-pending.js';
import {workspaceTransition} from './transition.js';
import {modulePrewarm} from '../../js/module-prewarm.js';
import routes from '../../js/routes.js';
import {el} from '../../js/dom.js';
import {controls} from '../../js/components/controls.js';
import {globalSearch} from './search.js';
import {profileMenu} from './profile.js';
import {shellUtilities} from './utilities.js';
import {sectionHeader} from './section-header.js';
import {notificationBell} from './notifications.js';
import {moduleDock} from './dock.js';

/** Shared controls for ordinary workspaces and detached focus route frames. */
export function createTopbar(context){
 const top=el('header',{'data-shell-topbar':'',class:'native-topbar bg-paper-raised'});
 const search=globalSearch(context),profile=profileMenu(context),pref=controls(context);
 pref.className='native-topbar-preferences';pref.removeAttribute('data-auth-controls');
 pref.setAttribute('data-campus-header-preferences','');
 top.append(el('div',{'data-campus-header-search':''},search.node),pref,
  el('div',{'data-campus-header-profile':''},notificationBell(context),profile.node));
 const chrome=campusHeader(top,context);
 chrome.update(context.url);return {top,chrome,search,profile,pref};
}

/** Reading's timed exam already owns its viewport/header; other focus details
 * get the same topbar without remounting their data, media, timers or drafts. */
export function focusFrame(context,staging){
 if(staging.querySelector('.reading-workspace-header')||(/^\/app\/reading\/attempts\/[^/]+$/.test(context.url.pathname)&&staging.querySelector('[data-reading-full-focus]'))){staging.append(shellUtilities(context).node);return staging;}
 const frame=el('div',{'data-shell':'','data-campus-shell':'','data-focus-workspace':'',class:'flex h-dvh min-h-0 flex-col overflow-hidden bg-paper'});
 frame.style.setProperty('--workspace-accent',workspaceAccent(context.url));
 const {top}=createTopbar(context),body=el('div',{'data-shell-main':'',class:'min-h-0 flex-1 overflow-auto'});
 body.append(...staging.childNodes);frame.append(top,body,shellUtilities(context).node);return frame;
}

/** Persistent controls and Dock; Management keeps its existing cards. */
export function createShell(context){
 const {signal}=context;
 if(context.session.diagnostics||rootDiagnosticsEnabled())void enableDiagnostics(signal,{shell:true});
 const host=el('div',{'data-shell':'','data-campus-shell':'','data-dock-shell':'',class:'flex h-dvh overflow-hidden bg-paper'});
 // Kept detached for the workspace scroll-state contract; no sidebar is rendered.
 const sidebar=el('aside');
 const column=el('div',{'data-dock-workspace':'',class:'flex min-h-0 min-w-0 flex-1 flex-col'});
 const {top,chrome,search,profile,pref}=createTopbar(context);
 const main=el('main',{id:'main-content',tabindex:-1,'data-shell-main':'',class:'min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-paper'});
 const outlet=el('div',{class:'mx-auto w-full',style:{maxWidth:'var(--shell-content-max)',paddingInline:'calc(var(--shell-pad-x) + env(safe-area-inset-left)) calc(var(--shell-pad-x) + env(safe-area-inset-right))',paddingBlock:'var(--shell-pad-y)',paddingBottom:'calc(var(--shell-pad-y) + env(safe-area-inset-bottom))'}});
 const transition=workspaceTransition(context);outlet.append(transition.node);main.append(outlet);
 const sections=sectionHeader(context);
 const band=el('div',{'data-workspace-header':''},top,sections.node);column.append(band,main);host.append(column);
 const utilities=shellUtilities(context),dock=moduleDock(context);host.append(dock.node,utilities.node);
 function update(url,user,state){host.style.setProperty('--workspace-accent',workspaceAccent(url));chrome.update(url);sections.update(url);if(state)pref.updateState?.(state);if(user)profile.update(user);profile.close();search.close(false);utilities.update(url);dock.update(url);}
 let stopPending=()=>{};
 function end(committed=false){stopPending(committed===true);transition.end();}
 signal.addEventListener('abort',()=>stopPending(),{once:true});
 modulePrewarm({root:host,routes,signal});viewPrewarm({root:host,signal});navigationIntent({root:host,signal});update(context.url);
 return {host,outlet:transition.content,main,sidebar,attachModuleHeader:sections.attach,openModule:url=>dock.open(column,url),preferenceFocus:()=>pref.preferenceFocus?.(),update,updateLocation(url){chrome.update(url);sections.updateLocation(url);profile.close();search.close(false);utilities.update(url);dock.update(url);},
  begin:(url,flight,source)=>{end();profile.close();search.close(false);
   const anchor=source?.isConnected?source:null;const stop=beginLinkPending(anchor,flight);
   const restore=()=>{stop();flight.removeEventListener('abort',restore);stopPending=()=>{};};
   stopPending=restore;flight.addEventListener('abort',restore,{once:true});dock.begin(url,flight,source,column);transition.begin(url,flight);},end};
}
