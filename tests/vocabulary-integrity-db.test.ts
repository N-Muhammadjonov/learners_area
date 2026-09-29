import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { lexemes, lexicalOccurrences, readingPassages, users, userVocabulary, vocabPointEvents, vocabFolders } from "../src/db/schema";
import { addVocabularyBatch, listFolders } from "../src/lib/services/vocabulary/engine";

const enabled = process.env.QA2_DATABASE_TESTS === "1";
function isolated() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2");
}

test("concurrent saves share one canonical sense and one learner entry with one award", { skip: !enabled }, async () => {
  isolated();
  const userId = randomUUID();
  const term = `qa2-${randomUUID()}`;
  await db.insert(users).values({ id: userId, name: "QA2 lexical concurrency", role: "student", accountStatus: "active" });
  let pending: Promise<Awaited<ReturnType<typeof addVocabularyBatch>>[]> | undefined;
  try {
    await db.transaction(async (lock) => {
      const owner = await lock.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      await lock.select().from(users).where(eq(users.id, userId)).for("update");
      pending = Promise.all(Array.from({ length: 3 }, () => addVocabularyBatch({
        userId, items: [{ term, partOfSpeech: "noun", definitionEn: "An isolated canonical sense" }], sourceType: "reading",
      })));
      let count = 0;
      for (let tries = 0; tries < 100; tries++) {
        const waiting = await db.execute<{ count: number }>(sql`with recursive blocked(pid) as (
          select pid from pg_stat_activity where ${owner.rows[0]!.pid} = any(pg_blocking_pids(pid))
          union
          select a.pid from pg_stat_activity a join blocked b on b.pid = any(pg_blocking_pids(a.pid))
        ) select count(*)::int as count from blocked`);
        count = waiting.rows[0]?.count ?? 0;
        if (count === 3) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(count, 3, "all three saves must overlap at a real DB lock");
    });
    const results = await pending!;
    assert.ok(results.every((result) => result.ok));
    assert.equal(results.reduce((n, result) => n + (result.ok ? result.added : 0), 0), 1);
    assert.equal((await db.select().from(lexemes).where(eq(lexemes.term, term))).length, 1);
    assert.equal((await db.select().from(userVocabulary).where(eq(userVocabulary.userId, userId))).length, 1);
    assert.equal((await db.select().from(vocabPointEvents).where(and(eq(vocabPointEvents.userId, userId), eq(vocabPointEvents.kind, "new_word")))).length, 1);
    const replay = await addVocabularyBatch({ userId, items: [{ term, partOfSpeech: "noun", definitionEn: "An isolated canonical sense" }] });
    assert.ok(replay.ok);
    assert.equal(replay.added, 0);
    assert.equal(replay.duplicates, 1, "an already saved sense must be reported as a duplicate");
  } finally {
    await pending?.catch(() => undefined);
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(lexemes).where(eq(lexemes.term, term));
  }
});

test("failed vocabulary batches cannot leave canonical rows, points or partial learner entries", { skip: !enabled }, async () => {
  isolated();
  const userId = randomUUID();
  const term = `qa2-${randomUUID()}`;
  const tooLong = `${term}${"x".repeat(121)}`;
  await db.insert(users).values({ id: userId, name: "QA2 lexical rollback", role: "student", accountStatus: "active" });
  try {
    await assert.rejects(addVocabularyBatch({ userId, items: [
      { term, definitionEn: "A valid first item" },
      { term: tooLong, definitionEn: "An invalid second item" },
    ] }));
    assert.equal((await db.select().from(userVocabulary).where(eq(userVocabulary.userId, userId))).length, 0);
    assert.equal((await db.select().from(vocabPointEvents).where(eq(vocabPointEvents.userId, userId))).length, 0);
    assert.equal((await db.select().from(lexemes).where(inArray(lexemes.term, [term, tooLong]))).length, 0);
  } finally {
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(lexemes).where(inArray(lexemes.term, [term, tooLong]));
  }
});


test("source deletion removes only its occurrences, preserving shared senses and both learners' saved words", { skip: !enabled }, async () => {
  isolated();
  const learnerIds = [randomUUID(), randomUUID()];
  const passageIds = [randomUUID(), randomUUID()];
  const term = `qa2-${randomUUID()}`;
  const items = [
    { term, partOfSpeech: "noun", definitionEn: "The side of a river" },
    { term, partOfSpeech: "noun", definitionEn: "An institution that keeps money" },
  ];
  await db.insert(users).values(learnerIds.map((id) => ({ id, name: "QA2 lexical source", role: "student" as const, accountStatus: "active" as const })));
  try {
    await db.insert(readingPassages).values(passageIds.map((id) => ({ id, title: "QA2 lexical source", bodyText: term })));
    for (const userId of learnerIds) await addVocabularyBatch({ userId, items, sourceType: "reading", sourceId: passageIds[0] });
    const senses = await db.select().from(lexemes).where(eq(lexemes.term, term));
    assert.equal(senses.length, 2, "distinct senses remain distinct and are shared across learners");
    await db.insert(lexicalOccurrences).values(passageIds.map((passageId) => ({ passageId, lexemeId: senses[0]!.id, surfaceForm: term, startChar: 0, endChar: term.length, sentenceText: term })));
    assert.equal((await db.select().from(userVocabulary).where(inArray(userVocabulary.userId, learnerIds))).length, 4);
    await db.delete(readingPassages).where(eq(readingPassages.id, passageIds[0]!));
    assert.equal((await db.select().from(lexicalOccurrences).where(inArray(lexicalOccurrences.passageId, passageIds))).length, 1);
    assert.equal((await db.select().from(lexemes).where(eq(lexemes.term, term))).length, 2);
    assert.equal((await db.select().from(userVocabulary).where(inArray(userVocabulary.userId, learnerIds))).length, 4);
  } finally {
    await db.delete(readingPassages).where(inArray(readingPassages.id, passageIds));
    await db.delete(users).where(inArray(users.id, learnerIds));
    await db.delete(lexemes).where(eq(lexemes.term, term));
  }
});


test("foreign or deleted folder fails before any lexical write or award; own and unfiled saves stay idempotent", { skip: !enabled }, async () => {
  isolated();
  const userIds = [randomUUID(), randomUUID()];
  const folderIds = [randomUUID(), randomUUID()];
  const terms = [`qa2-${randomUUID()}`, `qa2-${randomUUID()}`];
  await db.insert(users).values(userIds.map((id) => ({ id, name: "QA2 folder ownership", role: "student" as const, accountStatus: "active" as const })));
  try {
    await db.insert(vocabFolders).values(folderIds.map((id, index) => ({ id, userId: userIds[index]!, name: "QA2 private folder" })));
    assert.deepEqual((await listFolders(userIds[0]!)).map((f) => f.id), [folderIds[0]]);
    for (const folderId of [folderIds[1]!, randomUUID()]) {
      const refused = await addVocabularyBatch({ userId: userIds[0]!, folderId, items: [{ term: terms[0]!, definitionEn: "Only an owned folder is allowed" }] });
      assert.deepEqual(refused, { ok: false, error: "folder_not_found" });
      assert.equal((await db.select().from(lexemes).where(eq(lexemes.term, terms[0]!))).length, 0);
      assert.equal((await db.select().from(vocabPointEvents).where(eq(vocabPointEvents.userId, userIds[0]!))).length, 0);
    }
    const input = { userId: userIds[0]!, folderId: folderIds[0]!, items: [{ term: terms[0]!, definitionEn: "Only an owned folder is allowed" }] };
    const saved = await addVocabularyBatch(input);
    assert.ok(saved.ok);
    const replay = await addVocabularyBatch(input);
    assert.ok(replay.ok);
    assert.equal(replay.added, 0);
    assert.equal(replay.points, 0);
    assert.deepEqual(replay.ids, saved.ids);
    await addVocabularyBatch({ userId: userIds[0]!, items: [{ term: terms[1]!, definitionEn: "An unfiled word" }] });
    const rows = await db.select().from(userVocabulary).where(eq(userVocabulary.userId, userIds[0]!));
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.id === saved.ids[0])?.folderId, folderIds[0]);
    assert.equal(rows.filter((row) => row.folderId === null).length, 1);
  } finally {
    await db.delete(users).where(inArray(users.id, userIds));
    await db.delete(lexemes).where(inArray(lexemes.term, terms));
  }
});

