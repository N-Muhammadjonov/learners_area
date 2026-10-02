import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { lexemes, lexicalOccurrences, lexicalUnitPronunciations, userVocabulary, userVocabularyContexts, users, vocabularyUsages } from "../src/db/schema";
import { lexicalDetailFor, resolveOccurrence, type VocabularySourceSnapshot } from "../src/lib/services/lexical/context";
import { ingestListeningOccurrences } from "../src/lib/services/lexical/listening-occurrences";
import { addVocabularyBatch, applyScheduledReview, listVocabularyContexts, recordGameAnswer, recordSentenceUse } from "../src/lib/services/vocabulary/engine";

/**
 * Vocabulary architecture on REAL PostgreSQL (isolated local QA2 only):
 * the application's own connection pool, row locks and the 0029 unique indexes.
 *   QA2_DATABASE_TESTS=1 DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 …
 * Skipped (and reported as skipped, not passed) without that database.
 */
const enabled = process.env.QA2_DATABASE_TESTS === "1";
function isolated() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2");
}
type Vocab = Parameters<typeof ingestListeningOccurrences>[2]["vocabulary"][number];
const vocab = (word: string, pos: string, def: string, ex: string): Vocab => ({ word, pos, def, ex, uz: "", also: [], quiz: [] as unknown as Vocab["quiz"] });

async function learner(role: "student" | "admin" = "student") {
  const id = randomUUID();
  await db.insert(users).values({ id, name: `QA2 vocab ${role}`, role, accountStatus: "active" });
  return { id, role } as const;
}

/** A live Reading passage whose "bank" occurrences carry two different senses. */
async function readingFixture(userId: string) {
  const tag = randomUUID().slice(0, 8);
  const body = "The bank lends money to firms. Ducks sleep on the bank of the river.";
  const [passage] = await db.execute<{ id: string }>(sql`insert into reading_passages (title, body_text) values (${`QA2 reading ${tag}`}, ${body}) returning id`).then((r) => r.rows);
  const [attempt] = await db.execute<{ id: string }>(sql`insert into reading_attempts (user_id, passage_id) values (${userId}, ${passage!.id}) returning id`).then((r) => r.rows);
  const [money] = await db.insert(lexemes).values({ term: "bank", partOfSpeech: "noun", definitionEn: `A financial institution ${tag}`, senseKey: `qa2-money-${tag}`, provenance: "authored", verificationStatus: "verified" }).returning();
  const [river] = await db.insert(lexemes).values({ term: "bank", partOfSpeech: "noun", definitionEn: `Land beside a river ${tag}`, senseKey: `qa2-river-${tag}`, provenance: "authored", verificationStatus: "verified" }).returning();
  const at = (word: string, from = 0) => body.indexOf(word, from);
  const [moneyOcc] = await db.insert(lexicalOccurrences).values({ lexemeId: money!.id, passageId: passage!.id, surfaceForm: "bank", startChar: at("bank"), endChar: at("bank") + 4, sentenceText: "The bank lends money to firms.", occurrenceType: "vocabulary", isTargetVocabulary: true }).returning();
  const second = at("bank", at("bank") + 1);
  const [riverOcc] = await db.insert(lexicalOccurrences).values({ lexemeId: river!.id, passageId: passage!.id, surfaceForm: "bank", startChar: second, endChar: second + 4, sentenceText: "Ducks sleep on the bank of the river.", occurrenceType: "vocabulary", isTargetVocabulary: true }).returning();
  return { passageId: passage!.id, attemptId: attempt!.id, money: money!, river: river!, moneyOcc: moneyOcc!, riverOcc: riverOcc! };
}

/** A live Listening test with a package; authored vocabulary ingested exactly as the import route does. */
async function listeningFixture(authorId: string, transcript: string, vocabulary: Vocab[], section = 2) {
  const tag = randomUUID().slice(0, 8);
  const [testRow] = await db.execute<{ id: string }>(sql`insert into listening_tests (created_by_user_id, title, audio_type, audio_url) values (${authorId}, ${`QA2 listening ${tag}`}, 'audio', '/api/resources/qa2') returning id`).then((r) => r.rows);
  const payload = { testId: `qa2-${tag}`, sections: [{ number: section, title: "QA2", transcript }], vocabulary, questions: [] };
  await db.execute(sql`insert into listening_packages (test_id, source_id, payload, audio_object_key, source_hash) values (${testRow!.id}, ${`qa2-${tag}`}, ${JSON.stringify(payload)}::jsonb, 'qa2-audio', ${"0".repeat(64)})`);
  const lexical = await db.transaction((tx) => ingestListeningOccurrences(tx, testRow!.id, payload as never));
  const occurrences = await db.select().from(lexicalOccurrences).where(eq(lexicalOccurrences.listeningTestId, testRow!.id)).orderBy(lexicalOccurrences.startChar);
  return { testId: testRow!.id, occurrences, lexical };
}

