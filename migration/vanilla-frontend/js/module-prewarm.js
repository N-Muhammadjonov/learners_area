import {eligibleIntentTarget,IDLE_SHELL_PREFETCH_ROUTES,IntentPrefetchBudget} from './generated/intent-prefetch.js';
/** Code-only adaptation of original intent policy. NO DTO/API/media/auth requests.
 * Browser module bytes are public code, not a private-data/route-view cache. */
export function modulePrewarm({root,routes,signal,window:win=window,document:doc=document,navigator:nav=navigator,clock=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 const budget=new IntentPrefetchBudget();let timer,index=0,inflight=0,stopped=false;
 const allowed=()=>!stopped&&!signal.aborted&&nav.onLine!==false&&doc.visibilityState==='visible'&&!nav.connection?.saveData&&!['2g','slow-2g'].includes(nav.connection?.effectiveType);
 async function warm(raw){if(!allowed()||inflight>=2)return false;const target=eligibleIntentTarget(raw,win.location.origin,win.location.href),route=routes.find(r=>r.pattern===target&&r.protected&&!r.redirectOnly);if(!target||!route||!budget.take(target,clock()))return false;inflight++;
  try{const module=await route.load();if(allowed())await module.preload?.(new URL(target,win.location.origin));}catch{ /* A prewarm failure never blocks deliberate navigation. */ }finally{inflight--;}
  return true;
 }
 const intent=e=>{const a=e.target.closest?.('a[href]');if(a&&!a.target&&!a.hasAttribute('download'))void warm(a.href);};
 root.addEventListener('pointerover',intent);root.addEventListener('focusin',intent);
 function idle(){if(!allowed())return;const target=IDLE_SHELL_PREFETCH_ROUTES[index++];if(target)void warm(target);if(index<IDLE_SHELL_PREFETCH_ROUTES.length)timer=setTimer(idle,1100);}
 if(allowed())timer=setTimer(idle,2500);
 function dispose(){stopped=true;clearTimer(timer);root.removeEventListener('pointerover',intent);root.removeEventListener('focusin',intent);signal.removeEventListener('abort',dispose);}
 signal.addEventListener('abort',dispose,{once:true});return {warm,dispose};
}
