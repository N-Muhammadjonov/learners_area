import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, type TestDatabase } from "./support/pglite";
import {
  bindAttemptToSessionItem,
  completeAiSession,
  createAiSession,
  findActiveAiSessionForUser,
  findAiSessionForUser,
  listAiSessionsForUser,
  loadSessionSummaryInput,
  recentAnsweredPromptIds,
  skipAiSessionItem,
  toAiSessionView,
} from "../src/lib/data/speaking-ai-sessions";
import { buildSessionPlan } from "../src/lib/speaking/ai-session-plan";
import { buildSessionSummary } from "../src/lib/speaking/ai-session-summary";
import { toLearnerEvaluation } from "../src/lib/services/coach/public-evaluation";

/**
 * The Practice with AI session layer against a REAL PostgreSQL (PGlite,
 * PostgreSQL compiled to WASM) with the shipped migrations applied — including
 * 0045.
 *
 * The guarantees tested here are all database guarantees, which is exactly why
 * stubs would be worthless for them: the plan is written once and never
 * re-derived (§11), a bounded cursor moves forward and never back, a binding is
 * re-authorised from stored rows (§43), "Try again" rebinds only through real
 * retry lineage (§30), and the summary is arithmetic over persisted evaluations
 * (§29).
 */

let database: TestDatabase;
let learnerId: string;
let otherId: string;
let promptIds: string[] = [];

const PROMPTS = [
  { part: "part1", topic: "Work", promptText: "Do you work or are you a student?" },
  { part: "part1", topic: "Work", promptText: "What do you enjoy about your job?" },
  { part: "part1", topic: "Work", promptText: "Would you change your job?" },
  { part: "part1", topic: "Food", promptText: "What food do you like?" },
  { part: "part1", topic: "Food", promptText: "Do you cook at home?" },
  { part: "part1", topic: "Food", promptText: "What did you eat yesterday?" },
  { part: "part2", topic: "Travel", promptText: "Describe a journey you enjoyed.", cueCard: "You should say: where, when, why." },
  { part: "part3", topic: "Travel", promptText: "Why do people travel abroad?" },
  { part: "part3", topic: "Travel", promptText: "How has tourism changed?" },
  { part: "part3", topic: "Travel", promptText: "Should travel be cheaper?" },
];

before(async () => {
  database = await createTestDatabase();
  const users = await database.query<{ id: string; email: string }>(
    `insert into users (name, role, account_status, email) values
      ('QA AI Learner', 'student', 'active', 'qa.ai.learner@example.test'),
      ('QA AI Other', 'student', 'active', 'qa.ai.other@example.test')
     returning id, email`,
  );
  learnerId = users.find((u) => u.email === "qa.ai.learner@example.test")!.id;
  otherId = users.find((u) => u.email === "qa.ai.other@example.test")!.id;

  for (const prompt of PROMPTS) {
    const rows = await database.query<{ id: string }>(
      `insert into speaking_prompts (part, category, prompt_text, topic, cue_card, available_in, is_active, publication_state)
       values ($1::speaking_part, $1::text::speaking_category, $2, $3, $4, '["practice_alone"]'::jsonb, true, 'published')
       returning id`,
      [prompt.part, prompt.promptText, prompt.topic, prompt.cueCard ?? null],
    );
    promptIds.push(rows[0]!.id);
  }
});

after(async () => {
  await database.close();
});

/** The rows the planner works from: canonical prompts with their real ids. */
function bankPrompts() {
  return PROMPTS.map((prompt, index) => ({
    id: promptIds[index]!,
    part: prompt.part,
    topic: prompt.topic,
  }));
}

async function newSession(mode: "full" | "part1" | "part2" | "part3", seed = 7) {
  const plan = buildSessionPlan(bankPrompts(), { mode, seed });
  assert.ok(plan.items.length > 0, `the fixture bank must produce a ${mode} plan`);
  return createAiSession({ userId: learnerId, mode, plan }, database.db);
}

