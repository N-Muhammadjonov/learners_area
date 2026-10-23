/** Port of src/lib/live-partner/call-engine.ts. Audio-only WebRTC with relay-only
 * ICE; offerer is server-selected and TURN/signal credentials come from server. */
export const MAX_ICE_RESTARTS=3,MAX_SOCKET_REJOINS=5;
export class LivePartnerCall{
 constructor(sessionId,deps){this.sessionId=sessionId;this.deps=deps;this.pc=null;this.socket=null;this.local=null;this.remote=null;this.role='answerer';this.candidates=[];this.timers=new Set();this.destroyed=false;this.iceRestarts=0;this.rejoins=0;this.lastReported=null;this.status='preparing';this.muted=false;}
 get isDestroyed(){return this.destroyed;}
 async start(){this.statusUpdate('preparing');let auth;
  try{auth=await this.deps.fetchToken(this.sessionId);}catch{return this.fail('token');}if(this.destroyed)return;
  let stream;try{stream=await this.deps.getUserMedia();}catch{return this.fail('microphone');}if(this.destroyed){stream.getTracks().forEach(t=>t.stop());return;}
  this.local=stream;this.applyMute();this.role=auth.role;
  const pc=this.deps.createPeer({iceServers:auth.iceServers,iceTransportPolicy:'relay'});this.pc=pc;
  for(const t of stream.getAudioTracks())pc.addTrack(t,stream);
  pc.ontrack=e=>{this.remote=e.streams[0]??new MediaStream([e.track]);this.deps.onRemoteStream(this.remote);};
  pc.onicecandidate=e=>this.send({type:'signal',kind:'candidate',data:e.candidate?e.candidate.toJSON():null});
  pc.onconnectionstatechange=()=>this.connection(pc.connectionState);
  for(const t of stream.getAudioTracks())t.onended=()=>this.fail('microphone_ended');
  this.statusUpdate('connecting');this.openSocket(auth);
 }
 setMuted(v){this.muted=Boolean(v);this.applyMute();}
 applyMute(){for(const t of this.local?.getAudioTracks()??[])t.enabled=!this.muted;}
 hangup(){this.send({type:'signal',kind:'bye'});this.destroy('ended');}
 destroy(final='ended'){if(this.destroyed)return;this.destroyed=true;
  for(const id of this.timers)clearTimeout(id);this.timers.clear();
  const sk=this.socket;this.socket=null;if(sk){sk.onclose=sk.onmessage=sk.onerror=null;try{sk.close(1000);}catch{}}
  const pc=this.pc;this.pc=null;if(pc){pc.ontrack=pc.onicecandidate=pc.onconnectionstatechange=null;try{pc.close();}catch{}}
  this.local?.getTracks().forEach(t=>{t.onended=null;t.stop();});this.local=null;this.remote=null;
  this.deps.onRemoteStream(null);this.status=final;this.deps.onStatus(final);
 }
 statusUpdate(status,detail){if(this.destroyed||this.status===status)return;this.status=status;this.deps.onStatus(status,detail);}
 report(status){if(this.lastReported===status)return;this.lastReported=status;this.deps.report(status);}
 fail(reason){if(this.destroyed)return;this.deps.onStatus('failed',reason);this.destroy('failed');}
 later(fn,ms){const id=setTimeout(()=>{this.timers.delete(id);if(!this.destroyed)fn();},ms);this.timers.add(id);}
 connection(s){if(s==='connected'){this.iceRestarts=0;this.statusUpdate('connected');this.report('connected');}
  else if(s==='disconnected'){this.statusUpdate('reconnecting');this.report('reconnecting');this.later(()=>void this.restartIce(),2000);}
  else if(s==='failed'){this.statusUpdate('reconnecting');this.report('reconnecting');void this.restartIce();}}
 async restartIce(){const pc=this.pc;if(!pc||this.role!=='offerer'||pc.connectionState==='connected')return;
  if(this.iceRestarts>=MAX_ICE_RESTARTS)return this.fail('ice');this.iceRestarts++;await this.makeOffer(true);}
 async makeOffer(restart=false){const pc=this.pc;if(!pc||this.destroyed)return;
  try{const offer=await pc.createOffer({iceRestart:restart,offerToReceiveAudio:true});if(this.destroyed)return;await pc.setLocalDescription(offer);this.send({type:'signal',kind:'offer',data:{type:offer.type,sdp:offer.sdp}});}catch{this.fail('negotiation');}}
 openSocket(auth){if(this.destroyed)return;const sk=this.deps.createSocket(auth.url);this.socket=sk;
  sk.onopen=()=>sk.send(JSON.stringify({type:'auth',token:auth.token}));
  sk.onmessage=e=>void this.onMessage(String(e.data));
  sk.onclose=()=>{if(this.destroyed||this.socket!==sk)return;this.socket=null;
   if(this.rejoins>=MAX_SOCKET_REJOINS)return this.fail('signalling');const delay=1000*2**this.rejoins++;
   if(this.status==='connected')this.report('reconnecting');
   this.later(async()=>{try{this.openSocket(await this.deps.fetchToken(this.sessionId));}catch{this.fail('token');}},delay);
  };
 }
 send(data){const s=this.socket;if(s?.readyState===1)s.send(JSON.stringify(data));}
 async onMessage(raw){let msg;try{msg=JSON.parse(raw);}catch{return;}const pc=this.pc;if(!pc||this.destroyed)return;
  if(msg.type==='ready'){this.rejoins=0;if(this.role==='offerer'&&msg.peerPresent)await this.makeOffer(pc.connectionState!=='new');return;}
  if(msg.type==='peer-joined'){if(this.role==='offerer')await this.makeOffer(pc.connectionState!=='new');return;}
  if(msg.type==='peer-left'){if(this.status==='connected')this.statusUpdate('reconnecting');return;}
  if(msg.type==='error'){if(msg.reason?.startsWith('token_')||msg.reason==='not_participant')this.fail('unauthorized');return;}
  if(msg.type!=='signal')return;
  try{if(msg.kind==='offer'&&this.role==='answerer'){
   await pc.setRemoteDescription(msg.data);await this.flushCandidates();const answer=await pc.createAnswer();if(this.destroyed)return;await pc.setLocalDescription(answer);this.send({type:'signal',kind:'answer',data:{type:answer.type,sdp:answer.sdp}});
  }else if(msg.kind==='answer'&&this.role==='offerer'&&pc.signalingState==='have-local-offer'){
   await pc.setRemoteDescription(msg.data);await this.flushCandidates();
  }else if(msg.kind==='candidate'){if(!msg.data)return;if(pc.remoteDescription)await pc.addIceCandidate(msg.data);else if(this.candidates.length<50)this.candidates.push(msg.data);}
  else if(msg.kind==='bye')this.destroy('ended');}catch{}
 }
 async flushCandidates(){const list=this.candidates;this.candidates=[];for(const candidate of list)await this.pc?.addIceCandidate(candidate).catch(()=>{});}
}
