/** Opt-in router timings, never a claim about paint, data or media readiness.
 * Store registered route patterns only, excluding private URLs and query values. */
const PHASES=['prepare','module','mount','commit'];
export function createNavigationMetrics({enabled=()=>false,performance:perf=globalThis.performance,emit=()=>{},limit=100}={}){
 let sequence=0;const rows=[],capacity=Math.min(200,Math.max(1,Math.floor(limit)||100));
 return {snapshot:()=>rows.map(r=>({...r,phasesMs:{...r.phasesMs}})),
  begin({pattern='other',kind='navigate',signal}={}){
   if(!enabled()||!perf?.now)return null;
   const id=++sequence,prefix='la-route-'+id+'-',started=perf.now(),times=new Map(),names=new Set();let done=false;
   const abort=()=>finish('aborted');
   function finish(status){if(done)return;done=true;signal?.removeEventListener('abort',abort);const end=perf.now(),phasesMs={};
    for(const phase of PHASES){const a=times.get(phase+'-start'),b=times.get(phase+'-end');if(a!==undefined&&b!==undefined){phasesMs[phase]=Math.max(0,b-a);try{perf.measure?.(prefix+phase,prefix+phase+'-start',prefix+phase+'-end');}catch{}}}
    const row={event:'routePipeline',id,pattern,kind,status,totalMs:Math.max(0,end-started),phasesMs};rows.push(row);while(rows.length>capacity)rows.shift();
    try{emit({...row,phasesMs:{...phasesMs}});}catch{/* Optional diagnostics must not affect routing. */}
    for(const name of names)perf.clearMarks?.(name);for(const phase of PHASES)perf.clearMeasures?.(prefix+phase);
   }
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)finish('aborted');
   return {point:name=>{if(done||!PHASES.some(p=>name===p+'-start'||name===p+'-end'))return;times.set(name,perf.now());const key=prefix+name;names.add(key);try{perf.mark?.(key);}catch{}},finish};
  }};
}