async function save(user: { id: string; role: "student" | "admin" }, sourceType: "reading" | "listening", sourceId: string, occurrenceId: string) {
  const resolved = await resolveOccurrence(user, sourceType, sourceId, occurrenceId);
  assert.ok(resolved && resolved.status === "resolved", "fixture occurrence must resolve");
  return addVocabularyBatch({ userId: user.id, sourceType, sourceId, items: [{ ...resolved.lexeme, canonicalLexemeId: resolved.lexeme.id, sourceSnapshot: resolved.snapshot as VocabularySourceSnapshot }] });
}

test("1 Reading click: each occurrence resolves to ITS sense, server-validated, with a revisit snapshot", { skip: !enabled }, async () => {
  isolated();
  const user = await learner();
  const r = await readingFixture(user.id);
  const money = await resolveOccurrence(user, "reading", r.attemptId, r.moneyOcc.id);
  const river = await resolveOccurrence(user, "reading", r.attemptId, r.riverOcc.id);
  assert.equal(money?.status === "resolved" && money.lexeme.id, r.money.id);
  assert.equal(river?.status === "resolved" && river.lexeme.id, r.river.id);
  assert.equal(money?.snapshot.attemptId, r.attemptId);
  const stranger = await learner();
  const foreign = await resolveOccurrence(stranger, "reading", r.attemptId, r.moneyOcc.id);
  assert.equal(foreign?.snapshot.attemptId ?? null, null, "another learner's attempt id is never adopted as theirs");
});

test("2/3 Listening click: authored place resolves; the same spelling in another sense is UNRESOLVED (no meaning)", { skip: !enabled }, async () => {
  isolated();
  const author = await learner("admin");
  const student = await learner();
  const text = "I opened an account at the bank. They sat on the river bank.";
  const l = await listeningFixture(author.id, text, [vocab("bank", "n", `An institution that keeps money ${randomUUID()}`, "I opened an account at the bank.")]);
  assert.equal(l.occurrences.length, 2);
  const money = await resolveOccurrence(student, "listening", l.testId, l.occurrences[0]!.id);
  const trap = await resolveOccurrence(student, "listening", l.testId, l.occurrences[1]!.id);
  assert.equal(money?.status, "resolved");
  assert.equal(money?.snapshot.sectionNumber, 2);
  assert.equal(money?.snapshot.sourceType, "listening");
  assert.equal(trap?.status, "unresolved");
  assert.equal(trap?.lexeme, null, "the financial sense is never shown for the river bank");
  assert.equal(trap?.snapshot.sentenceText, "They sat on the river bank.");
  // A forged pairing (occurrence of another test) is refused.
  const other = await listeningFixture(author.id, "Nothing here.", [vocab("here", "adv", "In this place", "Nothing here.")]);
  assert.equal(await resolveOccurrence(student, "listening", other.testId, l.occurrences[0]!.id), null);
});

test("2b a draft Listening test is not resolvable by a student; staff may", { skip: !enabled }, async () => {
  isolated();
  const author = await learner("admin");
  const student = await learner();
  const l = await listeningFixture(author.id, "Costs rose sharply.", [vocab("rise", "verb", `To go up ${randomUUID()}`, "Costs rose sharply.")]);
  await db.execute(sql`update listening_tests set publication_state = 'draft' where id = ${l.testId}`);
  assert.equal(await resolveOccurrence(student, "listening", l.testId, l.occurrences[0]!.id), null);
  assert.equal((await resolveOccurrence(author, "listening", l.testId, l.occurrences[0]!.id))?.status, "resolved");
});

