import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../src/db/client";
import { lexemes, users, userVocabulary, vocabPointEvents } from "../src/db/schema";
import {
  addVocabularyBatch,
  applyScheduledReview,
  confirmSentenceUse,
  getStanding,
  recordGameAnswer,
  recordSentenceUse,
  recentAwards,
} from "../src/lib/services/vocabulary/engine";

const enabled = process.env.QA2_DATABASE_TESTS === "1";
function isolated() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2", "QA2 DB tests must use isolated localhost/learners_qa2 only");
}

const root = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("new saves earn zero; verified game answers award once; wrong/self/forged modes earn zero; leaderboard sums ledger", { skip: !enabled }, async () => {
  isolated();
  const userId = randomUUID();
  const terms = [`qa2-${randomUUID()}`, `qa2-${randomUUID()}`];
  await db.insert(users).values({ id: userId, name: "QA2 point contract", role: "student", accountStatus: "active" });
  try {
    const saved = await addVocabularyBatch({ userId, items: [
      { term: terms[0]!, definitionEn: "An isolated meaning", exampleSentence: "A sample sentence uses the word." },
      { term: terms[1]!, definitionEn: "A second isolated meaning" },
    ] });
    assert.ok(saved.ok);
    assert.equal(saved.added, 2);
    assert.equal(saved.points, 0);
    assert.equal((await db.select().from(vocabPointEvents).where(eq(vocabPointEvents.userId, userId))).length, 0, "a save creates no misleading zero/new-word event");

    const [first, second] = saved.ids;
    assert.ok(first && second);
    const competingGames = await Promise.all(Array.from({ length: 8 }, () => recordGameAnswer({ userId, entryId: first, setKey: "all", gameId: "race", submission: { kind: "spelling", text: terms[0]! } })));
    assert.ok(competingGames.every(result => result.ok && result.correct && result.verified));
    assert.equal(competingGames.reduce((sum, result) => sum + (result.ok ? result.awarded : 0), 0), 1, "independent pool connections commit exactly one word-day award");
    const correct = competingGames.find(result => result.ok && result.awarded === 1)!;
    assert.ok(correct.ok);
    assert.equal(correct.correct, true);
    assert.equal(correct.verified, true);
    assert.equal(correct.awarded, 1);
    const replay = await recordGameAnswer({ userId, entryId: first, setKey: "all", gameId: "race", submission: { kind: "spelling", text: terms[0]! } });
    assert.ok(replay.ok);
    assert.equal(replay.awarded, 0, "same word/game/set/day request replay is idempotent");

    const matchedPair = await recordGameAnswer({ userId, entryId: first, setKey: "all", gameId: "match", submission: { kind: "pair", pairEntryId: first } });
    assert.ok(matchedPair.ok);
    assert.equal(matchedPair.correct, true);
    assert.equal(matchedPair.verified, true);
    assert.equal(matchedPair.awarded, 0, "a second game mode cannot award the same saved word twice that day");
    const matchedOtherWord = await recordGameAnswer({ userId, entryId: second, setKey: "all", gameId: "match", submission: { kind: "pair", pairEntryId: second } });
    assert.ok(matchedOtherWord.ok);
    assert.equal(matchedOtherWord.correct, true);
    assert.equal(matchedOtherWord.awarded, 1);
    const mismatchedPair = await recordGameAnswer({ userId, entryId: first, setKey: "all", gameId: "match", submission: { kind: "pair", pairEntryId: second } });
    assert.ok(mismatchedPair.ok);
    assert.equal(mismatchedPair.correct, false);
    assert.equal(mismatchedPair.awarded, 0);

    const wrong = await recordGameAnswer({ userId, entryId: second, setKey: "all", gameId: "race", submission: { kind: "spelling", text: "not the answer" } });
    assert.ok(wrong.ok);
    assert.equal(wrong.correct, false);
    assert.equal(wrong.awarded, 0);

    const self = await recordGameAnswer({ userId, entryId: first, setKey: "all", gameId: "cards", submission: { kind: "self", known: true } });
    assert.ok(self.ok);
    assert.equal(self.verified, false);
    assert.equal(self.awarded, 0);
    const forgedTypedAnswer = await recordGameAnswer({ userId, entryId: first, setKey: "all", gameId: "cards", submission: { kind: "spelling", text: terms[0]! } });
    assert.ok(forgedTypedAnswer.ok);
    assert.equal(forgedTypedAnswer.verified, false, "a flashcard cannot be relabelled as a point-bearing typing game");
    assert.equal(forgedTypedAnswer.awarded, 0);

    const outsideSet = await recordGameAnswer({ userId, entryId: first, setKey: "reading", gameId: "race", submission: { kind: "spelling", text: terms[0]! } });
    assert.deepEqual(outsideSet, { ok: false, error: "not_in_set" });

    const standings = await getStanding(userId);
    assert.equal(standings.points, 2, "leaderboard has one race point for the first word and one verified pair point for the second word");
    const events = await db.select().from(vocabPointEvents).where(and(eq(vocabPointEvents.userId, userId), eq(vocabPointEvents.kind, "game_answer")));
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((row) => row.points), [1, 1]);
  } finally {
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(lexemes).where(inArray(lexemes.term, terms));
  }
});

