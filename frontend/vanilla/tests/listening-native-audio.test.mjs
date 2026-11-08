import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {nativeAudioBridge} from '../modules/listening/media/native-bridge.js';
import {NativeFrameMedia} from '../modules/listening/media/native-controller.js';
import {listeningAudio} from '../modules/listening/audio-preload.js';
import {privateScope} from '../js/private-scope.js';

const origin='https://learnersarea.uz',resource='/api/resources/listening/academic/one/full.mp3';
const turn=()=>new Promise(r=>setImmediate(r));
test('the frame keeps native playback and only enables Start after its authorized Blob is playable',async()=>{
 const dom=new JSDOM('<button id="startTestBtn">Start Test</button><audio id="sharedAudio" src="la-media:0"></audio>',{runScripts:'outside-only',url:origin}),w=dom.window;
 await new Promise(r=>w.addEventListener('load',r,{once:true}));
 const audio=w.document.getElementById('sharedAudio'),start=w.document.getElementById('startTestBtn');let ready=0,played=0,starts=0;
 const play=function(){played++;return Promise.resolve();},pause=function(){};
 w.HTMLMediaElement.prototype.play=play;w.HTMLMediaElement.prototype.pause=pause;w.HTMLMediaElement.prototype.load=function(){};
 Object.defineProperty(audio,'readyState',{get:()=>ready});w.URL.createObjectURL=()=> 'blob:opaque-frame';w.URL.revokeObjectURL=()=>{};
 w.eval(nativeAudioBridge('test-token',[{id:'0',path:'audio/full.mp3'}]));
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));start.onclick=()=>{starts++;audio.play();};
 const deliver=(token,source=w.parent)=>w.dispatchEvent(new w.MessageEvent('message',{source,data:{channel:'learners-area-native-audio',token,id:'0',blob:new w.Blob(['mp3'],{type:'audio/mpeg'})}}));
 try{
  assert.equal(w.HTMLMediaElement.prototype.play,play);assert.equal(w.HTMLMediaElement.prototype.pause,pause);
  assert.equal(start.disabled,true);start.click();assert.equal(starts,0);
  deliver('wrong-token');assert.equal(audio.getAttribute('src'),'la-media:0');
  deliver('test-token',{});assert.equal(audio.getAttribute('src'),'la-media:0');
  deliver('test-token');assert.equal(audio.getAttribute('src'),'blob:opaque-frame');assert.equal(start.disabled,true);
  ready=4;audio.dispatchEvent(new w.Event('canplay'));assert.equal(start.disabled,false);
  start.click();assert.equal(starts,1);assert.equal(played,1);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});

for(const mode of ['allowed','revoked','disposed'])test('retained Blob delivery requires fresh authority: '+mode,async()=>{
 globalThis.location={origin};privateScope.setScope('native-qa');const originalFetch=globalThis.fetch;let checked=0,resolveGrant;
 const sent=[];
 globalThis.fetch=async url=>url.includes('capability=1')?Response.json({url:resource+'?stream=1'}):new Response(new Uint8Array(8),{headers:{'Content-Type':'audio/mpeg','Content-Length':'8'}});
 const controller=new NativeFrameMedia([{id:'0',url:resource}],()=>{},{testId:'native-one',send:(channel,data)=>sent.push({channel,data}),fetch:async()=>{
  checked++;if(mode==='disposed')return new Promise(r=>resolveGrant=r);
  return mode==='revoked'?new Response(null,{status:403}):Response.json({expiresAt:Date.now()+120000});
 }});
 try{
  const loading=controller.load(controller.items[0]);
  if(mode==='disposed'){for(let i=0;i<30&&!resolveGrant;i++)await turn();assert(resolveGrant);controller.dispose();resolveGrant(Response.json({expiresAt:Date.now()+120000}));}
  await loading;assert.equal(checked,1);
  assert.equal(sent.filter(p=>p.channel==='learners-area-native-audio').length,mode==='allowed'?1:0);
  if(mode==='allowed'){assert.equal(sent[0].data.blob.size,8);assert.equal('url' in sent[0].data,false);}
 }finally{controller.dispose();listeningAudio.clear();privateScope.setScope(null);globalThis.fetch=originalFetch;delete globalThis.location;}
});
