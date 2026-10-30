import test from 'node:test';
import assert from 'node:assert/strict';
import {viewPrewarm} from '../js/view-prewarm.js';

function fakeRoot(){
 const handlers=new Map();
 return {handlers,addEventListener(k,fn){handlers.set(k,fn);},removeEventListener(k){handlers.delete(k);},contains(){return true;}};
}
function fakeWin({mobile=false}={}){
 return {innerWidth:mobile?390:1440,location:{origin:'https://la.example',href:'https://la.example/app/dashboard'},
  matchMedia:()=>({matches:mobile}),requestIdleCallback:fn=>7,cancelIdleCallback(){},
 };
}
test('mobile does not schedule background idle API prewarming',()=>{
 const root=fakeRoot(),controller=new AbortController(),timers=[];
 const worker=viewPrewarm({root,signal:controller.signal,win:fakeWin({mobile:true}),
  nav:{onLine:true,connection:{effectiveType:'4g'}},
  doc:{visibilityState:'visible'},setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},
  clearTimer(){}});
 try{assert.equal(timers.length,0);assert.equal(typeof root.handlers.get('learners-area:prefetch-intent'),'function');}
 finally{worker.dispose();controller.abort();}
});
test('desktop schedules only one bounded idle warm-up and disposes on abort',()=>{
 const root=fakeRoot(),controller=new AbortController(),timers=[],cancelled=[];
 const worker=viewPrewarm({root,signal:controller.signal,win:fakeWin(),
  nav:{onLine:true,connection:{effectiveType:'4g'}},
  doc:{visibilityState:'visible'},
  setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},
  clearTimer:id=>cancelled.push(id)});
 assert.equal(timers.length,1);
 assert.equal(timers[0].ms,4000);
 controller.abort();
 assert.equal(root.handlers.size,0);
 assert(cancelled.includes(1));
 worker.dispose();
});
test('data saver, slow connection and low memory prevent optional warm requests',async()=>{
 for(const nav of [{onLine:true,connection:{saveData:true}},{onLine:true,connection:{effectiveType:'2g'}},{onLine:true,deviceMemory:2}]){
  const root=fakeRoot(),controller=new AbortController();
  const worker=viewPrewarm({root,signal:controller.signal,win:fakeWin({mobile:true}),
   nav,doc:{visibilityState:'visible'},setTimer(){throw Error('should not schedule idle');},clearTimer(){}});
  try{assert.equal(await worker.warm('/app/reading/lessons'),false);}
  finally{worker.dispose();controller.abort();}
 }
});
