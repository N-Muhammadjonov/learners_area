import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../modules/speaking/upload.js',import.meta.url),'utf8');
const stub='data:text/javascript,'+encodeURIComponent('export class ApiError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}');
const {uploadRecording}=await import('data:text/javascript,'+encodeURIComponent(source.replace("'../../js/api-client.js'",JSON.stringify(stub))));
import {LivePartnerCall} from '../modules/speaking/call-engine.js';

// Only stub the network boundaries; do not fabricate live evaluation or media results.
test('upload errors retain structured server error code', async () => {
 const old=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'forbidden',message:'Denied'}}),{status:403,headers:{'content-type':'application/json'}});
 try{
  await assert.rejects(uploadRecording({name:'recording.webm',type:'audio/webm',size:1},'attempt-1'),e=>e.status===403&&e.code==='forbidden');
 } finally {globalThis.fetch=old;}
});

test('aborted upload cannot start a later XHR upload', async () => {
 const oldFetch=globalThis.fetch,oldXHR=globalThis.XMLHttpRequest,c=new AbortController();let xhrCreated=0;
 globalThis.fetch=async()=>{c.abort();return new Response(JSON.stringify({uploadId:'up-1',mode:'proxy',contentType:'audio/webm'}),{status:200,headers:{'content-type':'application/json'}});};
 globalThis.XMLHttpRequest=class{constructor(){xhrCreated++;}};
 try{
  await assert.rejects(uploadRecording({name:'recording.webm',type:'audio/webm',size:1},'attempt-1',{signal:c.signal}),e=>e.name==='AbortError');
  assert.equal(xhrCreated,0);
 }finally{globalThis.fetch=oldFetch;globalThis.XMLHttpRequest=oldXHR;}
});

test('Live Partner peer creation enforces relay-only ICE and stops tracks on hangup',async()=>{
 let peerConfig=null,trackStopped=0,peerClosed=0,remoteCleared=0;
 const track={enabled:true,stop(){trackStopped++;}};
 const socket={readyState:1,onopen:null,onmessage:null,onclose:null,onerror:null,send(){},close(){}};
 const deps={fetchToken:async()=>({role:'answerer',iceServers:[{urls:'turn:relay.example'}],url:'wss://signal.example',token:'test'}),
  getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}),
  createPeer:cfg=>{peerConfig=cfg;return{addTrack(){},close(){peerClosed++;},connectionState:'new'};},
  createSocket:()=>socket,onRemoteStream:s=>{if(s===null)remoteCleared++;},onStatus(){},report(){}
 };
 const call=new LivePartnerCall('session-1',deps);await call.start();
 assert.equal(peerConfig.iceTransportPolicy,'relay');assert.deepEqual(peerConfig.iceServers,[{urls:'turn:relay.example'}]);
 call.hangup();assert.equal(trackStopped,1);assert.equal(peerClosed,1);assert.equal(remoteCleared,1);
});


test('a signalling reconnect preserves connected audio and avoids a duplicate offer',async()=>{
 const reports=[];let offers=0,stops=0;
 const track={stop(){stops++;}},socket={readyState:1,send(){},close(){}};
 const pc={connectionState:'connected',addTrack(){},close(){},createOffer(){offers++;}};
 const call=new LivePartnerCall('connected-session',{
  fetchToken:async()=>({role:'offerer',iceServers:[],url:'wss://example.test',token:'fixture'}),
  getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}),
  createPeer:()=>pc,createSocket:()=>socket,onStatus(){},onRemoteStream(){},report:state=>reports.push(state)
 });
 try{
  await call.start();call.connection('connected');socket.onclose();
  assert.equal(call.status,'connected');
  assert.deepEqual(reports,['connected']);
  await call.onMessage(JSON.stringify({type:'ready',peerPresent:true}));
  await call.onMessage(JSON.stringify({type:'peer-joined'}));
  assert.equal(offers,0);assert.equal(stops,0);
 }finally{call.destroy();}
});

test('both participants request ICE recovery and a peer creation failure stops the microphone',async()=>{
 const sent=[],track={stops:0,stop(){this.stops++;}};
 const socket={readyState:1,send:message=>sent.push(JSON.parse(message)),close(){}};
 const base={
  fetchToken:async()=>({role:'answerer',iceServers:[],url:'wss://example.test',token:'fixture'}),
  getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}),
  createPeer:()=>({connectionState:'failed',addTrack(){},close(){}}),
  createSocket:()=>socket,onStatus(){},onRemoteStream(){},report(){}
 };
 const answerer=new LivePartnerCall('recovery',base);
 try{
  await answerer.start();await answerer.onMessage(JSON.stringify({type:'ready',peerPresent:false}));await answerer.restartIce();
  assert.equal(sent.at(-1).kind,'restart');
 }finally{answerer.destroy();}
 const failed=new LivePartnerCall('unsupported',{...base,createPeer(){throw Error('unsupported');}});
 await failed.start();
 assert(failed.isDestroyed);assert.equal(track.stops,2);
});
