import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createTestDatabase } from "./support/pglite";
import { prepareGrammarProduction, persistGrammarProduction, submitGrammarProduction, resumeGrammarProduction } from "../src/lib/data/grammar-production-write";
import { getTopicMastery, getTopicMasteryFor } from "../src/lib/data/grammar";
import { explainGrammarRetention } from "../src/lib/services/riwi/grammar-retention";
import { grammarContractKey, getAssessmentContractOrThrow } from "../src/lib/services/coach/contracts/registry";
import { evaluationResultSchema } from "../src/lib/services/coach/schema";
import type { GrammarEvaluationRequest } from "../src/lib/services/coach/grammar";

async function fixture() {
  const t = await createTestDatabase(), user = randomUUID(), other = randomUUID(), topic = randomUUID(), exercise = randomUUID();
  await t.query("insert into users(id,name,role,account_status)values($1,'Grammar learner','student','active'),($2,'Foreign learner','student','active')", [user, other]);
  await t.query("insert into grammar_topics(id,title,explanation,\"order\")values($1,'Present continuous','Authored topic',1)", [topic]);
  await t.query("insert into grammar_exercises(id,topic_id,\"order\",prompt_text,options,correct_option,explanation,translate_prompt_uz,activation_prompt,target_structures)values($1,$2,1,'Correct: She study now.','[\"She is studying now.\",\"She study now.\"]','She is studying now.','Use be plus -ing.', $3,'Describe something happening now.','[\"is studying\"]')", [exercise, topic, "U hozir o'qiyapti."]);
  return { t, user, other, topic, exercise };
}
function result(activity: "correct_it" | "activate_it" | "translate_it" = "activate_it") {
  const contract = getAssessmentContractOrThrow(grammarContractKey(activity));
  return evaluationResultSchema.parse({ evaluationId: "fixture-result", evaluationType: "grammar", createdAt: new Date().toISOString(),
    providerId: "grammar-fixture", providerDisplayName: "Grammar fixture", providerType: "external", providerVersion: "v1", model: "fixture",
    promptVersion: contract.version, rubricVersion: contract.rubricVersion, assessmentContractKey: contract.key,
    fallbackUsed: false, fallbackFrom: null, checkedBy: { id: "grammar-fixture", displayName: "Grammar fixture", type: "external" },
    overallEstimate: null, confidence: 0.8, verdict: "correct",
    criteria: ["meaning", "grammar", "target_structure"].map(key => ({ key, label: key, band: null, limited: false, note: "Assessed fixture" })),
    strengths: [], weaknesses: [], issues: [], nextActions: [], recommendedExercises: [], processedInMs: 1 });
}
const evaluator = async (input: GrammarEvaluationRequest) => {
  assert.ok(input.persist);
  const saved = await input.persist(result(input.activity));
  return { ok: true as const, evaluation: saved.record, reused: !saved.created };
};
const counts = (f: Awaited<ReturnType<typeof fixture>>) => f.t.query("select (select count(*)::int from grammar_attempts) attempts,(select count(*)::int from evaluations) evaluations,(select count(*)::int from activity_events) events");