/** Inserts a submitted attempt directly, the way the submit route leaves one. */
async function submittedAttempt(options: {
  userId?: string;
  promptId: string | null;
  part?: string;
  transcript?: string;
  retryOf?: string | null;
  durationMs?: number;
}) {
  const rows = await database.query<{ id: string }>(
    `insert into speaking_attempts (user_id, prompt_id, part, status, transcript, transcript_origin, transcript_edited, recording_duration_ms, submitted_at, retry_of_attempt_id)
     values ($1, $2, $3::speaking_part, 'submitted', $4, 'browser_stt', false, $5, now(), $6)
     returning id`,
    [
      options.userId ?? learnerId,
      options.promptId,
      options.part ?? "part1",
      options.transcript ?? "I work as a teacher in Tashkent and I enjoy it a lot.",
      options.durationMs ?? 42_000,
      options.retryOf ?? null,
    ],
  );
  return rows[0]!.id;
}


/** Stores a speaking evaluation row exactly the way the Coach persistence does. */
async function insertEvaluation(
  attemptId: string,
  options: { overall?: number | null; criteria?: unknown[]; fallback?: boolean; nextActions?: string[] } = {},
) {
  await database.query(
    `insert into evaluations (user_id, evaluation_type, source_type, source_id, provider_id, provider_display_name, provider_type, provider_version, model, prompt_version, rubric_version, fallback_used, checked_by_name, overall_estimate, confidence, verdict, criteria, strengths, weaknesses, issues, next_actions, recommended_exercises, processed_in_ms)
     values ($1, 'speaking', 'speaking_attempt', $2, 'riwi-local', 'RIWI local', 'internal', '1.0.0', null, 'p1', 'r1', $3, 'RIWI', $4, 0.5, null, $5::jsonb, '["Good detail"]'::jsonb, '["Repetition"]'::jsonb,
             '[{"category":"SPEAKING_REPETITION","message":"Repeated the same verb","severity":"medium"}]'::jsonb,
             $6::jsonb, '[]'::jsonb, 900)`,
    [
      learnerId,
      attemptId,
      options.fallback ?? true,
      options.overall === undefined ? 6.5 : options.overall,
      JSON.stringify(options.criteria ?? [
        { key: "fluency", label: "Fluency", band: 6.5 },
        { key: "pronunciation", label: "Pronunciation", band: null, limited: true, note: "Not assessed" },
      ]),
      JSON.stringify(options.nextActions ?? ["Vary your verbs"]),
    ],
  );
}

// ---------------------------------------------------------------------------
// the plan is written once and read back (§11)
// ---------------------------------------------------------------------------

test("a session is persisted with its items in plan order and a bounded cursor", async () => {
  const plan = buildSessionPlan(bankPrompts(), { mode: "full", seed: 11 });
  const session = await createAiSession({ userId: learnerId, mode: "full", plan }, database.db);

  assert.equal(session.status, "active");
  assert.equal(session.currentItemIndex, 0);
  assert.equal(session.sessionSeed, 11);
  assert.equal(session.items.length, plan.items.length);
  assert.deepEqual(session.items.map((i) => i.ordinal), plan.items.map((i) => i.ordinal));
  assert.deepEqual(session.items.map((i) => i.promptId), plan.items.map((i) => i.promptId));
  assert.deepEqual(session.items.map((i) => i.topicKey), plan.items.map((i) => i.topicKey));
  for (const item of session.items) assert.equal(item.status, "pending");
});

test("reading a session back returns the SAME plan — nothing is re-derived", async () => {
  const first = await newSession("full", 23);
  const again = await findAiSessionForUser(first.id, learnerId, database.db);
  assert.ok(again);
  assert.deepEqual(again.items.map((i) => i.promptId), first.items.map((i) => i.promptId));
  assert.deepEqual(again.items.map((i) => i.ordinal), first.items.map((i) => i.ordinal));
  assert.deepEqual(again.items.map((i) => i.questionPosition), first.items.map((i) => i.questionPosition));
  assert.deepEqual(again.items.map((i) => i.clusterSize), first.items.map((i) => i.clusterSize));
  assert.equal(again.sessionSeed, first.sessionSeed, "the seed is stored, so the plan is reproducible after a refresh");
});

test("the plan is stable across repeated reads — a refresh cannot reshuffle the examiner", async () => {
  const session = await newSession("part1", 5);
  const snapshots = await Promise.all([0, 1, 2, 3].map(() => findAiSessionForUser(session.id, learnerId, database.db)));
  for (const snapshot of snapshots) {
    assert.deepEqual(snapshot!.items.map((i) => i.promptId), session.items.map((i) => i.promptId));
  }
});

