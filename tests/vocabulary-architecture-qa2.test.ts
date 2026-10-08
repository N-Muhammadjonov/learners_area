import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { lexemes, lexicalOccurrences, listeningAttempts, listeningPackages, listeningTests, lexicalUnitPronunciations, userVocabulary, userVocabularyContexts, users, generalReadingSets, generalReadingPassages, vocabularyUsages } from "../src/db/schema";
import { inArray } from "drizzle-orm";
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
async function studyMembership(passageId: string) {
  const [set] = await db.insert(generalReadingSets).values({title: "QA2 learning fixture"}).returning();
  await db.insert(generalReadingPassages).values({setId:set!.id, passageId, passageNo:1, readingMode:"general_practice"});
  return set!.id;
}

type Vocab = Parameters<typeof ingestListeningOccurrences>[2]["vocabulary"][number];
const vocab = (word: string, pos: string, def: string, ex: string): Vocab => ({ word, pos, def, ex, uz: "", also: [], quiz: [] as unknown as Vocab["quiz"] });

async function learner(role: "student" | "admin" = "student") {
  const id = randomUUID();
  await db.insert(users).values({ id, name: `QA2 vocab ${role}`, role, accountStatus: "active" });
  return { id, role } as const;
}

/** A live Reading passage whose "bank" occurrences carry two different senses. */
/** General learning by default; explicit in-progress fixture remains Academic. */
async function readingFixture(userId: string, status: "completed" | "in_progress" = "completed") {
  const tag = randomUUID().slice(0, 8);
  const body = "The bank lends money to firms. Ducks sleep on the bank of the river.";
  const [passage] = await db.execute<{ id: string }>(sql`insert into reading_passages (title, body_text) values (${`QA2 reading ${tag}`}, ${body}) returning id`).then((r) => r.rows);
  const [attempt] = await db.execute<{ id: string }>(sql`insert into reading_attempts (user_id, passage_id, status, submitted_at) values (${userId}, ${passage!.id}, ${status}, ${status === "completed" ? new Date().toISOString() : null}) returning id`).then((r) => r.rows);
  const [money] = await db.insert(lexemes).values({ term: "bank", partOfSpeech: "noun", definitionEn: `A financial institution ${tag}`, senseKey: `qa2-money-${tag}`, provenance: "authored", verificationStatus: "verified" }).returning();
  const [river] = await db.insert(lexemes).values({ term: "bank", partOfSpeech: "noun", definitionEn: `Land beside a river ${tag}`, senseKey: `qa2-river-${tag}`, provenance: "authored", verificationStatus: "verified" }).returning();
  const at = (word: string, from = 0) => body.indexOf(word, from);
  const [moneyOcc] = await db.insert(lexicalOccurrences).values({ lexemeId: money!.id, passageId: passage!.id, surfaceForm: "bank", startChar: at("bank"), endChar: at("bank") + 4, sentenceText: "The bank lends money to firms.", occurrenceType: "vocabulary", isTargetVocabulary: true }).returning();
  const second = at("bank", at("bank") + 1);
  const [riverOcc] = await db.insert(lexicalOccurrences).values({ lexemeId: river!.id, passageId: passage!.id, surfaceForm: "bank", startChar: second, endChar: second + 4, sentenceText: "Ducks sleep on the bank of the river.", occurrenceType: "vocabulary", isTargetVocabulary: true }).returning();
  const setId = status === "completed" ? await studyMembership(passage!.id) : null;
  return { passageId: passage!.id, sourceId: status === "completed" ? passage!.id : attempt!.id, assessmentId: attempt!.id, setId, money: money!, river: river!, moneyOcc: moneyOcc!, riverOcc: riverOcc! };
}

