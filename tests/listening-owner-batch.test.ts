import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {authoredBatchPackage} from '../scripts/listening-authored-batch-package';
import {adaptOriginalListening} from '../src/lib/listening/original-test-one-hooks';
import {originalListeningDefinition,originalListeningStorageKey} from '../src/lib/listening/original-listening';
import {createTestDatabase} from './support/pglite';
import {originalListeningState,saveOriginalListeningState} from '../src/lib/data/listening-original-state';
import {gradePackage} from '../src/lib/listening/package';

for(let number=2;number<=32;number++)test(`owner Test ${number}: canonical keys, original activities and Start work`,async()=>{
 const {manifest,canonical,stored}=authoredBatchPackage(number);
 assert.equal(stored.questions.length,40);assert.equal(stored.sections.length,4);
 if(number===4){assert.ok(stored.questions.filter(q=>q.number>=21&&q.number<=26).every(q=>q.kind==='matching'));assert.ok(stored.questions.filter(q=>q.number>=27&&q.number<=30).every(q=>q.kind==='mcq'));}
 const answers=Object.fromEntries(stored.questions.map(q=>[q.number,q.key]));
 assert.equal(gradePackage(stored,answers).filter(q=>q.correct).length,40);
 for(const question of stored.questions.filter(q=>q.pair.length)){
  const group=[question.number,...question.pair].sort((a,b)=>a-b);
  const rotated={...answers};group.forEach((q,i)=>{rotated[q]=answers[group[(i+1)%group.length]!]!;});
  assert.equal(gradePackage(stored,rotated).filter(q=>q.correct).length,40,'multi answers may swap positions');
  const repeated={...answers};group.forEach(q=>{repeated[q]=answers[group[0]!]!;});
  assert.equal(gradePackage(stored,repeated).filter(q=>group.includes(q.number)&&q.correct).length,1,'duplicates get one mark');
 }
 const definition=originalListeningDefinition('11111111-1111-4111-8111-111111111111',manifest.id)!;
 assert.ok(definition);assert.equal(canonical.sourceRef,manifest.id);
 const source=readFileSync(new URL(`../content/listening/academic/test-${String(number).padStart(2,'0')}/source.html`,import.meta.url),'utf8');
 assert.doesNotMatch(source,/data:audio\//);assert.doesNotMatch(source,/data:image\//);
 const errors:unknown[]=[];
 const html=adaptOriginalListening(source,definition);
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://fixture.invalid',beforeParse(window){window.scrollTo=()=>{};window.HTMLMediaElement.prototype.pause=()=>{};window.HTMLMediaElement.prototype.load=()=>{};window.HTMLMediaElement.prototype.play=()=>Promise.resolve();window.addEventListener('error',e=>errors.push(e.error));}});
 try{
  const document=dom.window.document;
  assert.equal(document.querySelectorAll('[data-open]').length,definition.activityCount);
  for(const button of document.querySelectorAll('[data-open]')){
   (button as HTMLElement).click();await new Promise(resolve=>setImmediate(resolve));
   assert.ok(document.querySelector(`.activity.active`),button.getAttribute('data-open')!);
   (document.querySelector('.activity.active [data-back]') as HTMLElement).click();
   assert.equal(document.getElementById('hub')!.style.display,'block');
  }
  (document.querySelector('[data-open="exam"]') as HTMLElement).click();
  assert.equal(document.getElementById('startScreen')!.classList.contains('hidden'),false);
  (document.getElementById('startTestBtn') as HTMLElement).click();
  const checkpoint=JSON.parse(dom.window.localStorage.getItem(definition.storageKey)!);
  assert.equal(checkpoint.attemptStatus,'in_progress');assert.match(checkpoint.attemptKey,/^[a-f0-9-]{36}$/);
  assert.equal(document.getElementById('examInterface')!.classList.contains('hidden'),false);
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
test('original batch allowlist excludes unrelated sources; colliding source keys are normalized',()=>{
 assert.equal(originalListeningDefinition('11111111-1111-4111-8111-111111111111','listening-test-33'),null);
 assert.equal(originalListeningDefinition('preview','listening-test-2'),null);
 assert.equal(originalListeningStorageKey('listening-test-11'),'la_listening_test_11_v2');
 assert.equal(originalListeningStorageKey('listening-test-22'),'la_listening_test_22_v2');
});
test('split-audio resume restores the correct part and global checkpoint before its first save',()=>{
 const {manifest}=authoredBatchPackage(8),definition=originalListeningDefinition('11111111-1111-4111-8111-111111111111',manifest.id)!;
 const position=definition.media[0]!.durationSeconds+40;
 const source=readFileSync(new URL('../content/listening/academic/test-08/source.html',import.meta.url),'utf8');
 const dom=new JSDOM(adaptOriginalListening(source,definition),{runScripts:'dangerously',url:'https://fixture.invalid',beforeParse(w){w.scrollTo=()=>{};w.HTMLMediaElement.prototype.pause=()=>{};w.HTMLMediaElement.prototype.load=()=>{};w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.localStorage.setItem(definition.storageKey,JSON.stringify({attemptStatus:'in_progress',attemptKey:'11111111-1111-4111-8111-111111111111',answers:{1:'44'},audioPosition:position}));}});
 try{(dom.window.document.querySelector('[data-open="exam"]') as HTMLElement).click();(dom.window.document.getElementById('startTestBtn') as HTMLElement).click();const saved=JSON.parse(dom.window.localStorage.getItem(definition.storageKey)!);assert.equal(saved.audioPosition,position);assert.equal(saved.answers[1],'44');assert.match(dom.window.document.getElementById('sharedAudio')!.getAttribute('src')!,/part-2/);}finally{dom.window.close();}
});
test('two new tests persist canonical answers and grades separately for the same learner',async()=>{
 const d=await createTestDatabase();
 try{
  const [user]=await d.query<{id:string}>("insert into users(name,role) values('Batch fixture','student') returning id");
  for(const n of [2,32]){
   const {stored:pkg}=authoredBatchPackage(n);
   const [row]=await d.query<{id:string}>("insert into listening_tests(title,created_by_user_id,audio_type,publication_state) values($1,$2,'audio','published') returning id",[pkg.title,user!.id]);
   await d.query("insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash)values($1,$2,$3,'fixture/audio.mp3',$4)",[row!.id,pkg.testId,JSON.stringify(pkg),'0'.repeat(64)]);
   for(const q of pkg.questions)await d.query('insert into listening_questions(test_id,"order",type,question_text,correct_answer,explanation)values($1,$2,\'short_answer\',$3,$4,$5)',[row!.id,q.number,q.text,q.key,q.evidence.why]);
   const key=originalListeningStorageKey(pkg.testId),answers=Object.fromEntries(pkg.questions.map(q=>[q.number,q.key]));
   const saved=await saveOriginalListeningState(user!.id,row!.id,{[key]:JSON.stringify({attemptStatus:'in_progress',answers,audioPosition:n})},pkg,d.db);
   assert.equal(JSON.parse((await originalListeningState(user!.id,row!.id,d.db,key))[key]!).audioPosition,n);
   const result=await saveOriginalListeningState(user!.id,row!.id,{[key]:JSON.stringify({attemptStatus:'submitted',answers})},pkg,d.db);
   assert.equal(result.attemptId,saved.attemptId);assert.equal(JSON.parse(result.values[key]!).lastResults.filter((r:{ok:boolean})=>r.ok).length,40);
  }
  const [counts]=await d.query('select (select count(*)::int from listening_attempts) attempts,(select count(*)::int from listening_authored_checkpoints) checkpoints');
  assert.deepEqual(counts,{attempts:2,checkpoints:2});
 }finally{await d.close();}
});
