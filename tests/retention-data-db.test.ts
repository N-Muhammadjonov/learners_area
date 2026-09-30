import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  createRetentionText,
  createRetentionTextVersion,
  getRetentionTextDetail,
  listRetentionInventory,
  listRetentionLevelTexts,
  setRetentionTextActive,
  validateAuthoredContent,
} from "../src/lib/data/retention-bank";
import {
  findAttemptForUser,
  findLiveAttempt,
  getRetentionSummary,
  listRetentionHistory,
  saveRecallDraft,
  startOrResumeAttempt,
  submitAttempt,
} from "../src/lib/data/retention-attempts";
import { RetentionError } from "../src/lib/retention/errors";
import { RETENTION_LEVEL_CONFIG } from "../src/lib/retention/levels";
import { bodyOfWords, createTestDatabase, simpleStructure, type TestDatabase } from "./support/pglite";

/**
 * The Retention data layer against a REAL PostgreSQL (PGlite, PostgreSQL 18 on
 * WASM) with the shipped migrations applied.
 *
 * This is where the owner's rules stop being prose: rotation is exercised through
 * the same function the API calls, the deadlines are moved by injecting `now`
 * instead of sleeping, the optimistic-concurrency guard is provoked, and the
 * usage counters are compared with the rows they claim to count. Nothing here
 * touches a remote server: PGlite is an empty database inside this process.
 */

let database: TestDatabase;
let ownerId: string;
let learnerId: string;
let otherId: string;

const T0 = new Date("2026-05-01T08:00:00.000Z");
// Named `at` (not `after`) so the node:test teardown hook keeps its name.
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const draft = "The company was founded in 1998 by two students.";

before(async () => {
  database = await createTestDatabase();
  const rows = await database.query<{ id: string }>(
    `insert into users (name, role, account_status, email) values
      ('QA Owner', 'owner', 'active', 'qa.retention.owner@example.test'),
      ('QA Learner', 'student', 'active', 'qa.retention.learner@example.test'),
      ('QA Other', 'student', 'active', 'qa.retention.other@example.test')
     returning id`
  );
  ownerId = rows[0]!.id;
  learnerId = rows[1]!.id;
  otherId = rows[2]!.id;
});

after(async () => {
  await database.close();
});