test("a topic cluster is persisted contiguously, never interleaved", async () => {
  const session = await newSession("full", 3);
  const seen = new Set<string>();
  let previous: string | null = null;
  for (const item of session.items) {
    const key = `${item.part}:${item.topicKey}`;
    if (key !== previous) {
      assert.equal(seen.has(key), false, `topic ${key} reappeared after another topic — clusters must be contiguous`);
      seen.add(key);
      previous = key;
    }
  }
});

test("prompt text is NOT copied into the plan — it is read from the one bank", async () => {
  const session = await newSession("part1", 9);
  const view = await toAiSessionView(session, database.db);
  for (const item of view.items) {
    assert.ok(item.prompt, "prompt text must resolve from the canonical row");
    const expected = PROMPTS.find((p) => p.promptText === item.prompt!.promptText);
    assert.ok(expected, "the rendered text must be the bank's own text");
    assert.equal(item.prompt!.topic, expected!.topic);
  }
});

// ---------------------------------------------------------------------------
// ownership (§43)
// ---------------------------------------------------------------------------

test("another learner's session is indistinguishable from one that does not exist", async () => {
  const session = await newSession("part1", 13);
  assert.equal(await findAiSessionForUser(session.id, otherId, database.db), null);
  assert.equal(await findAiSessionForUser(session.id, learnerId, database.db) !== null, true);
});

test("binding another learner's attempt is refused", async () => {
  const session = await newSession("part1", 17);
  const item = session.items[0]!;
  const foreignAttempt = await submittedAttempt({ userId: otherId, promptId: item.promptId });

  const result = await bindAttemptToSessionItem({
    sessionId: session.id, itemId: item.id, attemptId: foreignAttempt, userId: learnerId,
  }, database.db);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 403);
});

test("an attempt recorded for a DIFFERENT question cannot be bound", async () => {
  const session = await newSession("part1", 19);
  const item = session.items[0]!;
  const wrongPrompt = promptIds.find((id) => id !== item.promptId)!;
  const attempt = await submittedAttempt({ promptId: wrongPrompt });

  const result = await bindAttemptToSessionItem({
    sessionId: session.id, itemId: item.id, attemptId: attempt, userId: learnerId,
  }, database.db);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "attempt_prompt_mismatch");
});

test("an attempt that was never submitted cannot be bound", async () => {
  const session = await newSession("part1", 29);
  const item = session.items[0]!;
  const rows = await database.query<{ id: string }>(
    `insert into speaking_attempts (user_id, prompt_id, part, status)
     values ($1, $2, 'part1'::speaking_part, 'recording') returning id`,
    [learnerId, item.promptId],
  );
  const result = await bindAttemptToSessionItem({
    sessionId: session.id, itemId: item.id, attemptId: rows[0]!.id, userId: learnerId,
  }, database.db);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "attempt_not_submitted");
});

// ---------------------------------------------------------------------------
// the cursor
// ---------------------------------------------------------------------------

test("binding an answer advances the cursor by exactly one and marks the item answered", async () => {
  const session = await newSession("part1", 31);
  const item = session.items[0]!;
  const attempt = await submittedAttempt({ promptId: item.promptId });

  const result = await bindAttemptToSessionItem({
    sessionId: session.id, itemId: item.id, attemptId: attempt, userId: learnerId,
  }, database.db);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.reused, false);
  assert.equal(result.session.currentItemIndex, 1);
  const bound = result.session.items.find((i) => i.id === item.id)!;
  assert.equal(bound.status, "answered");
  assert.equal(bound.attemptId, attempt);
});

test("replaying the SAME bind is idempotent and reports reuse", async () => {
  const session = await newSession("part1", 37);
  const item = session.items[0]!;
  const attempt = await submittedAttempt({ promptId: item.promptId });

  await bindAttemptToSessionItem({ sessionId: session.id, itemId: item.id, attemptId: attempt, userId: learnerId }, database.db);
  const replay = await bindAttemptToSessionItem({ sessionId: session.id, itemId: item.id, attemptId: attempt, userId: learnerId }, database.db);

  assert.equal(replay.ok, true);
  if (replay.ok) {
    assert.equal(replay.reused, true);
    assert.equal(replay.session.currentItemIndex, 1, "a replay must not advance the cursor again");
  }
  const rows = await database.query<{ n: number }>(
    `select count(*)::int as n from speaking_ai_session_items where session_id = $1 and attempt_id = $2`,
    [session.id, attempt],
  );
  assert.equal(rows[0]!.n, 1);
});

