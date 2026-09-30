import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createRetentionText, setRetentionTextActive } from "../src/lib/data/retention-bank";
import { getRetentionSummary, startOrResumeAttempt, submitAttempt } from "../src/lib/data/retention-attempts";
import { RetentionError } from "../src/lib/retention/errors";
import { bodyOfWords, createTestDatabase, simpleStructure, type TestDatabase } from "./support/pglite";

/**
 * Durable Retention state against real PostgreSQL (PGlite, shipped migrations):
 * multi-cycle rotation persistence (W01), evaluation-failure durability (W04)
 * and all-time analytics beyond any row window (W05). QA fixtures only.
 */

let database: TestDatabase;
let ownerId: string;
let seq = 0;

before(async () => {
  database = await createTestDatabase();
  const [owner] = await database.query<{ id: string }>(
    "insert into users (name, role, account_status, email) values ('QA Owner', 'owner', 'active', 'qa.durable.owner@example.test') returning id");
  ownerId = owner!.id;
});
after(async () => { await database.close(); });

async function learner(): Promise<string> {
  seq += 1;
  const [row] = await database.query<{ id: string }>(
    "insert into users (name, role, account_status, email) values ($1, 'student', 'active', $2) returning id",
    [`QA Learner ${seq}`, `qa.durable.${seq}@example.test`]);
  return row!.id;
}

const T0 = Date.UTC(2026, 0, 1);
let clock = 0;
const nextNow = () => new Date(T0 + (clock += 1_000_000));

async function runSession(userId: string, level: "B1" | "C1", random: () => number = Math.random) {
  const now = nextNow();
  const started = await startOrResumeAttempt({ userId, level, now, random }, database.db);
  // Resuming within the window never allocates another text.
  const resumed = await startOrResumeAttempt({ userId, level, now: new Date(now.getTime() + 5_000), random }, database.db);
  assert.equal(resumed.attempt.id, started.attempt.id);
  await submitAttempt({ attemptId: started.attempt.id, userId, recallText: "company 1998", now: new Date(now.getTime() + 121_000) }, database.db);
  return started.attempt;
}

async function stateCycle(userId: string, level: string): Promise<number> {
  const [row] = await database.query<{ cycle_number: number }>(
    "select cycle_number from retention_rotation_state where user_id = $1 and level = $2", [userId, level]);
  return row!.cycle_number;
}

test("W01: three full cycles consume every active text once per cycle and persist the cycle", async () => {
  const texts = [];
  for (let i = 0; i < 3; i++) texts.push(await createRetentionText({ level: "B1", bodyText: bodyOfWords(175), scoringStructure: simpleStructure(`cyc${i}`), actorUserId: ownerId }, database.db));
  const userId = await learner();
  let last: string | null = null;
  for (let cycle = 1; cycle <= 3; cycle++) {
    const seen = new Set<string>();
    for (let n = 0; n < 3; n++) {
      const attempt = await runSession(userId, "B1");
      assert.equal(attempt.rotationCycle, cycle, "assigned cycle");
      assert.equal(await stateCycle(userId, "B1"), cycle, "persisted state equals assigned cycle");
      assert.ok(!seen.has(attempt.retentionTextId), "no repeat inside a cycle");
      assert.notEqual(attempt.retentionTextId, last, "no immediate back-to-back repeat");
      seen.add(attempt.retentionTextId);
      last = attempt.retentionTextId;
    }
    assert.equal(seen.size, 3);
  }
});

test("W01: a one-text bank still advances its cycle on every session", async () => {
  await createRetentionText({ level: "C1", bodyText: bodyOfWords(260), scoringStructure: simpleStructure("solo"), actorUserId: ownerId }, database.db).catch(async () => {
    // Fall back to the configured C1 minimum if 260 is out of range.
    const { RETENTION_LEVEL_CONFIG } = await import("../src/lib/retention/levels");
    await createRetentionText({ level: "C1", bodyText: bodyOfWords(RETENTION_LEVEL_CONFIG.C1.minWords), scoringStructure: simpleStructure("solo"), actorUserId: ownerId }, database.db);
  });
  const userId = await learner();
  for (let cycle = 1; cycle <= 3; cycle++) {
    const attempt = await runSession(userId, "C1");
    assert.equal(attempt.rotationCycle, cycle);
    assert.equal(await stateCycle(userId, "C1"), cycle);
  }
});

