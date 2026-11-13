import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {reviewMaterial} from '../modules/listening/review-v16.js';

const root=new URL('../../../',import.meta.url);
const source=readFileSync(new URL('content/listening/academic/test-10/source.html',root),'utf8');
const runtimeRaw=readFileSync(new URL('services/backend/assets/listening/test-10.json',root),'utf8');
const runtime=JSON.parse(runtimeRaw);
const manifest=JSON.parse(readFileSync(new URL('services/backend/assets/listening/manifest.json',root),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const data=JSON.parse(source.split('const DATA=',2)[1].split(';\n',1)[0]);

test('Test 10 original HTML and runtime are byte-identical and checksum-pinned',()=>{
 assert.equal(runtime.files[runtime.entryPath],source);
 assert.equal(hash(source),manifest.entries['test-10'].sourceSha256);
 assert.equal(hash(runtimeRaw),manifest.entries['test-10'].runtimeSha256);
 assert.equal(Buffer.byteLength(runtimeRaw),manifest.entries['test-10'].bytes);
});

test('all four source transcript sections match their original learning topics',()=>{
 assert.deepEqual(Object.keys(data.transcript),['1','2','3','4']);
 for(let part=1;part<=4;part++)assert(data.transcript[part].length>=1000,'Part '+part+' is blank');
 assert.match(data.transcript[1],/Anna Black/);
 assert.match(data.transcript[2],/Green Island/);
 assert.match(data.transcript[3],/Professor North/);
 assert.match(data.transcript[3],/Sarah/);
 assert.match(data.transcript[3],/Mike/);
 assert.doesNotMatch(data.transcript[3],/Maya:|Liam:/);
 assert.match(data.transcript[4],/role reversal/);
 for(let part=1;part<=4;part++){
  const bounds=data.part_audio_boundaries[part];
  assert(bounds.end>bounds.start,'Part '+part+' audio duration must be positive');
 }
});

test('Script Completion has 8 ordered, exact, source-backed gaps per Part',()=>{
 assert.equal(data.script_completion.length,32);
 for(let part=1;part<=4;part++){
  const rows=data.script_completion.filter(g=>g.part===part).sort((a,b)=>a.n-b.n);
  assert.equal(rows.length,8);
  const body=data.transcript[part],seen=new Set();
  let offset=0;
  for(const row of rows){
   assert(!seen.has(row.q),'duplicate gap ID');
   seen.add(row.q);
   const index=body.indexOf(row.match,offset);
   assert(index>=offset,'Part '+part+' gap '+row.n+' missing or out of order: '+row.match);
   assert.equal(row.answer,row.match);
   offset=index+row.match.length;
  }
 }
});

test('Test 10 uses the actual native audio trainer, not a no-op source placeholder',()=>{
 assert.equal(data.audio_available,true);
 assert.match(source,/function renderTrainer\(el,start,end\)[\s\S]*?trainer-play/);
 assert.match(source,/function playWindow\(start,end,button\)[\s\S]*?a\.play\(\)/);
 assert.match(source,/function buildScriptTranscript\(part\)[\s\S]*?data-script-source-start/);
 assert.doesNotMatch(source,/function renderTrainer\(el,start,end\)\{stopActiveClip\(\);cleanupTrainer\(\);trainer=null;/);
 assert.doesNotMatch(source,/Audio source unavailable\. The supplied raw HTML/);
});

test('Review displays the original source questions without fabricating Test 10 clip timings',()=>{
 for(let part=1;part<=4;part++){
  const row=reviewMaterial(data,part);
  assert.equal(row.start,data.part_audio_boundaries[part].start);
  assert.equal(row.end,data.part_audio_boundaries[part].end);
  assert.equal(row.transcript,data.transcript[part]);
  assert.equal(row.incompleteSource,true);
 }
});

test('all other Listening reviews still enforce complete source and precise question audio windows',()=>{
 const broken={...data,test_id:'listening-test-11'};
 assert.throws(()=>reviewMaterial(broken,1),/Review feedback or question mapping unavailable/);
});

test('passive page visibility and focus never trigger a Review access block',()=>{
 const code=readFileSync(new URL('frontend/vanilla/modules/listening/authored.js',root),'utf8');
 assert.doesNotMatch(code,/Rechecking Review access|Review ruxsati qayta tekshirilmoqda/);
 assert.doesNotMatch(code,/visibilitychange',authorityHint/);
 assert.doesNotMatch(code,/focus',event=>\{const outside=focusOutside/);
 assert.match(code,/new ReviewAuthorityBarrier/);
 assert.match(code,/assertReviewOwner/);
});
