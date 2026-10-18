import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import catalogue from '../src/lib/listening/original-listening-catalogue.json';
import {adaptOriginalListening,adaptOriginalTestOne} from '../src/lib/listening/original-test-one-hooks';
import {authoredMediaBridge} from '../src/lib/listening/authored-media-bridge';
import {isolateAuthoredDocument} from '../src/lib/listening/authored-sandbox';
for(let number=1;number<=32;number++)test(`Test ${number}: trusted media facade preserves original Start/timer and state events`,async()=>{
 const definition=(catalogue as Record<string,{number:number;storageKey:string;durationSeconds:number;media:{path:string;contentType:string;durationSeconds:number}[]}>)[`listening-test-${number}`];
 const source=readFileSync(`content/listening/academic/test-${String(number).padStart(2,'0')}/source.html`,'utf8');
 let html=number===1?adaptOriginalTestOne(source):adaptOriginalListening(source,definition!);
 const items=number===1?[{path:'audio/full.mp3',durationSeconds:1645.061224}]:definition!.media.filter(item=>item.contentType.startsWith('audio/'));
 items.forEach((item,index)=>{html=html.replaceAll(`[embedded:${item.path}]`,'la-media:'+index).replaceAll(item.path,'la-media:'+index);});
 const packets:Record<string,unknown>[]=[],host={postMessage:(data:Record<string,unknown>)=>packets.push(data)},errors:unknown[]=[];
 const dom=new JSDOM(isolateAuthoredDocument(html,authoredMediaBridge('fixture',items.map((item,index)=>({id:String(index),duration:item.durationSeconds})))),{runScripts:'dangerously',url:'https://opaque.fixture',virtualConsole:new VirtualConsole(),beforeParse(w){Object.defineProperty(w,'parent',{value:host});w.scrollTo=()=>{};w.addEventListener('error',event=>errors.push(event.error));}});
 const reply=(data:Record<string,unknown>)=>dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:host as unknown as Window,data:{channel:'learners-area-media-state',token:'fixture',...data}}));
 try {
  assert.deepEqual(errors,[]);assert.equal(dom.window.document.querySelectorAll('[data-open]').length,number===1?9:dom.window.eval('ACTIVITIES.length'));
  assert.equal(packets.some(packet=>packet.action==='play'),false,'the hub never autoplays audio');
  dom.window.eval("openActivity('exam');startExam()");
  assert.equal(dom.window.eval('state.examTimer'),null,'the source timer is gated by real parent playback');
  const play=packets.find(packet=>packet.action==='play')!;assert.ok(play,JSON.stringify(packets));
  const snapshot={mediaId:'0',currentTime:0,duration:items[0]!.durationSeconds,paused:false,ended:false,readyState:4,playbackRate:1,volume:1,error:null};
  reply({requestId:play.requestId,ok:true,snapshot});await Promise.resolve();await Promise.resolve();assert.ok(dom.window.eval('state.examTimer'));
  reply({event:'timeupdate',snapshot:{...snapshot,currentTime:15}});assert.equal(dom.window.document.querySelector<HTMLAudioElement>('#sharedAudio')!.currentTime,15);
  dom.window.eval("openActivity('review')");assert.equal(dom.window.document.querySelector('.activity.active')!.id,'activity-exam','active exam restrictions are preserved');
  if(number===8){reply({event:'ended',snapshot:{...snapshot,currentTime:items[0]!.durationSeconds,ended:true}});assert.ok(packets.some(packet=>packet.action==='play'&&packet.mediaId==='1'),'native ended transitions to the next original split part');}
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
