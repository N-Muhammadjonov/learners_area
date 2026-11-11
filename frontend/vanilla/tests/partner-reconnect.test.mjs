import test from 'node:test';
import assert from 'node:assert/strict';
import {LivePartnerCall,MAX_ICE_RESTARTS,MAX_SOCKET_REJOINS} from '../modules/speaking/call-engine.js';

function fixture(){
 const events=[],messages=[];
 const socket={readyState:1,send(raw){messages.push(JSON.parse(raw));},close(){}};
 const call=new LivePartnerCall('session-1',{
  onStatus:(status)=>events.push(status),
  onLocalStream(){},
  onRemoteStream(){},
  report:status=>events.push('report:'+status)
 });
 call.socket=socket;
 call.pc={connectionState:'new'};
 call.role='answerer';
 return {call,socket,events,messages};
}

test('ICE messages are buffered until signal authorization and flushed once',async()=>{
 const {call,messages}=fixture();
 try{
  call.send({type:'signal',kind:'candidate',data:{candidate:'relay'}});
  assert.equal(messages.length,0);
  assert.equal(call.pendingSignals.length,1);
  await call.onMessage(JSON.stringify({type:'ready',role:'answerer',peerPresent:false}));
  assert.equal(messages.length,1);
  assert.equal(messages[0].kind,'candidate');
  assert.equal(call.pendingSignals.length,0);
 }finally{call.destroy();}
});

test('a previously connected call keeps retrying signalling without terminal failure',()=>{
 const {call}=fixture();
 try{
  call.status='reconnecting';
  call.everConnected=true;
  call.rejoins=MAX_SOCKET_REJOINS+1;
  let backoff=0;
  call.later=(_fn,ms)=>{backoff=ms;};
  call.rejoinSocket();
  assert.equal(call.isDestroyed,false);
  assert(backoff>0&&backoff<=32000);
 }finally{call.destroy();}
});

test('connection recovery resets ICE retries and retains the audio session',()=>{
 const {call,events}=fixture();
 try{
  call.status='reconnecting';
  call.iceRestarts=MAX_ICE_RESTARTS;
  call.connection('connected');
  assert.equal(call.everConnected,true);
  assert.equal(call.iceRestarts,0);
  assert(events.includes('connected'));
  assert.equal(call.isDestroyed,false);
 }finally{call.destroy();}
});