test("Grammar production rejects blank/forged/private/inactive work before staging or provider dispatch", async () => {
  const f = await fixture();
  let calls = 0;
  const never = async () => { calls++; throw new Error("must not dispatch"); };
  try {
    for (const input of [null, { activity: "activate_it", answer: "  " }, { activity: "activate_it", answer: "Useful answer.", sampleAnswer: "forged" },
      { activity: "transformation", answer: "Not an authored activity." }, { activity: "activate_it", answer: "a".repeat(2001) }])
      assert.deepEqual(await submitGrammarProduction(f.user, f.exercise, input, "en", f.t.db, never), { ok: false, error: "invalid_input", status: 400 });
    const hidden = randomUUID();
    await f.t.query("insert into grammar_exercises(id,topic_id,\"order\",prompt_text,options,correct_option,explanation,activation_prompt,source_owner_user_id)values($1,$2,2,'Private source','[]','Private key','Private explanation','Private activation',$3)", [hidden, f.topic, f.other]);
    assert.equal((await submitGrammarProduction(f.user, hidden, { activity: "activate_it", answer: "She is studying now." }, "en", f.t.db, never)).ok, false);
    await f.t.query("update grammar_exercises set activation_prompt=null where id=$1", [f.exercise]);
    assert.deepEqual(await submitGrammarProduction(f.user, f.exercise, { activity: "activate_it", answer: "She is studying now." }, "en", f.t.db, never), { ok: false, error: "assessment_metadata_unsupported", status: 409 });
    await f.t.query("update users set account_status='suspended' where id=$1", [f.user]);
    assert.deepEqual(await submitGrammarProduction(f.user, f.exercise, { activity: "correct_it", answer: "She is studying now." }, "en", f.t.db, never), { ok: false, error: "unauthenticated", status: 401 });
    assert.equal(calls, 0); assert.deepEqual(await counts(f), [{ attempts: 0, evaluations: 0, events: 0 }]);
  } finally { await f.t.close(); }
});

for (const activity of ["correct_it", "translate_it", "activate_it"] as const)
  test(activity + ": exact source, verdict, authoritative evaluation and receipt commit together; replay does not duplicate event", async () => {
    const f = await fixture();
    try {
      const prepared = await prepareGrammarProduction(f.user, f.exercise, { activity, answer: "She is studying now." }, "en", f.t.db);
      assert.ok(prepared.ok);
      if (!prepared.ok) assert.fail("expected authorized source");
      assert.equal(prepared.prepared.request.promptText, activity === "correct_it" ? "Correct: She study now." : activity === "translate_it" ? "U hozir o'qiyapti." : "Describe something happening now.");
      assert.equal(prepared.prepared.request.sampleAnswer, activity === "correct_it" ? "She is studying now." : null);
      const first = await persistGrammarProduction(prepared.prepared, result(activity), f.t.db);
      const replay = await persistGrammarProduction(prepared.prepared, result(activity), f.t.db);
      assert.equal(first.created, true); assert.equal(replay.created, false); assert.equal(first.record.id, replay.record.id);
      assert.deepEqual(await counts(f), [{ attempts: 1, evaluations: 1, events: 1 }]);
      const [attempt] = await f.t.query<{ response_text: string; selected_option: string; is_correct: boolean }>("select response_text,selected_option,is_correct from grammar_attempts");
      assert.equal(attempt!.response_text, "She is studying now."); assert.equal(attempt!.selected_option, ""); assert.equal(attempt!.is_correct, true);
      const [event] = await f.t.query<{ payload: Record<string, string> }>("select payload from activity_events");
      assert.equal(event!.payload.sourceHash, prepared.prepared.sourceHash); assert.equal(event!.payload.evaluationId, first.record.id);
      assert.equal(JSON.stringify(event!.payload).includes("She is studying"), false, "receipt must not log private answer text");
    } finally { await f.t.close(); }
  });

test("Grammar event failure rolls back evaluation and verdict; failed provider removes only unassessed writing", async () => {
  const f = await fixture();
  try {
    await f.t.query("create function fail_grammar_written_event() returns trigger language plpgsql as $$ begin if NEW.type='GRAMMAR_PRACTICE_SUBMITTED' then raise exception 'fixture event failure'; end if; return NEW; end $$");
    await f.t.query("create trigger fail_grammar_written_event before insert on activity_events for each row execute function fail_grammar_written_event()");
    const failed = await submitGrammarProduction(f.user, f.exercise, { activity: "activate_it", answer: "She is studying now." }, "en", f.t.db, evaluator);
    assert.deepEqual(failed, { ok: false, error: "evaluation_unavailable", status: 502 });
    assert.deepEqual(await counts(f), [{ attempts: 0, evaluations: 0, events: 0 }]);
    await f.t.query("drop trigger fail_grammar_written_event on activity_events");
    const unavailable = await submitGrammarProduction(f.user, f.exercise, { activity: "activate_it", answer: "She is studying now." }, "en", f.t.db,
      async () => ({ ok: false, error: "evaluation_unavailable" }));
    assert.equal(unavailable.ok, false); assert.deepEqual(await counts(f), [{ attempts: 0, evaluations: 0, events: 0 }]);
    assert.equal((await submitGrammarProduction(f.user, f.exercise, { activity: "activate_it", answer: "She is studying now." }, "en", f.t.db, evaluator)).ok, true);
  } finally { await f.t.close(); }
});