test("10/11 same sense from Reading and Listening → ONE item with TWO contexts; replays add nothing; SRS untouched", { skip: !enabled }, async () => {
  isolated();
  const author = await learner("admin");
  const user = await learner();
  const r = await readingFixture(user.id);
  // The Listening package authors the SAME sense text → same sense_key → same canonical sense.
  const l = await listeningFixture(author.id, "Firms borrow from a bank.", [vocab("bank", "noun", r.money.definitionEn, "Firms borrow from a bank.")]);
  assert.equal(l.occurrences[0]!.lexemeId, r.money.id, "Listening reuses the existing canonical sense");
  const first = await save(user, "reading", r.attemptId, r.moneyOcc.id);
  assert.ok(first.ok && first.added === 1);
  const [before] = await db.select().from(userVocabulary).where(eq(userVocabulary.id, first.ids[0]!));
  const second = await save(user, "listening", l.testId, l.occurrences[0]!.id);
  assert.ok(second.ok && second.added === 0);
  assert.equal(second.ids[0], first.ids[0]);
  const replay = await save(user, "listening", l.testId, l.occurrences[0]!.id);
  assert.ok(replay.ok && replay.added === 0);
  const contexts = await listVocabularyContexts(user.id, first.ids[0]!);
  assert.equal(contexts?.contexts.length, 2);
  assert.deepEqual(contexts!.contexts.map((c) => c.sourceType).sort(), ["listening", "reading"]);
  assert.equal(contexts!.seenCount, 2, "a replay of the same place is not a new sighting");
  const [after] = await db.select().from(userVocabulary).where(eq(userVocabulary.id, first.ids[0]!));
  assert.deepEqual([after!.srsStage, after!.nextReviewAt.getTime(), after!.mastery], [before!.srsStage, before!.nextReviewAt.getTime(), before!.mastery]);
  // 15/16 revisit
  const reading = contexts!.contexts.find((c) => c.sourceType === "reading")!;
  const listening = contexts!.contexts.find((c) => c.sourceType === "listening")!;
  assert.equal(reading.revisitHref, `/reading/attempts/${r.attemptId}`);
  assert.equal(listening.revisitHref, `/listening/tests/${l.testId}/study?section=2`);
  assert.equal(listening.startMs, null, "no timing exists for this transcript, none is shown");
});

test("12 two senses of one spelling are two separate items for one learner", { skip: !enabled }, async () => {
  isolated();
  const user = await learner();
  const r = await readingFixture(user.id);
  const a = await save(user, "reading", r.attemptId, r.moneyOcc.id);
  const b = await save(user, "reading", r.attemptId, r.riverOcc.id);
  assert.ok(a.ok && b.ok && a.added === 1 && b.added === 1);
  assert.notEqual(a.ids[0], b.ids[0]);
});

