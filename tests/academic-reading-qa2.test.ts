import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, readingAttempts, readingAnswers } from "../src/db/schema";
import { importGeneralReadingSet, type GeneralReadingBundle } from "../src/lib/services/reading/general-import";
import { assessmentScope, startAcademicSet } from "../src/lib/data/reading-assessments";
import { getAttemptDetail, saveDraftAnswers } from "../src/lib/data/reading";
import { listLearningLibrary } from "../src/lib/data/reading-library";
import { generalSetDetail } from "../src/lib/data/general-reading";
import { readingSourceAccess } from "../src/lib/services/lexical/context";

test("Academic full set captures all three passages, resumes one private timed assessment, and saves every part without enabling vocabulary", { skip: process.env.QA2_DATABASE_TESTS !== "1" }, async () => {
  const target = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost","127.0.0.1"].includes(target.hostname) && target.pathname === "/learners_qa2");
  const userId = randomUUID(), strangerId = randomUUID();
  await db.insert(users).values([userId,strangerId].map(id=>({id,name:"QA2 academic full",role:"student" as const,accountStatus:"active" as const})));
  const title = `QA2 Full Academic ${randomUUID()}`;
  const bundle: GeneralReadingBundle = {
    sourceRef:`qa2-academic-${randomUUID()}`, title, publish:true,
    passages:[1,2,3].map(number=>({passageNo:number as 1|2|3,title:`${title} Part ${number}`,body:`Shared published passage ${number}.`,vocabulary:[],
      questions:Array.from({length:number===3?14:13},(_,index)=>({questionNo:index+1,type:"short_answer" as const,text:`Q${index+1}`,answer:"answer",accepted:[],explanation:""}))})),
  };
  const imported = await db.transaction(tx=>importGeneralReadingSet(tx,bundle));
  const [first,repeat] = await Promise.all([startAcademicSet(userId,imported.setId),startAcademicSet(userId,imported.setId)]);
  assert.ok(first); assert.equal(repeat,first,"double start resumes rather than duplicating");
  const scope = await assessmentScope(first,imported.passages[0]!.passageId);
  assert.equal(scope.durationMinutes,60); assert.equal(scope.passageIds.length,3);
  const detail = await getAttemptDetail(first,userId); assert.ok(detail);
  assert.equal(detail.sections.length,3); assert.equal(detail.questions.length,40);
  assert.deepEqual(detail.questions.map(q=>q.questionNo),Array.from({length:40},(_,i)=>i+1));
  assert.equal(await getAttemptDetail(first,strangerId),null);
  const cards = await listLearningLibrary(userId,{query:title});
  assert.equal(cards.total,3); assert.ok(cards.items.every(card=>card.setId===imported.setId && card.lastAttemptId===null),"General library links into learning, never an Academic attempt");
  const sameContent = await generalSetDetail(imported.setId,"student"); assert.ok(sameContent);
  assert.deepEqual(sameContent.passages.map(p=>p.passage.id),scope.passageIds);
  assert.equal(await readingSourceAccess({id:userId,role:"student"},first),"locked");
  assert.equal(await readingSourceAccess({id:userId,role:"student"},scope.passageIds[1]!),"allowed","same text is learning only through General source");
  const saved = await saveDraftAnswers(first,userId,[...detail.questions.map(q=>({questionId:q.id,answer:"answer"})),{questionId:randomUUID(),answer:"forged"}]);
  assert.equal(saved.saved,40); assert.equal((await db.select().from(readingAnswers).where(eq(readingAnswers.attemptId,first))).length,40);
  await db.update(readingAttempts).set({startedAt:new Date(Date.now()-61*60_000)}).where(eq(readingAttempts.id,first));
  assert.equal((await saveDraftAnswers(first,userId,[])).reason,"expired");
  assert.equal((await db.select().from(readingAnswers).where(eq(readingAnswers.attemptId,first))).length,40,"late autosave cannot erase draft");
  await db.update(readingAttempts).set({status:"completed",submittedAt:new Date()}).where(eq(readingAttempts.id,first));
  assert.equal(await readingSourceAccess({id:userId,role:"student"},first),"locked","Academic review also forbids vocabulary");
  assert.equal((await saveDraftAnswers(first,userId,[])).reason,"already_submitted");
  await db.delete(users).where(eq(users.id,userId)); await db.delete(users).where(eq(users.id,strangerId));
});