test("W01: archiving mid-cycle removes the text from eligibility without resetting history", async () => {
  const userId = await learner();
  const first = await runSession(userId, "B1");
  const [row] = await database.query<{ id: string }>(
    "select id from retention_texts where level = 'B1' and active and id <> $1 order by id limit 1", [first.retentionTextId]);
  await setRetentionTextActive({ textId: row!.id, active: false, actorUserId: ownerId }, database.db);
  const second = await runSession(userId, "B1");
  assert.notEqual(second.retentionTextId, row!.id);
  assert.notEqual(second.retentionTextId, first.retentionTextId);
  assert.equal(second.rotationCycle, 1);
  const third = await runSession(userId, "B1");
  assert.equal(third.rotationCycle, 2, "two active texts exhausted: new cycle");
  const [count] = await database.query<{ n: number }>(
    "select count(*)::int as n from retention_rotation_completions where user_id = $1", [userId]);
  assert.equal(count!.n, 3, "history retained");
  await setRetentionTextActive({ textId: row!.id, active: true, actorUserId: ownerId }, database.db);
});

test("W04: an evaluation failure keeps the latest on-time recall, stays non-terminal, and a retry finalizes once", async () => {
  const userId = await learner();
  const now = nextNow();
  const started = await startOrResumeAttempt({ userId, level: "B1", now }, database.db);
  const [original] = await database.query<{ scoring_structure: unknown }>(
    "select scoring_structure from retention_text_versions where id = $1", [started.attempt.retentionTextVersionId]);
  // QA-only corruption to exercise failure isolation.
  await database.query("update retention_text_versions set scoring_structure = '{}'::jsonb where id = $1", [started.attempt.retentionTextVersionId]);
  await assert.rejects(
    submitAttempt({ attemptId: started.attempt.id, userId, recallText: "My newest recall", now: new Date(now.getTime() + 125_000) }, database.db),
    (error: unknown) => error instanceof RetentionError && error.code === "retention_scoring_failed");
  const [kept] = await database.query<{ recall_text: string; status: string; score: number | null }>(
    "select recall_text, status, score from retention_attempts where id = $1", [started.attempt.id]);
  assert.equal(kept!.recall_text, "My newest recall");
  assert.ok(["reading", "recall"].includes(kept!.status), "attempt stays non-terminal");
  assert.equal(kept!.score, null, "no invented score");
  const [usage] = await database.query<{ n: number }>(
    "select count(*)::int as n from retention_rotation_completions where user_id = $1", [userId]);
  assert.equal(usage!.n, 0, "no rotation usage consumed on failure");

  await database.query("update retention_text_versions set scoring_structure = $2::jsonb where id = $1",
    [started.attempt.retentionTextVersionId, JSON.stringify(original!.scoring_structure)]);
  // Late retry: grades only the persisted on-time draft, finalizes once.
  const late = await submitAttempt({ attemptId: started.attempt.id, userId, recallText: "late extra text", now: new Date(now.getTime() + 400_000) }, database.db);
  assert.equal(late.attempt.status, "timed_out");
  assert.equal(late.attempt.recallText, "My newest recall");
  const again = await submitAttempt({ attemptId: started.attempt.id, userId, now: new Date(now.getTime() + 401_000) }, database.db);
  assert.equal(again.idempotent, true);
  const [after] = await database.query<{ n: number }>(
    "select count(*)::int as n from retention_rotation_completions where user_id = $1", [userId]);
  assert.equal(after!.n, 1);
});

