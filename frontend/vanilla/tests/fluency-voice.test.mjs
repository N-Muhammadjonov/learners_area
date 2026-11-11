import test from 'node:test';import assert from 'node:assert/strict';
import {createEnergyDetector,createVoiceInput,rmsEnergy,CALIBRATION_MS} from '../modules/speaking/voice-activity.js';
import {readFileSync} from 'node:fs';
import {openSpeechClassifier} from '../modules/speaking/speech-classifier.js';
import {DIFFICULTIES} from '../modules/speaking/fluency-engine.js';
function detector(noise=.002){const d=createEnergyDetector(DIFFICULTIES.intermediate);let t=0,s;for(;t<=CALIBRATION_MS;t+=20)s=d.sample(noise,t);assert(s.ready);return {d,get t(){return t;},run(level,ms,speech){for(let n=0;n<ms;n+=20){t+=20;s=d.sample(level,t,speech);}return s;}};}
test('RMS uses real samples and rejects DC offset and invalid samples',()=>{assert.equal(rmsEnergy([1,-1,1,-1]),1);assert.equal(rmsEnergy([.5,.5]),0);assert.equal(rmsEnergy([]),0);assert.throws(()=>rmsEnergy([NaN]));});
test('quiet room and steady fan noise calibrate without speech',()=>{for(const floor of [.002,.025]){const h=detector(floor),s=h.run(floor,5000);assert(!s.speaking);assert(Math.abs(s.noiseFloor-floor)<.001);}});
test('continuous speech activates, short pause holds, long silence releases',()=>{const h=detector();assert(h.run(.07,400).speaking);assert(h.run(.002,100).speaking);assert(!h.run(.002,900).speaking);});
test('isolated keyboard-like bursts and threshold fluctuation do not activate',()=>{const h=detector();for(let i=0;i<20;i++){assert(!h.run(.035,20,false).speaking);assert(!h.run(.002,300,false).speaking);}const low=detector();for(let i=0;i<40;i++){assert(!low.run(.006,20,false).speaking);assert(!low.run(.004,20,false).speaking);}});
test('bad or disconnected calibration reports a clear failure',()=>{for(const [level,code] of [[0,'no_signal'],[.15,'too_noisy']]){const d=createEnergyDetector(DIFFICULTIES.intermediate);assert.throws(()=>{for(let at=0;at<=1300;at+=20)d.sample(level,at);},e=>e.code===code);}});
class Track extends EventTarget{readyState='live';muted=false;stops=0;stop(){this.stops++;this.readyState='ended';}}
function environment({suspended=false,getUserMedia}={}){
 const track=new Track(),stream={getTracks:()=>[track],getAudioTracks:()=>[track]},contexts=[],destinations=[];
 class Context extends EventTarget{constructor(){super();this.state=suspended?'suspended':'running';this.destination={output:true};contexts.push(this);}resume(){this.state='running';return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}createMediaStreamSource(){return {connect:target=>destinations.push(target),disconnect(){}};}createAnalyser(){return {fftSize:1024,getFloatTimeDomainData:buffer=>{for(let i=0;i<buffer.length;i++)buffer[i]=i%2?.02:-.02;},disconnect(){}};}}
 return {track,stream,contexts,destinations,options:{AudioContextClass:Context,mediaDevices:{getUserMedia:getUserMedia??(async()=>stream)},speechFactory:async()=>({classify:()=>true,dispose(){}})}};
}
test('microphone is gesture-opened, resumes audio, reads real buffers, never connects an output',async()=>{const h=environment({suspended:true});let constraints;h.options.mediaDevices.getUserMedia=async c=>{constraints=c;return h.stream;};const input=createVoiceInput(h.options);assert.equal(h.contexts.length,0);await input.open();assert.equal(constraints.video,false);assert.equal(constraints.audio.autoGainControl,false);assert.equal(h.contexts[0].state,'running');assert(Math.abs(input.sample().rms-.02)<.0001);assert(!h.destinations.includes(h.contexts[0].destination));input.dispose();input.dispose();assert.equal(h.track.stops,1);assert.equal(h.contexts[0].state,'closed');});
test('permission denial closes the context and unsupported input is actionable',async()=>{const h=environment({getUserMedia:async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'});}});const input=createVoiceInput(h.options);await assert.rejects(input.open(),e=>e.name==='NotAllowedError');assert.equal(h.contexts[0].state,'closed');await assert.rejects(createVoiceInput({mediaDevices:{},AudioContextClass:null}).open(),e=>e.code==='unsupported');});
test('abort rejects an ignored permission prompt and stops a later granted stream',async()=>{let grant;const h=environment({getUserMedia:()=>new Promise(r=>grant=r)}),controller=new AbortController(),input=createVoiceInput({...h.options,signal:controller.signal}),opening=input.open();controller.abort();await assert.rejects(opening,e=>e.code==='cancelled');grant(h.stream);await Promise.resolve();await Promise.resolve();assert.equal(h.track.stops,1);assert.equal(h.contexts[0].state,'closed');});
test('permission timeout is deterministic and late resources are still stopped',async()=>{let timeout,grant;const h=environment({getUserMedia:()=>new Promise(r=>grant=r)}),input=createVoiceInput({...h.options,setTimer:fn=>{timeout=fn;return 1;},clearTimer:()=>{}}),opening=input.open();timeout();await assert.rejects(opening,e=>e.code==='permission_timeout');grant(h.stream);await Promise.resolve();assert.equal(h.track.stops,1);});
test('track ended and suspended audio interrupt; disposal removes those listeners',async()=>{const h=environment(),events=[],input=createVoiceInput({...h.options,onInterrupted:code=>events.push(code)});await input.open();h.track.dispatchEvent(new Event('ended'));h.contexts[0].state='suspended';h.contexts[0].dispatchEvent(new Event('statechange'));assert.deepEqual(events,['device_interrupted','audio_suspended']);input.dispose();h.track.dispatchEvent(new Event('ended'));assert.equal(events.length,2);});

test('loud non-speech frames cannot trigger the game after calibration',()=>{
 const h=detector();
 for(let at=h.t;at<h.t+4000;at+=20)assert.equal(h.d.sample(.09,at,false).speaking,false);
 assert.equal(h.d.sample(.07,h.t+4100,true).speaking,false);
 assert.equal(h.d.sample(.07,h.t+4440,true).speaking,true);
});


test('local WASM detects recorded speech but does not trigger on fan or broadband noise',async()=>{
 const assets=new URL('../js/vendor/',import.meta.url);
 const model=await WebAssembly.compile(readFileSync(new URL('webrtc-vad/fvad.wasm',assets)));
 const wave=readFileSync(new URL('riwi-speech/qa/en_us.wav',assets));
 let dataOffset=12;
 while(wave.toString('ascii',dataOffset,dataOffset+4)!=='data'){
  const size=wave.readUInt32LE(dataOffset+4);
  dataOffset+=8+size+(size%2);
 }
 const sampleCount=wave.readUInt32LE(dataOffset+4)/4;
 const speech=Float32Array.from({length:sampleCount},(_,i)=>wave.readFloatLE(dataOffset+8+i*4));
 let seed=27;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**31-1;};
 const activeFrames=async signal=>{
  const classifier=await openSpeechClassifier(model),energy=createEnergyDetector(DIFFICULTIES.intermediate);
  let at=0,active=0;
  try{
   const silence=new Float32Array(320);
   for(;at<=CALIBRATION_MS;at+=20)energy.sample(.0001,at,classifier.classify(silence));
   for(let i=0;i+320<=signal.length;i+=320,at+=20){
    const frame=signal.subarray(i,i+320);
    if(energy.sample(rmsEnergy(frame),at,classifier.classify(frame)).speaking)active++;
   }
   return active;
  }finally{classifier.dispose();}
 };
 assert(await activeFrames(speech)>0);
 assert.equal(await activeFrames(Float32Array.from({length:160000},(_,i)=>
  .065*Math.sin(2*Math.PI*120*i/16000)+.008*random())),0);
 assert.equal(await activeFrames(Float32Array.from({length:160000},()=>.1*random())),0);
});