test("contextual bank saves preserve the exact sense, ownership and encounter after source deletion", { skip: !enabled }, async () => {
  isolated();
  const { resolveReadingOccurrence } = await import("../src/lib/services/lexical/context");
  const { readingAttempts } = await import("../src/db/schema");
  const { lookupCatalogue } = await import("../src/lib/services/lexical/enrichment");
  const userIds = [randomUUID(), randomUUID()];
  const passageId = randomUUID(), attemptId = randomUUID();
  const senseIds = [randomUUID(), randomUUID()];
  const occurrenceIds = [randomUUID(), randomUUID()];
  const body = "The bank lends money. The bank borders the river.";
  await db.insert(users).values(userIds.map((id) => ({ id, name: "QA2 context", role: "student" as const, accountStatus: "active" as const })));
  try {
    await db.insert(readingPassages).values({ id: passageId, title: "Two banks", bodyText: body, publicationState: "draft" });
    await db.insert(readingAttempts).values({ id: attemptId, userId: userIds[0]!, passageId });
    await db.insert(lexemes).values(senseIds.map((id, i) => ({ id, term: "bank", partOfSpeech: "noun", definitionEn: i ? "The edge of a river" : "A financial institution", translationUz: i ? "qirg'oq" : "bank", senseKey: `qa2-existing-${id}`, provenance: "authored", verificationStatus: "verified" })));
    await db.insert(lexicalOccurrences).values(occurrenceIds.map((id, i) => ({ id, passageId, lexemeId: senseIds[i]!, surfaceForm: "bank", startChar: i ? 26 : 4, endChar: i ? 30 : 8, sentenceText: i ? "The bank borders the river." : "The bank lends money." })));
    assert.equal(await lookupCatalogue("bank"), null, "spelling alone cannot select either sense");
    assert.equal(await resolveReadingOccurrence(userIds[1]!, attemptId, occurrenceIds[1]!), null);
    assert.equal(await resolveReadingOccurrence(userIds[1]!, passageId, occurrenceIds[1]!), null, "draft passage cannot be used as a public source");
    const resolved = await resolveReadingOccurrence(userIds[0]!, attemptId, occurrenceIds[1]!);
    assert.ok(resolved);
    assert.equal(resolved.lexeme.id, senseIds[1]);
    const input = { userId: userIds[0]!, sourceType: "reading", sourceId: attemptId, items: [{ ...resolved.lexeme, canonicalLexemeId: resolved.lexeme.id, sourceSnapshot: resolved.snapshot }] };
    const saved = await addVocabularyBatch(input);
    assert.ok(saved.ok);
    assert.equal(saved.added, 1);
    assert.equal((await addVocabularyBatch(input)).ok, true);
    const [entry] = await db.select().from(userVocabulary).where(eq(userVocabulary.userId, userIds[0]!));
    assert.equal(entry?.lexemeId, senseIds[1]);
    assert.equal(entry?.senseKey, resolved.lexeme.senseKey, "existing sense key is never recalculated");
    assert.equal(entry?.sourceSnapshot?.sentenceText, "The bank borders the river.");
    await assert.rejects(db.delete(lexemes).where(eq(lexemes.id, senseIds[1]!)), "a used canonical sense cannot destroy learner vocabulary");
    await db.delete(readingAttempts).where(eq(readingAttempts.id, attemptId));
    await db.delete(readingPassages).where(eq(readingPassages.id, passageId));
    const [survivor] = await db.select().from(userVocabulary).where(eq(userVocabulary.id, entry!.id));
    assert.deepEqual(survivor?.sourceSnapshot, entry?.sourceSnapshot);
    assert.equal(survivor?.lexemeId, senseIds[1]);
  } finally {
    await db.delete(readingAttempts).where(eq(readingAttempts.id, attemptId));
    await db.delete(readingPassages).where(eq(readingPassages.id, passageId));
    await db.delete(users).where(inArray(users.id, userIds));
    await db.delete(lexemes).where(inArray(lexemes.id, senseIds));
  }
});


