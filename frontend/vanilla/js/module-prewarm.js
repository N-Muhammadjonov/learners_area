import {eligibleIntentTarget,IDLE_SHELL_PREFETCH_ROUTES,IntentPrefetchBudget} from './generated/intent-prefetch.js';
/** Code-only adaptation of original intent policy. NO DTO/API/media/auth requests.
 * Browser module bytes are public code, not a private-data/route-view cache. */
export function modulePrewarm({root,routes,signal,window:win=window,document:doc=document,navigator:nav=navigator,clock=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 if(signal.aborted)return {warm:async()=>false,dispose(){}};
 const budget=new IntentPrefetchBudget();let timer,idleHandle,grammarTimer,index=0,inflight=0,stopped=false;
 const constrained=()=>nav.connection?.saveData||['2g','slow-2g','3g'].includes(nav.connection?.effectiveType)||
  (typeof nav.deviceMemory==='number'&&nav.deviceMemory<=2)||
  (typeof nav.hardwareConcurrency==='number'&&nav.hardwareConcurrency<=2);
 const allowed=()=>!stopped&&!signal.aborted&&nav.onLine!==false&&doc.visibilityState==='visible'&&!constrained();
 async function warm(raw,automatic=false){if(!allowed()||inflight>=2)return false;let target=eligibleIntentTarget(raw,win.location.origin,win.location.href);if(!target){try{const u=new URL(raw,win.location.origin);if(u.origin===win.location.origin&&u.pathname==='/app/writing'&&u.searchParams.size===1&&['lessons','exam','translation','typing','grade','activation','language-stealing'].includes(u.searchParams.get('tab'))&&!u.hash)target=u.pathname+u.search;}catch{}}const route=routes.find(r=>r.pattern===(target?.split('?')[0])&&r.protected&&!r.redirectOnly);if(!target||!route||(!automatic&&!budget.take(target,clock())))return false;inflight++;
  try{const module=await route.load();if(!automatic&&allowed())await module.preload?.(new URL(target,win.location.origin));}catch{ /* A prewarm failure never blocks deliberate navigation. */ }finally{inflight--;}
  return true;
 }
 const intents=new Map();
 const intent=e=>{const a=e.target.closest?.('a[href],[data-navigation-route]');if(!a)return;clearTimer(intents.get(a));intents.delete(a);if(e.detail?.action!=='prepare'||![0,90].includes(e.detail.delay)||a.hasAttribute('download')||a.target&&a.target!=='_self'||!allowed())return;const timer=setTimer(()=>{intents.delete(a);if(a.isConnected&&root.contains(a))void warm(a.dataset.navigationRoute||a.href);},e.detail.delay);intents.set(a,timer);};
 root.addEventListener('learners-area:prefetch-intent',intent);
 function idle(){
  if(!allowed())return;
  const run=()=>{
    idleHandle=null;
    if(!allowed())return;
    const target=IDLE_SHELL_PREFETCH_ROUTES[index++];
    if(target)void warm(target,true).finally(()=>{
      if(index<IDLE_SHELL_PREFETCH_ROUTES.length&&allowed())timer=setTimer(idle,350);
    });
  };
  if(win.requestIdleCallback)idleHandle=win.requestIdleCallback(run,{timeout:1500});else run();
 }
 function warmBooks(){
  if(!allowed())return;
  void import('../modules/grammar/book-skill.js')
    .then(module=>module.warmSkillBooks(allowed))
    .catch(()=>{/* Optional public static material never blocks navigation. */});
 }
 if(allowed()){timer=setTimer(idle,2200);grammarTimer=setTimer(warmBooks,5000);}
 function dispose(){stopped=true;clearTimer(timer);clearTimer(grammarTimer);if(idleHandle!=null)win.cancelIdleCallback?.(idleHandle);for(const id of intents.values())clearTimer(id);intents.clear();root.removeEventListener('learners-area:prefetch-intent',intent);signal.removeEventListener('abort',dispose);}
 signal.addEventListener('abort',dispose,{once:true});return {warm,dispose};
}