test("Grammar source/owner/account/answer changes during dispatch fence the late result before any accepted write", async () => {
  for (const scenario of ["prompt", "owner", "account", "answer"]) {
    const f = await fixture();
    try {
      const answer = await submitGrammarProduction(f.user, f.exercise, { activity: "activate_it", answer: "She is studying now." }, "en", f.t.db,
        async input => {
          if (scenario === "prompt") await f.t.query("update grammar_exercises set activation_prompt='Changed task' where id=$1", [f.exercise]);
          if (scenario === "owner") await f.t.query("update grammar_exercises set source_owner_user_id=$1 where id=$2", [f.other, f.exercise]);
          if (scenario === "account") await f.t.query("update users set account_status='suspended' where id=$1", [f.user]);
          if (scenario === "answer") await f.t.query("update grammar_attempts set response_text='Changed student answer' where id=$1", [input.attemptId]);
          return evaluator(input);
        });
      assert.deepEqual(answer, { ok: false, error: "assessment_source_changed", status: 409 });
      assert.deepEqual(await counts(f), [{ attempts: 0, evaluations: 0, events: 0 }]);
    } finally { await f.t.close(); }
  }
});

test("Grammar post-commit bookkeeping failure preserves and returns its authorized result, while later revocation withholds feedback", async () => {
  const f = await fixture();
  try {
    const accepted = await submitGrammarProduction(f.user, f.exercise, { activity: "correct_it", answer: "She is studying now." }, "en", f.t.db,
      async input => { await evaluator(input); throw new Error("downstream bookkeeping fixture"); });
    assert.ok(accepted.ok); assert.deepEqual(await counts(f), [{ attempts: 1, evaluations: 1, events: 1 }]);
    const hidden = await submitGrammarProduction(f.user, f.exercise, { activity: "correct_it", answer: "She is studying now." }, "en", f.t.db,
      async input => { await evaluator(input); await f.t.query("update users set account_status='suspended' where id=$1", [f.user]); throw new Error("downstream fixture"); });
    assert.equal(hidden.ok, false); assert.ok(!("sampleAnswer" in hidden));
    assert.deepEqual(await counts(f), [{ attempts: 2, evaluations: 2, events: 2 }], "accepted history survives denied delivery");
  } finally { await f.t.close(); }
});

test("Grammar rejects forged domain/contract/versions, unsupported translation fallback and ungrounded provider evidence", async () => {
  const f = await fixture();
  try {
    const start = await prepareGrammarProduction(f.user, f.exercise, { activity: "translate_it", answer: "She is studying now." }, "en", f.t.db);
    assert.ok(start.ok); if (!start.ok) assert.fail("expected source");
    const base = result("translate_it");
    for (const forged of [ { ...base, evaluationType: "vocabulary" as const }, { ...base, assessmentContractKey: "grammar.activate-it" as const },
      { ...base, promptVersion: "forged" }, { ...base, rubricVersion: "forged" }, { ...base, overallEstimate: 9 },
      { ...base, providerType: "internal" as const }, { ...base, criteria: base.criteria.slice(1) },
      { ...base, issues: [{ category: "GRAMMAR_TENSE" as const, message: "Invented issue", excerpt: "not in the student's answer", suggestion: null, severity: "medium" as const }] } ])
      await assert.rejects(persistGrammarProduction(start.prepared, forged, f.t.db), /grammar_production_invalid_evaluation/);
    assert.deepEqual(await counts(f), [{ attempts: 1, evaluations: 0, events: 0 }]);
  } finally { await f.t.close(); }
});

