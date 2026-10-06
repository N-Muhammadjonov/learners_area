import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { grammarTopics, listeningAttempts, listeningTests, readingAttempts, readingPassages, writingPrompts } from "../src/db/schema";
import {
  publishedVersionForTarget,
  revisionForGrammarTopic,
  revisionForListeningTest,
  revisionForReadingPassage,
  revisionForWritingPrompt,
} from "../src/lib/content/attempt-binding";
import { pinVersion } from "../src/lib/content/versions";
import { publishContentVersion } from "../src/lib/content/authoring";
import { createTestDatabase } from "./support/pglite";

/**
 * Attempt → revision binding (§71, §72).
 *
 * The version store is only a guarantee if attempts record what they were given.
 * These tests drive the SAME resolvers the routes call, and prove the two halves
 * that matter:
 *
 *   - only a PUBLISHED revision is ever returned (a draft nobody may open is never
 *     bound to anybody's work);
 *   - when there is no revision, the answer is `null` — an honest absence, not a
 *     guess — so legacy content is recorded unbound instead of falsely claimed.
 */

async function fixture(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  const { db, query } = database;
  const [owner] = await query<{ id: string }>(`insert into users (name, role) values ('Binding owner', 'owner') returning id`);
  return { db, ownerId: owner!.id };
}

const published = (actor: { id: string; role: string; mayPublish: boolean }, versionId: string, db: Awaited<ReturnType<typeof createTestDatabase>>["db"]) =>
  db.transaction((tx) => publishContentVersion(tx, { actor, versionId, to: "published" }));

test("AB1 a Listening attempt binds to the published revision, and an unversioned test binds to nothing", async () => {
  const database = await createTestDatabase();
  try {
    const { db, ownerId } = await fixture(database);
    const actor = { id: ownerId, role: "owner", mayPublish: true };

    const [test] = await db
      .insert(listeningTests)
      .values({ title: "Binding test", audioType: "audio", sourceRef: "bind-listening-1", createdByUserId: ownerId })
      .returning();
    const [legacy] = await db.insert(listeningTests).values({ title: "Legacy test", audioType: "audio", createdByUserId: ownerId }).returning();

    const pinned = await db.transaction((tx) =>
      pinVersion(tx, {
        module: "listening",
        contentType: "full_test",
        sourceRef: "bind-listening-1",
        title: "Binding test",
        content: { questions: [{ number: 1, questionText: "Synthetic", correctAnswer: "yes" }] },
        publicationState: "draft",
        actorUserId: ownerId,
        targetType: "listening_test",
        targetId: test!.id,
      }),
    );
    assert.equal(pinned.created, true);

    // A draft is not something a learner can be given, so it is not bound.
    assert.equal(await revisionForListeningTest(test!.id, db), null, "a draft revision is never bound");
    assert.equal(await revisionForListeningTest(legacy!.id, db), null, "content with no revision binds to null, not to a guess");

    await published(actor, pinned.version.id, db);
    assert.equal((await revisionForListeningTest(test!.id, db))!.id, pinned.version.id, "the attempt binds to the published revision");
  } finally {
    await database.close();
  }
});

