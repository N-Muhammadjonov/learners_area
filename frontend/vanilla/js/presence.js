const HEARTBEAT_MS=30000;
const IDLE_MS=300000;
const RETRY_MS=5000;
const JITTER_MS=5000;

/** One heartbeat per active workspace, including detached exam routes. */
export function watchPresence({signal,session}){
 if(session?.user.accountStatus!=='active'||session.user.role==='guardian'||signal.aborted)return;
 let busy=false,lastInput=Date.now(),nextBeat=0,timer=null;
 function schedule(interval){
  const delay=interval+Math.floor(Math.random()*JITTER_MS);
  nextBeat=Date.now()+delay;
  timer=setTimeout(()=>void beat(),delay);
 }
 async function beat(){
  const now=Date.now();
  if(busy||signal.aborted||document.visibilityState==='hidden'||now-lastInput>IDLE_MS||now<nextBeat)return;
  busy=true;
  clearTimeout(timer);
  let interval=HEARTBEAT_MS;
  try{
   const response=await fetch('/api/presence',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
    signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),
    headers:{'Content-Type':'application/json'},body:JSON.stringify({path:window.location.pathname})});
   if(!response.ok&&response.status>=500)throw new Error('Presence temporarily unavailable');
  }catch{interval=RETRY_MS;}
  finally{
   busy=false;
   if(!signal.aborted)schedule(interval);
  }
 }
 const activity=()=>{
  lastInput=Date.now();
  if(lastInput>=nextBeat)void beat();
 };
 // Scroll and focus matter on touch devices and after returning to an idle tab.
 for(const event of ['pointerdown','pointermove','keydown','touchstart','scroll','focus','pageshow']){
  window.addEventListener(event,activity,{signal,passive:true,capture:true});
 }
 document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='hidden')activity();
 },{signal});
 signal.addEventListener('abort',()=>clearTimeout(timer),{once:true});
 void beat();
}