test("18 concurrent duplicate saves of one occurrence: one item, one context (real row locks)", { skip: !enabled }, async () => {
  isolated();
  const user = await learner();
  const r = await readingFixture(user.id);
  const resolved = await resolveOccurrence(user, "reading", r.attemptId, r.moneyOcc.id);
  assert.ok(resolved?.status === "resolved");
  const item = { ...resolved.lexeme, canonicalLexemeId: resolved.lexeme.id, sourceSnapshot: resolved.snapshot as VocabularySourceSnapshot };
  let pending: Promise<Awaited<ReturnType<typeof addVocabularyBatch>>[]> | undefined;
  await db.transaction(async (lock) => {
    const owner = await lock.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    await lock.select().from(users).where(eq(users.id, user.id)).for("update");
    pending = Promise.all(Array.from({ length: 3 }, () => addVocabularyBatch({ userId: user.id, sourceType: "reading", sourceId: r.attemptId, items: [item] })));
    let count = 0;
    for (let tries = 0; tries < 200 && count < 3; tries++) {
      count = (await db.execute<{ count: number }>(sql`with recursive blocked(pid) as (
        select pid from pg_stat_activity where ${owner.rows[0]!.pid} = any(pg_blocking_pids(pid))
        union
        select a.pid from pg_stat_activity a join blocked b on b.pid = any(pg_blocking_pids(a.pid))
      ) select count(*)::int as count from blocked`)).rows[0]?.count ?? 0;
      if (count < 3) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(count, 3, "all three saves overlap at a real database lock (pool-sized, as in vocabulary-integrity-db)");
  });
  const results = await pending!;
  assert.equal(results.reduce((n, res) => n + (res.ok ? res.added : 0), 0), 1);
  const items = await db.select().from(userVocabulary).where(eq(userVocabulary.userId, user.id));
  assert.equal(items.length, 1);
  assert.equal((await db.select().from(userVocabularyContexts).where(eq(userVocabularyContexts.userVocabularyId, items[0]!.id))).length, 1);
  assert.equal(items[0]!.seenCount, 1);
  // The database itself refuses a second (user, sense) row, whatever the code path.
  await assert.rejects(db.insert(userVocabulary).values({ userId: user.id, lexemeId: r.money.id, senseKey: "dup", nextReviewAt: new Date() }),
    (error: { cause?: { code?: string; constraint?: string } }) => error.cause?.code === "23505" && error.cause.constraint === "user_vocabulary_user_sense_idx");
});

test("19/20 multi-user isolation: separate items, contexts and SRS per learner", { skip: !enabled }, async () => {
  isolated();
  const a = await learner();
  const b = await learner();
  const r = await readingFixture(a.id);
  const ra = await save(a, "reading", r.attemptId, r.moneyOcc.id);
  const rb = await save(b, "reading", r.passageId, r.moneyOcc.id);
  assert.ok(ra.ok && rb.ok);
  assert.notEqual(ra.ids[0], rb.ids[0]);
  assert.equal(await listVocabularyContexts(b.id, ra.ids[0]!), null, "B cannot read A's contexts");
  const bCtx = await listVocabularyContexts(b.id, rb.ids[0]!);
  assert.equal(bCtx?.contexts[0]?.revisitHref, null, "B met it via the live passage, not via A's attempt");
  await db.update(userVocabulary).set({ nextReviewAt: new Date(Date.now() - 1000) }).where(eq(userVocabulary.id, ra.ids[0]!));
  const reviewed = await applyScheduledReview({ userId: a.id, entryId: ra.ids[0]!, outcome: "correct" });
  assert.ok(reviewed.ok);
  const [aRow] = await db.select().from(userVocabulary).where(eq(userVocabulary.id, ra.ids[0]!));
  const [bRow] = await db.select().from(userVocabulary).where(eq(userVocabulary.id, rb.ids[0]!));
  assert.ok(aRow!.srsStage > bRow!.srsStage, "A's review moved only A's schedule");
  assert.equal((await applyScheduledReview({ userId: b.id, entryId: ra.ids[0]!, outcome: "correct" })).ok, false, "B cannot review A's item");
});

test("21 games do not move SRS; 22 RIWI V1 sentence use is tied to the exact saved sense", { skip: !enabled }, async () => {
  isolated();
  const user = await learner();
  const r = await readingFixture(user.id);
  const saved = await save(user, "reading", r.attemptId, r.riverOcc.id);
  assert.ok(saved.ok);
  const entryId = saved.ids[0]!;
  const [before] = await db.select().from(userVocabulary).where(eq(userVocabulary.id, entryId));
  const game = await recordGameAnswer({ userId: user.id, entryId, setKey: "all", gameId: "race", submission: { kind: "spelling", text: "bank" } });
  assert.ok(game.ok && game.srsUntouched);
  const [after] = await db.select().from(userVocabulary).where(eq(userVocabulary.id, entryId));
  assert.deepEqual([after!.srsStage, after!.nextReviewAt.getTime()], [before!.srsStage, before!.nextReviewAt.getTime()]);
  const use = await recordSentenceUse({ userId: user.id, entryId, sentence: "We had a picnic on the bank of the river." });
  assert.ok(use.ok);
  const [usage] = await db.select().from(vocabularyUsages).where(eq(vocabularyUsages.userVocabularyId, entryId));
  const [item] = await db.select().from(userVocabulary).where(and(eq(userVocabulary.id, usage!.userVocabularyId), eq(userVocabulary.userId, user.id)));
  assert.equal(item!.lexemeId, r.river.id, "the sentence is evidence for the river sense, not the financial one");
});

test("14 an unresolved Listening occurrence cannot be saved under a sense; 24 missing pronunciation stays null", { skip: !enabled }, async () => {
  isolated();
  const author = await learner("admin");
  const student = await learner();
  const l = await listeningFixture(author.id, "I opened an account at the bank. They sat on the river bank.", [vocab("bank", "n", `An institution that keeps money ${randomUUID()}`, "I opened an account at the bank.")]);
  const trap = await resolveOccurrence(student, "listening", l.testId, l.occurrences[1]!.id);
  assert.equal(trap?.status, "unresolved");
  assert.equal(trap?.lexeme, null, "there is no sense object a route could save");
  // Units are global: a fresh word guarantees no earlier run stored a pronunciation.
  const word = Array.from({ length: 9 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");
  const fresh = await listeningFixture(author.id, `The ${word} glowed.`, [vocab(word, "n", "A QA2 test object", `The ${word} glowed.`)]);
  const resolved = await resolveOccurrence(student, "listening", fresh.testId, fresh.occurrences[0]!.id);
  assert.ok(resolved?.status === "resolved");
  const detail = await lexicalDetailFor(resolved.lexeme);
  assert.equal(detail?.ipa, null, "no stored pronunciation -> null, never generated");
  assert.equal(detail?.lexicalType, "word");
  await db.insert(lexicalUnitPronunciations).values({ lexicalUnitId: resolved.lexeme.lexicalUnitId!, ipa: "b\u00e6\u014bk", provenance: "qa2_fixture" });
  assert.equal((await lexicalDetailFor(resolved.lexeme))?.ipa, "b\u00e6\u014bk");
});
