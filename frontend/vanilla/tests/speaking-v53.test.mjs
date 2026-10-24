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
