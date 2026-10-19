import {test} from 'node:test';import assert from 'node:assert/strict';
import {evidenceRange,reviewMaterial,reviewProgress,originalReviewV16} from '../modules/listening/review-v16.js';
const material=()=>({answers:Object.fromEntries(Array.from({length:10},(_,i)=>[i+1,'fixture'])),part_audio_boundaries:{1:{start:0,end:20}},transcript:{1:'One authentic fixture transcript.'},questions:Object.fromEntries(Array.from({length:10},(_,i)=>[i+1,{q:i+1,part:1,timeStart:1,timeEnd:2,...Object.fromEntries(['prompt','answer','evidence','why','trap','paraphrase','mistakeType'].map(k=>[k,'fixture']))}]))});
test('unique verbatim evidence uses original offsets, never paraphrase generation',()=>{assert.deepEqual(evidenceRange('a café b','café'),{start:2,end:6});for(const [t,e]of [['repeated repeated','repeated'],['one','absent'],['one',''],[null,'x'],['aaaa','aa']])assert.equal(evidenceRange(t,e),null);});
test('source material retains exact transcript and authored bounds',()=>assert.deepEqual(reviewMaterial(material(),1),{start:0,end:20,transcript:'One authentic fixture transcript.'}));
for(const [name,mutate]of [['missing transcript',d=>delete d.transcript[1]],['foreign row',d=>d.questions[2].q=1],['foreign part',d=>d.questions[2].part=2],['missing evidence',d=>delete d.questions[2].evidence],['reversed clip',d=>d.questions[2].timeEnd=0],['foreign clip',d=>d.questions[2].timeEnd=21],['nonfinite bounds',d=>d.part_audio_boundaries[1].end=Infinity]])test('fail closed: '+name,()=>{const d=material();mutate(d);assert.throws(()=>reviewMaterial(d,1));});
const status=()=>({completed:0,total:9,complete:false,activities:{review:{done:1,total:40,complete:false,available:true}}});
test('only typed server course status is accepted, no local completion inference',()=>assert.equal(reviewProgress(status()).complete,false));
for(const [name,mutate]of [['missing Review',d=>delete d.activities.review],['array feedback',d=>d.activities=[]],['false counts',d=>d.activities.review.done=41],['string completion',d=>d.complete='true'],['unknown identity',d=>d.activities.foreign=d.activities.review]])test('reject course '+name,()=>{const d=status();mutate(d);assert.throws(()=>reviewProgress(d));});
test('injected Review code parses without material or answer corpus',()=>assert.doesNotThrow(()=>new Function(originalReviewV16('fixture-token'))));

for(const [name,mutate]of [['missing key',d=>delete d.answers[1]],['wrong alternatives',d=>d.alternatives={1:['']}],['nonstring key',d=>d.answers[1]=false]])test('reject '+name,()=>{const d=material();mutate(d);assert.throws(()=>reviewMaterial(d,1));});

test('aggregate completion cannot contradict authoritative course counts',()=>{const d=status();d.complete=true;assert.throws(()=>reviewProgress(d));});
