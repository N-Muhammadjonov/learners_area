import {readCatalogue} from './catalogue-cache.js';
import {viewData,cacheableView} from './adapters/frontend.js';
import {eligibleIntentTarget,IntentPrefetchBudget} from './generated/intent-prefetch.js';
import {privateScope} from './private-scope.js';

/** Bounded, opt-in private reads. Intent never preloads an active exam, answers or media. */
export function viewPrewarm({root,signal,win=window,doc=document,nav=navigator,clock=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 const budget=new IntentPrefetchBudget(),timers=new Map(),requests=new Set();
 let remaining=1024*1024,idleTimer,idleHandle,idleIndex=0,disposed=false;
 const lowResource=()=>nav.connection?.saveData||['2g','slow-2g'].includes(nav.connection?.effectiveType)||
    (typeof nav.deviceMemory==='number'&&nav.deviceMemory<=2);
 const allowed=()=>!disposed&&!signal.aborted&&remaining>0&&!!privateScope.scope&&
    nav.onLine!==false&&doc.visibilityState==='visible'&&!lowResource();
 function reserve(max){const bytes=Math.min(max,remaining);if(bytes<=0)return 0;remaining-=bytes;return bytes;}
 function refund(max,result){if(!result)return;try{remaining+=Math.max(0,max-Math.min(max,JSON.stringify(result).length*2));}catch{}}
 async function warm(target,kind='view'){
  if(!allowed()||requests.size>=1||!budget.take(target,clock()))return false;
  const controller=new AbortController(),forward=()=>controller.abort(signal.reason);
  signal.addEventListener('abort',forward,{once:true});requests.add(controller);
  try{
   if(kind==='vocabulary'){
    const paths=['/api/vocabulary/folders','/api/vocabulary/packs','/api/vocabulary?limit=50&offset=0','/api/vocabulary/summary'];
    for(const path of paths){if(!allowed())break;const capacity=reserve(128*1024);if(!capacity)break;
     try{refund(capacity,await readCatalogue(path,{signal:controller.signal,maxBytes:capacity}));}catch{ /* Skip optional prewarm. */ }}
   }else{
    const regions=target==='/app/dashboard'?['dashboard','openLessons','mock']:
      target==='/app/progress'?['progressSummary','progressStreak','progressTrends','progressMocks']:[undefined];
    for(const region of regions){if(!allowed())break;const capacity=reserve(regions.length>1?128*1024:256*1024);if(!capacity)break;
     try{refund(capacity,await viewData(target,controller.signal,region,{maxBytes:capacity}));}catch{}}
   }
  }finally{requests.delete(controller);signal.removeEventListener('abort',forward);}
  return true;
 }
 function intent(event){
  const a=event.target.closest?.('a[href],[data-navigation-route]');
  if(!a)return;
  clearTimer(timers.get(a));timers.delete(a);
  if(event.detail?.action!=='prepare'||![0,90].includes(event.detail.delay)||!allowed()||
     a.hasAttribute('download')||(a.target&&a.target!=='_self'))return;
  const target=eligibleIntentTarget(a.dataset.navigationRoute||a.href,win.location.origin,win.location.href);
  if(!target||!(target==='/app/vocabulary'||cacheableView(target)))return;
  const id=setTimer(()=>{timers.delete(a);if(!a.isConnected||!root.contains(a)||!allowed())return;
   void warm(target,target==='/app/vocabulary'?'vocabulary':'view');},event.detail.delay);
  timers.set(a,id);
 }
 root.addEventListener('learners-area:prefetch-intent',intent);
 // Idle reads improve warm desktop navigation; suppress optional private network
 // work on touch/mobile so first-frame and ready p99 aren't delayed by competition.
 const mobile=win.matchMedia?.('(pointer: coarse)')?.matches===true||(win.innerWidth>0&&win.innerWidth<768);
 function idle(){
  if(!allowed()||mobile)return;
  const run=()=>{idleHandle=null;if(!allowed())return;
   const targets=['/app/reading/lessons','/app/listening/lessons'];
   const target=targets[idleIndex++];if(target)void warm(target);
   if(idleIndex<targets.length)idleTimer=setTimer(idle,1500);};
  if(win.requestIdleCallback)idleHandle=win.requestIdleCallback(run,{timeout:1500});else run();
 }
 if(!mobile)idleTimer=setTimer(idle,4000);
 function dispose(){
  if(disposed)return;disposed=true;clearTimer(idleTimer);
  if(idleHandle!=null)win.cancelIdleCallback?.(idleHandle);
  for(const id of timers.values())clearTimer(id);timers.clear();
  for(const controller of requests)controller.abort('prewarm-disposed');requests.clear();
  root.removeEventListener('learners-area:prefetch-intent',intent);
  signal.removeEventListener('abort',dispose);
 }
 signal.addEventListener('abort',dispose,{once:true});
 return {warm,dispose,get remainingBytes(){return remaining;}};
}
