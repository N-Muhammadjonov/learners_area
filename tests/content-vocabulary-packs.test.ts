import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { contentVersions, lexemes, vocabularyTopicPackWords, vocabularyTopicPacks } from "../src/db/schema";
import { builtInPacks, findTopicPackForLearner, listTopicPacksForLearner, saveTopicPack } from "../src/lib/content/vocabulary-packs";
import { publishContentVersion, saveContentDraft, type AuthoringActor } from "../src/lib/content/authoring";
import { TOPIC_PACKS } from "../src/lib/services/vocabulary/packs";
import { createTestDatabase } from "./support/pglite";

/**
 * Vocabulary packs as canonical content (§31, §76, §100).
 *
 * The rules under test:
 *   • a pack's words ARE canonical `lexemes` rows — no second word store;
 *   • the same sense added twice resolves to one row (the pack cannot fork a sense);
 *   • while nothing is authored, learners see exactly the built-in packs they had;
 *   • once a pack is authored and published, the DATABASE is the source of truth,
 *     so adding a pack needs no deployment;
 *   • a draft pack is invisible to learners.
 */

const owner: AuthoringActor = { id: "", role: "owner", mayPublish: true };

async function ownerId(db: Awaited<ReturnType<typeof createTestDatabase>>["query"]): Promise<string> {
  const [row] = await db<{ id: string }>(`insert into users (name, role) values ('Pack owner', 'owner') returning id`);
  return row!.id;
}

const WORDS = [
  { term: "symptom", partOfSpeech: "noun", definitionEn: "a sign of illness", translationUz: "alomat", example: "The first symptom was a cough." },
  { term: "treatment", partOfSpeech: "noun", definitionEn: "medical care", translationUz: "davolash", example: "Treatment began immediately." },
];

test("VP1 before anything is authored, learners see exactly the built-in packs", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const packs = await listTopicPacksForLearner("en", db);
    assert.deepEqual(
      packs.map((pack) => pack.id),
      TOPIC_PACKS.map((pack) => pack.id),
      "the compatibility fallback is the previous behaviour, unchanged",
    );
    assert.equal(packs[0]!.words.length, builtInPacks("en")[0]!.words.length);
    assert.equal((await findTopicPackForLearner("health_medicine", db))?.id, "health_medicine");
    assert.equal(await findTopicPackForLearner("not_a_pack", db), null);
  } finally {
    await database.close();
  }
});

test("VP2 an authored pack stores its words as canonical lexemes, not as pack-local copies", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const actorUserId = await ownerId(database.query);

    const saved = await db.transaction((tx) =>
      saveTopicPack(tx, { actorUserId, sourceRef: "pack-transport", slug: "transport", labelEn: "Transport", labelUz: "Transport", words: WORDS }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    const senses = await db.select().from(lexemes);
    assert.equal(senses.length, 2, "one canonical sense per distinct word");
    assert.ok(senses.every((sense) => sense.senseKey.startsWith("v2:")));
    assert.deepEqual(senses.map((sense) => sense.term).sort(), ["symptom", "treatment"]);

    const membership = await db.select().from(vocabularyTopicPackWords).where(eq(vocabularyTopicPackWords.packId, saved.packId));
    assert.equal(membership.length, 2, "the pack holds membership rows, not definitions");
    assert.deepEqual(membership.map((row) => row.position), [1, 2]);
    assert.ok(membership.every((row) => senses.some((sense) => sense.id === row.lexemeId)), "every member IS a canonical sense");

    const pack = await db.select().from(vocabularyTopicPacks).where(eq(vocabularyTopicPacks.id, saved.packId));
    assert.equal(pack[0]!.publicationState, "draft", "an authored pack starts as a draft");
    const revision = await db.select().from(contentVersions).where(eq(contentVersions.id, saved.versionId));
    assert.equal(revision[0]!.module, "vocabulary");
    assert.equal(revision[0]!.contentType, "topic_pack");
    assert.equal(revision[0]!.publicationState, "draft");
  } finally {
    await database.close();
  }
});

