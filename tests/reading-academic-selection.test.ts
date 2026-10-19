import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { ACADEMIC_105_OMISSIONS, academicQuestionSelection, academicInstructionNumbers } from "../src/lib/reading/academic-selection";
import { reading105Catalogue } from "../scripts/lib/reading-105-catalogue";
import { startAcademicSet, assessmentScope } from "../src/lib/data/reading-assessments";
import { getAttemptDetail, saveDraftAnswers } from "../src/lib/data/reading";
import { submitReadingAttempt } from "../src/lib/services/reading/submit";
import { listGeneralSets } from "../src/lib/data/general-reading";

test("Academic selection is restricted to four reviewed source identities; instruction numbers follow the displayed CD range", () => {
  assert.equal(academicQuestionSelection('unknown',Array.from({length:41},(_,i)=>({id:String(i),externalId:'unknown',questionNo:i+1}))),null);
  assert.equal(academicInstructionNumbers('Write your answers in boxes 11 – 14. Reading Passage 2. Choose TWO letters.',24,26),'Write your answers in boxes 24–26. Reading Passage 2. Choose TWO letters.');
});

test("All four 41-question originals start exact 40-question CD assessments; immutable scopes gate reload, drafts, forgery, grading and other users",async()=>{
  const env=await createTestDatabase();
  try{
    const [a,b]=await env.query<{id:string}>("insert into users(name) values ('A'),('B') returning id");
    const groups=reading105Catalogue('data/import-sources/learnersarea_reading_105.zip');
    for(const omission of ACADEMIC_105_OMISSIONS){
      const source=groups.find(g=>g.sourceRef===omission.sourceRef)!;
      const [set]=await env.query<{id:string}>("insert into general_reading_sets(title,source_ref) values($1,$2) returning id",[source.title,source.sourceRef]);
      let excludedId='';
      for(const p of source.passages){
        const [passage]=await env.query<{id:string}>("insert into reading_passages(title,body_text,external_id,test_no,passage_no,instructions) values($1,$2,$3,$4,$5,$6) returning id",[p.title,p.bodyText,p.externalId,p.testNo,p.passageNo,`Questions 1–${p.questionCount}`]);
        await env.query("insert into general_reading_passages(passage_id,set_id,passage_no) values($1,$2,$3)",[passage!.id,set!.id,p.passageNo]);
        const [group]=await env.query<{id:string}>("insert into reading_question_groups(passage_id,position,type_code,display_title,instructions_text,from_question_no,to_question_no) values($1,1,'SAQ',$2,$3,1,$4) returning id",[passage!.id,`Questions 1–${p.questionCount}`,`Write answers in boxes 1–${p.questionCount}.`,p.questionCount]);
        const rows=await env.query<{id:string;question_no:number}>("insert into reading_questions(passage_id,group_id,\"order\",question_no,type,question_text,correct_answer,explanation) select $1::uuid,$2::uuid,n,n,'short_answer','Fixture question','answer','' from generate_series(1,$3::int) n returning id,question_no",[passage!.id,group!.id,p.questionCount]);
        if(p.externalId===omission.externalId)excludedId=rows.find(q=>q.question_no===omission.questionNo)!.id;
      }
      assert.ok((await listGeneralSets(a!.id,{academic:true},env.db)).some(s=>s.id===set!.id));
      const id=await startAcademicSet(a!.id,set!.id,env.db);assert.ok(id);
      assert.equal(await startAcademicSet(a!.id,set!.id,env.db),id,'repeat Start resumes the captured assessment');
      const scope=await assessmentScope(id!,source.passages[0]!.externalId,env.db);
      assert.equal(scope.questionIds!.length,40);assert.ok(!scope.questionIds!.includes(excludedId));
      let detail=(await getAttemptDetail(id!,a!.id,env.db))!;
      assert.equal(detail.questions.length,40);assert.equal(detail.sections.length,3);
      assert.deepEqual(detail.questions.map(q=>q.questionNo),Array.from({length:40},(_,i)=>i+1));
      for(const s of detail.sections)for(const g of s.groups){const qs=s.questions.filter(q=>q.groupId===g.id);assert.equal(g.displayTitle,null);assert.equal(g.fromQuestionNo,qs[0]!.questionNo);assert.equal(g.toQuestionNo,qs.at(-1)!.questionNo);}
      assert.equal(await getAttemptDetail(id!,b!.id,env.db),null);
      // An additional source question after Start does not enter an existing exam.
      const [late]=await env.query<{id:string}>("insert into reading_questions(passage_id,\"order\",question_no,type,question_text,correct_answer,explanation) values($1,999,999,'short_answer','Later fixture','answer','') returning id",[scope.passageIds[0]]);
      const capturedOrder=detail.questions.map(q=>q.id);
      await env.query("update reading_questions set \"order\"=1000-\"order\" where passage_id=$1",[scope.passageIds[0]]);
      detail=(await getAttemptDetail(id!,a!.id,env.db))!;assert.equal(detail.questions.length,40);
      assert.deepEqual(detail.questions.map(q=>q.id),capturedOrder,'captured display order survives later source reordering');
      const entries=[...detail.questions.map(q=>({questionId:q.id,answer:'answer'})),{questionId:excludedId,answer:'answer'},{questionId:late!.id,answer:'answer'}];
      assert.equal((await saveDraftAnswers(id!,a!.id,entries,env.db)).saved,40);
      assert.equal((await env.query<{n:number}>("select count(*)::int n from reading_answers where attempt_id=$1",[id]))[0]!.n,40);
      const result=await submitReadingAttempt(id!,a!.id,entries,env.db);assert.ok(result.ok);if(result.ok){assert.equal(result.score,40);assert.equal(result.totalQuestions,40);}
      assert.equal((await getAttemptDetail(id!,a!.id,env.db))!.questions.length,40,'submitted review has the identical selection');
      assert.equal((await env.query<{n:number}>("select count(*)::int n from reading_questions q join general_reading_passages g on g.passage_id=q.passage_id where g.set_id=$1",[set!.id]))[0]!.n,42,'all original 41 questions remain, plus the deliberately inserted late fixture');
    }
  }finally{await env.close();}
});
