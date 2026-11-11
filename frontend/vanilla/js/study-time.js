/** Activity signals only. The server owns duration and cross-tab overlap. */
export function watchStudyTime({signal,session}){
 if(session?.user.role!=='student'||signal.aborted)return;
 const modules=new Set(['reading','listening','writing','speaking','vocabulary','grammar','video','mocks','courses']);
 const moduleFor=()=>{let part=location.pathname.split('/')[2];if(part==='video-lessons')part='video';return modules.has(part)&&!/(?:history|author|admin)(?:\/|$)/.test(location.pathname)?part:null;};
 let module=moduleFor(),id=null,sequence=0,busy=false,lastInput=0,wasActive=false,stopped=false,idleTimer;
 let lastMedia=0;const positions=new WeakMap(),recorders=new Set();
 const now=()=>Date.now(),visible=()=>document.visibilityState==='visible'&&document.hasFocus();
 // Playback must actually advance, be in the foreground, and be re-armed by
 // learner input at least every ten minutes. A parked player cannot run forever.
 const active=()=>visible()&&lastInput>0&&(now()-lastInput<120000||now()-lastInput<600000&&(now()-lastMedia<10000||[...recorders].some(r=>r.state==='recording')));
 function armIdle(){clearTimeout(idleTimer);idleTimer=setTimeout(()=>void tick(),120000);}
 function interaction(e){if(!e.isTrusted||!moduleFor())return;lastInput=now();armIdle();if(!wasActive)void tick();}
 function playback(source,position){const prior=positions.get(source);positions.set(source,{at:now(),position});if(prior&&position>prior.position&&position-prior.position<Math.max(1,(now()-prior.at)/1000)*3)lastMedia=now();}
 async function send(body,beacon=false){
  const data=JSON.stringify(body);
  if(beacon&&navigator.sendBeacon){navigator.sendBeacon('/api/study-time',new Blob([data],{type:'application/json'}));return null;}
  const response=await fetch('/api/study-time',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:data,cache:'no-store',redirect:'error',signal,keepalive:body.action==='end'});
  if(!response.ok){if(response.status===410||response.status===404)id=null;throw Error('study_time_unavailable');}
  return response.json();
 }
 function finish(){if(id){void send({action:'end',sessionId:id,sequence:++sequence,active:false},true);id=null;}wasActive=false;}
 function route(){const next=moduleFor();if(next!==module){finish();module=next;lastInput=0;lastMedia=0;recorders.clear();}void tick();}
 async function tick(){
  if(busy||stopped||signal.aborted)return;
  if(moduleFor()!==module){route();return;}
  if(!module)return;
  const engaged=active();if(!id&&!engaged)return;
  busy=true;
  try{
   if(!id){const started=await send({action:'start',module});id=started.sessionId;sequence=0;if(stopped||signal.aborted||moduleFor()!==module||!visible()){finish();return;}}
   const sendingId=id;
   await send({action:'heartbeat',sessionId:sendingId,sequence:++sequence,active:engaged});
   if(id===sendingId)wasActive=engaged;
  }catch{}finally{busy=false;}
 }
 for(const event of ['pointerdown','keydown','input','touchstart','wheel'])window.addEventListener(event,interaction,{signal,passive:true});
 document.addEventListener('timeupdate',e=>{const n=e.target;if(n instanceof HTMLMediaElement&&!n.paused&&!n.ended&&!n.seeking)playback(n,n.currentTime);},{signal,capture:true});
 window.addEventListener('la:study-playback',e=>{if(e.detail?.source?.isConnected&&Number.isFinite(e.detail.position))playback(e.detail.source,e.detail.position);},{signal});
 window.addEventListener('la:study-recording',e=>{const r=e.detail?.recorder;if(r&&typeof r.state==='string'){if(e.detail.active)recorders.add(r);else recorders.delete(r);}},{signal});
 const timer=setInterval(()=>void tick(),30000);
 document.addEventListener('visibilitychange',()=>{if(!visible())finish();else void tick();},{signal});
 window.addEventListener('focus',()=>void tick(),{signal});window.addEventListener('blur',finish,{signal});window.addEventListener('pagehide',finish,{signal});
 window.addEventListener('la:study-route',route,{signal});window.addEventListener('la:study-pause',finish,{signal});
 signal.addEventListener('abort',()=>{stopped=true;clearInterval(timer);clearTimeout(idleTimer);finish();},{once:true});
}
