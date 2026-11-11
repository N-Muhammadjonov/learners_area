import {el,listen} from '../../js/dom.js';

export async function partnerRequest(body,signal,view){
 const url='/api/live-partner'+(view?'?view='+encodeURIComponent(view):'');
 const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',
  headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),signal});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(Error(data.error||'unavailable'),{code:data.error,status:response.status});
 return data;
}

export function partnerOutsideRoom(userId,value){
 const key='la-partner-ringing:'+userId;
 try{
  if(value===true)window.sessionStorage.setItem(key,'1');
  else if(value===false)window.sessionStorage.removeItem(key);
  return window.sessionStorage.getItem(key)==='1';
 }catch{return false;}
}

export function partnerRingtone(target,signal){
 let id=null,context,timer;
 function stop(){clearInterval(timer);timer=null;}
 function start(){
  if(!id||timer||context?.state!=='running'||signal.aborted)return;
  const play=()=>{
   for(const offset of [0,.32]){
    const at=context.currentTime+offset,tone=context.createOscillator(),gain=context.createGain();
    tone.frequency.value=offset?620:480;
    gain.gain.setValueAtTime(.001,at);gain.gain.exponentialRampToValueAtTime(.075,at+.02);
    gain.gain.exponentialRampToValueAtTime(.001,at+.23);
    tone.connect(gain).connect(context.destination);tone.start(at);tone.stop(at+.24);
   }
  };
  play();timer=setInterval(play,2600);
 }
 const enable=()=>{
  if(typeof AudioContext==='undefined'||signal.aborted||!id)return;
  try{context??=new AudioContext();if(context.state==='running')start();else void context.resume().then(start).catch(()=>{});}catch{}
 };
 listen(target,'pointerdown',enable,signal);listen(target,'keydown',enable,signal);
 signal.addEventListener('abort',()=>{stop();if(context)void context.close().catch(()=>{});},{once:true});
 return {sync(next){if(next!==id){stop();id=next;}start();},unlock(){
  if(context||typeof AudioContext==='undefined'||signal.aborted)return;
  try{context=new AudioContext();if(context.state!=='running')void context.resume().then(start).catch(()=>{});}catch{}
 }};
}

export function shellPartnerRinging({dict,session,signal,navigate}){
 const path='/app/speaking/live-partner',userId=session.user.id,t=dict.livePartner;
 const node=el('div',{class:'lp-global-ring','aria-live':'polite','data-global-partner-ring':''});
 const sound=partnerRingtone(window,signal);
 let currentPath='',incoming=null,timeout,controller,busy=false,lastBeat=0;
 const enabled=()=>!signal.aborted&&currentPath!==path&&partnerOutsideRoom(userId);
 const clear=()=>{incoming=null;node.replaceChildren();sound.sync(null);};
 function render(next){
  if(next?.id===incoming?.id)return;
  clear();
  if(!next)return;
  incoming=next;sound.sync(next.id);
  const button=(label,accept)=>{
   const control=el('button',{class:accept?'btn-primary':'btn-secondary',type:'button','aria-label':label,title:label},accept?'📞':'📵');
   control.addEventListener('click',async()=>{
    if(busy||!enabled()||incoming?.id!==next.id)return;
    busy=true;
    try{
     await partnerRequest({action:accept?'accept':'decline',inviteId:next.id},AbortSignal.timeout(8000));
     clear();if(accept&&!signal.aborted)await navigate(path);
    }catch{clear();node.append(el('p',{role:'alert'},t.errors.unknownResult));}
    finally{busy=false;}
   });return control;
  };
  node.append(el('section',{class:'lp-call-notice','aria-label':t.incomingTitle},
   el('div',{class:'lp-person'},el('strong',{},next.from.name),el('small',{},t.incomingBody)),button(t.decline,false),button(t.accept,true)));
 }
 async function poll(){
  if(!enabled()||busy||controller||document.visibilityState!=='visible')return;
  controller=new AbortController();const current=controller,deadline=setTimeout(()=>current.abort(),6000);
  try{
   if(Date.now()-lastBeat>=15000){
    lastBeat=Date.now();void partnerRequest({action:'heartbeat',ringOnly:true},current.signal).catch(()=>{});
   }
   const data=await partnerRequest(null,current.signal,'ring');
   if(enabled()&&!current.signal.aborted)render(data.incoming);
  }catch{}finally{clearTimeout(deadline);if(controller===current)controller=null;}
 }
 function loop(){clearTimeout(timeout);if(enabled()){void poll();timeout=setTimeout(loop,4000);}}
 listen(document,'visibilitychange',loop,signal);
 listen(window,'pointerdown',()=>{if(enabled())sound.unlock();},signal);
 signal.addEventListener('abort',()=>{clearTimeout(timeout);controller?.abort();clear();},{once:true});
 return {node,update(url){
  currentPath=url.pathname;
  if(!enabled()){controller?.abort();clear();}
  loop();
 }};
}
