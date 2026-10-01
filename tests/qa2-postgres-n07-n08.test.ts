import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, evaluations } from "../src/db/schema";
import { createRetentionText } from "../src/lib/data/retention-bank";
import { finishReadingEarly, startOrResumeAttempt, submitAttempt, saveRecallDraft } from "../src/lib/data/retention-attempts";
import { getProgressTrends } from "../src/lib/data/progress-trends";
import { RetentionError } from "../src/lib/retention/errors";
import { RETENTION_LEVEL_CONFIG } from "../src/lib/retention/levels";
import { bodyOfWords, simpleStructure } from "./support/pglite";

/**
 * Real PostgreSQL (multi-connection pool) gates for N07/N08. Guarded exactly
 * like the other QA2 gates: localhost + database learners_qa2 only.
 */
const enabled = process.env.QA2_DATABASE_TESTS === "1";
const guard = () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2", "only the isolated QA database is allowed");
};
const isCode = (code: string) => (e: unknown) => e instanceof RetentionError && e.code === code;

async function fixtureUsers(n: number) {
  const ids = Array.from({ length: n }, () => randomUUID());
  await db.insert(users).values(ids.map((id, i) => ({ id, name: `QA2 N07 ${i}`, role: i === 0 ? ("owner" as const) : ("student" as const), accountStatus: "active" as const, email: `qa2.${id}@example.test` })));
  return ids;
}

test("N07 on real PostgreSQL: 8 concurrent finish requests on separate connections → one transition, one deadline", { skip: !enabled && "set QA2_DATABASE_TESTS=1" }, async () => {
  guard();
  const [owner, learner, other] = await fixtureUsers(3);
  const marker = `n07${randomUUID().slice(0, 8)}`;
  await createRetentionText({ level: "A2", bodyText: `${bodyOfWords(RETENTION_LEVEL_CONFIG.A2.targetWords)} ${marker}`, scoringStructure: simpleStructure(marker), actorUserId: owner! }, db as never);
  const start = new Date();
  const { attempt } = await startOrResumeAttempt({ userId: learner!, level: "A2", now: start }, db as never);
  const t = (s: number) => new Date(start.getTime() + s * 1000);
  await assert.rejects(finishReadingEarly({ attemptId: attempt.id, userId: other!, now: t(5) }, db as never), isCode("retention_attempt_not_found"));
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => finishReadingEarly({ attemptId: attempt.id, userId: learner!, now: t(10 + i) }, db as never)));
  assert.equal(results.filter((r) => !r.idempotent).length, 1, "exactly one request performs the transition");
  const deadlines = new Set(results.map((r) => r.attempt.writeEndsAt.getTime()));
  assert.equal(deadlines.size, 1, "every caller sees the same single recall deadline");
  const winner = results.find((r) => !r.idempotent)!;
  assert.equal(winner.attempt.writeEndsAt.getTime() - winner.attempt.readEndsAt.getTime(), 180_000);
  // Concurrent draft save + finish on the boundary do not deadlock or extend.
  await Promise.all([
    saveRecallDraft({ attemptId: attempt.id, userId: learner!, recallText: "draft", now: t(30) }, db as never),
    finishReadingEarly({ attemptId: attempt.id, userId: learner!, now: t(30) }, db as never),
  ]);
  // A finish arriving together with/after the natural write deadline is safe.
  const late = new Date(winner.attempt.writeEndsAt.getTime() + 1000);
  const [a, b] = await Promise.allSettled([
    finishReadingEarly({ attemptId: attempt.id, userId: learner!, now: late }, db as never),
    submitAttempt({ attemptId: attempt.id, userId: learner!, recallText: undefined, now: late }, db as never),
  ]);
  assert.ok(b.status === "fulfilled" && b.value.attempt.status === "timed_out");
  assert.ok(a.status === "fulfilled" ? a.value.attempt.status === "timed_out" : isCode("retention_expired")(a.reason));
  const rows = await db.execute(sql`select count(*)::int as n from retention_attempts where user_id = ${learner!}`);
  assert.equal((rows.rows[0] as { n: number }).n, 1, "no duplicate attempt was created");
  await db.delete(users).where(inArray(users.id, [learner!, other!]));
});

test("N08 on real PostgreSQL: SQL executes, users are isolated, unfinished work excluded, no join multiplication", { skip: !enabled && "set QA2_DATABASE_TESTS=1" }, async () => {
  guard();
  const [owner, me, them] = await fixtureUsers(3);
  const marker = `n08${randomUUID().slice(0, 8)}`;
  await createRetentionText({ level: "B1", bodyText: `${bodyOfWords(RETENTION_LEVEL_CONFIG.B1.targetWords)} ${marker}`, scoringStructure: simpleStructure(marker), actorUserId: owner! }, db as never);
  const now = new Date();
  const ago = (s: number) => new Date(now.getTime() - s * 1000);
  // Finished attempt for me; an unfinished one for them.
  const mine = await startOrResumeAttempt({ userId: me!, level: "B1", now: ago(3600) }, db as never);
  await submitAttempt({ attemptId: mine.attempt.id, userId: me!, recallText: "The company was founded in 1998.", now: ago(3600 - 150) }, db as never);
  await startOrResumeAttempt({ userId: them!, level: "B1", now: ago(30) }, db as never);
  const evaluation = (userId: string, sourceType: string, band: number) => ({
    userId, evaluationType: (sourceType === "speaking_attempt" ? "speaking" : "writing") as never, sourceType, sourceId: randomUUID(),
    providerId: "qa", providerDisplayName: "QA", providerType: "internal" as const, providerVersion: "1", promptVersion: "1", rubricVersion: "1",
    checkedByName: "QA", overallEstimate: band,
  });
  await db.insert(evaluations).values([evaluation(me!, "writing_submission", 6), evaluation(me!, "writing_submission", 7), evaluation(me!, "speaking_attempt", 5.5), evaluation(them!, "writing_submission", 9)] as never);

  const t = await getProgressTrends(me!, now);
  assert.ok(t.reading && t.listening && t.writing && t.speaking && t.heatmap && t.retention, "every source query succeeded");
  assert.equal(t.writing!.at(-1)!.value, 6.5, "other user's 9.0 is not mixed in");
  assert.equal(t.writing!.at(-1)!.count, 2, "no duplicated rows");
  assert.equal(t.speaking!.at(-1)!.value, 5.5);
  const b1 = t.retention!.find((r) => r.level === "B1")!;
  assert.equal(b1.attempts, 1);
  assert.equal(b1.textsCompleted, 1);
  const theirs = await getProgressTrends(them!, now);
  assert.equal(theirs.retention!.find((r) => r.level === "B1")!.attempts, 0, "unfinished attempt is not a trend point");
  assert.equal(theirs.heatmap!.flat().reduce((n, d) => n + d.count, 0), 0);
  await db.delete(users).where(inArray(users.id, [me!, them!]));
});
