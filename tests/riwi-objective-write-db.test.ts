import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { submitReadingAttempt } from "../src/lib/data/reading-attempt-write";
import { submitListeningAttempt, startListeningAttempt } from "../src/lib/data/listening-attempt-write";
import { listeningPackageSchema } from "../src/lib/listening/package";

test("Reading submission records every authored subtype from server metadata while keeping official scores and deadline drafts", async () => {
  const d = await createTestDatabase();
  try {
    const [user] = await d.query<{ id: string }>("insert into users(name,role)values('Objective fixture','student')returning id");
    const [passage] = await d.query<{ id: string }>("insert into reading_passages(title,body_text,suggested_minutes)values('Fixture','Owner-authored fixture text',20)returning id");
    const codes = ['TFNG','YNNG','MCQ','MCQ_MULTI','MH','MI','MF','MSE','DIAG','SC','NOTE','FLOW','SEN','SAQ'];
    const answers: Array<{ questionId: string; answer: string }> = [];
    for (const [index, code] of codes.entries()) {
      const [q] = await d.query<{ id: string }>("insert into reading_questions(passage_id,\"order\",type,type_code,question_text,correct_answer,accepted_answers,explanation)values($1,$2,'short_answer',$3,'Fixture?','40 millimetres','[\"40 mm\"]','Evidence')returning id", [passage!.id,index+1,code]);
      answers.push({ questionId: q!.id, answer: '40 mm' });
    }
    const [attempt] = await d.query<{ id: string }>("insert into reading_attempts(user_id,passage_id)values($1,$2)returning id", [user!.id,passage!.id]);
    const result = await submitReadingAttempt(user!.id, attempt!.id, answers, d.db);
    assert.deepEqual(result, { ok: true, score: codes.length, totalQuestions: codes.length });
    const [event] = await d.query<{ payload: { assessmentContracts: Array<{ questionId: string; key: string; promptVersion: string }> } }>("select payload from activity_events where user_id=$1", [user!.id]);
    assert.equal(event!.payload.assessmentContracts.length, codes.length);
    assert.equal(new Set(event!.payload.assessmentContracts.map(proof => proof.key)).size, codes.length);
    assert.ok(event!.payload.assessmentContracts.every(proof => proof.promptVersion && answers.some(answer => answer.questionId === proof.questionId)));
    assert.equal((await submitReadingAttempt(user!.id, attempt!.id, [], d.db)).ok, false);
    const [late] = await d.query<{ id: string }>("insert into reading_attempts(user_id,passage_id,started_at)values($1,$2,now()-interval '1 hour')returning id", [user!.id,passage!.id]);
    await d.query("insert into reading_answers(attempt_id,question_id,user_answer)values($1,$2,'40 mm')", [late!.id,answers[0]!.questionId]);
    const lateResult = await submitReadingAttempt(user!.id, late!.id, answers.map(answer => ({ ...answer, answer: 'wrong' })), d.db);
    assert.deepEqual(lateResult, { ok: true, score: 1, totalQuestions: codes.length });
    const [unsupported] = await d.query<{ id: string }>("insert into reading_attempts(user_id,passage_id)values($1,$2)returning id", [user!.id,passage!.id]);
    await d.query("update reading_questions set type_code='UNSUPPORTED' where id=$1", [answers[0]!.questionId]);
    assert.deepEqual(await submitReadingAttempt(user!.id, unsupported!.id, answers, d.db), { ok: false, status: 409, error: 'assessment_metadata_unsupported' });
    assert.equal((await d.query<{ n: number }>("select count(*)::int n from reading_answers where attempt_id=$1", [unsupported!.id]))[0]!.n, 0);
    assert.equal((await d.query<{ status: string }>("select status from reading_attempts where id=$1", [unsupported!.id]))[0]!.status, 'in_progress');
  } finally { await d.close(); }
});

test("Listening choose-TWO metadata comes from the canonical package, not the legacy question enum or caller", async () => {
  const d = await createTestDatabase();
  try {
    const [user] = await d.query<{ id: string }>("insert into users(name,role,account_status)values('Listening metadata fixture','student','active')returning id");
    const [testRow] = await d.query<{ id: string }>("insert into listening_tests(created_by_user_id,title,audio_type)values($1,'Fixture','audio')returning id", [user!.id]);
    const payload = listeningPackageSchema.parse({ schemaVersion: 1, testId: 'metadata-fixture', title: 'Owner-authored metadata fixture', category: 'full', provenance: 'Synthetic test fixture, not source-bank acceptance', audio: { path: 'audio/fixture.mp3', durationSec: 100 }, imagePath: null,
      sections: Array.from({ length: 4 }, (_, i) => ({ number: i+1, title: `Section ${i+1}` })),
      questions: Array.from({ length: 40 }, (_, i) => ({ number: i+1, section: Math.ceil((i+1)/10), text: 'Fixture?', instruction: 'Authored instruction', options: i < 3 ? ['A','B','C'] : [], key: i===1 ? 'B' : 'A', alternatives: [], pair: i===0 ? [2] : i===1 ? [1] : [], evidence: { at: i+1, why: 'Authored test evidence' } })),
      keyword1: [{ q: 1, at: 1, end: 2, text: 'Text', heard: 'Heard', link: 'Link' }], keyword2: [{ q: 1, at: 1, end: 2, heard: 'Heard', link: 'Link', answer: 'A' }], vocabulary: [{ word: 'study', pos: 'verb', uz: "o'rganmoq", def: 'Learn', ex: 'Study daily.', also: [] }],
    });
    await d.query("insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash)values($1,'metadata-fixture',$2,'private/audio','0000000000000000000000000000000000000000000000000000000000000000')", [testRow!.id,JSON.stringify(payload)]);
    const answers: Array<{ questionId: string; answer: string }> = [];
    for (const q of payload.questions) {
      const [saved] = await d.query<{ id: string }>("insert into listening_questions(test_id,\"order\",type,question_text,correct_answer,explanation)values($1,$2,'short_answer','Fixture?',$3,'Evidence')returning id", [testRow!.id,q.number,q.key]);
      answers.push({ questionId: saved!.id, answer: q.number===1 ? 'B' : q.number===2 ? 'A' : q.key });
    }
    const id = (await startListeningAttempt(user!.id,testRow!.id,d.db))!;
    assert.deepEqual(await submitListeningAttempt(user!.id,id,answers,d.db), { score: 40, totalQuestions: 40 });
    const [event] = await d.query<{ payload: { assessmentContracts: Array<{ questionId: string; key: string }> } }>("select payload from activity_events where user_id=$1", [user!.id]);
    const byId = new Map(event!.payload.assessmentContracts.map(proof => [proof.questionId,proof.key]));
    assert.equal(byId.get(answers[0]!.questionId), 'listening.mcq-multiple'); assert.equal(byId.get(answers[1]!.questionId), 'listening.mcq-multiple');
    assert.equal(byId.get(answers[2]!.questionId), 'listening.mcq-single'); assert.equal(byId.get(answers[3]!.questionId), 'listening.short-answer');
    await d.query("update users set account_status='pending' where id=$1", [user!.id]);
    assert.equal(await startListeningAttempt(user!.id, testRow!.id, d.db), null);
    assert.equal((await d.query<{ n: number }>("select count(*)::int n from listening_attempts where user_id=$1", [user!.id]))[0]!.n, 1);
  } finally { await d.close(); }
});