async function makeText(level: "A2" | "B1" | "B2" | "C1" | "C2", marker: string, words?: number) {
  return createRetentionText(
    {
      level,
      bodyText: `${bodyOfWords(words ?? RETENTION_LEVEL_CONFIG[level].targetWords)} ${marker}`,
      scoringStructure: simpleStructure(marker),
      actorUserId: ownerId,
    },
    database.db
  );
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

test("Add text assigns the next internal label per level and stores v1", async () => {
  const first = await makeText("B1", "first");
  const second = await makeText("B1", "second");
  assert.equal(first.internalLabel, "B1-001");
  assert.equal(second.internalLabel, "B1-002");

  const detail = await getRetentionTextDetail(second.textId, database.db);
  assert.equal(detail!.versionNumber, 1);
  assert.equal(detail!.active, true);
  assert.equal(detail!.versionCount, 1);
  assert.equal(detail!.lifetimeUses, 0);
});

test("the word range is enforced before anything is written", async () => {
  assert.throws(
    () => validateAuthoredContent({ level: "B1", bodyText: bodyOfWords(159), scoringStructure: simpleStructure("short") }),
    (error: unknown) => error instanceof RetentionError && error.code === "retention_word_count_out_of_range"
  );
  assert.throws(
    () => validateAuthoredContent({ level: "B1", bodyText: bodyOfWords(196), scoringStructure: simpleStructure("long") }),
    (error: unknown) => error instanceof RetentionError && error.code === "retention_word_count_out_of_range"
  );
  // In range: accepted, and the count that will be stored is returned.
  const ok = validateAuthoredContent({ level: "B1", bodyText: bodyOfWords(175), scoringStructure: simpleStructure("ok") });
  assert.equal(ok.wordCount, 175);
});

test("a structure that is not worth 100 points is refused with the validator's issues", async () => {
  const broken = { ...simpleStructure("broken"), maxScore: 90 };
  await assert.rejects(
    createRetentionText({ level: "B1", bodyText: bodyOfWords(175), scoringStructure: broken, actorUserId: ownerId }, database.db),
    (error: unknown) => error instanceof RetentionError && error.code === "retention_invalid_structure"
  );
});

test("Change writes a NEW version, keeps the old one, and refuses a stale editor", async () => {
  const created = await makeText("B2", "change");
  const before = await getRetentionTextDetail(created.textId, database.db);

  const v2 = await createRetentionTextVersion(
    {
      textId: created.textId,
      bodyText: `${bodyOfWords(260)} change-two`,
      scoringStructure: simpleStructure("change-two"),
      expectedCurrentVersionId: before!.currentVersionId,
      actorUserId: ownerId,
    },
    database.db
  );
  assert.equal(v2.versionNumber, 2);

  const afterChange = await getRetentionTextDetail(created.textId, database.db);
  assert.equal(afterChange!.versionNumber, 2);
  assert.equal(afterChange!.versionCount, 2);
  assert.notEqual(afterChange!.currentVersionId, before!.currentVersionId);

  await assert.rejects(
    createRetentionTextVersion(
      {
        textId: created.textId,
        bodyText: `${bodyOfWords(260)} stale`,
        scoringStructure: simpleStructure("stale"),
        expectedCurrentVersionId: before!.currentVersionId,
        actorUserId: ownerId,
      },
      database.db
    ),
    (error: unknown) => error instanceof RetentionError && error.code === "retention_conflict"
  );
  const stillTwo = await getRetentionTextDetail(created.textId, database.db);
  assert.equal(stillTwo!.versionCount, 2, "the refused attempt wrote nothing");
});

test("Delete archives and Restore brings the text back to rotation with its history intact", async () => {
  const created = await makeText("A2", "archive", 110);
  await setRetentionTextActive({ textId: created.textId, active: false, actorUserId: ownerId }, database.db);

  const archived = await listRetentionLevelTexts("A2", "all", database.db);
  const row = archived.find((entry) => entry.textId === created.textId);
  assert.equal(row!.active, false);

  await setRetentionTextActive({ textId: created.textId, active: true, actorUserId: ownerId }, database.db);
  const restored = await listRetentionLevelTexts("A2", "active", database.db);
  assert.ok(restored.some((entry) => entry.textId === created.textId));
});

test("inventory counts active, archived and lifetime uses without a per-row query", async () => {
  const inventory = await listRetentionInventory(database.db);
  const b1 = inventory.find((row) => row.level === "B1")!;
  assert.equal(b1.target, 15);
  assert.equal(b1.activeCount, 2);
  assert.equal(b1.remainingToTarget, 13);
  assert.equal(inventory.length, 5, "every level is reported, even an empty one");
});

// ---------------------------------------------------------------------------
// Allocation and rotation
// ---------------------------------------------------------------------------

test("allocation is random over unseen texts, and refreshing resumes the SAME attempt", async () => {
  const level = "C1" as const;
  const created = [] as string[];
  for (let index = 0; index < 3; index += 1) created.push((await makeText(level, `rot-${index}`, 300))!.textId);

  const first = await startOrResumeAttempt({ userId: learnerId, level, now: T0, random: () => 0.5 }, database.db);
  assert.equal(first.outcome, "created");
  assert.ok(created.includes(first.assignedTextId!), "the assigned text is one of the level's texts");

  const resumed = await startOrResumeAttempt({ userId: learnerId, level, now: at(30), random: () => 0.9 }, database.db);
  assert.equal(resumed.outcome, "resumed");
  assert.equal(resumed.attempt.id, first.attempt.id, "a second Start does not allocate a new text");
  assert.equal(resumed.attempt.retentionTextId, first.attempt.retentionTextId);

  const live = await findLiveAttempt({ userId: learnerId, level, now: at(31) }, database.db);
  assert.equal(live!.id, first.attempt.id);
});

test("a completed cycle starts a new one without a back-to-back repeat", async () => {
  const level = "B1" as const;
  // Both B1 texts are already in the bank; finish one, then the other, then ask again.
  const seen: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const started = await startOrResumeAttempt({ userId: otherId, level, now: T0, random: () => 0.25 }, database.db);
    seen.push(started.attempt.retentionTextId);
    await submitAttempt({ attemptId: started.attempt.id, userId: otherId, recallText: draft, now: at(200) }, database.db);
  }
  assert.equal(new Set(seen).size, 2, "both texts were used before any repeat");

  const newCycle = await startOrResumeAttempt({ userId: otherId, level, now: at(1000), random: () => 0.75 }, database.db);
  assert.equal(newCycle.attempt.rotationCycle, 2);
  assert.notEqual(newCycle.attempt.retentionTextId, seen[1]);
});

test("a level with no active text answers retention_no_content", async () => {
  await assert.rejects(
    startOrResumeAttempt({ userId: learnerId, level: "C2", now: T0 }, database.db),
    (error: unknown) => error instanceof RetentionError && error.code === "retention_no_content"
  );
  await assert.rejects(
    startOrResumeAttempt({ userId: learnerId, level: "D3", now: T0 }, database.db),
    (error: unknown) => error instanceof RetentionError && error.code === "retention_invalid_level"
  );
});

// ---------------------------------------------------------------------------
// Draft, submit, timing
// ---------------------------------------------------------------------------

