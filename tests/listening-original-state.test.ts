import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createTestDatabase } from './support/pglite';
import { convertLegacyPackage } from '../src/lib/listening/source-parser';
import { originalListeningState, saveOriginalListeningState, StaleListeningCheckpointError } from '../src/lib/data/listening-original-state';
import { ORIGINAL_TEST_ONE_STORAGE as key } from '../src/lib/listening/original-test-one';
import { adaptOriginalTestOne } from '../src/lib/listening/original-test-one-hooks';
const source=readFileSync(new URL('../content/listening/academic/test-01/source.html',import.meta.url),'utf8');
const pkg=convertLegacyPackage({'source.html':source},1645.061224,html=>new JSDOM(html).window.document,{audioPath:'listening/academic/test-01/full.mp3'});
test('an old exited checkpoint returns the saved state without changing answers or creating another attempt',async()=>{
  const d=await createTestDatabase();
  try {
    const [u]=await d.query<{id:string}>("insert into users(name,role)values('Conflict QA','student')returning id");
    const [t]=await d.query<{id:string}>("insert into listening_tests(created_by_user_id,title,audio_type,publication_state)values($1,'Conflict fixture','audio','published')returning id",[u!.id]);
    await d.query("insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash)values($1,$2,$3,'fixture/audio.mp3',$4)",[t!.id,pkg.testId,JSON.stringify(pkg),'0'.repeat(64)]);
    const saved={[key]:JSON.stringify({attemptKey:'11111111-1111-4111-8111-111111111111',attemptStatus:'exited',answers:{1:'saved answer'},submitted:false})};
    await d.query('insert into listening_authored_checkpoints(user_id,test_id,values)values($1,$2,$3)',[u!.id,t!.id,JSON.stringify(saved)]);
    const old={[key]:JSON.stringify({attemptKey:'22222222-2222-4222-8222-222222222222',attemptStatus:'exited',answers:{1:'offline answer'},submitted:false})};
    await assert.rejects(()=>saveOriginalListeningState(u!.id,t!.id,old,pkg,d.db),error=>{
      assert.ok(error instanceof StaleListeningCheckpointError);assert.deepEqual(error.values,saved);return true;
    });
    assert.deepEqual(await originalListeningState(u!.id,t!.id,d.db),saved);
    const [counts]=await d.query('select (select count(*)::int from listening_attempts) attempts,(select count(*)::int from listening_answers) answers');
    assert.deepEqual(counts,{attempts:0,answers:0});
  } finally {await d.close();}
});
test('original nine-activity document runs all original controls; confirmations stay inside sandbox',()=>{
  const errors:unknown[]=[];
  const html=adaptOriginalTestOne(source);
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://fixture.invalid',beforeParse(window){window.scrollTo=()=>{};window.HTMLMediaElement.prototype.pause=()=>{};window.addEventListener('error',e=>errors.push(e.error));}});
  try {
    assert.deepEqual(errors,[]);
    assert.equal(dom.window.document.querySelectorAll('[data-open]').length,9);
    (dom.window.document.querySelector('[data-open="exam"]') as HTMLElement).click();
    assert.equal(dom.window.document.querySelector('#startScreen')!.classList.contains('hidden'),false,'activity opens the Start screen without an artificial delay');
    assert.equal(dom.window.document.querySelector('#examInterface')!.classList.contains('hidden'),true,'opening the activity does not start the exam');
    (dom.window.document.querySelector('#activity-exam [data-back]') as HTMLElement).click();
    for(const id of ['review','script','mcq','map','multi','completion','vocab','retry']){
      (dom.window.document.querySelector(`[data-open="${id}"]`) as HTMLElement).click();
      assert.ok(dom.window.document.querySelector(`#activity-${id}.active`),id);
    }
    assert.equal(dom.window.document.querySelectorAll('#retryHost .panel').length,1);
    assert.doesNotMatch(html,/!confirm\(/);
  } finally{dom.window.close();}
});
test('original checkpoint writes canonical drafts, grades swapped Choose TWO once, restores across devices, isolates students',async()=>{
  const d=await createTestDatabase();
  try{
    const [u,other]=await d.query<{id:string}>("insert into users(name,role)values('Original QA','student'),('Other QA','student')returning id");
    const [t]=await d.query<{id:string}>("insert into listening_tests(created_by_user_id,title,audio_type,publication_state)values($1,'Listening Test 1','audio','published')returning id",[u!.id]);
    await d.query("insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash)values($1,$2,$3,'fixture/audio.mp3',$4)",[t!.id,pkg.testId,JSON.stringify(pkg),'0'.repeat(64)]);
    for(const q of pkg.questions) await d.query('insert into listening_questions(test_id,"order",type,question_text,correct_answer,explanation)values($1,$2,\'short_answer\',$3,$4,$5)',[t!.id,q.number,q.text,q.key,q.evidence.why]);
    const answers=Object.fromEntries(pkg.questions.map(q=>[q.number,q.key]));
    [answers[25],answers[26]]=[answers[26]!,answers[25]!];
    const values={[key]:JSON.stringify({attemptStatus:'in_progress',answers,audioPosition:321}),la_listening_test_1_practice:JSON.stringify({views:{multi:{multiIndex:1}}})};
    const first=await saveOriginalListeningState(u!.id,t!.id,values,pkg,d.db);
    const repeated=await saveOriginalListeningState(u!.id,t!.id,values,pkg,d.db);
    assert.equal(first.attemptId,repeated.attemptId);
    const [draft]=await d.query<{answers:Record<string,string>;audio_position:number}>('select answers,audio_position from listening_drafts where attempt_id=$1',[first.attemptId]);
    assert.equal(Object.keys(draft!.answers).length,40);assert.equal(draft!.audio_position,321);
    assert.deepEqual(await originalListeningState(u!.id,t!.id,d.db),values);
    assert.deepEqual(await originalListeningState(other!.id,t!.id,d.db),{});
    await d.query('delete from listening_authored_checkpoints where user_id=$1 and test_id=$2',[u!.id,t!.id]);
    const restored=JSON.parse((await originalListeningState(u!.id,t!.id,d.db))[key]!);
    assert.deepEqual(restored.answers,answers);assert.equal(restored.audioPosition,321);assert.equal(restored.attemptStatus,'in_progress');
    const done=await saveOriginalListeningState(u!.id,t!.id,{...values,[key]:JSON.stringify({attemptStatus:'submitted',answers,lastResults:[{q:1,ok:false}]})},pkg,d.db);
    assert.equal(JSON.parse(done.values[key]!).lastResults.filter((r:{ok:boolean})=>r.ok).length,40);
    const tampered=await saveOriginalListeningState(u!.id,t!.id,{...values,[key]:JSON.stringify({attemptStatus:'submitted',answers:{1:'wrong'}})},pkg,d.db);
    assert.equal(JSON.parse(tampered.values[key]!).lastResults.filter((r:{ok:boolean})=>r.ok).length,40);
    const [counts]=await d.query<{attempts:number;answers:number}>("select (select count(*)::int from listening_attempts) attempts,(select count(*)::int from listening_answers) answers");
    assert.deepEqual(counts,{attempts:1,answers:40});
    await assert.rejects(()=>saveOriginalListeningState(u!.id,t!.id,{[key]:JSON.stringify({answers:{41:'foreign'}})},pkg,d.db),{name:'ZodError'});
  }finally{await d.close();}
});