test("AB2 a Reading attempt binds through the passage's own identity, and a new revision never rebinds an old attempt", async () => {
  const database = await createTestDatabase();
  try {
    const { db, ownerId } = await fixture(database);
    const actor = { id: ownerId, role: "owner", mayPublish: true };

    const [passage] = await db
      .insert(readingPassages)
      .values({ title: "Binding passage", bodyText: "A synthetic passage body for the binding test.", sourceRef: "bind-reading-1", publicationState: "published" })
      .returning();

    const first = await db.transaction((tx) =>
      pinVersion(tx, {
        module: "reading",
        contentType: "general_set",
        sourceRef: "bind-reading-1",
        title: "Binding set",
        content: { passages: [{ passageNo: 1, body: "A synthetic passage body for the binding test.", questions: [] }] },
        publicationState: "draft",
        actorUserId: ownerId,
        targetType: "general_reading_set",
        targetId: passage!.id,
      }),
    );
    assert.equal(first.created, true);

    // No published revision yet: the passage resolves through its own identity and
    // finds nothing rather than falling back to a draft.
    assert.equal(await revisionForReadingPassage(passage!.id, db), null);
    await published(actor, first.version.id, db);
    assert.equal((await revisionForReadingPassage(passage!.id, db))!.id, first.version.id);

    // The content is revised and the revision published: the resolver moves to the
    // new revision for NEW work, which is why an attempt must STORE what it used.
    const second = await db.transaction((tx) =>
      pinVersion(tx, {
        module: "reading",
        contentType: "general_set",
        sourceRef: "bind-reading-1",
        title: "Binding set",
        content: { passages: [{ passageNo: 1, body: "A synthetic passage body for the binding test, revised.", questions: [] }] },
        publicationState: "draft",
        actorUserId: ownerId,
        targetType: "general_reading_set",
        targetId: passage!.id,
      }),
    );
    assert.equal(second.version.versionNo, 2);
    assert.equal((await revisionForReadingPassage(passage!.id, db))!.id, first.version.id, "the newer DRAFT does not displace the published revision");
    await published(actor, second.version.id, db);
    assert.equal((await revisionForReadingPassage(passage!.id, db))!.id, second.version.id, "a newly published revision is what new work binds to");

    // An attempt bound to the FIRST revision keeps pointing at it.
    const [student] = await database.query<{ id: string }>(`insert into users (name, role) values ('Binding student', 'student') returning id`);
    const [attempt] = await db
      .insert(readingAttempts)
      .values({ userId: student!.id, passageId: passage!.id, contentVersionId: first.version.id })
      .returning();
    assert.equal(attempt!.contentVersionId, first.version.id, "history keeps the revision it was given");
    assert.equal((await db.select().from(readingAttempts).where(eq(readingAttempts.id, attempt!.id))).length, 1);
  } finally {
    await database.close();
  }
});

test("AB3 grammar and writing attempts resolve the revision of the topic / prompt they answer", async () => {
  const database = await createTestDatabase();
  try {
    const { db, ownerId } = await fixture(database);
    const actor = { id: ownerId, role: "owner", mayPublish: true };

    const [topic] = await db
      .insert(grammarTopics)
      .values({ title: "Binding topic", explanation: "Synthetic.", order: 1, sourceRef: "bind-grammar-1", publicationState: "published" })
      .returning();
    const [prompt] = await db
      .insert(writingPrompts)
      .values({ taskType: "task2", category: "education", prompt: "A synthetic binding prompt, long enough to be a real one.", targetWordCount: 250 })
      .returning();

    assert.equal(await revisionForGrammarTopic(topic!.id, db), null);
    assert.equal(await revisionForWritingPrompt(prompt!.id, db), null);

    const grammarVersion = await db.transaction((tx) =>
      pinVersion(tx, {
        module: "grammar",
        contentType: "topic",
        sourceRef: "bind-grammar-1",
        title: "Binding topic",
        content: { promptText: "Synthetic.", correctOption: "a" },
        publicationState: "draft",
        actorUserId: ownerId,
        targetType: "grammar_topic",
        targetId: topic!.id,
      }),
    );
    const writingVersion = await db.transaction((tx) =>
      pinVersion(tx, {
        module: "writing",
        contentType: "task2",
        sourceRef: "bind-writing-1",
        title: "Binding prompt",
        content: { prompt: "A synthetic binding prompt, long enough to be a real one.", taskType: "task2" },
        publicationState: "draft",
        actorUserId: ownerId,
        targetType: "writing_prompt",
        targetId: prompt!.id,
      }),
    );
    await published(actor, grammarVersion.version.id, db);
    await published(actor, writingVersion.version.id, db);

    assert.equal((await revisionForGrammarTopic(topic!.id, db))!.id, grammarVersion.version.id);
    assert.equal((await revisionForWritingPrompt(prompt!.id, db))!.id, writingVersion.version.id);
    assert.equal((await publishedVersionForTarget("writing_prompt", prompt!.id, db))!.id, writingVersion.version.id);
    assert.equal(await publishedVersionForTarget("writing_prompt", topic!.id, db), null, "a target of the wrong type resolves to nothing");
  } finally {
    await database.close();
  }
});