test("draft autosave is refused outside recall, persisted inside it, and survives a refresh", async () => {
  const level = "C1" as const;
  const attempt = (await findLiveAttempt({ userId: learnerId, level, now: at(60) }, database.db))!;

  await assert.rejects(
    saveRecallDraft({ attemptId: attempt.id, userId: learnerId, recallText: "too early", now: at(60) }, database.db),
    (error: unknown) => error instanceof RetentionError && error.code === "retention_wrong_phase"
  );

  const saved = await saveRecallDraft({ attemptId: attempt.id, userId: learnerId, recallText: draft, now: at(130) }, database.db);
  assert.ok(saved.savedAt);

  const reloaded = await findAttemptForUser({ attemptId: attempt.id, userId: learnerId, now: at(140) }, database.db);
  assert.equal(reloaded.recallText, draft, "the draft is in the row, so a refresh restores it");
  assert.equal(reloaded.writeEndsAt.getTime(), at(300).getTime());
});

test("another learner cannot read, draft or submit somebody else's attempt", async () => {
  const attempt = (await findLiveAttempt({ userId: learnerId, level: "C1", now: at(140) }, database.db))!;
  for (const call of [
    () => findAttemptForUser({ attemptId: attempt.id, userId: otherId, now: at(140) }, database.db),
    () => saveRecallDraft({ attemptId: attempt.id, userId: otherId, recallText: "x", now: at(140) }, database.db),
    () => submitAttempt({ attemptId: attempt.id, userId: otherId, recallText: "x", now: at(140) }, database.db),
  ]) {
    await assert.rejects(call, (error: unknown) => error instanceof RetentionError && error.code === "retention_attempt_not_found");
  }
});

test("submit scores against the ASSIGNED version even after the owner publishes v2", async () => {
  const level = "C1" as const;
  const live = (await findLiveAttempt({ userId: learnerId, level, now: at(140) }, database.db))!;
  const assigned = live.retentionTextVersionId;

  // The owner edits the text mid-attempt.
  const detail = await getRetentionTextDetail(live.retentionTextId, database.db);
  await createRetentionTextVersion(
    {
      textId: live.retentionTextId,
      bodyText: `${bodyOfWords(300)} republished`,
      scoringStructure: simpleStructure("republished"),
      expectedCurrentVersionId: detail!.currentVersionId,
      actorUserId: ownerId,
    },
    database.db
  );

  const submitted = await submitAttempt({ attemptId: live.id, userId: learnerId, recallText: draft, now: at(150) }, database.db);
  assert.equal(submitted.idempotent, false);
  assert.equal(submitted.attempt.retentionTextVersionId, assigned, "the attempt still points at the version it was given");
  assert.equal(submitted.attempt.status, "completed");
  assert.equal(submitted.attempt.score, 100);
  assert.equal(submitted.attempt.evaluatorVersion, "retention-deterministic-v1");
  assert.ok(submitted.attempt.scoreBreakdown?.claims.length);

  // Submitting twice returns the stored result and never re-scores.
  const again = await submitAttempt({ attemptId: live.id, userId: learnerId, recallText: "a totally different answer", now: at(160) }, database.db);
  assert.equal(again.idempotent, true);
  assert.equal(again.attempt.score, 100);
  assert.equal(again.attempt.recallText, draft);
});

test("a late submit does not extend the deadline: it finalizes as timed_out using the persisted draft", async () => {
  const level = "C1" as const;
  const started = await startOrResumeAttempt({ userId: learnerId, level, now: at(2000), random: () => 0.1 }, database.db);
  const attemptId = started.attempt.id;
  await saveRecallDraft({ attemptId, userId: learnerId, recallText: draft, now: at(2130) }, database.db);

  const late = await submitAttempt({ attemptId, userId: learnerId, recallText: "typed after the timer", now: at(2400) }, database.db);
  assert.equal(late.attempt.status, "timed_out");
  assert.equal(late.attempt.recallText, draft, "the row's draft is what was scored");
  assert.equal(late.attempt.score, 100);
  assert.equal(late.attempt.writeEndsAt.getTime(), started.attempt.writeEndsAt.getTime());

  // Reading it later returns the same terminal result; nothing is re-timed.
  const later = await findAttemptForUser({ attemptId, userId: learnerId, now: at(99_999) }, database.db);
  assert.equal(later.status, "timed_out");
  assert.equal(later.score, 100);
  assert.equal(later.writeEndsAt.getTime(), started.attempt.writeEndsAt.getTime());
});

