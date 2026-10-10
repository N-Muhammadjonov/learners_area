import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase } from "./support/pglite";
import { submitGrammarObjective } from "../src/lib/data/grammar-attempt-write";

async function fixture() {
  const d = await createTestDatabase();
  const [user, other] = await d.query<{ id: string }>("insert into users(name,role,account_status) values ('Grammar owner','student','active'),('Other learner','student','active') returning id");
  const [topic, foreignTopic] = await d.query<{ id: string }>("insert into grammar_topics(title,explanation,\"order\") values ('Fixture','Authored rule',1),('Other topic','Authored rule',2) returning id");
  const [shared, privateExercise, foreign] = await d.query<{ id: string }>("insert into grammar_exercises(topic_id,\"order\",prompt_text,options,correct_option,explanation,source_owner_user_id) values ($1,1,'Choose an option','[\"is\",\"are\"]','is','Authored evidence',null),($1,2,'Private correction','[\"is\",\"are\"]','are','Private evidence',$2),($3,1,'Other topic','[\"is\",\"are\"]','is','Authored evidence',null) returning id", [topic!.id, other!.id, foreignTopic!.id]);
  return { d, user: user!.id, topic: topic!.id, shared: shared!.id, privateExercise: privateExercise!.id, foreign: foreign!.id };
}

test("Grammar objective rejects duplicates, forged keys, invalid options, hidden/foreign items and incomplete canonical metadata before writing", async () => {
  const f = await fixture();
  const answer = { exerciseId: f.shared, selectedOption: "is" };
  const counts = async () => f.d.query<{ attempts: number; events: number }>("select (select count(*)::int from grammar_attempts) attempts,(select count(*)::int from activity_events) events");
  try {
    for (const body of [null, { answers: [] }, { answers: [answer, answer] }, { answers: [{ ...answer, isCorrect: true }] }, { answers: [answer], assessmentContractKey: "grammar.correct-it" }, { answers: [{ ...answer, selectedOption: "not an authored option" }] }, { answers: Array.from({ length: 101 }, () => answer) }]) {
      assert.deepEqual(await submitGrammarObjective(f.user, f.topic, body, f.d.db), { ok: false, status: 400, error: "invalid_input" });
    }
    for (const exerciseId of [f.privateExercise, f.foreign]) {
      const result = await submitGrammarObjective(f.user, f.topic, { answers: [answer, { ...answer, exerciseId }] }, f.d.db);
      assert.deepEqual(result, { ok: false, status: 404, error: "not_found" });
      assert.ok(!("results" in result), "no hidden answer key may be returned");
    }
    await f.d.query("update grammar_exercises set correct_option='missing key' where id=$1", [f.shared]);
    assert.deepEqual(await submitGrammarObjective(f.user, f.topic, { answers: [answer] }, f.d.db), { ok: false, status: 409, error: "assessment_metadata_unsupported" });
    await f.d.query("update grammar_exercises set correct_option='is',options='[\"is\",\"is\"]' where id=$1", [f.shared]);
    assert.deepEqual(await submitGrammarObjective(f.user, f.topic, { answers: [answer] }, f.d.db), { ok: false, status: 409, error: "assessment_metadata_unsupported" });
    assert.deepEqual(await counts(), [{ attempts: 0, events: 0 }]);
  } finally { await f.d.close(); }
});

test("Grammar objective uses the current authored key, refuses suspended identities and rolls back attempts when the event write fails", async () => {
  const f = await fixture();
  try {
    const input = { answers: [{ exerciseId: f.shared, selectedOption: "is" }] };
    await f.d.query("update users set account_status='suspended' where id=$1", [f.user]);
    assert.deepEqual(await submitGrammarObjective(f.user, f.topic, input, f.d.db), { ok: false, status: 401, error: "unauthenticated" });
    await f.d.query("update users set account_status='active' where id=$1", [f.user]);
    await f.d.query("create function fail_grammar_event() returns trigger language plpgsql as $$ begin if NEW.type='GRAMMAR_TOPIC_ATTEMPTED' then raise exception 'fixture event write failed'; end if; return NEW; end $$");
    await f.d.query("create trigger fail_grammar_event before insert on activity_events for each row execute function fail_grammar_event()");
    await assert.rejects(submitGrammarObjective(f.user, f.topic, input, f.d.db));
    assert.deepEqual(await f.d.query("select count(*)::int n from grammar_attempts"), [{ n: 0 }]);
    assert.deepEqual(await f.d.query("select count(*)::int n from activity_events"), [{ n: 0 }]);
    await f.d.query("drop trigger fail_grammar_event on activity_events");
    await f.d.query("update grammar_exercises set correct_option='are' where id=$1", [f.shared]);
    assert.deepEqual(await submitGrammarObjective(f.user, f.topic, input, f.d.db), { ok: true, results: [{ exerciseId: f.shared, isCorrect: false, correctOption: "are", explanation: "Authored evidence" }] });
    assert.deepEqual(await f.d.query("select activity,is_correct from grammar_attempts"), [{ activity: "correct_it", is_correct: false }]);
    const [event] = await f.d.query<{ payload: { correct: number; total: number } }>("select payload from activity_events where type='GRAMMAR_TOPIC_ATTEMPTED'");
    assert.equal(event!.payload.correct, 0);
    assert.equal(event!.payload.total, 1);
  } finally { await f.d.close(); }
});