test("VP3 the same sense added twice resolves to one lexeme and cannot fork", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const actorUserId = await ownerId(database.query);
    const first = await db.transaction((tx) =>
      saveTopicPack(tx, { actorUserId, sourceRef: "pack-one", slug: "one", labelEn: "One", words: [WORDS[0]!] }),
    );
    const second = await db.transaction((tx) =>
      saveTopicPack(tx, {
        actorUserId,
        sourceRef: "pack-two",
        slug: "two",
        labelEn: "Two",
        // Same spelling and meaning, different capitalisation: the same sense.
        words: [{ ...WORDS[0]!, term: "Symptom" }],
      }),
    );
    assert.equal(first.ok && second.ok, true);
    const senses = await db.select().from(lexemes);
    assert.equal(senses.length, 1, "one sense, shared by both packs");
    assert.equal((await db.select().from(vocabularyTopicPackWords)).length, 2, "two memberships pointing at the same sense");

    // A genuinely different meaning is a different sense and must coexist.
    const third = await db.transaction((tx) =>
      saveTopicPack(tx, {
        actorUserId,
        sourceRef: "pack-three",
        slug: "three",
        labelEn: "Three",
        words: [{ ...WORDS[0]!, definitionEn: "something that indicates a problem of any kind" }],
      }),
    );
    assert.equal(third.ok, true);
    assert.equal((await db.select().from(lexemes)).length, 2, "a different sense is a different word");
  } finally {
    await database.close();
  }
});

test("VP4 publishing a pack makes the database the source of truth for learners", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const actor = { ...owner, id: await ownerId(database.query) };
    const saved = await db.transaction((tx) =>
      saveTopicPack(tx, { actorUserId: actor.id, sourceRef: "pack-travel", slug: "travel", labelEn: "Travel", labelUz: "Sayohat", words: WORDS }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    // Still a draft: learners keep seeing the built-in set.
    assert.deepEqual(
      (await listTopicPacksForLearner("en", db)).map((pack) => pack.id),
      TOPIC_PACKS.map((pack) => pack.id),
    );

    const published = await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: saved.versionId, to: "published" }));
    assert.equal(published.ok, true);
    if (!published.ok) return;

    const packs = await listTopicPacksForLearner("uz", db);
    assert.equal(packs.length, 1, "the database is now the source of truth");
    assert.equal(packs[0]!.id, "travel");
    assert.equal(packs[0]!.label, "Sayohat", "the locale is applied by the reader");
    assert.deepEqual(packs[0]!.words.map((word) => word.term), ["symptom", "treatment"]);
    assert.equal(packs[0]!.words[0]!.definitionEn, "a sign of illness");
    assert.equal((await findTopicPackForLearner("travel", db))!.label, "Travel");
  } finally {
    await database.close();
  }
});

test("VP5 a pack is authored through the shared authoring pipeline, and revisions are kept", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const actor = { ...owner, id: await ownerId(query) };

    const created = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "vocabulary",
        contentType: "topic_pack",
        sourceRef: "pack-academic-verbs",
        title: "Academic verbs",
        payload: { labelEn: "Academic verbs", slug: "academic-verbs", words: [{ term: "mitigate", partOfSpeech: "verb", definitionEn: "to make less severe", translationUz: "yumshatmoq", example: "Policies can mitigate the damage." }] },
      }),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.version.publicationState, "draft");

    const renamed = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "vocabulary",
        contentType: "topic_pack",
        sourceRef: "pack-academic-verbs",
        title: "Academic verbs (revised)",
        payload: { labelEn: "Academic verbs (revised)", slug: "academic-verbs", words: [{ term: "mitigate", partOfSpeech: "verb", definitionEn: "to make less severe", translationUz: "yumshatmoq", example: "Policies can mitigate the damage." }] },
      }),
    );
    assert.equal(renamed.ok, true);
    const rows = await query<{ version_no: number }>(`select version_no from content_versions where source_ref = 'pack-academic-verbs' order by version_no`);
    assert.deepEqual(rows.map((row) => row.version_no), [1], "a label-only change is metadata, so it stays one revision");
    assert.equal((await db.select().from(lexemes)).length, 1, "re-authoring did not duplicate the sense");
  } finally {
    await database.close();
  }
});
