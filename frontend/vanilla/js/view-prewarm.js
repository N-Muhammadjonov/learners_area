import {readCatalogue} from './catalogue-cache.js';
import {viewData,cacheableView} from './adapters/frontend.js';
import {eligibleIntentTarget,IntentPrefetchBudget} from './generated/intent-prefetch.js';
import {privateScope} from './private-scope.js';
/** Deliberate hover/focus only: one bounded, cancellable authorised catalogue read. */
export function viewPrewarm({root,signal}){
 const budget=new IntentPrefetchBudget(),timers=new Map();let inflight=0,remaining=1024*1024,idleTimer,idleHandle,idleIndex=0;
 const allowed=()=>!signal.aborted&&remaining>0&&!!privateScope.scope&&navigator.onLine!==false&&document.visibilityState==='visible'&&!navigator.connection?.saveData&&!['2g','slow-2g'].includes(navigator.connection?.effectiveType);
 async function warm(target){if(!allowed()||inflight>=1||!budget.take(target,Date.now()))return;const capacity=Math.min(256*1024,remaining);inflight++;remaining-=capacity;try{const result=await viewData(target,signal,undefined,{maxBytes:capacity});remaining+=Math.max(0,capacity-JSON.stringify(result).length*2);}catch{}finally{inflight--;}}
 function intent(event){const a=event.target.closest?.('a[href],[data-navigation-route]');if(!a)return;clearTimeout(timers.get(a));timers.delete(a);
  if(event.detail?.action!=='prepare'||![0,90].includes(event.detail.delay)||!allowed())return;
  const target=eligibleIntentTarget(a.dataset.navigationRoute||a.href,window.location.origin,window.location.href);
  const vocabulary=target==='/app/vocabulary'||target==='/app/vocabulary/games';if(!target||!vocabulary&&!cacheableView(target))return;
  timers.set(a,setTimeout(async()=>{timers.delete(a);if(!allowed()||!root.contains(a)||inflight>=1)return;if(!vocabulary&&target!=='/app/dashboard'&&target!=='/app/progress'){await warm(target);return;}if(!budget.take(target,Date.now()))return;inflight++;try{const paths=vocabulary?['/api/vocabulary/folders','/api/vocabulary/packs',...(target==='/app/vocabulary'?['/api/vocabulary?limit=50&offset=0','/api/vocabulary/summary']:[])]:target==='/app/dashboard'?['dashboard','openLessons','mock']:['progressSummary','progressStreak','progressTrends','progressMocks'];for(const path of paths){if(!allowed())break;const capacity=Math.min(128*1024,remaining);remaining-=capacity;const result=vocabulary?await readCatalogue(path,{signal,maxBytes:capacity}):await viewData(target,signal,path,{maxBytes:capacity});remaining+=Math.max(0,capacity-JSON.stringify(result).length*2);}}catch{/* Navigation always retries failures. */}finally{inflight--; }},event.detail.delay));
 }
 root.addEventListener('learners-area:prefetch-intent',intent);
 const idle=()=>{if(!allowed())return;const run=()=>{idleHandle=null;if(!allowed())return;const target=['/app/reading/lessons','/app/listening/lessons'][idleIndex++];if(target)void warm(target);if(idleIndex<2)idleTimer=setTimeout(idle,1500);};if(window.requestIdleCallback)idleHandle=window.requestIdleCallback(run,{timeout:1500});else run();};idleTimer=setTimeout(idle,4000);
 signal.addEventListener('abort',()=>{clearTimeout(idleTimer);if(idleHandle!=null)window.cancelIdleCallback?.(idleHandle);for(const id of timers.values())clearTimeout(id);timers.clear();root.removeEventListener('learners-area:prefetch-intent',intent);},{once:true});
}