test("effective leaderboard remaps legacy values and collapses historical game modes per word/day", { skip: !enabled }, async () => {
  isolated();
  const userId = randomUUID();
  const zeroPointUserId = randomUUID();
  const entryId = randomUUID();
  const firstAt = new Date("2026-03-10T20:00:00.000Z");
  await db.insert(users).values([
    { id: userId, name: "QA2 effective legacy ledger", role: "student", accountStatus: "active" },
    { id: zeroPointUserId, name: "QA2 zero-point legacy ledger", role: "student", accountStatus: "active" },
  ]);
  try {
    await db.insert(vocabPointEvents).values([
      { userId: zeroPointUserId, kind: "new_word", points: 99, dedupeKey: `legacy-zero-${randomUUID()}`, createdAt: firstAt },
      { userId, kind: "new_word", points: 2, dedupeKey: `legacy-new-${randomUUID()}`, createdAt: firstAt },
      { userId, kind: "revision", points: 99, dedupeKey: `legacy-revision-${randomUUID()}`, createdAt: firstAt },
      { userId, kind: "game_answer", points: 70, dedupeKey: `legacy-game-race-${randomUUID()}`, refType: "user_vocabulary", refId: entryId, createdAt: firstAt },
      { userId, kind: "game_answer", points: 80, dedupeKey: `legacy-game-choice-${randomUUID()}`, refType: "user_vocabulary", refId: entryId, createdAt: new Date(firstAt.getTime() + 60_000) },
      { userId, kind: "sentence", points: 5, dedupeKey: `legacy-sentence-${randomUUID()}`, createdAt: firstAt },
    ]);

    const standing = await getStanding(userId);
    assert.equal(standing.points, 4, "new_word=0, revision=1, game_answer=1 across old modes, sentence=2");
    const awards = await recentAwards(userId);
    const byKind = new Map(awards.map((award) => [award.kind, award.points]));
    assert.equal(awards.length, 3, "zero-value saves and duplicate same-day game provenance do not appear as current awards");
    assert.equal(byKind.get("revision"), 1);
    assert.equal(byKind.get("game_answer"), 1);
    assert.equal(byKind.get("sentence"), 2);
    assert.equal(byKind.has("new_word"), false);
    const zeroPointStanding = await getStanding(zeroPointUserId);
    assert.equal(zeroPointStanding.points, 0);
    assert.equal(zeroPointStanding.rank, 0, "legacy word-save-only users must not appear in the ranked nonzero leaderboard");
  } finally {
    await db.delete(users).where(inArray(users.id, [userId, zeroPointUserId]));
  }
});

