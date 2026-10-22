import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTestDatabase } from "./support/pglite";
import { reviseReadingSource, type ReadingSourceRevision } from "../src/lib/services/reading/source-revision";
import { getAttemptDetail } from "../src/lib/data/reading";
import { startAcademicSet } from "../src/lib/data/reading-assessments";
import { saveGeneralProgress } from "../src/lib/data/general-reading";
import { submitReadingAttempt } from "../src/lib/services/reading/submit";

test("a source correction replaces the catalogue slot while historical and open assessments keep their exact questions, keys and results", async () => {
  const env = await createTestDatabase();
  try {
    const [owner, student, newcomer] = await env.query<{id:string}>("insert into users(name,role) values ('Teacher','owner'),('Learner','student'),('New learner','student') returning id");
    const [set] = await env.query<{id:string}>("insert into general_reading_sets(title,source_ref) values('Test 1','qa:reading:revision') returning id");
    const body = "The old record is preserved. The new answer is stated in this sentence.";
    let passageId = "", questionId = "";
    for (let part = 1; part <= 3; part++) {
      const [p] = await env.query<{id:string}>("insert into reading_passages(title,body_text,test_no,passage_no,external_id) values($1,$2,1,$3,$4) returning id", ["Passage " + part, body, part, "source-p" + part]);
      await env.query("insert into general_reading_passages(passage_id,set_id,passage_no) values($1,$2,$3)", [p!.id,set!.id,part]);
      const [group] = await env.query<{id:string}>("insert into reading_question_groups(passage_id,position,type_code,instructions_text) values($1,1,'SAQ','Use one word.') returning id", [p!.id]);
      for (let no = 1; no <= (part === 3 ? 14 : 13); no++) {
        const [q] = await env.query<{id:string}>("insert into reading_questions(passage_id,group_id,\"order\",question_no,type,question_text,correct_answer,accepted_answers,explanation) values($1,$2,$3,$3,'short_answer','Original prompt','old','[\"old\",\"former\"]','Original explanation') returning id", [p!.id,group!.id,no]);
        if (part === 1 && no === 1) { passageId = p!.id; questionId = q!.id; }
      }
      await env.query("insert into reading_passage_paragraphs(passage_id,position,label,text) values($1,1,'A',$2)", [p!.id,body]);
    }
    const started = (await startAcademicSet(student!.id, set!.id, env.db))!;
    const previous = (await getAttemptDetail(started,student!.id,env.db))!;
    const general = await saveGeneralProgress({ userId:student!.id,role:"student",passageId,answers:{[questionId]:"old"},check:true },env.db);
    const originalQuestions = await env.query("select * from reading_questions where passage_id=$1 order by \"order\"", [passageId]);
    const revision: ReadingSourceRevision = { revision:"qa-repair-v1",passageId,bodySha256:createHash("sha256").update(body).digest("hex"),corrections:[{
      questionId,before:{text:"Original prompt",answer:"old"},after:{text:"Corrected prompt",answer:"new",evidence:"The new answer is stated in this sentence.",explanation:"The source supplies the new answer."},referenceUrl:"https://example.org/course-source",
    }] };
    await assert.rejects(() => reviseReadingSource(revision,student!.id,env.db),/forbidden/);
    await assert.rejects(() => reviseReadingSource({...revision,bodySha256:"0".repeat(64)},owner!.id,env.db),/body_changed/);
    await assert.rejects(() => reviseReadingSource({...revision,corrections:[{...revision.corrections[0]!,after:{...revision.corrections[0]!.after,evidence:"not in the text"}}]},owner!.id,env.db),/evidence_missing/);
    const changed = await reviseReadingSource(revision,owner!.id,env.db);
    assert.equal(changed.created,true);
    assert.notEqual(changed.passageId,passageId);
    const repeated = await reviseReadingSource(revision,owner!.id,env.db);
    assert.equal(repeated.created,false); assert.equal(repeated.passageId,changed.passageId);
    assert.deepEqual(await env.query("select * from reading_questions where passage_id=$1 order by \"order\"",[passageId]),originalQuestions,"historical question rows are not rewritten");
    assert.deepEqual((await getAttemptDetail(started,student!.id,env.db))!.questions,previous.questions,"an already open assessment remains on its original keys");
    assert.equal((await startAcademicSet(student!.id,set!.id,env.db)),started,"the original open attempt resumes");
    const submitted = await submitReadingAttempt(started,student!.id,previous.questions.map(q=>({questionId:q.id,answer:"old"})),env.db);
    assert.deepEqual(submitted,{ok:true,score:40,totalQuestions:40});
    assert.equal((await getAttemptDetail(started,student!.id,env.db))!.attempt.score,40);
    const progress = (await env.query<{id:string;score:number;answers:Record<string,string>}>("select id,score,answers from general_reading_progress where passage_id=$1",[passageId]))[0]!;
    assert.equal(progress.id,general!.progress.id); assert.equal(progress.score,1); assert.equal(progress.answers[questionId],"old");
    const newer = (await startAcademicSet(newcomer!.id,set!.id,env.db))!;
    const current = (await getAttemptDetail(newer,newcomer!.id,env.db))!;
    assert.equal(current.questions.length,40);
    assert.ok(!current.questions.some(q=>q.id===questionId));
    const corrected = current.questions.find(q=>q.questionText==="Corrected prompt")!;
    assert.equal(corrected.correctAnswer,"new"); assert.deepEqual(corrected.acceptedAnswers,["new"],"the old accepted key cannot survive the correction");
    assert.equal(current.sections[0]!.paragraphs[0]!.label,"A");
    assert.equal(current.questions[0]!.groupId,current.sections[0]!.groups[0]!.id);
    const [version] = await env.query<{content_snapshot:{passages:{questions:{text:string;answer:string}[]}[]}}>("select content_snapshot from content_versions where id=$1",[current.attempt.contentVersionId]);
    assert.equal(version!.content_snapshot.passages[0]!.questions[0]!.text,"Corrected prompt");
    assert.equal(version!.content_snapshot.passages[0]!.questions[0]!.answer,"new");
    const [counts] = await env.query<{slots:number;live:number}>("select (select count(*)::int from general_reading_passages where set_id=$1) as slots,(select count(*)::int from reading_passages where publication_state='published') as live",[set!.id]);
    assert.deepEqual(counts,{slots:3,live:3});
    await assert.rejects(() => reviseReadingSource({...revision,corrections:[{...revision.corrections[0]!,after:{...revision.corrections[0]!.after,answer:"different"}}]},owner!.id,env.db),/identity_conflict/);
  } finally { await env.close(); }
});
