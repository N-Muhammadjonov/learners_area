import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { contentVersions, grammarTopics, users } from "../src/db/schema";
import { publishContentVersion, saveContentDraft, type AuthoringActor } from "../src/lib/content/authoring";
import { revisionForGrammarTopic } from "../src/lib/content/attempt-binding";
import { getTopicWithExercises, listTopics } from "../src/lib/data/grammar";

/**
 * Grammar publication on the real database (§41, §71, §72).
 *
 * The claim: an authored Grammar topic is invisible to learners while it is a draft,
 * becomes readable exactly when it is published, and stops being readable when it is
 * archived — and the revision a learner's attempt records is the revision that made it
 * readable. The three questions are asked of the REAL learner readers (`listTopics`,
 * `getTopicWithExercises`) against the same rows the authoring service wrote, which is
 * the part a pglite fixture cannot answer honestly.
 *
 * Runs only in the isolated QA2 database: `QA2_DATABASE_TESTS=1`.
 */

const enabled = process.env.QA2_DATABASE_TESTS === "1";

test("Grammar learner reads follow publication, and the attempt binds the revision that opened it", { skip: !enabled }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2", "isolated QA2 database only");

  const ownerId = randomUUID();
  const learnerId = randomUUID();
  const sourceRef = `qa2-grammar-publication-${randomUUID().slice(0, 8)}`;
  const title = `QA2 grammar publication ${randomUUID().slice(0, 8)}`;
  const actor: AuthoringActor = { id: ownerId, role: "owner", mayPublish: true };

  await db.insert(users).values([
    { id: ownerId, name: "QA2 grammar author", role: "owner", accountStatus: "active" },
    { id: learnerId, name: "QA2 grammar learner", role: "student", accountStatus: "active" },
  ]);
  try {
    const saved = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "grammar",
        contentType: "topic",
        sourceRef,
        title,
        payload: {
          title,
          explanation: "A synthetic explanation written for this test, long enough to pass the authoring schema.",
          skillArea: "writing",
          exercises: [{ promptText: "She ___ to work every day.", options: ["go", "goes"], correctOption: "goes", explanation: "Third person singular." }],
        },
      }),
    );
    assert.equal(saved.ok, true, JSON.stringify(saved.ok ? {} : saved.issues));
    if (!saved.ok) return;
    const topicId = saved.version.targetId!;

    // A draft is a real row and a real revision, and it is invisible.
    assert.equal((await db.select().from(grammarTopics).where(eq(grammarTopics.id, topicId))).length, 1, "the draft row exists");
    assert.ok(!(await listTopics()).some((topic) => topic.id === topicId), "a draft topic is not in the learner's list");
    assert.equal(await getTopicWithExercises(topicId, learnerId), null, "and its page does not open");
    assert.equal(await revisionForGrammarTopic(topicId), null, "a draft is never the revision an attempt binds");

    // Publishing moves the row and the revision together.
    const published = await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: saved.version.id, to: "published" }));
    assert.equal(published.ok, true, JSON.stringify(published.ok ? {} : published.issues));
    assert.ok((await listTopics()).some((topic) => topic.id === topicId), "a published topic is in the list");
    const detail = await getTopicWithExercises(topicId, learnerId);
    assert.ok(detail, "a published topic opens");
    assert.equal(detail!.exercises.length, 1, "with the exercises the author wrote");
    assert.equal((await revisionForGrammarTopic(topicId))!.id, saved.version.id, "and the attempt would bind exactly this revision");

    // Archiving withdraws it: no list entry, no page, and new attempts bind nothing.
    const archived = await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: saved.version.id, to: "archived" }));
    assert.equal(archived.ok, true);
    assert.ok(!(await listTopics()).some((topic) => topic.id === topicId), "an archived topic leaves the list");
    assert.equal(await getTopicWithExercises(topicId, learnerId), null, "and its page stops opening");
    assert.equal(await revisionForGrammarTopic(topicId), null, "a learner starting now is not bound to the withdrawn revision");
  } finally {
    await db.delete(contentVersions).where(eq(contentVersions.sourceRef, sourceRef));
    const topics = await db.select({ id: grammarTopics.id }).from(grammarTopics).where(eq(grammarTopics.sourceRef, sourceRef));
    if (topics.length) await db.delete(grammarTopics).where(inArray(grammarTopics.id, topics.map((row) => row.id)));
    await db.delete(users).where(inArray(users.id, [ownerId, learnerId]));
  }
});
