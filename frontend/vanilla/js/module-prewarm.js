import {eligibleIntentTarget,IDLE_SHELL_PREFETCH_ROUTES,IntentPrefetchBudget} from './generated/intent-prefetch.js';
/** Code-only adaptation of original intent policy. NO DTO/API/media/auth requests.
 * Browser module bytes are public code, not a private-data/route-view cache.
 *
 * High-probability learning destinations are warmed while the tab is idle, one at
 * a time, only while visible, online, on a non-2g connection, without Save-Data and
 * never while a foreground navigation is unresolved. Warming loads module code only:
 * the destination still reads its own data behind the same authorization gate. */
const IDLE_LEARNING_ROUTES=[...IDLE_SHELL_PREFETCH_ROUTES,'/app/writing','/app/vocabulary','/app/grammar/lessons','/app/progress','/app/mocks','/app/video-lessons','/app/speaking'];
export function modulePrewarm({root,routes,signal,window:win=window,document:doc=document,navigator:nav=navigator,clock=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 if(signal.aborted)return {warm:async()=>false,dispose(){}};
 const budget=new IntentPrefetchBudget();let timer,idleHandle,index=0,inflight=0,stopped=false,deferrals=0;
 // A flight in progress owns the main thread and the network; queue nothing behind it.
 const foreground=()=>!!doc.querySelector?.('[data-navigation-pending],[data-workspace-loading],[data-entry-frame]');
 const allowed=()=>!stopped&&!signal.aborted&&nav.onLine!==false&&doc.visibilityState==='visible'&&!foreground()&&!nav.connection?.saveData&&!['2g','slow-2g'].includes(nav.connection?.effectiveType);
 async function warm(raw){if(!allowed()||inflight>=2)return false;let target=eligibleIntentTarget(raw,win.location.origin,win.location.href);if(!target){try{const u=new URL(raw,win.location.origin);if(u.origin===win.location.origin&&u.pathname==='/app/writing'&&u.searchParams.size===1&&['lessons','exam','translation','typing','grade','activation','language-stealing'].includes(u.searchParams.get('tab'))&&!u.hash)target=u.pathname+u.search;}catch{}}const route=routes.find(r=>r.pattern===(target?.split('?')[0])&&r.protected&&!r.redirectOnly);if(!target||!route||!budget.take(target,clock()))return false;inflight++;
  try{const module=await route.load();if(allowed())await module.preload?.(new URL(target,win.location.origin));}catch{ /* A prewarm failure never blocks deliberate navigation. */ }finally{inflight--;}
  return true;
 }
 const intents=new Map();
 const intent=e=>{const a=e.target.closest?.('a[href],[data-navigation-route]');if(!a)return;clearTimer(intents.get(a));intents.delete(a);if(e.detail?.action!=='prepare'||![0,90].includes(e.detail.delay)||a.hasAttribute('download')||a.target&&a.target!=='_self'||!allowed())return;const timer=setTimer(()=>{intents.delete(a);if(a.isConnected&&root.contains(a))void warm(a.dataset.navigationRoute||a.href);},e.detail.delay);intents.set(a,timer);};
 root.addEventListener('learners-area:prefetch-intent',intent);
 // A busy/foreground tab defers idle warming, but only for a bounded number of
 // rounds so a tab left in the background never keeps a heartbeat of its own.
 function idle(){if(stopped||signal.aborted)return;const retry=()=>{if(index<IDLE_LEARNING_ROUTES.length&&deferrals<6)timer=setTimer(idle,1500);};if(!allowed()){deferrals++;retry();return;}deferrals=0;
  const run=()=>{idleHandle=null;if(stopped||signal.aborted)return;if(!allowed()){retry();return;}const target=IDLE_LEARNING_ROUTES[index++];if(target)void warm(target);if(index<IDLE_LEARNING_ROUTES.length)timer=setTimer(idle,1100);};
  if(win.requestIdleCallback)idleHandle=win.requestIdleCallback(run,{timeout:1500});else run();}
 if(allowed())timer=setTimer(idle,2500);
 function dispose(){stopped=true;clearTimer(timer);if(idleHandle!=null)win.cancelIdleCallback?.(idleHandle);for(const id of intents.values())clearTimer(id);intents.clear();root.removeEventListener('learners-area:prefetch-intent',intent);signal.removeEventListener('abort',dispose);}
 signal.addEventListener('abort',dispose,{once:true});return {warm,dispose};
}