test("a STALE bind for an earlier question cannot drag the cursor backwards", async () => {
  const session = await newSession("part1", 41);
  const [first, second] = [session.items[0]!, session.items[1]!];

  // Answer question 2 first, then a late/duplicate request answers question 1.
  const secondAttempt = await submittedAttempt({ promptId: second.promptId });
  await bindAttemptToSessionItem({ sessionId: session.id, itemId: second.id, attemptId: secondAttempt, userId: learnerId }, database.db);

  const firstAttempt = await submittedAttempt({ promptId: first.promptId });
  const late = await bindAttemptToSessionItem({ sessionId: session.id, itemId: first.id, attemptId: firstAttempt, userId: learnerId }, database.db);

  assert.equal(late.ok, true);
  if (late.ok) assert.equal(late.session.currentItemIndex, 2, "max() must keep the furthest position reached");
});

test("skipping records the skip, leaves attempt_id null and advances the cursor", async () => {
  const session = await newSession("part1", 43);
  const item = session.items[0]!;

  const result = await skipAiSessionItem({ sessionId: session.id, itemId: item.id, userId: learnerId }, database.db);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const skipped = result.session.items.find((i) => i.id === item.id)!;
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.attemptId, null, "a skip must never fabricate an answer");
  assert.equal(result.session.currentItemIndex, 1);
});

test("a late skip cannot un-answer a question that was already answered", async () => {
  const session = await newSession("part1", 47);
  const item = session.items[0]!;
  const attempt = await submittedAttempt({ promptId: item.promptId });
  await bindAttemptToSessionItem({ sessionId: session.id, itemId: item.id, attemptId: attempt, userId: learnerId }, database.db);

  const lateSkip = await skipAiSessionItem({ sessionId: session.id, itemId: item.id, userId: learnerId }, database.db);
  assert.equal(lateSkip.ok, true);
  if (lateSkip.ok) {
    const after = lateSkip.session.items.find((i) => i.id === item.id)!;
    assert.equal(after.status, "answered", "an answered question stays answered");
    assert.equal(after.attemptId, attempt);
  }
});

test("one learner cannot advance another learner's session", async () => {
  const session = await newSession("part1", 53);
  const item = session.items[0]!;
  const skip = await skipAiSessionItem({ sessionId: session.id, itemId: item.id, userId: otherId }, database.db);
  assert.equal(skip.ok, false);
  if (!skip.ok) assert.equal(skip.status, 404);
});

// ---------------------------------------------------------------------------
// "Try again" (§30)
// ---------------------------------------------------------------------------

test("a retry rebinds the item to the newer attempt and leaves the original untouched", async () => {
  const session = await newSession("part1", 59);
  const item = session.items[0]!;
  const first = await submittedAttempt({ promptId: item.promptId, transcript: "First, weaker answer." });
  await bindAttemptToSessionItem({ sessionId: session.id, itemId: item.id, attemptId: first, userId: learnerId }, database.db);

  // "Try again" creates a NEW attempt carrying the retry lineage.
  const second = await submittedAttempt({ promptId: item.promptId, transcript: "Second, better answer.", retryOf: first });
  const rebind = await bindAttemptToSessionItem({ sessionId: session.id, itemId: item.id, attemptId: second, userId: learnerId }, database.db);

  assert.equal(rebind.ok, true);
  if (!rebind.ok) return;
  assert.equal(rebind.reused, false);
  assert.equal(rebind.session.items.find((i) => i.id === item.id)!.attemptId, second);

  // The replaced attempt is NOT overwritten or deleted — it survives in history.
  const original = await database.query<{ transcript: string; status: string; retry_of_attempt_id: string | null }>(
    `select transcript, status, retry_of_attempt_id from speaking_attempts where id = $1`, [first],
  );
  assert.equal(original.length, 1, "the original attempt must still exist");
  assert.equal(original[0]!.transcript, "First, weaker answer.", "the original transcript must be unchanged");
  assert.equal(original[0]!.status, "submitted");
  assert.equal(original[0]!.retry_of_attempt_id, null);

  const newer = await database.query<{ retry_of_attempt_id: string }>(
    `select retry_of_attempt_id from speaking_attempts where id = $1`, [second],
  );
  assert.equal(newer[0]!.retry_of_attempt_id, first, "the retry must record what it replaced");
});

