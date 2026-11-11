import test from 'node:test';
import assert from 'node:assert/strict';
import {LivePartnerCall} from '../modules/speaking/call-engine.js';

function fixture(){
 const sent=[],statuses=[];
 const socket={readyState:0,send(raw){sent.push(JSON.parse(raw));},close(){this.readyState=3;}};
 const call=new LivePartnerCall('session-test',{
  createSocket:()=>socket,
  onStatus:(status,reason)=>statuses.push({status,reason}),
  onRemoteStream:()=>{},
 });
 call.pc={connectionState:'connected'};
 call.openSocket({url:'wss://example.test/signal',token:'short-lived-token'});
 return {call,socket,sent,statuses};
}

test('buffers ICE signals until signaling authentication completes',async()=>{
 const {call,socket,sent}=fixture();
 try{
  call.send({type:'signal',kind:'candidate',data:{candidate:'relay-candidate'}});
  assert.equal(sent.length,0);
  assert.equal(call.pendingSignals.length,1);
  socket.readyState=1;
  socket.onopen();
  assert.deepEqual(sent.map(x=>x.type),['auth']);
  await call.onMessage(JSON.stringify({type:'ready',peerPresent:false}));
  assert.deepEqual(sent.map(x=>x.type),['auth','signal']);
  assert.equal(call.pendingSignals.length,0);
  assert.equal(call.signallingReady,true);
 }finally{call.destroy();}
});

test('socket close triggers reconnect without terminating an established call',async()=>{
 const {call,socket,statuses}=fixture();
 try{
  call.everConnected=true;
  call.rejoins=12;
  call.openSocket({url:'wss://example.test/signal',token:'another-token'});
  const latest=call.socket;
  latest.onclose();
  assert.equal(call.destroyed,false);
  assert.equal(call.rejoins,13);
  assert.equal(statuses.some(x=>x.status==='failed'),false);
 }finally{call.destroy();}
});

test('terminal connection failures notify the application only once',()=>{
 const {call,statuses}=fixture();
 call.fail('microphone_ended');
 assert.equal(call.destroyed,true);
 assert.deepEqual(statuses,[{status:'failed',reason:'microphone_ended'}]);
});