test("an abandoned attempt is resumed, not replaced, and expired ones finalize lazily", async () => {
  const level = "B2" as const;
  const first = await startOrResumeAttempt({ userId: learnerId, level, now: T0, random: () => 0.4 }, database.db);
  const resumed = await startOrResumeAttempt({ userId: learnerId, level, now: at(60), random: () => 0.6 }, database.db);
  assert.equal(resumed.outcome, "resumed");
  assert.equal(resumed.attempt.id, first.attempt.id);

  // Come back the next day: the first call closes the abandoned attempt and shows
  // its honest timed-out result…
  const nextDay = new Date(T0.getTime() + 24 * 60 * 60 * 1000);
  const closed = await startOrResumeAttempt({ userId: learnerId, level, now: nextDay, random: () => 0.4 }, database.db);
  assert.equal(closed.outcome, "finalized");
  assert.equal(closed.attempt.id, first.attempt.id);
  assert.equal(closed.attempt.status, "timed_out");
  assert.equal(closed.attempt.score, 0, "nothing was written, so the score is honestly zero");

  // …and the next Start opens a fresh reading attempt, with an empty draft.
  // The timed-out attempt consumed the text the learner had been shown, and this
  // level has exactly one text, so the fresh attempt legitimately begins the next
  // cycle rather than handing the same text back inside the same one (§98, §99).
  const fresh = await startOrResumeAttempt({ userId: learnerId, level, now: at(24 * 60 * 60 + 5), random: () => 0.4 }, database.db);
  assert.equal(fresh.outcome, "created");
  assert.notEqual(fresh.attempt.id, first.attempt.id, "the expired attempt is not reopened");
  assert.equal(closed.attempt.rotationCycle, 1);
  assert.equal(fresh.attempt.rotationCycle, 2);
  assert.equal(fresh.attempt.status, "reading");
  assert.equal(fresh.attempt.recallText, "");
});

// ---------------------------------------------------------------------------
// Usage, history, analytics
// ---------------------------------------------------------------------------

test("usage counts ignore live attempts and count terminal ones on the right version", async () => {
  const rows = await listRetentionLevelTexts("C1", "all", database.db);
  for (const row of rows) {
    const truth = await database.query<{ lifetime: number; current: number }>(
      `select
         count(*) filter (where a.status in ('completed','timed_out'))::int as lifetime,
         count(*) filter (where a.status in ('completed','timed_out') and a.retention_text_version_id = t.current_version_id)::int as current
       from retention_texts t
       left join retention_attempts a on a.retention_text_id = t.id
       where t.id = $1
       group by t.id`,
      [row.textId]
    );
    assert.equal(row.lifetimeUses, truth[0]!.lifetime, `${row.internalLabel} lifetime`);
    assert.equal(row.currentVersionUses, truth[0]!.current, `${row.internalLabel} current version`);
  }
  const someUsed = rows.some((row) => row.lifetimeUses > 0);
  assert.ok(someUsed, "the fixture actually completed attempts in this level");
});

test("history is owner-scoped, terminal-only, newest first and paginated", async () => {
  const page = await listRetentionHistory({ userId: learnerId, page: 1, pageSize: 2 }, database.db);
  assert.equal(page.pageSize, 2);
  assert.ok(page.rows.length <= 2);
  assert.ok(page.total >= page.rows.length);
  assert.ok(page.pageCount >= 1);
  for (const row of page.rows) {
    assert.ok(row.status === "completed" || row.status === "timed_out");
    assert.ok(row.completedAt || row.createdAt);
  }
  const first = await listRetentionHistory({ userId: learnerId, page: 1, pageSize: 50 }, database.db);
  const second = await listRetentionHistory({ userId: otherId, page: 1, pageSize: 50 }, database.db);
  assert.equal(second.rows.some((row) => first.rows.some((own) => own.attemptId === row.attemptId)), false);
});

test("My memory metrics are computed from the learner's own terminal attempts", async () => {
  const history = await listRetentionHistory({ userId: learnerId, page: 1, pageSize: 50 }, database.db);
  const summary = await getRetentionSummary(learnerId, database.db);
  const scores = history.rows.map((row) => row.score ?? 0);

  assert.equal(summary.completedCount, history.rows.length);
  assert.equal(summary.bestScore, Math.max(...scores));
  const lastTen = scores.slice(0, 10);
  assert.equal(summary.lastTenCount, lastTen.length);
  assert.equal(summary.lastTenAverage, Math.round(lastTen.reduce((sum, score) => sum + score, 0) / lastTen.length));
  assert.equal(
    summary.perLevel.reduce((sum, row) => sum + row.attempts, 0),
    history.rows.length
  );
  // A learner with no attempts at all is told the truth, not given a fake zero.
  const empty = await getRetentionSummary(ownerId, database.db);
  assert.equal(empty.completedCount, 0);
  assert.equal(empty.bestScore, null);
  assert.equal(empty.lastTenAverage, null);
});
