/** Port of src/lib/live-partner/call-engine.ts. Audio-only WebRTC with relay-only
 * ICE; offerer is server-selected and TURN/signal credentials come from server. */
export const MAX_ICE_RESTARTS=8,MAX_SOCKET_REJOINS=10;
export class LivePartnerCall{
 constructor(sessionId,deps){this.sessionId=sessionId;this.deps=deps;this.pc=null;this.socket=null;this.local=null;this.remote=null;this.channel=null;this.role='answerer';this.candidates=[];this.timers=new Set();this.destroyed=false;this.iceRestarts=0;this.rejoins=0;this.lastReported=null;this.status='preparing';this.muted=false;this.lastRestart=-Infinity;this.iceRetry=null;this.signallingReady=false;this.lastActivity=0;this.everConnected=false;this.pendingSignals=[];this.socketKeepalive=null;}
 get isDestroyed(){return this.destroyed;}
 async start(){this.statusUpdate('preparing');let auth;
  try{auth=await this.deps.fetchToken(this.sessionId);}catch{return this.fail('token');}if(this.destroyed)return;
  let stream;try{stream=await this.deps.getUserMedia();}catch{return this.fail('microphone');}if(this.destroyed){stream.getTracks().forEach(t=>t.stop());return;}
  this.local=stream;this.applyMute();this.deps.onLocalStream?.(stream);this.role=auth.role;
  let pc;
  try{pc=this.deps.createPeer({iceServers:auth.iceServers,iceTransportPolicy:'relay'});this.pc=pc;}
  catch{return this.fail('peer');}
  try{
   this.channel=pc.createDataChannel?.('la-partner-state',{negotiated:true,id:0})??null;
   if(this.channel){
    this.channel.onopen=()=>this.sendMute();
    this.channel.onmessage=event=>{
     if(event.data==='mute:1'||event.data==='mute:0')this.deps.onPeerMute?.(event.data==='mute:1');
     else if(event.data==='activity'&&Date.now()-this.lastActivity>=600){
      this.lastActivity=Date.now();this.deps.onActivity?.();
     }
    };
   }
  }catch{this.channel=null;}
  for(const t of stream.getAudioTracks())pc.addTrack(t,stream);
  pc.ontrack=e=>{this.remote=e.streams[0]??new MediaStream([e.track]);this.deps.onRemoteStream(this.remote);};
  pc.onicecandidate=e=>this.send({type:'signal',kind:'candidate',data:e.candidate?e.candidate.toJSON():null});
  pc.onconnectionstatechange=()=>this.connection(pc.connectionState);
  for(const t of stream.getAudioTracks())t.onended=()=>this.fail('microphone_ended');
  this.statusUpdate('connecting');try{this.openSocket(auth);}catch{this.fail('signalling');}
 }
 setMuted(v){this.muted=Boolean(v);this.applyMute();this.sendMute();}
 sendMute(){if(this.channel?.readyState==='open')try{this.channel.send(this.muted?'mute:1':'mute:0');}catch{}}
 notifyActivity(){if(this.channel?.readyState==='open')try{this.channel.send('activity');}catch{}}
 applyMute(){for(const t of this.local?.getAudioTracks()??[])t.enabled=!this.muted;}
 hangup(){this.send({type:'signal',kind:'bye'});this.destroy('ended');}
 destroy(final='ended',detail){if(this.destroyed)return;this.destroyed=true;
  for(const id of this.timers)clearTimeout(id);this.timers.clear();clearTimeout(this.iceRetry);clearTimeout(this.socketKeepalive);this.socketKeepalive=null;this.pendingSignals=[];
  const sk=this.socket;this.socket=null;if(sk){sk.onclose=sk.onmessage=sk.onerror=null;try{sk.close(1000);}catch{}}
  const pc=this.pc;this.pc=null;if(pc){pc.ontrack=pc.onicecandidate=pc.onconnectionstatechange=null;try{pc.close();}catch{}}
  if(this.channel){this.channel.onopen=this.channel.onmessage=null;try{this.channel.close();}catch{}this.channel=null;}
  this.local?.getTracks().forEach(t=>{t.onended=null;t.stop();});this.local=null;this.remote=null;
  this.deps.onLocalStream?.(null);this.deps.onRemoteStream?.(null);this.status=final;this.deps.onStatus(final,detail);
 }
 statusUpdate(status,detail){if(this.destroyed||this.status===status)return;this.status=status;this.deps.onStatus(status,detail);}
 report(status){if(this.lastReported===status)return;this.lastReported=status;this.deps.report(status);}
 fail(reason){if(this.destroyed)return;this.destroy('failed',reason);}
 later(fn,ms){const id=setTimeout(()=>{this.timers.delete(id);if(!this.destroyed)fn();},ms);this.timers.add(id);}
 connection(s){
  if(s==='connected'){
   clearTimeout(this.iceRetry);this.iceRetry=null;this.iceRestarts=0;this.everConnected=true;
   this.statusUpdate('connected');this.report('connected');
  }else if(s==='disconnected'||s==='failed'){
   this.statusUpdate('reconnecting');this.report('reconnecting');this.queueRestart(s==='failed'?0:2000);
  }
 }
 queueRestart(delay){
  if(this.destroyed||this.iceRetry!==null)return;
  this.iceRetry=setTimeout(()=>{
   this.iceRetry=null;
   if(!this.destroyed&&this.status==='reconnecting'){
    if(this.signallingReady)void this.restartIce();
    this.queueRestart(4500);
   }
  },delay);
 }
 async restartIce(peer=false){const pc=this.pc;if(!pc||(!peer&&pc.connectionState==='connected')||Date.now()-this.lastRestart<1800)return;
  this.lastRestart=Date.now();
  if(this.iceRestarts>=MAX_ICE_RESTARTS){if(!this.everConnected)return this.fail('ice');this.iceRestarts=0;}
  this.iceRestarts++;
  try{
   const auth=await this.deps.fetchToken(this.sessionId);
   if(this.destroyed)return;
   pc.setConfiguration?.({iceServers:auth.iceServers,iceTransportPolicy:'relay'});
  }catch{return;}
  if(this.role==='offerer')await this.makeOffer(true);
  else this.send({type:'signal',kind:'restart',data:{}});}
 async makeOffer(restart=false){const pc=this.pc;if(!pc||this.destroyed)return;
  try{const offer=await pc.createOffer({iceRestart:restart,offerToReceiveAudio:true});if(this.destroyed)return;await pc.setLocalDescription(offer);this.send({type:'signal',kind:'offer',data:{type:offer.type,sdp:offer.sdp}});}catch{this.fail('negotiation');}}
 openSocket(auth){if(this.destroyed)return;const sk=this.deps.createSocket(auth.url);this.socket=sk;this.signallingReady=false;
  sk.onopen=()=>sk.send(JSON.stringify({type:'auth',token:auth.token}));
  sk.onmessage=e=>void this.onMessage(String(e.data));
  sk.onclose=()=>{if(this.destroyed||this.socket!==sk)return;this.socket=null;this.signallingReady=false;clearTimeout(this.socketKeepalive);this.socketKeepalive=null;
   this.rejoinSocket();
  };
 }
 rejoinSocket(){
  if(this.destroyed)return;
  if(this.rejoins>=MAX_SOCKET_REJOINS&&!this.everConnected)return this.fail('signalling');
  const delay=1000*2**Math.min(this.rejoins++,5);
  this.later(async()=>{
   try{this.openSocket(await this.deps.fetchToken(this.sessionId));}
   catch{this.rejoinSocket();}
  },delay);
 }
 send(data){
  const s=this.socket;
  if(s?.readyState===1&&this.signallingReady){try{s.send(JSON.stringify(data));}catch{this.bufferSignal(data);}}
  else this.bufferSignal(data);
 }
 bufferSignal(data){if(data.type==='ping')return;if(this.pendingSignals.length>=64)this.pendingSignals.shift();this.pendingSignals.push(data);}
 flushSignals(){const list=this.pendingSignals;this.pendingSignals=[];for(const data of list)this.send(data);}
 keepSocketAlive(){clearTimeout(this.socketKeepalive);if(this.destroyed||!this.signallingReady)return;
  const current=this.socket;
  this.socketKeepalive=setTimeout(()=>{if(!this.destroyed&&this.socket===current&&this.signallingReady){
   this.send({type:'ping'});this.keepSocketAlive();
  }},20000);
 }
 async onMessage(raw){let msg;try{msg=JSON.parse(raw);}catch{return;}const pc=this.pc;if(!pc||this.destroyed)return;
  if(msg.type==='ready'){this.rejoins=0;this.signallingReady=true;this.flushSignals();this.keepSocketAlive();if(!msg.peerPresent)return;}
  if(msg.type==='ready'||msg.type==='peer-joined'){
   if(this.role==='offerer'&&pc.connectionState!=='connected')await this.makeOffer(pc.connectionState!=='new');
   return;
  }
  if(msg.type==='error'){if(msg.reason?.startsWith('token_')||msg.reason==='not_participant')this.fail('unauthorized');return;}
  if(msg.type!=='signal')return;
  try{if(msg.kind==='offer'&&this.role==='answerer'){
   await pc.setRemoteDescription(msg.data);await this.flushCandidates();const answer=await pc.createAnswer();if(this.destroyed)return;await pc.setLocalDescription(answer);this.send({type:'signal',kind:'answer',data:{type:answer.type,sdp:answer.sdp}});
  }else if(msg.kind==='answer'&&this.role==='offerer'&&pc.signalingState==='have-local-offer'){
   await pc.setRemoteDescription(msg.data);await this.flushCandidates();
  }else if(msg.kind==='candidate'){if(!msg.data)return;if(pc.remoteDescription)await pc.addIceCandidate(msg.data);else if(this.candidates.length<50)this.candidates.push(msg.data);}
  else if(msg.kind==='restart'&&this.role==='offerer')await this.restartIce(true);
  else if(msg.kind==='bye')this.destroy('ended');}catch{}
 }
 async flushCandidates(){const list=this.candidates;this.candidates=[];for(const candidate of list)await this.pc?.addIceCandidate(candidate).catch(()=>{});}
}
