import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { startListeningAttempt, submitListeningAttempt } from "../src/lib/data/listening-attempt-write";

test("Listening start retries resume; submission is owned and cannot write grades/events twice", async () => {
  const d = await createTestDatabase();
  try {
    const [owner] = await d.query<{ id: string }>("insert into users(name,role,account_status) values ('QA','student','active') returning id");
    const [other] = await d.query<{ id: string }>("insert into users(name,role) values ('Other','student') returning id");
    const [testRow] = await d.query<{ id: string }>("insert into listening_tests(created_by_user_id,title,audio_type) values ($1,'QA audio','audio') returning id", [owner!.id]);
    const [q] = await d.query<{ id: string }>("insert into listening_questions(test_id,\"order\",type,question_text,correct_answer,explanation) values ($1,1,'short_answer','Test?','work','QA') returning id", [testRow!.id]);
    const id = (await startListeningAttempt(owner!.id, testRow!.id, d.db))!;
    assert.equal(await startListeningAttempt(owner!.id, testRow!.id, d.db), id);
    assert.deepEqual(await submitListeningAttempt(other!.id,id,[],d.db), { error: "not_found" });
    assert.deepEqual(await submitListeningAttempt(owner!.id,id,[{questionId:q!.id,answer:'work'},{questionId:q!.id,answer:'work'}],d.db), {error:'invalid_input'});
    assert.deepEqual(await submitListeningAttempt(owner!.id,id,[{questionId:q!.id,answer:'work'}],d.db), {score:1,totalQuestions:1});
    assert.deepEqual(await submitListeningAttempt(owner!.id,id,[],d.db), {error:'already_submitted'});
    assert.equal((await d.query<{n:number}>("select count(*)::int n from listening_answers where attempt_id=$1",[id]))[0]!.n,1);
    assert.equal((await d.query<{n:number}>("select count(*)::int n from activity_events where user_id=$1",[owner!.id]))[0]!.n,1);
  } finally { await d.close(); }
});