test("each genuinely scheduled revision earns one point, and the same due occurrence cannot replay", { skip: !enabled }, async () => {
  isolated();
  const userId = randomUUID();
  const term = `qa2-${randomUUID()}`;
  await db.insert(users).values({ id: userId, name: "QA2 revision idempotency", role: "student", accountStatus: "active" });
  try {
    const saved = await addVocabularyBatch({ userId, items: [{ term, definitionEn: "A scheduled revision test" }] });
    assert.ok(saved.ok);
    const entryId = saved.ids[0]!;
    const now = new Date(Date.now() + 1_000);
    const first = await applyScheduledReview({ userId, entryId, outcome: "incorrect", now });
    assert.ok(first.ok);
    assert.equal(first.points, 1);
    const replay = await applyScheduledReview({ userId, entryId, outcome: "incorrect", now });
    assert.ok(!replay.ok);
    assert.equal(replay.error, "not_due");
    const nextDueAt = first.nextReviewAt;
    const second = await applyScheduledReview({ userId, entryId, outcome: "incorrect", now: new Date(nextDueAt.getTime() + 1) });
    assert.ok(second.ok);
    assert.equal(second.points, 1, "the next due occurrence has a distinct ledger key even when the resulting SRS stage repeats");
    const awards = await db.select().from(vocabPointEvents).where(and(eq(vocabPointEvents.userId, userId), eq(vocabPointEvents.kind, "revision")));
    assert.equal(awards.length, 2);
    assert.deepEqual(awards.map((row) => row.points), [1, 1]);
  } finally {
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(lexemes).where(eq(lexemes.term, term));
  }
});

test("RIWI acceptance is authoritative and a repeated accepted sentence under a new usage id pays once", { skip: !enabled }, async () => {
  isolated();
  const userId = randomUUID();
  const term = `qa2-${randomUUID()}`;
  const sentence = "A unique student sentence about the saved term.";
  await db.insert(users).values({ id: userId, name: "QA2 sentence replay", role: "student", accountStatus: "active" });
  try {
    const saved = await addVocabularyBatch({ userId, items: [{ term, definitionEn: "A sentence replay test" }] });
    assert.ok(saved.ok);
    const entryId = saved.ids[0]!;
    const firstUsage = await recordSentenceUse({ userId, entryId, sentence });
    assert.ok(firstUsage.ok);
    assert.equal(firstUsage.points, 0);
    const accepted = await confirmSentenceUse({ userId, usageId: firstUsage.usageId, accepted: true, evaluationId: randomUUID() });
    assert.ok(accepted.ok);
    assert.equal(accepted.points, 2);

    const replayUsage = await recordSentenceUse({ userId, entryId, sentence: "  A UNIQUE student sentence about the saved term! " });
    assert.ok(replayUsage.ok);
    const replay = await confirmSentenceUse({ userId, usageId: replayUsage.usageId, accepted: true, evaluationId: randomUUID() });
    assert.ok(replay.ok);
    assert.equal(replay.points, 0, "same normalized sentence replay does not pay under a newly created usage id");
    const sentenceEvents = await db.select().from(vocabPointEvents).where(and(eq(vocabPointEvents.userId, userId), eq(vocabPointEvents.kind, "sentence")));
    assert.equal(sentenceEvents.length, 1);
    assert.equal(sentenceEvents[0]?.points, 2);
    assert.equal((await getStanding(userId)).points, 2);
  } finally {
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(lexemes).where(eq(lexemes.term, term));
  }
});

test("HTTP contracts reject client score/correctness claims and award only the evaluator verdict", () => {
  const gameRoute = read("src/app/api/vocabulary/games/route.ts");
  const gameSchema = read("src/lib/services/vocabulary/game-input.ts");
  const sentenceRoute = read("src/app/api/vocabulary/[id]/use/route.ts");
  assert.match(gameRoute, /const answerSchema = vocabularyGameAnswerHttpSchema/);
  assert.match(gameSchema, /\.object\([\s\S]*?\)\s*\.strict\(\)/);
  assert.match(gameSchema, /gameId: z\.enum/);
  assert.match(gameSchema, /kind: z\.literal\("pair"\), pairEntryId: z\.string\(\)\.uuid\(\)/);
  assert.doesNotMatch(gameSchema, /correct:|points:/, "shared game schema has no client verdict or point fields");
  assert.doesNotMatch(gameRoute.slice(gameRoute.indexOf("const answerSchema"), gameRoute.indexOf("export async function POST")), /correct:|points:/, "game schema has no client verdict or point fields");
  assert.match(sentenceRoute, /const accepted = outcome\.evaluation\.verdict === "correct"/);
  assert.doesNotMatch(sentenceRoute.slice(sentenceRoute.indexOf("const schema"), sentenceRoute.indexOf("export async function POST")), /accepted|points|evaluationId/);
});