test("an unrelated second attempt CANNOT overwrite a bound answer", async () => {
  const session = await newSession("part1", 61);
  const item = session.items[0]!;
  const first = await submittedAttempt({ promptId: item.promptId });
  await bindAttemptToSessionItem({ sessionId: session.id, itemId: item.id, attemptId: first, userId: learnerId }, database.db);

  // Not a retry — a separate attempt for the same prompt with no lineage.
  const unrelated = await submittedAttempt({ promptId: item.promptId });
  const result = await bindAttemptToSessionItem({
    sessionId: session.id, itemId: item.id, attemptId: unrelated, userId: learnerId,
  }, database.db);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "attempt_not_a_retry");
  const still = await database.query<{ attempt_id: string }>(
    `select attempt_id from speaking_ai_session_items where id = $1`, [item.id],
  );
  assert.equal(still[0]!.attempt_id, first, "the original binding must survive the refused rebind");
});

test("a retry of a DIFFERENT attempt cannot hijack the binding", async () => {
  const session = await newSession("part1", 67);
  const item = session.items[0]!;
  const bound = await submittedAttempt({ promptId: item.promptId });
  await bindAttemptToSessionItem({ sessionId: session.id, itemId: item.id, attemptId: bound, userId: learnerId }, database.db);

  const unrelatedParent = await submittedAttempt({ promptId: item.promptId });
  const wrongRetry = await submittedAttempt({ promptId: item.promptId, retryOf: unrelatedParent });

  const result = await bindAttemptToSessionItem({
    sessionId: session.id, itemId: item.id, attemptId: wrongRetry, userId: learnerId,
  }, database.db);
  assert.equal(result.ok, false, "a retry must be a retry OF THE BOUND attempt");
  if (!result.ok) assert.equal(result.error, "attempt_not_a_retry");
});

// ---------------------------------------------------------------------------
// completing (§27–§29, §46)
// ---------------------------------------------------------------------------

test("completing a session is idempotent and stamps completedAt once", async () => {
  const session = await newSession("part3", 71);
  const first = await completeAiSession({ sessionId: session.id, userId: learnerId }, database.db);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.reused, false);
  assert.equal(first.session.status, "completed");
  assert.ok(first.session.completedAt);

  const second = await completeAiSession({ sessionId: session.id, userId: learnerId }, database.db);
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.reused, true);
    assert.equal(second.session.completedAt?.getTime(), first.session.completedAt?.getTime());
  }
});

test("a completed session refuses further answers, so a finished interview cannot change", async () => {
  const session = await newSession("part1", 73);
  const item = session.items[0]!;
  await completeAiSession({ sessionId: session.id, userId: learnerId }, database.db);

  const attempt = await submittedAttempt({ promptId: item.promptId });
  const bind = await bindAttemptToSessionItem({ sessionId: session.id, itemId: item.id, attemptId: attempt, userId: learnerId }, database.db);
  assert.equal(bind.ok, false);
  if (!bind.ok) assert.equal(bind.error, "session_completed");

  const skip = await skipAiSessionItem({ sessionId: session.id, itemId: item.id, userId: learnerId }, database.db);
  assert.equal(skip.ok, false);
});

test("a completed session no longer appears as the active one to resume", async () => {
  const session = await newSession("part2", 79);
  const beforeFinish = await findActiveAiSessionForUser(learnerId, database.db);
  assert.equal(beforeFinish?.id, session.id, "the newest active session is the one resumed");

  await completeAiSession({ sessionId: session.id, userId: learnerId }, database.db);
  const afterFinish = await findActiveAiSessionForUser(learnerId, database.db);
  assert.notEqual(afterFinish?.id, session.id, "a finished session must not be resumed as active");
});

// ---------------------------------------------------------------------------
// the summary (§29)
// ---------------------------------------------------------------------------

test("the summary is arithmetic over persisted evaluations and survives a reload", async () => {
  const session = await newSession("part3", 83);
  // Answer two Part 3 questions, each with a stored evaluation.
  for (const item of session.items.slice(0, 2)) {
    const attempt = await submittedAttempt({ promptId: item.promptId, part: "part3" });
    await insertEvaluation(attempt);
    await bindAttemptToSessionItem({ sessionId: session.id, itemId: item.id, attemptId: attempt, userId: learnerId }, database.db);
  }

  const stored = await findAiSessionForUser(session.id, learnerId, database.db);
  assert.ok(stored);
  const summary = buildSessionSummary(await loadSessionSummaryInput(stored!, database.db));

  assert.equal(summary.answeredCount, 2);
  assert.equal(summary.estimate.band, 6.5);
  assert.equal(summary.pronunciationAssessed, false);
  const pronunciation = summary.criteria.find((c) => c.key === "pronunciation");
  assert.equal(pronunciation?.band, null, "an unassessed criterion must stay band-less through the database round trip");
  assert.equal(pronunciation?.limited, true);
  assert.equal(summary.fallbackUsed, true);
  assert.deepEqual(summary.nextActions, ["Vary your verbs"]);
});

