/** A single heartbeat for the signed-in workspace, including detached focus routes. */
export function watchPresence({signal,session}){
 if(session?.user.accountStatus!=='active'||signal.aborted)return;
 let busy=false,lastInput=Date.now();
 const activity=()=>{lastInput=Date.now();};
 for(const event of ['pointerdown','pointermove','keydown','touchstart'])window.addEventListener(event,activity,{signal,passive:true});
 async function beat(){
  if(busy||signal.aborted||document.visibilityState==='hidden'||Date.now()-lastInput>300000)return;
  busy=true;
  try{await fetch('/api/presence',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal});}catch{}finally{busy=false;}
 }
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden'){activity();void beat();}},{signal});
 const timer=setInterval(()=>void beat(),30000);signal.addEventListener('abort',()=>clearInterval(timer),{once:true});void beat();
}
