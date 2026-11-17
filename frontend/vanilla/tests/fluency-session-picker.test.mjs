import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../js/api-client.js';
import {createQuestionPicker} from '../modules/speaking/fluency-questions.js';
import {createRoundRecording} from '../modules/speaking/round-recording.js';
const q=(number,level='intermediate',topic='Home')=>({id:`00000000-0000-4000-8000-${String(number).padStart(12,'0')}`,part:'part1',topic,promptText:'Describe your hometown.',difficulty:level});

test('level is sent to the server and complete session order survives successive answers',async()=>{
 const request=api.request,calls=[];
 try{
  api.request=async path=>{calls.push(path);const level=new URL(path,'https://fixture.invalid').searchParams.get('level');return {level,questions:[q(1,level),q(2,level),q(3,level,'Work')]};};
  const picker=createQuestionPicker();
  assert.equal((await picker.next()).id,q(1).id);
  assert.equal((await picker.next()).id,q(2).id);
  assert.equal((await picker.next()).topic,'Work');
  assert.equal(calls.length,1);
  assert.equal((await picker.next(undefined,{level:'advanced'})).difficulty,'advanced');
  assert.equal(calls.length,2);
  assert.match(calls[1],/level=advanced/);
 }finally{api.request=request;}
});

test('a response containing a different difficulty is rejected instead of leaking into the session',async()=>{
 const request=api.request;
 try{api.request=async()=>({level:'beginner',questions:[q(1,'advanced')]});await assert.rejects(createQuestionPicker().next(undefined,{level:'beginner'}),{code:'question_unavailable'});}
 finally{api.request=request;}
});

test('round capture uses the existing stream, flushes real bytes and stops idempotently',async()=>{
 const stream={identity:'existing microphone'};let instance;
 class Recorder extends EventTarget{
  static isTypeSupported(){return true;}
  constructor(input){super();assert.equal(input,stream);instance=this;this.mimeType='audio/webm';this.stops=0;}
  start(){}
  stop(){this.stops++;const event=new Event('dataavailable');event.data=new Blob(['original bytes']);this.dispatchEvent(event);this.dispatchEvent(new Event('stop'));}
 }
 const recording=createRoundRecording(stream,{Recorder});
 const first=recording.stop(),second=recording.stop();assert.equal(first,second);
 assert.equal(await (await first).text(),'original bytes');assert.equal(instance.stops,1);
});