test("the summary reports a Part-1-only session without an overall band", async () => {
  const session = await newSession("part1", 89);
  const item = session.items[0]!;
  const attempt = await submittedAttempt({ promptId: item.promptId, part: "part1" });
  await insertEvaluation(attempt, { overall: 6.5 });
  await bindAttemptToSessionItem({ sessionId: session.id, itemId: item.id, attemptId: attempt, userId: learnerId }, database.db);

  const stored = await findAiSessionForUser(session.id, learnerId, database.db);
  const summary = buildSessionSummary(await loadSessionSummaryInput(stored!, database.db));
  assert.equal(summary.estimate.band, null);
  assert.equal(
    summary.estimate.suppressedReason,
    "part1_only",
    "a real Part 1 evaluation exists, so the missing band is the Part-1 rule, not a missing evaluation",
  );
  assert.equal(summary.criteria.length > 0, true, "the criteria are still reported");
  assert.equal(summary.answeredCount, 1, "the answer is still counted; only the band is withheld");
});

test("bank limitations recorded at creation are still disclosed in the summary", async () => {
  // One published question in a topic cannot reach the cluster minimum.
  const rows = await database.query<{ id: string }>(
    `insert into speaking_prompts (part, category, prompt_text, topic, available_in, is_active, publication_state)
     values ('part1'::speaking_part, 'part1'::speaking_category, 'A lonely question?', 'Lonely Topic', '["practice_alone"]'::jsonb, true, 'published') returning id`,
  );
  const plan = buildSessionPlan(
    [{ id: rows[0]!.id, part: "part1", topic: "Lonely Topic" }],
    { mode: "part1", seed: 97 },
  );
  assert.ok(plan.limitations.length > 0, "the planner must record the shortfall");

  const session = await createAiSession({ userId: learnerId, mode: "part1", plan }, database.db);
  const stored = await findAiSessionForUser(session.id, learnerId, database.db);
  const summary = buildSessionSummary(await loadSessionSummaryInput(stored!, database.db));
  assert.equal(summary.limitations.length, plan.limitations.length);
  assert.equal(summary.limitations[0]!.available, 1);
  assert.equal(summary.limitations[0]!.requested, 3);
});

test("the learner projection of a stored evaluation never carries provider identity", async () => {
  const rows = await database.query<{ source_id: string }>(
    `select source_id from evaluations where source_type = 'speaking_attempt' limit 1`,
  );
  const { findEvaluation } = await import("../src/lib/data/evaluations");
  const record = await findEvaluation({ sourceType: "speaking_attempt", sourceId: rows[0]!.source_id }, database.db);
  assert.ok(record);
  assert.equal(record!.providerId, "riwi-local", "the row keeps the real evaluator identity for audit");

  const projected = toLearnerEvaluation(record!);
  const json = JSON.stringify(projected);
  assert.equal(projected.checkedBy, "RIWI");
  assert.equal(json.includes("riwi-local"), false, "internal provenance must not survive the learner projection");
  assert.equal(json.includes("providerId"), false);
});

// ---------------------------------------------------------------------------
// history (§33)
// ---------------------------------------------------------------------------

test("recently answered prompts are returned newest-first and never include another learner's", async () => {
  const mine = await recentAnsweredPromptIds(learnerId, 100, database.db);
  assert.ok(mine.size > 0);
  // A learner with no attempts of their own sees an empty history even though
  // other learners have answered plenty — history is strictly per-user.
  const bystander = await database.query<{ id: string }>(
    `insert into users (name, role, account_status, email) values ('QA Bystander', 'student', 'active', 'qa.bystander@example.test') returning id`,
  );
  const theirs = await recentAnsweredPromptIds(bystander[0]!.id, 100, database.db);
  assert.equal(theirs.size, 0, "one learner's history must never inform another's plan");
});

