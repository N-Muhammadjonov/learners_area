// Isolated lab probe only. The production builder excludes tests/.
(()=>{
 const values={lcp:null,cls:0,errors:[],longTasks:[]};
 for(const type of ['largest-contentful-paint','layout-shift','longtask'])try{
  new PerformanceObserver(list=>{for(const e of list.getEntries()){
   if(type==='largest-contentful-paint')values.lcp=e.startTime;
   if(type==='layout-shift'&&!e.hadRecentInput)values.cls+=e.value;
   if(type==='longtask')values.longTasks.push(e.duration);
  }}).observe({type,buffered:true});
 }catch{}
 addEventListener('error',e=>values.errors.push(String(e.message).slice(0,160)));
 addEventListener('unhandledrejection',e=>values.errors.push(String(e.reason?.message||e.reason).slice(0,160)));
 let ready=false;
 function inspect(){
  if(ready||!document.querySelector('main h1'))return;
  ready=true;const readyMs=performance.now();observer.disconnect();
  setTimeout(()=>{
   const resources=performance.getEntriesByType('resource'),query=new URLSearchParams(location.search);
   const row={stage:query.get('__qa_stage'),token:query.get('__qa_token'),profile:query.get('__qa_profile'),route:location.pathname,
    viewport:{width:innerWidth,height:innerHeight},readyMs,lcpMs:values.lcp,cls:values.cls,
    fcpMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime??null,
    resourceCount:resources.length,transferBytes:resources.reduce((s,e)=>s+e.transferSize,0),
    decodedBytes:resources.reduce((s,e)=>s+e.decodedBodySize,0),cachedResources:resources.filter(e=>e.transferSize===0&&e.decodedBodySize>0).length,
    longTaskCount:values.longTasks.length,longTaskTotalMs:values.longTasks.reduce((s,v)=>s+v,0),errors:values.errors,
    horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
    navigation:performance.getEntriesByType('navigation').map(e=>({ttfbMs:e.responseStart,domContentLoadedMs:e.domContentLoadedEventEnd,loadMs:e.loadEventEnd}))};
   parent.postMessage({phase2ColdWarm:row},location.origin);
  },2000);
 }
 const observer=new MutationObserver(inspect);observer.observe(document,{childList:true,subtree:true});
 addEventListener('DOMContentLoaded',inspect);inspect();
})();