/** A live Listening test with a package; authored vocabulary ingested exactly as the import route does. */
async function listeningFixture(authorId: string, transcript: string, vocabulary: Vocab[], section = 2, collection?: "general" | "academic") {
  const tag = randomUUID().slice(0, 8);
  const [testRow] = await db.execute<{ id: string }>(sql`insert into listening_tests (created_by_user_id, title, audio_type, audio_url) values (${authorId}, ${`QA2 listening ${tag}`}, 'audio', '/api/resources/qa2') returning id`).then((r) => r.rows);
  const payload = { ...(collection ? { schemaVersion: 1, collection, category: "full", provenance: "QA2 fixture", audio: { path: "audio.mp3", durationSec: 600 }, imagePath: null, keyword1: [], keyword2: [] } : {}), testId: `qa2-${tag}`, sections: [{ number: section, title: "QA2", transcript }], vocabulary, questions: [] };
  await db.execute(sql`insert into listening_packages (test_id, source_id, payload, audio_object_key, source_hash) values (${testRow!.id}, ${`qa2-${tag}`}, ${JSON.stringify(payload)}::jsonb, 'qa2-audio', ${"0".repeat(64)})`);
  const lexical = await db.transaction((tx) => ingestListeningOccurrences(tx, testRow!.id, payload as never));
  const occurrences = await db.select().from(lexicalOccurrences).where(and(eq(lexicalOccurrences.listeningTestId, testRow!.id), eq(lexicalOccurrences.segmentKey, `s${section}`))).orderBy(lexicalOccurrences.startChar);
  return { testId: testRow!.id, occurrences, lexical };
}

/** A full-exam attempt for this learner and test (status "completed" = submitted). */
async function examAttempt(userId: string, testId: string, status: "completed" | "in_progress" = "completed") {
  const [row] = await db.insert(listeningAttempts).values({ userId, testId, status, ...(status === "completed" ? { submittedAt: new Date() } : {}) }).returning();
  return row!;
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
  const money = await resolveOccurrence(user, "reading", r.sourceId, r.moneyOcc.id);
  const river = await resolveOccurrence(user, "reading", r.sourceId, r.riverOcc.id);
  assert.equal(money?.status === "resolved" && money.lexeme.id, r.money.id);
  assert.equal(river?.status === "resolved" && river.lexeme.id, r.river.id);
  assert.equal(money?.status === "resolved" && money.snapshot.attemptId, null);
  const stranger = await learner();
  const foreign = await resolveOccurrence(stranger, "reading", r.sourceId, r.moneyOcc.id);
  assert.equal(foreign?.status === "resolved" ? foreign.snapshot.attemptId : null, null, "another learner's attempt id is never adopted as theirs");
});

test("2/3 Listening click: authored place resolves; the same spelling in another sense is UNRESOLVED (no meaning)", { skip: !enabled }, async () => {
  isolated();
  const author = await learner("admin");
  const student = await learner();
  const text = "I opened an account at the bank. They sat on the river bank.";
  const l = await listeningFixture(author.id, text, [vocab("bank", "n", `An institution that keeps money ${randomUUID()}`, "I opened an account at the bank.")]);
  await examAttempt(student.id, l.testId); // Review/Control is open only after submission (lexical-policy)
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
  await examAttempt(student.id, other.testId);
  assert.equal(await resolveOccurrence(student, "listening", other.testId, l.occurrences[0]!.id), null);
});

test("2b a draft Listening test is not resolvable by a student; staff may", { skip: !enabled }, async () => {
  isolated();
  const author = await learner("admin");
  const student = await learner();
  const l = await listeningFixture(author.id, "Costs rose sharply.", [vocab("rise", "verb", `To go up ${randomUUID()}`, "Costs rose sharply.")]);
  await examAttempt(student.id, l.testId);
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
  await examAttempt(user.id, l.testId);
  assert.equal(l.occurrences[0]!.lexemeId, r.money.id, "Listening reuses the existing canonical sense");
  const first = await save(user, "reading", r.sourceId, r.moneyOcc.id);
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
  assert.equal(reading.revisitHref, `/app/reading/general/${r.setId}?passage=1`);
  assert.equal(listening.revisitHref, `/app/listening/tests/${l.testId}/study?section=2`);
  assert.equal(listening.startMs, null, "no timing exists for this transcript, none is shown");
});

test("12 two senses of one spelling are two separate items for one learner", { skip: !enabled }, async () => {
  isolated();
  const user = await learner();
  const r = await readingFixture(user.id);
  const a = await save(user, "reading", r.sourceId, r.moneyOcc.id);
  const b = await save(user, "reading", r.sourceId, r.riverOcc.id);
  assert.ok(a.ok && b.ok && a.added === 1 && b.added === 1);
  assert.notEqual(a.ids[0], b.ids[0]);
});