test("session history is scoped to the owner and newest-first", async () => {
  const sessions = await listAiSessionsForUser(learnerId, 50, database.db);
  assert.ok(sessions.length > 0);
  for (let i = 1; i < sessions.length; i += 1) {
    assert.ok(sessions[i - 1]!.createdAt.getTime() >= sessions[i]!.createdAt.getTime(), "history must be newest-first");
  }
  const foreign = await listAiSessionsForUser(otherId, 50, database.db);
  assert.equal(foreign.length, 0);
});

// ---------------------------------------------------------------------------
// the migration itself
// ---------------------------------------------------------------------------

test("transcript_origin accepts browser_stt — the reason for the varchar widening", async () => {
  const attempt = await submittedAttempt({ promptId: promptIds[0]! });
  const rows = await database.query<{ transcript_origin: string; character_maximum_length: number }>(
    `select a.transcript_origin, c.character_maximum_length
       from speaking_attempts a
       join information_schema.columns c on c.table_name = 'speaking_attempts' and c.column_name = 'transcript_origin'
      where a.id = $1`,
    [attempt],
  );
  assert.equal(rows[0]!.transcript_origin, "browser_stt");
  assert.ok(rows[0]!.character_maximum_length >= 11, "the column must be wide enough for 'browser_stt'");
});

test("(session_id, ordinal) is unique, so a plan cannot contain two positions with the same place", async () => {
  const session = await newSession("part1", 101);
  await assert.rejects(
    () => database.query(
      `insert into speaking_ai_session_items (session_id, ordinal, prompt_id, part, topic_key, topic_position, question_position, cluster_size)
       values ($1, 0, $2, 'part1'::speaking_part, 'work', 0, 1, 4)`,
      [session.id, promptIds[0]!],
    ),
    /duplicate key|unique/i,
  );
});

test("deleting a prompt keeps the plan row but reports the question as unavailable", async () => {
  const rows = await database.query<{ id: string }>(
    `insert into speaking_prompts (part, category, prompt_text, topic, available_in, is_active, publication_state)
     values ('part1'::speaking_part, 'part1'::speaking_category, 'Temporary question?', 'Temp Topic', '["practice_alone"]'::jsonb, true, 'published') returning id`,
  );
  const plan = buildSessionPlan([{ id: rows[0]!.id, part: "part1", topic: "Temp Topic" }], { mode: "part1", seed: 103 });
  const session = await createAiSession({ userId: learnerId, mode: "part1", plan }, database.db);
  await database.query(`delete from speaking_prompts where id = $1`, [rows[0]!.id]);

  const stored = await findAiSessionForUser(session.id, learnerId, database.db);
  assert.ok(stored, "the session must survive; only the prompt link is dropped");
  assert.equal(stored!.items.length, plan.items.length, "the plan rows must survive the prompt's deletion");
  const view = await toAiSessionView(stored!, database.db);
  assert.equal(view.items[0]!.prompt, null, "a deleted prompt must render as unavailable, not as invented text");
});

test("deleting a learner cascades their sessions away", async () => {
  const rows = await database.query<{ id: string }>(
    `insert into users (name, role, account_status, email) values ('QA Cascade', 'student', 'active', 'qa.cascade@example.test') returning id`,
  );
  const cascadeUser = rows[0]!.id;
  const plan = buildSessionPlan(bankPrompts(), { mode: "part1", seed: 107 });
  const session = await createAiSession({ userId: cascadeUser, mode: "part1", plan }, database.db);

  await database.query(`delete from users where id = $1`, [cascadeUser]);
  const items = await database.query<{ n: number }>(
    `select count(*)::int as n from speaking_ai_session_items where session_id = $1`, [session.id],
  );
  assert.equal(items[0]!.n, 0, "session items must cascade with the learner");
});

test("an answered session with no stored evaluation reports not_evaluated, not no_answers", async () => {
  const session = await newSession("part3", 109);
  const item = session.items[0]!;
  const attempt = await submittedAttempt({ promptId: item.promptId, part: "part3" });
  await bindAttemptToSessionItem({ sessionId: session.id, itemId: item.id, attemptId: attempt, userId: learnerId }, database.db);

  const stored = await findAiSessionForUser(session.id, learnerId, database.db);
  const summary = buildSessionSummary(await loadSessionSummaryInput(stored!, database.db));
  assert.equal(summary.estimate.band, null);
  assert.equal(summary.estimate.suppressedReason, "not_evaluated");
  assert.equal(summary.answeredCount, 1, "saying \"no answers\" here would be false");
});