test("legacy IDs stay stable while distinct parenthetical meanings and POS get separate new senses", { skip: !enabled }, async () => {
  isolated();
  const { legacySenseKeyOf } = await import("../src/lib/services/vocabulary/dedupe");
  const { lookupCatalogue } = await import("../src/lib/services/lexical/enrichment");
  const userId = randomUUID(), legacyId = randomUUID(), term = `qa2-${randomUUID()}`;
  const oldMeaning = "an amount (of money owed)";
  const oldKey = legacySenseKeyOf({ term, partOfSpeech: "noun", meaning: oldMeaning });
  await db.insert(users).values({ id: userId, name: "QA2 normalization", role: "student", accountStatus: "active" });
  try {
    await db.insert(lexemes).values({ id: legacyId, term, definitionEn: oldMeaning, partOfSpeech: "noun", senseKey: oldKey });
    const saved = await addVocabularyBatch({ userId, items: [
      { term, partOfSpeech: "n.", definitionEn: "An   amount (of money owed)." },
      { term, partOfSpeech: "noun", definitionEn: "an amount (of electricity stored)" },
      { term, partOfSpeech: "noun phrase", definitionEn: oldMeaning },
    ] });
    assert.ok(saved.ok);
    assert.equal(saved.added, 3);
    const rows = await db.select().from(lexemes).where(eq(lexemes.term, term));
    assert.equal(rows.length, 3);
    assert.equal(rows.find((r) => r.id === legacyId)?.senseKey, oldKey);
    assert.equal(rows.filter((r) => r.id !== legacyId).every((r) => r.senseKey.startsWith('v2:') && r.provenance === 'user_provided' && r.verificationStatus === 'unverified'), true);
    // Authored/legacy catalogue lookup cannot propagate the new custom senses.
    assert.equal((await lookupCatalogue(term))?.canonicalLexemeId, legacyId);
    const replay = await addVocabularyBatch({ userId, items: [{ term, partOfSpeech: "noun", definitionEn: oldMeaning }] });
    assert.ok(replay.ok);
    assert.equal(replay.added, 0);
    assert.equal(replay.points, 0);
  } finally {
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(lexemes).where(eq(lexemes.term, term));
  }
});
