import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { confirmSentenceUse, recordSentenceUse } from "../src/lib/services/vocabulary/engine";
import { vocabularyUseHttpSchema } from "../src/lib/services/vocabulary/sentence-input";
import { createTestDatabase } from "./support/pglite";

async function fixture() {
  const d = await createTestDatabase();
  const [user, other] = await d.query<{ id: string }>("insert into users(name,role,account_status) values ('Active use learner','student','active'),('Other learner','student','active') returning id");
  const [lexeme] = await d.query<{ id: string }>("insert into lexemes(term,definition_en,sense_key) values ('resilient','Able to recover after difficulty',$1) returning id", [randomUUID()]);
  const [entry, foreign] = await d.query<{ id: string }>("insert into user_vocabulary(user_id,lexeme_id) values ($1,$3),($2,$3) returning id", [user!.id, other!.id, lexeme!.id]);
  return { d, user: user!.id, other: other!.id, entry: entry!.id, foreign: foreign!.id };
}

test("active-use event failure rolls back points, mastery and confirmation; retry commits once", async () => {
  const f = await fixture();
  try {
    const stored = await recordSentenceUse({ userId: f.user, entryId: f.entry, sentence: "Resilient people recover after setbacks." }, f.d.db);
    assert.ok(stored.ok);
    await f.d.query("create function fail_vocab_event() returns trigger language plpgsql as $$ begin if NEW.type='VOCABULARY_USED' then raise exception 'fixture active-use event failure'; end if; return NEW; end $$");
    await f.d.query("create trigger fail_vocab_event before insert on activity_events for each row execute function fail_vocab_event()");
    const input = { userId: f.user, usageId: stored.usageId, accepted: true, evaluationId: randomUUID() };
    await assert.rejects(confirmSentenceUse(input, f.d.db));
    assert.deepEqual(await f.d.query("select origin,riwi_accepted,evaluation_id,points_awarded from vocabulary_usages where id=$1", [stored.usageId]), [{ origin: "manual", riwi_accepted: false, evaluation_id: null, points_awarded: 0 }]);
    assert.deepEqual(await f.d.query("select active_use_count from user_vocabulary where id=$1", [f.entry]), [{ active_use_count: 0 }]);
    assert.deepEqual(await f.d.query("select count(*)::int n from vocab_point_events"), [{ n: 0 }]);
    await f.d.query("drop trigger fail_vocab_event on activity_events");
    const accepted = await confirmSentenceUse(input, f.d.db);
    assert.ok(accepted.ok);
    assert.equal(accepted.points, 2);
    assert.deepEqual(await confirmSentenceUse({ ...input, accepted: false, evaluationId: randomUUID() }, f.d.db), { ok: false, error: "already_evaluated" });
    assert.deepEqual(await f.d.query("select count(*)::int n from activity_events where type='VOCABULARY_USED'"), [{ n: 1 }]);
  } finally { await f.d.close(); }
});

test("two active-use answers retain both awards/counts; competing confirmations cannot replace the first verdict", async () => {
  const f = await fixture();
  try {
    const inputs = [];
    for (const sentence of ["Resilient people recover after setbacks.", "She became resilient after a difficult year."]) {
      const stored = await recordSentenceUse({ userId: f.user, entryId: f.entry, sentence }, f.d.db);
      assert.ok(stored.ok);
      inputs.push({ userId: f.user, usageId: stored.usageId, accepted: true, evaluationId: randomUUID() });
    }
    const results = await Promise.all(inputs.map(input => confirmSentenceUse(input, f.d.db)));
    assert.ok(results.every(result => result.ok));
    assert.deepEqual(await f.d.query("select active_use_count from user_vocabulary where id=$1", [f.entry]), [{ active_use_count: 2 }]);
    assert.deepEqual(await f.d.query("select sum(points)::int points from vocab_point_events"), [{ points: 4 }]);
    const third = await recordSentenceUse({ userId: f.user, entryId: f.entry, sentence: "Our resilient team returned to work." }, f.d.db);
    assert.ok(third.ok);
    const competing = await Promise.all([true, false].map(accepted => confirmSentenceUse({ userId: f.user, usageId: third.usageId, accepted, evaluationId: randomUUID() }, f.d.db)));
    assert.equal(competing.filter(result => result.ok).length, 1);
    assert.deepEqual(await f.d.query("select count(*)::int n from activity_events where type='VOCABULARY_USED'"), [{ n: 3 }]);
  } finally { await f.d.close(); }
});

test("sentence HTTP input rejects client-controlled scores, blank text and unknown fields", () => {
  for (const body of [null, { sentence: "   " }, { sentence: "x".repeat(1001) },
    { sentence: "Resilient people recover.", accepted: true },
    { sentence: "Resilient people recover.", points: 100 },
    { sentence: "Resilient people recover.", evaluationId: randomUUID() }]) {
    assert.equal(vocabularyUseHttpSchema.safeParse(body).success, false);
  }
  assert.deepEqual(vocabularyUseHttpSchema.parse({ sentence: "  Resilient people recover.  " }), { sentence: "Resilient people recover." });
});

