import {viewData,cacheableView} from './adapters/frontend.js';
import {eligibleIntentTarget,IntentPrefetchBudget} from './generated/intent-prefetch.js';
import {privateScope} from './private-scope.js';
/** Deliberate hover/focus only: one bounded, cancellable authorised catalogue read. */
export function viewPrewarm({root,signal}){
 const budget=new IntentPrefetchBudget(),timers=new Map();let inflight=0;
 const allowed=()=>!signal.aborted&&!!privateScope.scope&&navigator.onLine!==false&&document.visibilityState==='visible'&&!navigator.connection?.saveData&&!['2g','slow-2g'].includes(navigator.connection?.effectiveType);
 function intent(event){const a=event.target.closest?.('a[href],[data-navigation-route]');if(!a)return;clearTimeout(timers.get(a));timers.delete(a);
  if(event.detail?.action!=='prepare'||![0,90].includes(event.detail.delay)||!allowed())return;
  const target=eligibleIntentTarget(a.dataset.navigationRoute||a.href,window.location.origin,window.location.href);
  if(!target||!cacheableView(target))return;
  timers.set(a,setTimeout(async()=>{timers.delete(a);if(!allowed()||!root.contains(a)||inflight>=1||!budget.take(target,Date.now()))return;inflight++;try{if(target==='/app/dashboard')await Promise.all(['dashboard','openLessons','mock'].map(region=>viewData(target,signal,region)));else await viewData(target,signal);}catch{/* Navigation always retries failures. */}finally{inflight--; }},event.detail.delay));
 }
 root.addEventListener('learners-area:prefetch-intent',intent);
 signal.addEventListener('abort',()=>{for(const id of timers.values())clearTimeout(id);timers.clear();root.removeEventListener('learners-area:prefetch-intent',intent);},{once:true});
}