test("Pending written correction/translation/activation are unassessed in review and cannot lower mastery or add assessed sessions", async () => {
  const f = await fixture();
  try {
    await f.t.query("insert into grammar_attempts(user_id,exercise_id,activity,selected_option,is_correct,attempted_at)values($1,$2,'correct_it','She is studying now.',true,'2026-01-01')", [f.user, f.exercise]);
    const first = await getTopicMasteryFor(f.user, f.topic, f.t.db);
    assert.equal(first.mastery?.attempted, 1); assert.equal(first.mastery?.scorePercent, 100);
    for (const activity of ["correct_it", "translate_it", "activate_it"] as const)
      assert.ok((await prepareGrammarProduction(f.user, f.exercise, { activity, answer: "She is studying now." }, "en", f.t.db)).ok);
    const second = await getTopicMasteryFor(f.user, f.topic, f.t.db);
    assert.deepEqual(second, first);
    const all = await getTopicMastery(f.user, f.t.db);
    assert.deepEqual(all.find(row => row.topic.id === f.topic)?.mastery, first.mastery);
    const recall = await explainGrammarRetention({ id: f.user, role: "student", accountStatus: "active" }, "en", f.t.db);
    assert.equal(recall.status, "ready");
    if (recall.status === "ready") { assert.match(recall.answer, /3 unassessed/); assert.match(recall.answer, /0 needing correction/); }
    assert.deepEqual(await f.t.query("select count(*)::int n from evaluations"), [{ n: 0 }]);
  } finally { await f.t.close(); }
});

test("RIWI resumes one saved owned activation through the same fence and preserves prior work on provider failure", async () => {
  const f = await fixture();
  try {
    const start = await prepareGrammarProduction(f.user, f.exercise, { activity: "activate_it", answer: "She is studying now." }, "en", f.t.db);
    assert.ok(start.ok); if (!start.ok) assert.fail("expected pending source");
    const id = start.prepared.attemptId;
    assert.equal((await resumeGrammarProduction(f.other, id, "en", f.t.db, evaluator)).ok, false);
    assert.equal((await resumeGrammarProduction(f.user, id, "en", f.t.db, async () => ({ ok: false, error: "evaluation_unavailable" }))).ok, false);
    assert.deepEqual(await counts(f), [{ attempts: 1, evaluations: 0, events: 0 }]);
    const resumed = await resumeGrammarProduction(f.user, id, "en", f.t.db, evaluator);
    assert.ok(resumed.ok); assert.deepEqual(await counts(f), [{ attempts: 1, evaluations: 1, events: 1 }]);
    const replay = await resumeGrammarProduction(f.user, id, "en", f.t.db, evaluator);
    assert.ok(replay.ok); assert.equal(replay.evaluation.id, resumed.evaluation.id);
    assert.deepEqual(await counts(f), [{ attempts: 1, evaluations: 1, events: 1 }]);
  } finally { await f.t.close(); }
});

test("A valid one-letter correction remains eligible; whitespace and unsaved provider verdicts are refused", async () => {
  const f = await fixture();
  try {
    await f.t.query("update grammar_exercises set prompt_text='Insert the correct article: ___ book',correct_option='a',options='[\"a\",\"an\"]' where id=$1", [f.exercise]);
    const short = await submitGrammarProduction(f.user, f.exercise, { activity: "correct_it", answer: " a " }, "en", f.t.db, evaluator);
    assert.ok(short.ok); assert.equal(short.sampleAnswer, "a");
    assert.deepEqual(await submitGrammarProduction(f.user, f.exercise, { activity: "correct_it", answer: "  " }, "en", f.t.db, evaluator), { ok: false, error: "invalid_input", status: 400 });
    const fake = await submitGrammarProduction(f.user, f.exercise, { activity: "correct_it", answer: "a" }, "en", f.t.db,
      async () => ({ ok: true, evaluation: short.evaluation, reused: false }));
    assert.equal(fake.ok, false); assert.deepEqual(await counts(f), [{ attempts: 1, evaluations: 1, events: 1 }]);
  } finally { await f.t.close(); }
});

