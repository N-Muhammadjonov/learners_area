import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  lexicalOccurrences,
  lexicalUnitPronunciations,
  lexicalUnits,
  lexemes,
  listeningAttempts,
  listeningPackages,
  listeningTests,
  readingAttempts,
  readingPassages,
  users,
} from "../src/db/schema";
import { resolveDictionaryOccurrence, lookupCanonicalDictionary } from "../src/lib/services/riwi/dictionary";
import { createTestDatabase } from "./support/pglite";

const actor = (id: string, role: "student" | "teacher" = "student") => ({ id, role });

test("RIWI dictionary resolves canonical senses from PostgreSQL, locks active student exams, and validates Reading occurrences", async () => {
  const database = await createTestDatabase();
  const studentId = randomUUID();
  const strangerId = randomUUID();
  const teacherId = randomUUID();
  const now = new Date();
  try {
    await database.db.insert(users).values([
      { id: studentId, name: "RIWI dictionary student", role: "student", accountStatus: "active" },
      { id: strangerId, name: "RIWI dictionary stranger", role: "student", accountStatus: "active" },
      { id: teacherId, name: "RIWI dictionary teacher", role: "teacher", accountStatus: "active" },
    ]);

    const [unit] = await database.db.insert(lexicalUnits).values({
      language: "en", lemma: "resilient", lemmaNorm: "resilient", partOfSpeech: "adjective", lexicalType: "word", provenance: "authored",
    }).returning();
    const [resilient] = await database.db.insert(lexemes).values({
      term: "Resilient", partOfSpeech: "adjective", definitionEn: "able to recover quickly after difficulty",
      translationUz: "bardoshli", exampleSentence: "The team remained resilient.", collocations: "resilient community",
      senseKey: `resilient-${randomUUID()}`, acceptedTranslations: ["bardoshli"], provenance: "authored",
      verificationStatus: "verified", lexicalUnitId: unit!.id,
    }).returning();
    await database.db.insert(lexicalUnitPronunciations).values({ lexicalUnitId: unit!.id, ipa: "/rɪˈzɪliənt/", provenance: "qa_fixture" });

    const resolved = await lookupCanonicalDictionary("RESILIENT", actor(studentId), database.db);
    assert.equal(resolved.status, "resolved");
    if (resolved.status === "resolved") {
      assert.equal(resolved.term, "Resilient");
      assert.equal(resolved.definitionEn, "able to recover quickly after difficulty");
      assert.equal(resolved.verified, true);
      assert.equal(resolved.pronunciation, "/rɪˈzɪliənt/");
    }

    await database.db.insert(lexemes).values({
      term: "learner draft", definitionEn: "A learner supplied definition", senseKey: `learner-${randomUUID()}`,
      provenance: "user_provided", verificationStatus: "candidate",
    });
    assert.deepEqual(await lookupCanonicalDictionary("learner draft", actor(studentId), database.db), { status: "unresolved" },
      "learner-provided vocabulary never becomes a shared canonical definition");
    assert.deepEqual(await lookupCanonicalDictionary("unrecorded word", actor(studentId), database.db), { status: "unresolved" },
      "unknown entries remain unknown; no definition is invented");

    await database.db.insert(lexemes).values([
      { term: "bank", definitionEn: "a financial institution", senseKey: `bank-money-${randomUUID()}`, provenance: "authored", verificationStatus: "verified" },
      { term: "BANK", definitionEn: "land beside a river", senseKey: `bank-river-${randomUUID()}`, provenance: "authored", verificationStatus: "verified" },
    ]);
    assert.deepEqual(await lookupCanonicalDictionary("bank", actor(studentId), database.db), { status: "unresolved" },
      "an ambiguous multi-sense term is not guessed without occurrence context");

    const passageBody = "The resilient team recovered after a difficult season.";
    const [passage] = await database.db.insert(readingPassages).values({ title: "RIWI dictionary fixture", bodyText: passageBody }).returning();
    const [attempt] = await database.db.insert(readingAttempts).values({
      userId: studentId, passageId: passage!.id, status: "in_progress", startedAt: now,
    }).returning();
    const surfaceForm = "resilient";
    const startChar = passageBody.toLowerCase().indexOf(surfaceForm);
    const [occurrence] = await database.db.insert(lexicalOccurrences).values({
      lexemeId: resilient!.id, passageId: passage!.id, surfaceForm, startChar, endChar: startChar + surfaceForm.length,
      sentenceText: passageBody, occurrenceType: "vocabulary", isTargetVocabulary: true,
    }).returning();

    assert.deepEqual(await lookupCanonicalDictionary("resilient", actor(studentId), database.db), { status: "locked" },
      "dictionary facts remain hidden while a student's Academic attempt is active");
    assert.deepEqual(await resolveDictionaryOccurrence({
      actor: actor(studentId), sourceType: "reading", sourceId: attempt!.id, occurrenceId: occurrence!.id,
    }, database.db), { status: "locked", lexeme: null, snapshot: null });

    const staffLookup = await lookupCanonicalDictionary("resilient", actor(teacherId, "teacher"), database.db);
    assert.equal(staffLookup.status, "resolved", "the student exam lock does not silently remove staff access");

    await database.db.update(readingAttempts).set({ status: "completed", submittedAt: now }).where(eq(readingAttempts.id, attempt!.id));
    const contextual = await resolveDictionaryOccurrence({
      actor: actor(studentId), sourceType: "reading", sourceId: attempt!.id, occurrenceId: occurrence!.id,
    }, database.db);
    assert.equal(contextual?.status, "resolved");
    if (contextual?.status === "resolved") {
      assert.equal(contextual.lexeme.id, resilient!.id);
      assert.equal(contextual.snapshot.attemptId, attempt!.id);
      assert.equal(contextual.snapshot.surfaceForm, surfaceForm);
      assert.equal(contextual.snapshot.sentenceText, passageBody);
    }

    assert.equal(await resolveDictionaryOccurrence({
      actor: actor(strangerId), sourceType: "reading", sourceId: attempt!.id, occurrenceId: occurrence!.id,
    }, database.db), null, "another learner cannot resolve an owned attempt occurrence");
    assert.equal(await resolveDictionaryOccurrence({
      actor: actor(studentId), sourceType: "reading", sourceId: attempt!.id, occurrenceId: randomUUID(),
    }, database.db), null, "a fabricated occurrence id is not a source of meaning");

    await database.db.update(lexicalOccurrences).set({ startChar: startChar + 1 }).where(eq(lexicalOccurrences.id, occurrence!.id));
    assert.equal(await resolveDictionaryOccurrence({
      actor: actor(studentId), sourceType: "reading", sourceId: attempt!.id, occurrenceId: occurrence!.id,
    }, database.db), null, "stale offsets fail closed instead of attaching the wrong canonical sense");

    const [listeningTest] = await database.db.insert(listeningTests).values({
      createdByUserId: teacherId, title: "RIWI dictionary Listening fixture", audioType: "audio", audioUrl: "/fixture.mp3",
    }).returning();
    const listeningTranscript = "Please remain resilient when plans change.";
    await database.db.insert(listeningPackages).values({
      testId: listeningTest!.id, sourceId: `riwi-${randomUUID()}`,
      payload: { sections: [{ number: 1, title: "Section 1", transcript: listeningTranscript }] } as never,
      audioObjectKey: "fixtures/riwi-dictionary.mp3", sourceHash: "a".repeat(64),
    });
    const listeningStart = listeningTranscript.indexOf(surfaceForm);
    const [listeningOccurrence] = await database.db.insert(lexicalOccurrences).values({
      sourceType: "listening", listeningTestId: listeningTest!.id, sectionNumber: 1,
      lexemeId: resilient!.id, surfaceForm, startChar: listeningStart, endChar: listeningStart + surfaceForm.length,
      sentenceText: listeningTranscript, occurrenceType: "vocabulary", isTargetVocabulary: true,
    }).returning();
    const [listeningAttempt] = await database.db.insert(listeningAttempts).values({
      userId: studentId, testId: listeningTest!.id, status: "in_progress", startedAt: now,
    }).returning();
    assert.deepEqual(await lookupCanonicalDictionary("resilient", actor(studentId), database.db), { status: "locked" },
      "full Listening attempts also pause dictionary assistance");
    assert.deepEqual(await resolveDictionaryOccurrence({
      actor: actor(studentId), sourceType: "listening", sourceId: listeningTest!.id, occurrenceId: listeningOccurrence!.id,
    }, database.db), { status: "locked", lexeme: null, snapshot: null });
    await database.db.update(listeningAttempts).set({ status: "completed", submittedAt: now }).where(eq(listeningAttempts.id, listeningAttempt!.id));
    const listeningContext = await resolveDictionaryOccurrence({
      actor: actor(studentId), sourceType: "listening", sourceId: listeningTest!.id, occurrenceId: listeningOccurrence!.id,
    }, database.db);
    assert.equal(listeningContext?.status, "resolved");
    if (listeningContext?.status === "resolved") {
      assert.equal(listeningContext.lexeme.id, resilient!.id);
      assert.equal(listeningContext.snapshot.sourceType, "listening");
      assert.equal(listeningContext.snapshot.sectionNumber, 1);
      assert.equal(listeningContext.snapshot.sentenceText, listeningTranscript);
    }
    await database.db.update(lexicalOccurrences).set({ startChar: listeningStart + 1 }).where(eq(lexicalOccurrences.id, listeningOccurrence!.id));
    assert.equal(await resolveDictionaryOccurrence({
      actor: actor(studentId), sourceType: "listening", sourceId: listeningTest!.id, occurrenceId: listeningOccurrence!.id,
    }, database.db), null, "a stale Listening transcript offset is not paired with a stored sense");
  } finally {
    await database.close();
  }
});
