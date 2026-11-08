import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OwnedMediaController} from '../modules/listening/media/shared-v11.js';

class AudioFixture extends EventTarget {
 constructor(){super();Object.assign(this,{currentTime:0,paused:true,readyState:1,seeking:false,error:null,volume:1,playbackRate:1,plays:0});}
 pause(){this.paused=true;}
 removeAttribute(){}
 load(){this.error=null;this.readyState=1;this.seeking=false;}
 async play(){this.plays++;if(this.error)throw new DOMException('Failed preload','NotSupportedError');this.paused=false;}
}
const origin='https://learnersarea.uz';
function fixture(fetcher){
 globalThis.window={location:{origin}};
 const audio=new AudioFixture(),events=[];
 const controller=new OwnedMediaController([{id:'0',url:'/api/resources/listening/academic/test-01/full.mp3'}],p=>events.push(p),{createAudio:()=>audio,fetch:fetcher,commandTimeout:100});
 controller.active='0';controller.capability={expiresAt:Date.now()-1};
 return {audio,events,controller};
}
const grant=()=>Response.json({url:'/api/resources/listening/academic/test-01/full.mp3?stream=1',key:'listening/academic/test-01/full.mp3',expiresAt:Date.now()+120000});

for(const failed of [true,false])test('renew '+(failed?'failed':'expired')+' metadata before awaiting the saved seek',async()=>{
 let reads=0;const {audio,events,controller}=fixture(async()=>{reads++;return grant();});
 audio.currentTime=37;audio.playbackRate=1.5;audio.volume=.4;controller.pendingSeek=37;
 if(failed)audio.error={code:4};else audio.seeking=true;
 try{
  await controller.command({mediaId:'0',action:'play',requestId:1});
  assert.equal(reads,1);assert.equal(audio.plays,1);assert.equal(audio.currentTime,37);
  assert.equal(audio.playbackRate,1.5);assert.equal(audio.volume,.4);
  assert.equal(new URL(audio.src).origin,origin);assert.equal(new URL(audio.src).search,'?stream=1');
  assert(events.some(e=>e.requestId===1&&e.ok===true));
  assert(!events.some(e=>e.requestId===1&&e.ok===false));
 }finally{controller.dispose();}
});

test('Pause cancels a renewal without starting late playback',async()=>{
 let finish;const {audio,events,controller}=fixture(()=>new Promise(resolve=>finish=resolve));
 audio.error={code:4};
 const playing=controller.command({mediaId:'0',action:'play',requestId:1});
 await Promise.resolve();await Promise.resolve();
 await controller.command({mediaId:'0',action:'pause'});finish(grant());await playing;
 await Promise.resolve();await Promise.resolve();
 assert.equal(audio.plays,0);assert(audio.paused);
 assert(events.some(e=>e.requestId===1&&e.ok===false));
 assert(!events.some(e=>e.requestId===1&&e.ok===true));controller.dispose();
});

test('a failed renewal acknowledges failure and a later play can retry',async()=>{
 let reads=0;const {audio,events,controller}=fixture(async()=>++reads===1?new Response(null,{status:503}):grant());
 audio.error={code:4};
 try{
  await controller.command({mediaId:'0',action:'play',requestId:1});
  assert(events.some(e=>e.requestId===1&&e.ok===false));assert.equal(audio.plays,0);
  await controller.command({mediaId:'0',action:'play',requestId:2});
  assert.equal(reads,2);assert.equal(audio.plays,1);assert(events.some(e=>e.requestId===2&&e.ok===true));
 }finally{controller.dispose();}
});
