// Isolated QA instrumentation, excluded from the production asset builder.
// No playback/microphone bypass, credentials, answer text or private URLs logged.
(()=>{
 const start=performance.now(),stage=document.cookie.includes('phase2_stage=before')?'before':'after';
 performance.setResourceTimingBufferSize(20000);
 const observed={paint:{},lcp:null,cls:0,longTasks:[],events:[],media:[],errors:[],snapshots:[]};
 const safePath=()=>location.pathname;
 for(const type of ['paint','largest-contentful-paint','layout-shift','longtask','event']){
  try{new PerformanceObserver(list=>{for(const e of list.getEntries()){
   if(type==='paint')observed.paint[e.name]=e.startTime;
   if(type==='largest-contentful-paint')observed.lcp=e.startTime;
   if(type==='layout-shift'&&!e.hadRecentInput)observed.cls+=e.value;
   if(type==='longtask')observed.longTasks.push({at:e.startTime,ms:e.duration});
   if(type==='event')observed.events.push({name:e.name,ms:e.duration,interactionId:e.interactionId});
  }}).observe({type,buffered:true,...(type==='event'?{durationThreshold:16}:{})});}catch{}
 }
 addEventListener('error',e=>observed.errors.push({kind:'error',message:String(e.message).slice(0,240)}));
 addEventListener('unhandledrejection',e=>observed.errors.push({kind:'rejection',message:String(e.reason?.message||e.reason).slice(0,240)}));
 for(const type of ['loadedmetadata','playing','pause','waiting','stalled','error','ended','seeking','seeked']){
  document.addEventListener(type,e=>{if(e.target instanceof HTMLMediaElement){
   const a=e.target;observed.media.push({event:type,atMs:performance.now(),currentTime:a.currentTime,
    duration:Number.isFinite(a.duration)?a.duration:null,readyState:a.readyState,networkState:a.networkState,error:a.error?.code||null});
   if(observed.media.length>300)observed.media.shift();
  }},true);
 }
 const pct=(v,p)=>v.length?[...v].sort((a,b)=>a-b)[Math.min(v.length-1,Math.floor((v.length-1)*p))]:null;
 function snapshot(label='manual'){
  const resources=performance.getEntriesByType('resource'),a=document.querySelector('audio');
  const result={label,stage,route:safePath(),wallClock:new Date().toISOString(),elapsedMs:performance.now()-start,
   viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
   navigationType:performance.getEntriesByType('navigation')[0]?.type,
   paint:observed.paint,lcpMs:observed.lcp,cls:observed.cls,
   inputEventDurationP95Ms:pct(observed.events.filter(e=>e.interactionId).map(e=>e.ms),.95),
   longTaskCount:observed.longTasks.length,longTaskTotalMs:observed.longTasks.reduce((s,e)=>s+e.ms,0),
   resourceCount:resources.length,transferredBytes:resources.reduce((s,e)=>s+e.transferSize,0),
   decodedResourceBytes:resources.reduce((s,e)=>s+e.decodedBodySize,0),
   apiRequests:resources.filter(e=>new URL(e.name).pathname.startsWith('/api/')).length,
   domNodes:document.querySelectorAll('*').length,approxHeapBytes:performance.memory?.usedJSHeapSize??null,
   visibility:document.visibilityState,online:navigator.onLine,
   timerRemainingSeconds:document.querySelector('[data-time-remaining]')
    ?Number(document.querySelector('[data-time-remaining]').dataset.timeRemaining):null,
   timerText:document.querySelector('[role="timer"]')?.textContent??null,
   largestResources:resources.toSorted((a,b)=>b.transferSize-a.transferSize).slice(0,12).map(e=>({
    path:new URL(e.name).pathname.startsWith('/api/resources/')?'/api/resources/[synthetic-private-media]':new URL(e.name).pathname,
    transferBytes:e.transferSize,decodedBytes:e.decodedBodySize})),
   audio:a?{elements:document.querySelectorAll('audio').length,paused:a.paused,time:a.currentTime,duration:a.duration,
    readyState:a.readyState,error:a.error?.code||null,playbackState:document.querySelector('[data-listening-playback]')?.dataset.listeningPlayback,
    recoveryVisible:!!document.querySelector('[data-listening-start-audio]:not([hidden])')}:null,
   mediaEvents:observed.media.slice(-20),errors:observed.errors.slice(-20),
   limitations:['Instrumented Chrome lab run, not field CWV/INP','Approximate heap, no forced GC or heap snapshot','No DevTools CPU/network throttle or Safari exposed']};
  observed.snapshots.push(result);parent.postMessage({phase2:result},location.origin);
  void fetch('/__qa/metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result),keepalive:true});
  return result;
 }
 async function reading(){
  const pane=document.querySelector('[data-native-view="reading-attempt"]')||document.body;
  const input=document.querySelector('input[id^="answer-"],input[data-answer-id],input[type="text"]');
  if(!input){parent.postMessage({phase2:{error:'No reading text input on this route'}},location.origin);return;}
  const id=input.id,original=input,records=[],times=[];let identityChanges=0,focusLoss=0,selectionLoss=0;
  const observer=new MutationObserver(rs=>records.push(...rs));observer.observe(pane||document.body,{childList:true,subtree:true});
  input.focus();
  for(let i=0;i<200;i++){
   const current=id?document.getElementById(id):input;if(current!==original)identityChanges++;
   current.value='word'+i;current.setSelectionRange(2,2);const t=performance.now();
   current.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(i)}));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));times.push(performance.now()-t);
   const next=id?document.getElementById(id):current;
   if(document.activeElement!==next)focusLoss++;
   if(next.selectionStart!==2||next.selectionEnd!==2)selectionLoss++;
  }
  records.push(...observer.takeRecords());observer.disconnect();
  const result={label:'reading-200-inputs',stage,route:safePath(),events:200,identityChanges,focusLoss,selectionLoss,
   addedNodes:records.reduce((s,r)=>s+r.addedNodes.length,0),removedNodes:records.reduce((s,r)=>s+r.removedNodes.length,0),
   inputToTwoAnimationFramesMs:{p50:pct(times,.5),p95:pct(times,.95),p99:pct(times,.99)},
   note:'Synthetic input events and two-frame lab proxy, not trusted-event INP'};
  parent.postMessage({phase2:result},location.origin);void fetch('/__qa/metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
 }
 async function navigation(){
  const paths=['/app/dashboard','/app/listening/academic','/app/reading/academic','/app/progress'];
  const times=[];for(let i=0;i<20;i++){
   const path=paths[i%paths.length],link=document.createElement('a');link.href=path;link.hidden=true;document.querySelector('#root').append(link);
   const t=performance.now();link.click();link.remove();
   await new Promise((resolve,reject)=>{const until=performance.now()+15000;function check(){
    if(location.pathname===path&&document.querySelector('h1')&&!document.querySelector('[aria-busy="true"]'))requestAnimationFrame(()=>requestAnimationFrame(resolve));
    else if(performance.now()>until)reject(new Error('navigation timeout'));else setTimeout(check,30);
   }check();});times.push(performance.now()-t);
  }
  const result={label:'warm-20-navigation',stage,timesMs:times,p50Ms:pct(times,.5),p95Ms:pct(times,.95),p99Ms:null,
   note:'Synthetic same-document anchors; N=20, no p99 claim'};
  parent.postMessage({phase2:result},location.origin);void fetch('/__qa/metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
 }
 let soak=false;
 addEventListener('message',e=>{if(e.origin!==location.origin)return;
  if(e.data?.phase2Command==='snapshot')snapshot();
  if(e.data?.phase2Command==='reading')void reading();
  if(e.data?.phase2Command==='navigation')void navigation().catch(error=>parent.postMessage({phase2:{error:error.message}},location.origin));
  if(['soak','soak-nav'].includes(e.data?.phase2Command)&&!soak){soak=true;snapshot('soak-0');
   for(const minutes of [15,30,45,60])setTimeout(()=>snapshot('soak-'+minutes),minutes*60000);
   const timer=setInterval(()=>snapshot('soak-minute'),60000);setTimeout(()=>clearInterval(timer),3600001);
   if(e.data.phase2Command==='soak-nav'){
    let n=0;const nav=setInterval(()=>{const a=document.createElement('a');a.href=['/app/dashboard','/app/listening/academic','/app/reading/academic','/app/progress'][n++%4];a.hidden=true;document.querySelector('#root').append(a);a.click();a.remove();},20000);
    setTimeout(()=>clearInterval(nav),3600001);
   }
  }
 });
 addEventListener('load',()=>setTimeout(()=>snapshot('first-render'),1500),{once:true});
})();