test("18 concurrent duplicate saves of one occurrence: one item, one context (real row locks)", { skip: !enabled }, async () => {
  isolated();
  const user = await learner();
  const r = await readingFixture(user.id);
  const resolved = await resolveOccurrence(user, "reading", r.sourceId, r.moneyOcc.id);
  assert.ok(resolved?.status === "resolved");
  const item = { ...resolved.lexeme, canonicalLexemeId: resolved.lexeme.id, sourceSnapshot: resolved.snapshot as VocabularySourceSnapshot };
  let pending: Promise<Awaited<ReturnType<typeof addVocabularyBatch>>[]> | undefined;
  await db.transaction(async (lock) => {
    const owner = await lock.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    await lock.select().from(users).where(eq(users.id, user.id)).for("update");
    pending = Promise.all(Array.from({ length: 3 }, () => addVocabularyBatch({ userId: user.id, sourceType: "reading", sourceId: r.sourceId, items: [item] })));
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
  // B submitted the same passage too (Reading review is open only after submission);
  // B still saves through the passage id, so B's context never points at A's attempt.
  await db.insert(readingAttempts).values({ userId: b.id, passageId: r.passageId, status: "completed", submittedAt: new Date() });
  const ra = await save(a, "reading", r.sourceId, r.moneyOcc.id);
  const rb = await save(b, "reading", r.passageId, r.moneyOcc.id);
  assert.ok(ra.ok && rb.ok);
  assert.notEqual(ra.ids[0], rb.ids[0]);
  assert.equal(await listVocabularyContexts(b.id, ra.ids[0]!), null, "B cannot read A's contexts");
  const bCtx = await listVocabularyContexts(b.id, rb.ids[0]!);
  assert.equal(bCtx?.contexts[0]?.revisitHref, `/app/reading/general/${r.setId}?passage=1`, "B revisits the shared General passage without A's attempt");
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
  const saved = await save(user, "reading", r.sourceId, r.riverOcc.id);
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
  await examAttempt(student.id, l.testId);
  const trap = await resolveOccurrence(student, "listening", l.testId, l.occurrences[1]!.id);
  assert.equal(trap?.status, "unresolved");
  assert.equal(trap?.lexeme, null, "there is no sense object a route could save");
  // Units are global: a fresh word guarantees no earlier run stored a pronunciation.
  const word = Array.from({ length: 9 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");
  const fresh = await listeningFixture(author.id, `The ${word} glowed.`, [vocab(word, "n", "A QA2 test object", `The ${word} glowed.`)]);
  await examAttempt(student.id, fresh.testId);
  const resolved = await resolveOccurrence(student, "listening", fresh.testId, fresh.occurrences[0]!.id);
  assert.ok(resolved?.status === "resolved");
  const detail = await lexicalDetailFor(resolved.lexeme);
  assert.equal(detail?.ipa, null, "no stored pronunciation -> null, never generated");
  assert.equal(detail?.lexicalType, "word");
  await db.insert(lexicalUnitPronunciations).values({ lexicalUnitId: resolved.lexeme.lexicalUnitId!, ipa: "b\u00e6\u014bk", provenance: "qa2_fixture" });
  assert.equal((await lexicalDetailFor(resolved.lexeme))?.ipa, "b\u00e6\u014bk");
});

// ---------------------------------------------------------------------------
// Listening mode separation (FULL_EXAM vs REVIEW_CONTROL vs VOCABULARY_STUDY).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { lexicalAssistanceAllowed, modeForActivity, modeForListeningProduct } from "../src/lib/listening/lexical-policy";
import { listeningExamState } from "../src/lib/data/full-listening";
import { listeningVocabularySession } from "../src/lib/services/lexical/listening-occurrences";

test("M21 Full Exam reveals nothing: exam components carry no lexical code or transcript; policy and server lock while the exam is open", { skip: !enabled }, async () => {
  for (const file of ["src/components/listening/NativeListeningExam.tsx", "src/components/listening/ListeningExam.tsx"]) {
    const source = readFileSync(file, "utf8");
    for (const banned of ["ClickableText", "WordPopover", "/api/vocabulary", "occurrence", "transcript"]) assert.equal(source.includes(banned), false, `${file} must not contain ${banned}`);
  }
  for (const state of [{ submitted: true, examInProgress: false, staff: true }, { submitted: false, examInProgress: false, staff: false }]) {
    assert.equal(lexicalAssistanceAllowed("FULL_EXAM", state), false);
    assert.equal(lexicalAssistanceAllowed("KEYWORD_PRACTICE", state), true);
  }
  assert.equal(modeForActivity(1), "FULL_EXAM");
  isolated();
  const author = await learner("admin");
  const student = await learner();
  const l = await listeningFixture(author.id, "I opened an account at the bank.", [vocab("bank", "n", `An institution that keeps money ${randomUUID()}`, "I opened an account at the bank.")]);
  assert.ok(l.occurrences.length, "occurrence data EXISTS before the exam (data availability)…");
  await examAttempt(student.id, l.testId, "in_progress");
  const during = await resolveOccurrence(student, "listening", l.testId, l.occurrences[0]!.id);
  assert.equal(during?.status, "locked", "…but revealing it is not permitted (permission)");
  assert.equal(during?.lexeme, null);
  assert.equal(during?.snapshot, null);
});

test("M21b a General section is a LEARNING activity: its own open attempt does not lock its vocabulary, while the Academic full exam stays sealed", { skip: !enabled }, async () => {
  // The mode comes from what the source IS — the same product classifier the catalogues use —
  // so a section's word lookup is permitted while the learner is working in it, and an Academic
  // full test with an attempt in progress is still locked.
  assert.equal(modeForListeningProduct("general_section"), "SECTION_PRACTICE");
  assert.equal(modeForListeningProduct("academic_full_test"), "REVIEW_CONTROL");
  assert.equal(modeForListeningProduct("mcq_programme"), "REVIEW_CONTROL", "a practice package is not a section");
  assert.equal(lexicalAssistanceAllowed("SECTION_PRACTICE", { submitted: false, examInProgress: true, staff: false }), true);
  assert.equal(lexicalAssistanceAllowed("REVIEW_CONTROL", { submitted: false, examInProgress: true, staff: false }), false, "the exam seat rule is unchanged");
  assert.equal(lexicalAssistanceAllowed("FULL_EXAM", { submitted: true, examInProgress: false, staff: true }), false, "the timed exam never reveals lexical data");

  isolated();
  const author = await learner("admin");
  const student = await learner();
  const section = await listeningFixture(author.id, "The tour guide met us at the harbour.", [vocab("harbour", "n", `A place where boats moor ${randomUUID()}`, "The tour guide met us at the harbour.")], 2, "general");
  const academic = await listeningFixture(author.id, "I opened an account at the bank.", [vocab("bank", "n", `An institution that keeps money ${randomUUID()}`, "I opened an account at the bank.")], 2, "academic");
  try {
    await examAttempt(student.id, section.testId, "in_progress");
    await examAttempt(student.id, academic.testId, "in_progress");
    const inSection = await resolveOccurrence(student, "listening", section.testId, section.occurrences[0]!.id);
    assert.notEqual(inSection?.status, "locked", "a learner working in a section may look a word up");
    const inExam = await resolveOccurrence(student, "listening", academic.testId, academic.occurrences[0]!.id);
    assert.equal(inExam?.status, "locked", "…and the running full exam is still sealed");
  } finally {
    // This test's fixtures are REMOVED, and the removal itself is asserted: a section the centre
    // can still see in the General catalogue after a test run would be residue, not a fixture.
    const ids = [section.testId, academic.testId];
    await db.delete(listeningAttempts).where(inArray(listeningAttempts.testId, ids));
    await db.delete(listeningPackages).where(inArray(listeningPackages.testId, ids));
    await db.delete(lexicalOccurrences).where(inArray(lexicalOccurrences.listeningTestId, ids));
    await db.delete(listeningTests).where(inArray(listeningTests.id, ids));
    const residue = await db.execute<{ tests: number; packages: number; occurrences: number }>(sql`
      select (select count(*)::integer from listening_tests where id = ${ids[0]} or id = ${ids[1]}) as tests,
             (select count(*)::integer from listening_packages where test_id = ${ids[0]} or test_id = ${ids[1]}) as packages,
             (select count(*)::integer from lexical_occurrences where listening_test_id = ${ids[0]} or listening_test_id = ${ids[1]}) as occurrences`);
    assert.deepEqual(residue.rows[0], { tests: 0, packages: 0, occurrences: 0 }, "no fixture row remains");
  }
});

test("M22 independent study: never-taken → resolved; exam open → locked; submitted → locked; a NEW open attempt re-locks", { skip: !enabled }, async () => {
  isolated();
  const author = await learner("admin");
  const student = await learner();
  const l = await listeningFixture(author.id, "Firms borrow from a bank.", [vocab("bank", "noun", `An institution that keeps money ${randomUUID()}`, "Firms borrow from a bank.")]);
  const occ = l.occurrences[0]!.id;
  assert.equal((await resolveOccurrence(student, "listening", l.testId, occ))?.status, "resolved");
  const attempt = await examAttempt(student.id, l.testId, "in_progress");
  assert.equal((await resolveOccurrence(student, "listening", l.testId, occ))?.status, "locked");
  await db.update(listeningAttempts).set({ status: "completed", submittedAt: new Date() }).where(eq(listeningAttempts.id, attempt.id));
  assert.deepEqual(await listeningExamState(student, l.testId), { submitted: true, examInProgress: false, staff: false });
  assert.equal((await resolveOccurrence(student, "listening", l.testId, occ))?.status, "resolved");
  await examAttempt(student.id, l.testId, "in_progress");
  assert.equal((await resolveOccurrence(student, "listening", l.testId, occ))?.status, "locked", "a second tab cannot be a dictionary for a retake");
  assert.equal((await resolveOccurrence(author, "listening", l.testId, occ))?.status, "resolved", "staff may inspect content");
});

test("M23/M24 after submission, financial vs river bank: the money place resolves, the river place stays UNRESOLVED (one-meaning trap)", { skip: !enabled }, async () => {
  isolated();
  const author = await learner("admin");
  const student = await learner();
  const money = `An institution that keeps money ${randomUUID()}`;
  const l = await listeningFixture(author.id, "My salary goes to the bank. We walked along the river bank.", [vocab("bank", "n", money, "My salary goes to the bank.")]);
  await examAttempt(student.id, l.testId);
  const [first, second] = l.occurrences.filter((row) => row.surfaceForm.toLowerCase() === "bank");
  const a = await resolveOccurrence(student, "listening", l.testId, first!.id);
  const b = await resolveOccurrence(student, "listening", l.testId, second!.id);
  assert.equal(a?.status === "resolved" && a.lexeme.definitionEn, money);
  assert.equal(b?.status, "unresolved", "the only known sense is NOT assigned to a different usage");
  assert.equal(b?.lexeme, null);
});

test("M25/M26 save from review keeps the Listening source context; the same sense from Reading is ONE item with TWO contexts", { skip: !enabled }, async () => {
  isolated();
  const author = await learner("admin");
  const user = await learner();
  const r = await readingFixture(user.id);
  const l = await listeningFixture(author.id, "Firms borrow from a bank.", [vocab("bank", "noun", r.money.definitionEn, "Firms borrow from a bank.")]);
  await examAttempt(user.id, l.testId);
  await save(user, "reading", r.sourceId, r.moneyOcc.id);
  await save(user, "listening", l.testId, l.occurrences[0]!.id);
  const items = await db.select().from(userVocabulary).where(and(eq(userVocabulary.userId, user.id), eq(userVocabulary.lexemeId, r.money.id)));
  assert.equal(items.length, 1);
  const contexts = await db.select().from(userVocabularyContexts).where(eq(userVocabularyContexts.userVocabularyId, items[0]!.id));
  assert.deepEqual(contexts.map((c) => c.sourceType).sort(), ["listening", "reading"]);
  const listening = contexts.find((c) => c.sourceType === "listening")!;
  assert.equal(listening.occurrenceId, l.occurrences[0]!.id);
  assert.equal(listening.snapshot.sentenceText, "Firms borrow from a bank.");
  assert.equal(listening.snapshot.listeningTestId, l.testId);
  assert.equal(listening.snapshot.sectionNumber, 2);
  assert.equal(listening.snapshot.startMs ?? null, null, "no word timings exist; none is fabricated");
});

test("M27 Vocabulary Session: canonical sense wins over a conflicting package definition; order kept for index grading", { skip: !enabled }, async () => {
  isolated();
  const author = await learner("admin");
  const def = `Land beside a river ${randomUUID()}`;
  const entries = [vocab("the", "det", "function word", "the"), vocab("shore", "n", def, "We reached the shore.")];
  const l = await listeningFixture(author.id, "We reached the shore.", entries);
  const [sense] = await db.select().from(lexemes).where(eq(lexemes.definitionEn, def));
  await db.update(lexemes).set({ translationUz: "qirg'oq (kanonik)" }).where(eq(lexemes.id, sense!.id));
  const conflicting = [entries[0]!, { ...entries[1]!, uz: "PACKAGE LOCAL — must not win" }];
  const session = await listeningVocabularySession(db, l.testId, conflicting);
  assert.equal(session.length, 2, "one item per package entry");
  assert.equal(session[0]!.senseId, null, "function word is not linked");
  assert.equal(session[1]!.senseId, sense!.id);
  assert.equal(session[1]!.translationUz, "qirg'oq (kanonik)");
  assert.equal(session[1]!.occurrenceId, l.occurrences.find((o) => o.lexemeId === sense!.id)?.id);
});

test("M28 question evidence is independent of vocabulary occurrences: ingestion ignores evidence, evidence never creates a sense", { skip: !enabled }, async () => {
  isolated();
  const author = await learner("admin");
  const plain = await listeningFixture(author.id, "The museum opens at nine.", []);
  assert.equal(plain.occurrences.filter((o) => o.lexemeId).length, 0);
  const source = readFileSync("src/lib/services/lexical/listening-occurrences.ts", "utf8");
  assert.equal(/evidence/.test(source), false, "occurrence ingestion does not read question evidence");
});

// ---------------------------------------------------------------------------
// Reading mode separation (ACADEMIC_EXAM vs ACADEMIC_REVIEW; GENERAL_READING policy).
// ---------------------------------------------------------------------------
import { readingAttempts, readingPassages } from "../src/db/schema";

async function passageWith(body: string, spans: { term: string; def: string; surface: string; from?: number; pos?: string; key?: string }[], learning = true) {
  const tag = randomUUID().slice(0, 8);
  const [passage] = await db.insert(readingPassages).values({ title: `QA2 R ${tag}`, bodyText: body }).returning();
  const out: { occurrenceId: string; lexemeId: string }[] = [];
  const senses = new Map<string, string>();
  for (const span of spans) {
    const key = span.key ?? `${span.term}|${span.def}`;
    let lexemeId = senses.get(key);
    if (!lexemeId) {
      const [row] = await db.insert(lexemes).values({ term: span.term, partOfSpeech: span.pos ?? "noun", definitionEn: span.def, senseKey: `qa2-r-${randomUUID()}`, provenance: "authored", verificationStatus: "verified" }).returning();
      lexemeId = row!.id; senses.set(key, lexemeId);
    }
    const start = body.indexOf(span.surface, span.from ?? 0);
    assert.ok(start >= 0, span.surface);
    const [occ] = await db.insert(lexicalOccurrences).values({ lexemeId, passageId: passage!.id, surfaceForm: span.surface, startChar: start, endChar: start + span.surface.length, occurrenceType: "vocabulary", isTargetVocabulary: true }).returning();
    out.push({ occurrenceId: occ!.id, lexemeId });
  }
  if (learning) await studyMembership(passage!.id);
  return { passageId: passage!.id, spans: out };
}
async function readingAttempt(userId: string, passageId: string, status: "completed" | "in_progress") {
  const [row] = await db.insert(readingAttempts).values({ userId, passageId, status, ...(status === "completed" ? { submittedAt: new Date() } : {}) }).returning();
  return row!;
}

test("R23 ACADEMIC_EXAM: occurrence data exists, but an open attempt reveals nothing — by attempt id AND by the passage-id bypass", { skip: !enabled }, async () => {
  isolated();
  const user = await learner();
  const r = await readingFixture(user.id, "in_progress");
  assert.ok(r.moneyOcc.id, "lexical data is precomputed (data availability)");
  for (const sourceId of [r.sourceId, r.passageId]) {
    const result = await resolveOccurrence(user, "reading", sourceId, r.moneyOcc.id);
    assert.equal(result?.status, "locked", `locked via ${sourceId === r.sourceId ? "attempt" : "passage"} id`);
    assert.equal(result?.lexeme, null);
    assert.equal(result?.snapshot, null);
  }
  const rows = await db.select().from(lexicalOccurrences).where(eq(lexicalOccurrences.id, r.moneyOcc.id));
  assert.equal(rows.length, 1, "backend data is not removed to satisfy the UI rule");
});

test("R27 Academic transition: never taken → locked; open → locked; own submitted review → resolved; a retake re-locks (also the old attempt id)", { skip: !enabled }, async () => {
  isolated();
  const user = await learner();
  const p = await passageWith("The bank approved the loan.", [{ term: "bank", def: `A financial institution ${randomUUID()}`, surface: "bank" }], false);
  const occ = p.spans[0]!.occurrenceId;
  assert.equal((await resolveOccurrence(user, "reading", p.passageId, occ))?.status, "locked", "never taken: the passage id is not a dictionary");
  const first = await readingAttempt(user.id, p.passageId, "in_progress");
  assert.equal((await resolveOccurrence(user, "reading", first.id, occ))?.status, "locked");
  await db.update(readingAttempts).set({ status: "completed", submittedAt: new Date() }).where(eq(readingAttempts.id, first.id));
  // Reading V4: a SUCCESSFULLY SUBMITTED own attempt is review, and review is where
  // the canonical Dictionary belongs. The lock that matters is the active exam, which
  // the assertions above and below still prove: the passage id is never a dictionary,
  // and an open retake re-locks the old attempt.
  assert.equal((await resolveOccurrence(user, "reading", first.id, occ))?.status, "resolved", "own submitted review may look a word up");
  assert.equal((await resolveOccurrence(user, "reading", p.passageId, occ))?.status, "resolved", "the same passage is review material for a learner who has submitted it");
  await readingAttempt(user.id, p.passageId, "in_progress");
  assert.equal((await resolveOccurrence(user, "reading", first.id, occ))?.status, "locked", "the old review cannot assist the open retake");
  assert.equal((await resolveOccurrence(user, "reading", p.passageId, occ))?.status, "locked", "nor can the passage id while the retake is open");
  assert.equal((await resolveOccurrence(await learner(), "reading", p.passageId, occ))?.status, "locked", "a learner who never submitted it gets nothing");
  assert.equal((await resolveOccurrence(await learner("admin"), "reading", p.passageId, occ))?.status, "locked", "Academic assistance remains disabled");
});

test("R28/R29 bank polysemy by occurrence identity; one-meaning trap: an unlinked river 'bank' has NO occurrence, so no meaning is served", { skip: !enabled }, async () => {
  isolated();
  const user = await learner();
  const money = `A financial institution ${randomUUID()}`, river = `Land beside a river ${randomUUID()}`;
  const body = "She deposited her salary in the bank. They rested on the river bank.";
  const two = await passageWith(body, [{ term: "bank", def: money, surface: "bank" }, { term: "bank", def: river, surface: "bank", from: body.indexOf("river") }]);
  await readingAttempt(user.id, two.passageId, "completed");
  const a = await resolveOccurrence(user, "reading", two.passageId, two.spans[0]!.occurrenceId);
  const b = await resolveOccurrence(user, "reading", two.passageId, two.spans[1]!.occurrenceId);
  assert.equal(a?.status === "resolved" && a.lexeme.definitionEn, money);
  assert.equal(b?.status === "resolved" && b.lexeme.definitionEn, river);
  // Trap: the dictionary knows only the money sense; only the salary place is linked.
  const trap = await passageWith(body, [{ term: "bank", def: `A financial institution ${randomUUID()}`, surface: "bank" }]);
  await readingAttempt(user.id, trap.passageId, "completed");
  const riverStart = body.indexOf("bank", body.indexOf("river"));
  const linked = await db.select().from(lexicalOccurrences).where(eq(lexicalOccurrences.passageId, trap.passageId));
  assert.equal(linked.some((o) => o.startChar === riverStart), false, "no occurrence → the UI shows 'Meaning not checked yet' (UI test) and never searches by spelling");
  assert.equal(await resolveOccurrence(user, "reading", trap.passageId, two.spans[1]!.occurrenceId), null, "another passage's river occurrence cannot be borrowed");
});

test("R30/R13 save from General learning: one sense-level item, source occurrence + passage in context; same sense in a 2nd passage → SAME item, 2 contexts; canonical not copied", { skip: !enabled }, async () => {
  isolated();
  const user = await learner();
  const def = `A financial institution ${randomUUID()}`;
  const [sense] = await db.insert(lexemes).values({ term: "bank", partOfSpeech: "noun", definitionEn: def, senseKey: `qa2-r-${randomUUID()}`, provenance: "authored", verificationStatus: "verified" }).returning();
  const passages = [];
  for (const body of ["The bank approved the loan.", "Her bank charged a fee."]) {
    const [passage] = await db.insert(readingPassages).values({ title: `QA2 R ${randomUUID().slice(0, 6)}`, bodyText: body }).returning();
    const start = body.indexOf("bank");
    const [occ] = await db.insert(lexicalOccurrences).values({ lexemeId: sense!.id, passageId: passage!.id, surfaceForm: "bank", startChar: start, endChar: start + 4, occurrenceType: "vocabulary", isTargetVocabulary: true }).returning();
    const setId = await studyMembership(passage!.id);
    passages.push({ passageId: passage!.id, setId, occurrenceId: occ!.id, body });
  }
  for (const p of passages) await save(user, "reading", p.passageId, p.occurrenceId);
  const items = await db.select().from(userVocabulary).where(eq(userVocabulary.userId, user.id));
  assert.equal(items.length, 1, "one student item for the sense");
  assert.equal(items[0]!.lexemeId, sense!.id, "the item REFERENCES the canonical sense");
  const contexts = await db.select().from(userVocabularyContexts).where(eq(userVocabularyContexts.userVocabularyId, items[0]!.id));
  assert.equal(contexts.length, 2);
  for (const p of passages) {
    const c = contexts.find((row) => row.occurrenceId === p.occurrenceId)!;
    assert.equal(c.snapshot.passageId, p.passageId);
    assert.equal(c.snapshot.attemptId, null, "General context must not borrow an Academic attempt");
    assert.equal(c.snapshot.sentenceText.includes("bank"), true);
  }
  await db.update(lexemes).set({ definitionEn: `${def} (edited)` }).where(eq(lexemes.id, sense!.id));
  const [after] = await db.select({ def: lexemes.definitionEn }).from(userVocabulary).innerJoin(lexemes, eq(lexemes.id, userVocabulary.lexemeId)).where(eq(userVocabulary.id, items[0]!.id));
  assert.equal(after!.def, `${def} (edited)`, "canonical edit is visible through the reference");
});

test("R31/R32 MWE resolves the whole expression; inflections run/runs/running/ran share one sense → ONE item, four distinct occurrences", { skip: !enabled }, async () => {
  isolated();
  const user = await learner();
  const body = "He took the cost into account. I run daily. She runs fast. Running helps. We ran home.";
  const runDef = `To move quickly on foot ${randomUUID()}`;
  const p = await passageWith(body, [
    { term: "take into account", def: `To consider something ${randomUUID()}`, surface: "took the cost into account", pos: "verb phrase" },
    ...["run", "runs", "Running", "ran"].map((surface) => ({ term: "run", def: runDef, surface, pos: "verb", key: "run", from: surface === "run" ? body.indexOf("I run") : 0 })),
  ]);
  await readingAttempt(user.id, p.passageId, "completed");
  const mwe = await resolveOccurrence(user, "reading", p.passageId, p.spans[0]!.occurrenceId);
  assert.equal(mwe?.status === "resolved" && mwe.lexeme.term, "take into account");
  assert.equal(mwe?.status === "resolved" && mwe.snapshot.surfaceForm, "took the cost into account");
  const runIds = new Set(p.spans.slice(1).map((s) => s.lexemeId));
  assert.equal(runIds.size, 1, "one shared sense for the four forms");
  for (const span of p.spans.slice(1)) await save(user, "reading", p.passageId, span.occurrenceId);
  const items = await db.select().from(userVocabulary).where(and(eq(userVocabulary.userId, user.id), eq(userVocabulary.lexemeId, [...runIds][0]!)));
  assert.equal(items.length, 1, "no four duplicate entries");
  const contexts = await db.select().from(userVocabularyContexts).where(eq(userVocabularyContexts.userVocabularyId, items[0]!.id));
  assert.deepEqual(contexts.map((c) => c.snapshot.surfaceForm).sort(), ["Running", "ran", "run", "runs"], "surface occurrences stay distinct");
});