test("native PostgreSQL serializes competing vocabulary confirmations and independent accepted answers", { skip: !enabled }, async () => {
  isolated();
  const userId = randomUUID();
  const term = `qa2-atomic-${randomUUID()}`;
  await db.insert(users).values({ id: userId, name: "QA2 active-use concurrency", role: "student", accountStatus: "active" });
  try {
    const saved = await addVocabularyBatch({ userId, items: [{ term, definitionEn: "Native concurrency fixture" }] });
    assert.ok(saved.ok);
    const entryId = saved.ids[0]!;
    const first = await recordSentenceUse({ userId, entryId, sentence: "A resilient team can recover quickly." });
    assert.ok(first.ok);
    const competing = await Promise.all(Array.from({ length: 8 }, (_, index) => confirmSentenceUse({
      userId, usageId: first.usageId, accepted: index % 2 === 0, evaluationId: randomUUID(),
    })));
    assert.equal(competing.filter(result => result.ok).length, 1, "one committed verdict per usage across pool connections");
    const usages = [];
    for (const sentence of ["People learn from difficult experiences.", "Our team returned after a long break."]) {
      const stored = await recordSentenceUse({ userId, entryId, sentence });
      assert.ok(stored.ok);
      usages.push(stored.usageId);
    }
    const results = await Promise.all(usages.map(usageId => confirmSentenceUse({ userId, usageId, accepted: true, evaluationId: randomUUID() })));
    assert.ok(results.every(result => result.ok));
    const [entry] = await db.select().from(userVocabulary).where(eq(userVocabulary.id, entryId));
    const ledger = await db.select().from(vocabPointEvents).where(and(eq(vocabPointEvents.userId, userId), eq(vocabPointEvents.kind, "sentence")));
    assert.equal(entry!.activeUseCount, ledger.length, "entry counters retain both independently awarded answers");
    assert.ok(entry!.activeUseCount >= 2);
    const { activityEvents } = await import("../src/db/schema");
    const activity = await db.select().from(activityEvents).where(and(eq(activityEvents.userId, userId), eq(activityEvents.type, "VOCABULARY_USED")));
    assert.equal(activity.length, 3, "one activity event per committed usage, including a rejected winner");

    const now = new Date();
    await db.update(userVocabulary).set({ srsStage: 3, correctCount: 4, incorrectCount: 0,
      intervalDays: 16, nextReviewAt: now, mastery: "active" }).where(eq(userVocabulary.id, entryId));
    const finalUsage = await recordSentenceUse({ userId, entryId, sentence: "A resilient learner develops through scheduled practice." });
    assert.ok(finalUsage.ok);
    const [reviews, confirmation] = await Promise.all([
      Promise.all(Array.from({ length: 8 }, () => applyScheduledReview({ userId, entryId, outcome: "correct", now }))),
      confirmSentenceUse({ userId, usageId: finalUsage.usageId, accepted: true, evaluationId: randomUUID() }),
    ]);
    assert.equal(reviews.filter(result => result.ok).length, 1, "only one pool connection consumes the due slot");
    assert.equal(reviews.filter(result => !result.ok && result.error === "not_due").length, 7);
    assert.ok(confirmation.ok);
    const [finalEntry] = await db.select().from(userVocabulary).where(eq(userVocabulary.id, entryId));
    assert.equal(finalEntry!.srsStage, 4);
    assert.equal(finalEntry!.correctCount, 5);
    assert.equal(finalEntry!.activeUseCount, entry!.activeUseCount + 1);
    assert.equal(finalEntry!.mastery, "mastered", "recall and production evidence both survive either connection order");
    const revisionEvents = await db.select().from(activityEvents).where(and(eq(activityEvents.userId, userId), eq(activityEvents.type, "VOCAB_REVIEWED")));
    const revisionPoints = await db.select().from(vocabPointEvents).where(and(eq(vocabPointEvents.userId, userId), eq(vocabPointEvents.kind, "revision")));
    assert.equal(revisionEvents.length, 1);
    assert.equal(revisionPoints.length, 1);
    assert.equal(revisionPoints[0]!.points, 1);
  } finally {
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(lexemes).where(eq(lexemes.term, term));
  }
});