test("RIWI refuses legacy or changed original task/answer evidence before dispatch, without fabricating a version", async () => {
  const f = await fixture(); let calls = 0;
  const never = async () => { calls++; throw new Error("must not dispatch stale work"); };
  try {
    const legacy = randomUUID();
    await f.t.query("insert into grammar_attempts(id,user_id,exercise_id,activity,response_text,is_correct)values($1,$2,$3,'activate_it','She is studying now.',false)", [legacy, f.user, f.exercise]);
    assert.deepEqual(await resumeGrammarProduction(f.user, legacy, "en", f.t.db, never), { ok: false, error: "source_unavailable", status: 409 });
    assert.deepEqual(await f.t.query("select count(*)::int n from audit_log where target_id=$1", [legacy]), [{ n: 0 }]);
    const staged = await prepareGrammarProduction(f.user, f.exercise, { activity: "activate_it", answer: "She is studying now." }, "en", f.t.db);
    assert.ok(staged.ok); if (!staged.ok) assert.fail("expected source");
    await f.t.query("update grammar_exercises set activation_prompt='A different task.' where id=$1", [f.exercise]);
    assert.deepEqual(await resumeGrammarProduction(f.user, staged.prepared.attemptId, "en", f.t.db, never), { ok: false, error: "source_unavailable", status: 409 });
    await f.t.query("update grammar_exercises set activation_prompt='Describe something happening now.' where id=$1", [f.exercise]);
    await f.t.query("update grammar_attempts set response_text='An edited answer.' where id=$1", [staged.prepared.attemptId]);
    assert.deepEqual(await resumeGrammarProduction(f.user, staged.prepared.attemptId, "en", f.t.db, never), { ok: false, error: "source_unavailable", status: 409 });
    assert.equal(calls, 0); assert.deepEqual(await counts(f), [{ attempts: 2, evaluations: 0, events: 0 }]);
  } finally { await f.t.close(); }
});

test("Grammar prepared-source audit is mandatory and contains only fingerprints; failure rolls back staging", async () => {
  const f = await fixture();
  try {
    await f.t.query("create function fail_grammar_prepared_audit() returns trigger language plpgsql as $$ begin if NEW.action='grammar.production.prepared' then raise exception 'fixture audit failure'; end if; return NEW; end $$");
    await f.t.query("create trigger fail_grammar_prepared_audit before insert on audit_log for each row execute function fail_grammar_prepared_audit()");
    await assert.rejects(prepareGrammarProduction(f.user, f.exercise, { activity: "activate_it", answer: "She is studying now." }, "en", f.t.db));
    assert.deepEqual(await counts(f), [{ attempts: 0, evaluations: 0, events: 0 }]);
    await f.t.query("drop trigger fail_grammar_prepared_audit on audit_log");
    const start = await prepareGrammarProduction(f.user, f.exercise, { activity: "activate_it", answer: "She is studying now." }, "en", f.t.db);
    assert.ok(start.ok); if (!start.ok) assert.fail("expected mandatory prepared receipt");
    const [audit] = await f.t.query<{ metadata: { sourceChecksum: string; inputHash: string } }>("select metadata from audit_log where target_id=$1", [start.prepared.attemptId]);
    assert.equal(audit!.metadata.sourceChecksum, start.prepared.sourceHash); assert.match(audit!.metadata.inputHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(audit).includes("She is studying"), false);
    await f.t.query("delete from audit_log where target_id=$1", [start.prepared.attemptId]);
    await assert.rejects(persistGrammarProduction(start.prepared, result(), f.t.db), /grammar_production_source_changed/);
    assert.deepEqual(await counts(f), [{ attempts: 1, evaluations: 0, events: 0 }]);
  } finally { await f.t.close(); }
});