test("rejected and duplicate uses preserve recognition and return only persisted mastery", async () => {
  const f = await fixture();
  try {
    const before = (await f.d.query("select srs_stage,correct_count,incorrect_count,next_review_at,mastery from user_vocabulary where id=$1", [f.entry]))[0];
    const rejected = await recordSentenceUse({ userId: f.user, entryId: f.entry, sentence: "I copied an unrelated word." }, f.d.db);
    assert.ok(rejected.ok);
    assert.deepEqual(await confirmSentenceUse({ userId: f.user, usageId: rejected.usageId, accepted: true, verdict: "needs_correction", evaluationId: randomUUID() }, f.d.db), { ok: false, error: "invalid_input" });
    const rejectedResult = await confirmSentenceUse({ userId: f.user, usageId: rejected.usageId, accepted: false, verdict: "mostly_correct", evaluationId: randomUUID() }, f.d.db);
    assert.ok(rejectedResult.ok);
    assert.equal(rejectedResult.points, 0);
    assert.deepEqual((await f.d.query("select srs_stage,correct_count,incorrect_count,next_review_at,mastery from user_vocabulary where id=$1", [f.entry]))[0], before);
    for (const sentence of ["Resilient people recover after setbacks.", "  RESILIENT people recover after setbacks! "]) {
      const saved = await recordSentenceUse({ userId: f.user, entryId: f.entry, sentence }, f.d.db);
      assert.ok(saved.ok);
      const result = await confirmSentenceUse({ userId: f.user, usageId: saved.usageId, accepted: true, verdict: "correct", evaluationId: randomUUID() }, f.d.db);
      assert.ok(result.ok);
      const [current] = await f.d.query<{ mastery: string }>("select mastery from user_vocabulary where id=$1", [f.entry]);
      assert.equal(result.mastery, current!.mastery);
    }
    assert.deepEqual(await f.d.query("select active_use_count from user_vocabulary where id=$1", [f.entry]), [{ active_use_count: 1 }]);
    assert.deepEqual(await f.d.query("select count(*)::int n,sum(points)::int points from vocab_point_events"), [{ n: 1, points: 2 }]);
    const [event] = await f.d.query<{ payload: { verdict: string; accepted: boolean } }>("select payload from activity_events where payload->>'usageId'=$1", [rejected.usageId]);
    assert.equal(event!.payload.verdict, "mostly_correct");
    assert.equal(event!.payload.accepted, false);
  } finally { await f.d.close(); }
});

test("saved sentences and confirmations recheck active identity and both sides of vocabulary ownership", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await recordSentenceUse({ userId: f.user, entryId: f.foreign, sentence: "Private resilient sentence." }, f.d.db), { ok: false, error: "not_found" });
    const stored = await recordSentenceUse({ userId: f.user, entryId: f.entry, sentence: "Resilient people recover after setbacks." }, f.d.db);
    assert.ok(stored.ok);
    await f.d.query("update users set account_status='suspended' where id=$1", [f.user]);
    assert.deepEqual(await recordSentenceUse({ userId: f.user, entryId: f.entry, sentence: "A stale request should not be saved." }, f.d.db), { ok: false, error: "unauthenticated" });
    assert.deepEqual(await confirmSentenceUse({ userId: f.user, usageId: stored.usageId, accepted: true, evaluationId: randomUUID() }, f.d.db), { ok: false, error: "unauthenticated" });
    await f.d.query("update users set account_status='active' where id=$1", [f.user]);
    await f.d.query("update vocabulary_usages set user_vocabulary_id=$1 where id=$2", [f.foreign, stored.usageId]);
    assert.deepEqual(await confirmSentenceUse({ userId: f.user, usageId: stored.usageId, accepted: true, evaluationId: randomUUID() }, f.d.db), { ok: false, error: "not_found" });
    assert.deepEqual(await f.d.query("select count(*)::int n from vocab_point_events"), [{ n: 0 }]);
  } finally { await f.d.close(); }
});

test("sentence storage refuses blank, oversized or forged input before any write", async () => {
  const f = await fixture();
  try {
    for (const sentence of ["   ", "ab", "x".repeat(20001)]) {
      assert.deepEqual(await recordSentenceUse({ userId: f.user, entryId: f.entry, sentence }, f.d.db), { ok: false, error: "invalid_input" });
    }
    assert.deepEqual(await recordSentenceUse({ userId: f.user, entryId: f.entry, sentence: "Resilient people recover.", accepted: true } as never, f.d.db), { ok: false, error: "invalid_input" });
    assert.deepEqual(await f.d.query("select count(*)::int n from vocabulary_usages"), [{ n: 0 }]);
  } finally { await f.d.close(); }
});