test("W05: all-time metrics include attempts beyond any 500-row window", async () => {
  const userId = await learner();
  const [text] = await database.query<{ id: string; version_id: string }>(
    "select t.id, t.current_version_id as version_id from retention_texts t where level = 'B1' limit 1");
  await database.query(`insert into retention_attempts(user_id,retention_text_id,retention_text_version_id,level,rotation_cycle,status,read_started_at,read_ends_at,write_started_at,write_ends_at,score,created_at)
    select $1,$2,$3,'B1',n,'completed',t,t+interval '120 seconds',t+interval '120 seconds',t+interval '300 seconds',case when n=1 then 100 else 20 end,t
    from (select n, timestamp '2025-01-01' + n*interval '1 hour' as t from generate_series(1,501) as n) s`, [userId, text!.id, text!.version_id]);
  // A null-score terminal row must not count as a scored completion.
  await database.query(`insert into retention_attempts(user_id,retention_text_id,retention_text_version_id,level,rotation_cycle,status,read_started_at,read_ends_at,write_started_at,write_ends_at,score,created_at)
    values ($1,$2,$3,'B1',999,'timed_out',now(),now(),now(),now(),null,now())`, [userId, text!.id, text!.version_id]);
  const summary = await getRetentionSummary(userId, database.db);
  assert.equal(summary.completedCount, 501);
  assert.equal(summary.bestScore, 100);
  assert.equal(summary.lastTenAverage, 20);
  assert.equal(summary.lastTenCount, 10);
  const b1 = summary.perLevel.find((row) => row.level === "B1")!;
  assert.equal(b1.attempts, 501);
  assert.equal(b1.bestScore, 100);
  assert.equal(summary.perLevel.find((row) => row.level === "A2")!.attempts, 0);
});

test("W05: a learner with no results gets empty metrics", async () => {
  const summary = await getRetentionSummary(await learner(), database.db);
  assert.equal(summary.completedCount, 0);
  assert.equal(summary.bestScore, null);
  assert.equal(summary.lastTenAverage, null);
});

test("W06: 100+ texts are all reachable through pages, and sorts are global before paging", async () => {
  const { listRetentionLevelPage } = await import("../src/lib/data/retention-bank");
  const { RETENTION_LEVEL_CONFIG } = await import("../src/lib/retention/levels");
  const ids: string[] = [];
  for (let i = 0; i < 105; i++) {
    const created = await createRetentionText({ level: "A2", bodyText: bodyOfWords(RETENTION_LEVEL_CONFIG.A2.minWords), scoringStructure: simpleStructure(`pg${i}`), actorUserId: ownerId }, database.db);
    ids.push((created as { textId: string }).textId);
  }
  const seen = new Set<string>();
  const first = await listRetentionLevelPage({ level: "A2", filter: "active", sort: "label", page: 1 }, database.db);
  assert.equal(first.total, 105);
  assert.equal(first.pageCount, 3);
  assert.equal(first.rows.length, 50);
  for (let page = 1; page <= first.pageCount; page++) {
    const result = await listRetentionLevelPage({ level: "A2", sort: "label", page }, database.db);
    for (const row of result.rows) seen.add(row.textId);
  }
  assert.equal(seen.size, 105, "every text reachable");

  // Newest (created last, beyond the original first 50) leads the newest sort.
  const newest = await listRetentionLevelPage({ level: "A2", sort: "newest", page: 1 }, database.db);
  assert.equal(newest.rows[0]!.textId, ids[104]);

  // Give the 90th text lifetime uses: it must lead "most used" on page 1.
  const heavy = ids[89]!;
  const [version] = await database.query<{ v: string }>("select current_version_id as v from retention_texts where id = $1", [heavy]);
  const userId = await learner();
  await database.query(`insert into retention_attempts(user_id,retention_text_id,retention_text_version_id,level,rotation_cycle,status,read_started_at,read_ends_at,write_started_at,write_ends_at,score,created_at)
    select $1,$2,$3,'A2',n,'completed',now(),now(),now(),now(),50,now() - n*interval '1 day' from generate_series(1,3) n`, [userId, heavy, version!.v]);
  const used = await listRetentionLevelPage({ level: "A2", sort: "uses", page: 1 }, database.db);
  assert.equal(used.rows[0]!.textId, heavy);
  assert.equal(used.rows[0]!.lifetimeUses, 3);
  assert.equal(used.rows[0]!.currentVersionUses, 3);

  // Out-of-range pages clamp; page size is bounded.
  const clamped = await listRetentionLevelPage({ level: "A2", page: 999 }, database.db);
  assert.equal(clamped.page, 3);
  assert.equal(clamped.rows.length, 5);
  const bounded = await listRetentionLevelPage({ level: "A2", pageSize: 10_000 }, database.db);
  assert.equal(bounded.pageSize, 100);
});
