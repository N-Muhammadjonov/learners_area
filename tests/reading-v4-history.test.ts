import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { saveContentDraft, publishContentVersion } from "../src/lib/content/authoring";
import { startAcademicSet } from "../src/lib/data/reading-assessments";
import { getAttemptDetail, saveDraftAnswers } from "../src/lib/data/reading";
import { listGeneralSets } from "../src/lib/data/general-reading";
import { submitReadingAttempt } from "../src/lib/services/reading/submit";
import { readingDraftEditable } from "../src/lib/services/reading/authoring-guard";

test("R-V4-22 actual V1 start/draft/resume/submit survives V2 drafting/publication; V2 learner gets new canonical rows",async()=>{
 const env=await createTestDatabase();
 try {
  const [owner,a,b]=await env.query<{id:string}>("insert into users(name,role) values ('Owner','owner'),('A','student'),('B','student') returning id");
  const actor={id:owner!.id,role:'owner',mayPublish:true};
  const draft=async(version:number)=>env.db.transaction(tx=>saveContentDraft(tx,{
    actor,module:'reading',contentType:'general_set',sourceRef:'qa-reading-history',title:`QA version ${version}`,track:'academic',
    payload:{suggestedMinutes:60,passages:[1,2,3].map(p=>({title:`V${version} Passage ${p}`,bodyText:`Revision ${version}, passage ${p}. `+'Authored QA passage text. '.repeat(5),
      questions:Array.from({length:p===3?14:13},(_,i)=>({typeCode:'short_answer',questionText:`V${version} question ${i+1}`,correctAnswer:`key${version}`,evidenceQuote:`Revision ${version}`,explanation:`Explanation V${version}`}))}))}
  }));
  const v1=await draft(1);assert.ok(v1.ok);if(!v1.ok)throw Error('v1');
  assert.equal(await startAcademicSet(a!.id,v1.version.targetId!,env.db),null,'draft cannot start');
  assert.equal((await env.db.transaction(tx=>publishContentVersion(tx,{actor:{...actor,role:'teacher',mayPublish:false},versionId:v1.version.id,to:'published'}))).ok,false);
  assert.equal((await env.db.transaction(tx=>publishContentVersion(tx,{actor,versionId:v1.version.id,to:'published'}))).ok,true);
  const id=await startAcademicSet(a!.id,v1.version.targetId!,env.db);assert.ok(id);
  assert.equal(await startAcademicSet(a!.id,v1.version.targetId!,env.db),id,'resume, not duplicate');
  const before=(await getAttemptDetail(id!,a!.id,env.db))!;
  assert.equal(before.sections.length,3);assert.equal(before.questions.length,40);assert.equal(before.attempt.contentVersionId,v1.version.id);
  const entries=before.questions.map(q=>({questionId:q.id,answer:'key1'}));
  assert.equal((await saveDraftAnswers(id!,a!.id,entries,env.db)).saved,40);
  assert.equal(await getAttemptDetail(id!,b!.id,env.db),null);
  assert.equal((await submitReadingAttempt(id!,b!.id,entries,env.db)).ok,false);
  const v2=await draft(2);assert.ok(v2.ok);if(!v2.ok)throw Error('v2');
  assert.notEqual(v2.version.targetId,v1.version.targetId);
  assert.deepEqual((await getAttemptDetail(id!,a!.id,env.db))!.questions,before.questions,'draft cannot replace a published question');
  assert.equal((await listGeneralSets(b!.id,{academic:true},env.db)).length,1);
  assert.equal((await env.db.transaction(tx=>publishContentVersion(tx,{actor,versionId:v2.version.id,to:'published'}))).ok,true);
  assert.equal(await startAcademicSet(b!.id,v1.version.targetId!,env.db),null,'old revision withdrawn from new starts, not deleted');
  const catalogue=await listGeneralSets(b!.id,{academic:true},env.db);assert.deepEqual(catalogue.map(s=>s.id),[v2.version.targetId]);
  const id2=await startAcademicSet(b!.id,v2.version.targetId!,env.db);assert.ok(id2);
  const after=(await getAttemptDetail(id!,a!.id,env.db))!;
  assert.deepEqual(after.questions,before.questions);assert.equal(after.answers.length,40);assert.equal(after.sections[0]!.passage.bodyText,before.sections[0]!.passage.bodyText);
  const newer=(await getAttemptDetail(id2!,b!.id,env.db))!;
  assert.equal(newer.attempt.contentVersionId,v2.version.id);assert.ok(newer.questions.every(q=>q.correctAnswer==='key2'));
  for(const section of after.sections) assert.equal(await env.db.transaction(tx=>readingDraftEditable(tx,section.passage.id)),false);
  // A real database write failure rolls back score AND answer replacement.
  await env.query(`create function qa_reading_fail() returns trigger language plpgsql as $$begin raise exception 'QA forced failure'; end$$`);
  await env.query("create trigger qa_reading_fail before insert on activity_events for each row execute function qa_reading_fail()");
  await assert.rejects(()=>submitReadingAttempt(id!,a!.id,entries,env.db));
  assert.equal((await getAttemptDetail(id!,a!.id,env.db))!.attempt.status,'in_progress');
  assert.equal((await getAttemptDetail(id!,a!.id,env.db))!.answers.length,40);
  await env.query('drop trigger qa_reading_fail on activity_events');
  const result=await submitReadingAttempt(id!,a!.id,entries,env.db);assert.deepEqual(result,{ok:true,score:40,totalQuestions:40});
  const review=(await getAttemptDetail(id!,a!.id,env.db))!;
  assert.ok(review.answers.every(answer=>answer.isCorrect));assert.ok(review.questions.every(q=>q.explanation==='Explanation V1'));
  assert.equal((await saveDraftAnswers(id!,a!.id,[],env.db)).reason,'already_submitted');
  assert.equal((await submitReadingAttempt(id!,a!.id,[],env.db)).ok,false,'re-submit cannot regrade');
  assert.equal((await getAttemptDetail(id!,a!.id,env.db))!.attempt.score,40);
  assert.equal((await env.query<{n:number}>("select count(*)::int n from reading_questions"))[0]!.n,80,'both revisions retained, no cascade');
 }finally{await env.close();}
});
