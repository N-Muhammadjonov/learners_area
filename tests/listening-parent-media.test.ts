import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthoredMediaController} from '../src/lib/client/authored-media-controller';
Object.defineProperty(globalThis,'window',{value:{location:{origin:'https://app.fixture'}},configurable:true});
class AudioFixture extends EventTarget {
 src='';preload='';currentTime=0;duration=100;paused=true;ended=false;readyState=4;playbackRate=1;volume=1;error:{code:number}|null=null;plays=0;failure:Error|null=null;release:(()=>void)|null=null;hold=false;
 pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
 load(){this.error=null;}
 removeAttribute(name:string){if(name==='src')this.src='';}
 async play(){this.plays++;if(this.failure){const error=this.failure;this.failure=null;throw error;}if(this.hold)await new Promise<void>(resolve=>{this.release=resolve;});this.paused=false;this.dispatchEvent(new Event('play'));}
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup(){const audio=new AudioFixture(),packets:Record<string,unknown>[]=[];let reads=0;const controller=new AuthoredMediaController([{id:'0',url:'/api/resources/a.mp3'},{id:'1',url:'/api/resources/b.mp3'}],packet=>packets.push(packet),{createAudio:()=>audio as unknown as HTMLAudioElement,fetch:async()=>{reads++;return {ok:true,json:async()=>({url:'https://media.fixture/object?temporary=fixture',expiresAt:Date.now()+60000,key:'object'})} as Response;}});return {audio,packets,controller,reads:()=>reads};}
test('native parent prepares only after hub acknowledgement; play acknowledgement follows actual playback',async()=>{
 const f=setup();assert.equal(f.reads(),0);f.controller.prepare();await settle();assert.equal(f.reads(),1);assert.equal(f.audio.preload,'auto');
 f.audio.hold=true;const playing=f.controller.command({mediaId:'0',action:'play',requestId:1});await settle();assert.equal(f.packets.some(p=>p.requestId===1),false,'the original exam timer must not begin before actual playback');
 f.audio.release!();await playing;assert.equal(f.packets.find(p=>p.requestId===1)?.ok,true);
 await f.controller.command({mediaId:'0',action:'seek',value:42});await f.controller.command({mediaId:'0',action:'rate',value:1.5});await f.controller.command({mediaId:'0',action:'volume',value:.4});
 assert.equal(f.audio.currentTime,42);assert.equal(f.audio.playbackRate,1.5);assert.equal(f.audio.volume,.4);
 assert.doesNotMatch(JSON.stringify(f.packets),/media\.fixture|temporary=/,'no capability URL enters the iframe bridge');f.controller.dispose();assert.equal(f.audio.src,'');
});
test('autoplay denial is returned without renewing authorization; cancellation cannot start an exam timer',async()=>{
 const f=setup();f.controller.prepare();await settle();f.audio.failure=new DOMException('gesture required','NotAllowedError');await f.controller.command({mediaId:'0',action:'play',requestId:2});assert.equal(f.reads(),1);assert.equal(f.packets.find(p=>p.requestId===2)?.error,'NotAllowedError');
 f.audio.hold=true;const playing=f.controller.command({mediaId:'0',action:'play',requestId:3});await settle();await f.controller.command({mediaId:'0',action:'pause'});f.audio.release!();await playing;assert.equal(f.audio.paused,true,'cancelled asynchronous playback must actually stop');assert.equal(f.packets.find(p=>p.requestId===3)?.ok,false);assert.equal(f.packets.find(p=>p.requestId===3)?.error,'AbortError');f.controller.dispose();
});
test('an obsolete split-part capability cannot replace the selected part',async()=>{
 const audio=new AudioFixture(),resolve:((value:Response)=>void)[]=[],packets:Record<string,unknown>[]=[];
 const controller=new AuthoredMediaController([{id:'0',url:'/api/resources/a.mp3'},{id:'1',url:'/api/resources/b.mp3'}],packet=>packets.push(packet),{createAudio:()=>audio as unknown as HTMLAudioElement,fetch:async()=>new Promise<Response>(r=>resolve.push(r))});
 controller.prepare();const second=controller.command({mediaId:'1',action:'load'});
 resolve[1]!({ok:true,json:async()=>({url:'https://media.fixture/part-two',expiresAt:Date.now()+60000,key:'b.mp3'})} as Response);await second;
 resolve[0]!({ok:true,json:async()=>({url:'https://media.fixture/part-one',expiresAt:Date.now()+60000,key:'a.mp3'})} as Response);await settle();assert.equal(audio.src,'https://media.fixture/part-two');controller.dispose();
});
test('transport recovery renews once and retains position, rate, volume and play intention',async()=>{
 const f=setup();f.controller.prepare();await settle();f.audio.currentTime=33;f.audio.playbackRate=1.75;f.audio.volume=.3;f.audio.failure=new DOMException('expired transport','NotSupportedError');
 await f.controller.command({mediaId:'0',action:'play',requestId:4});assert.equal(f.reads(),2);assert.equal(f.audio.currentTime,33);assert.equal(f.audio.playbackRate,1.75);assert.equal(f.audio.volume,.3);assert.equal(f.audio.paused,false);assert.equal(f.packets.find(p=>p.requestId===4)?.ok,true);
 f.audio.error={code:2};f.audio.dispatchEvent(new Event('error'));await settle();assert.equal(f.reads(),2,'a persistent error cannot create an authorization retry loop');f.controller.dispose();
});
test('a later native network error renews once; a saved seek waits for metadata without losing position',async()=>{
 const f=setup();f.controller.prepare();await settle();f.audio.readyState=0;
 await f.controller.command({mediaId:'0',action:'seek',value:27});f.audio.currentTime=0;f.audio.readyState=1;f.audio.dispatchEvent(new Event('loadedmetadata'));assert.equal(f.audio.currentTime,27,'Safari metadata arrival reapplies the pending resume position');
 await f.controller.command({mediaId:'0',action:'play',requestId:5});f.audio.currentTime=45;f.audio.error={code:2};f.audio.dispatchEvent(new Event('error'));await settle();assert.equal(f.reads(),2);assert.equal(f.audio.currentTime,45);assert.equal(f.audio.paused,false);
 f.audio.error={code:2};f.audio.dispatchEvent(new Event('error'));await settle();assert.equal(f.reads(),2);
 await f.controller.command({mediaId:'foreign',action:'play',requestId:6});await f.controller.command({mediaId:'0',action:'fetch',requestId:7});assert.equal(f.reads(),2,'unknown media IDs and operations cannot create capabilities');f.controller.dispose();
});

test('split-part transition can play directly after ended without a false cancellation',async()=>{
 const f=setup();f.controller.prepare();await settle();
 await f.controller.command({mediaId:'1',action:'play',requestId:8});
 assert.equal(f.packets.find(p=>p.requestId===8)?.ok,true);assert.equal(f.audio.paused,false);f.controller.dispose();
});

test('long recordings can renew later expired capabilities without a periodic identity poll or retry loop',async()=>{
 const audio=new AudioFixture();let now=Date.now(),reads=0;
 const controller=new AuthoredMediaController([{id:'0',url:'/api/resources/a.mp3'}],()=>{},{createAudio:()=>audio as unknown as HTMLAudioElement,now:()=>now,fetch:async()=>{reads++;return Response.json({url:'https://media.fixture/part',expiresAt:now+120000,key:'a.mp3'});}});
 controller.prepare();await settle();await controller.command({mediaId:'0',action:'play',requestId:10});audio.currentTime=25;
 audio.error={code:2};audio.dispatchEvent(new Event('error'));await settle();assert.equal(reads,2);
 audio.error={code:2};audio.dispatchEvent(new Event('error'));await settle();assert.equal(reads,2,'one recovery per still-valid transport prevents a burst loop');
 now+=120001;audio.currentTime=140;audio.error={code:2};audio.dispatchEvent(new Event('error'));await settle();assert.equal(reads,3);assert.equal(audio.currentTime,140);assert.equal(audio.paused,false);controller.dispose();
});
