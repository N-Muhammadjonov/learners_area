import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { contentVersions, grammarTopics, listeningQuestions, listeningTests, readingPassages, readingQuestions, speakingPrompts, writingPrompts } from "../src/db/schema";
import { canAuthor, listRegisteredAuthors, registerModuleAuthors, resolveModuleAuthor } from "../src/lib/content/authors";
import { versionContent } from "../src/lib/content/versions";
import { activateDueVersions, listContentItems, publishContentVersion, saveContentDraft, slugSourceRef, versionsOf, type AuthoringActor } from "../src/lib/content/authoring";
import { createTestDatabase } from "./support/pglite";

/**
 * Authoring and publication (§34, §35, §41, §43, §44).
 *
 * The claims that make "create content without deploying anything" safe:
 *   • a draft is a real row AND a real version, and it is invisible to students;
 *   • an invalid payload or an unknown question type writes NOTHING;
 *   • publishing is a role-gated decision that moves the content row with it;
 *   • revising a published item creates a new version instead of rewriting it;
 *   • archiving withdraws content without deleting questions or answer keys.
 */

const owner: AuthoringActor = { id: "", role: "owner", mayPublish: true };

function student(): AuthoringActor {
  return { id: "", role: "student", mayPublish: false };
}

async function staff(db: Awaited<ReturnType<typeof createTestDatabase>>["query"], role = "owner") {
  const rows = await db<{ id: string }>(`insert into users (name, role) values ($1, $2) returning id`, [`Author ${role}`, role]);
  return rows[0]!.id;
}

const listeningPayload = (questionOverrides: Record<string, unknown> = {}) => ({
  audioType: "audio",
  questions: [
    {
      type: "multiple_choice",
      questionText: "What does the speaker recommend?",
      options: ["A", "B", "C"],
      correctAnswer: "B",
      explanation: "The speaker says B explicitly.",
      keywords: "recommend",
      ...questionOverrides,
    },
  ],
});

test("AU1 an authoring capability is declared per content type, and only where an author exists", () => {
  registerModuleAuthors();
  assert.equal(canAuthor("listening", "full_test"), true);
  assert.equal(canAuthor("reading", "general_set"), true);
  assert.equal(canAuthor("writing", "task2"), true);
  assert.equal(canAuthor("speaking", "cue_card"), true);
  assert.equal(canAuthor("grammar", "topic"), true);
  assert.equal(canAuthor("reading", "full_test"), false, "no author, no silent empty form");
  assert.equal(canAuthor("ted", "video_lesson"), false, "media lessons are authored through the TED/Podcast surface, not here");
  assert.equal(canAuthor("vocabulary", "topic_pack"), true, "a vocabulary pack is canonical content (§31)");
  assert.equal(canAuthor("lesson", "lesson"), true);
  assert.ok(listRegisteredAuthors().length >= 10);
});

test("AU2 a source reference is a stable slug, and a title-shaped one is refused", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const actorId = await staff(query);
    const actor = { ...owner, id: actorId };
    assert.equal(slugSourceRef("IELTS Book 18 Test 1 Listening"), "ielts-book-18-test-1-listening");

    const refused = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "listening",
        contentType: "full_test",
        sourceRef: "IELTS Book 18!",
        title: "Unstable identity",
        payload: listeningPayload(),
      }),
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.ok(refused.issues.some((issue) => issue.code === "unstable_source_ref"));
  } finally {
    await database.close();
  }
});

test("AU3 creating a listening test from scratch writes the rows AND the draft revision, invisible to students", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const actorId = await staff(query);
    const actor = { ...owner, id: actorId };

    const saved = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "listening",
        contentType: "full_test",
        sourceRef: "authored-listening-1",
        title: "Authored Listening 1",
        track: "academic",
        payload: listeningPayload(),
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.created, true);
    assert.equal(saved.version.versionNo, 1);
    assert.equal(saved.version.publicationState, "draft", "an authored item never starts published");
    assert.equal(saved.version.targetType, "listening_test");

    const tests = await query<{ id: string; publication_state: string; source_ref: string }>(
      `select id, publication_state, source_ref from listening_tests where source_ref = 'authored-listening-1'`,
    );
    assert.equal(tests.length, 1);
    assert.equal(tests[0]!.publication_state, "draft");
    const questions = await db.select().from(listeningQuestions).where(eq(listeningQuestions.testId, tests[0]!.id));
    assert.equal(questions.length, 1);
    assert.equal(questions[0]!.typeCode, "mcq_single", "the canonical type id is recorded (the alias `multiple_choice` resolves to it)");
    assert.equal(questions[0]!.type, "multiple_choice");
    assert.equal(questions[0]!.keywords, "recommend");
  } finally {
    await database.close();
  }
});

test("AU4 an unknown question type is refused before anything is written", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const actor = { ...owner, id: await staff(query) };

    const refused = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "listening",
        contentType: "full_test",
        sourceRef: "authored-listening-bad-type",
        title: "Bad type",
        payload: listeningPayload({ type: "match_the_unicorn" }),
      }),
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.ok(refused.issues.some((issue) => issue.code === "invalid_payload"));
    assert.equal((await query<{ count: string }>(`select count(*)::text as count from listening_tests`))[0]!.count, "0", "no partial write");
    assert.equal((await query<{ count: string }>(`select count(*)::text as count from content_versions`))[0]!.count, "0");
  } finally {
    await database.close();
  }
});

test("AU5 a reading set is authored with real passages, canonical reading types and 40 questions", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const actor = { ...owner, id: await staff(query) };
    const questions = Array.from({ length: 40 }, (_, index) => ({
      typeCode: index % 2 === 0 ? "true_false_not_given" : "short_answer",
      questionText: `Question ${index + 1}`,
      correctAnswer: index % 2 === 0 ? "true" : `answer ${index + 1}`,
      explanation: "Synthetic.",
    }));

    const saved = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "reading",
        contentType: "general_set",
        sourceRef: "authored-reading-1",
        title: "Authored Reading 1",
        track: "academic",
        payload: {
          difficultyLevel: "B2",
          suggestedMinutes: 60,
          passages: [
            { title: "Passage A", bodyText: "Synthetic body text for the authored reading set, long enough to pass validation.", questions: questions.slice(0, 20) },
            { title: "Passage B", bodyText: "A second synthetic passage body, also long enough to pass validation checks.", questions: questions.slice(20) },
          ],
        },
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    const passages = await db.select().from(readingPassages).where(eq(readingPassages.sourceRef, "authored-reading-1"));
    assert.equal(passages.length, 2, "both passages of the set share the set's source ref");
    assert.deepEqual(passages.map((passage) => passage.passageNo).sort(), [1, 2]);
    const rows = await query<{ type: string; type_code: string | null }>(
      `select type, type_code from reading_questions where passage_id = any($1::uuid[])`,
      [passages.map((passage) => passage.id)],
    );
    assert.equal(rows.length, 40);
    assert.deepEqual([...new Set(rows.map((row) => row.type))].sort(), ["short_answer", "true_false_not_given"]);
    assert.ok(rows.every((row) => row.type_code !== null));
  } finally {
    await database.close();
  }
});

test("AU6 writing, speaking and grammar authoring all land as drafts", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const actor = { ...owner, id: await staff(query) };

    const writing = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "writing",
        contentType: "task2",
        sourceRef: "authored-writing-t2-1",
        title: "Authored Task 2",
        payload: { taskType: "task2", category: "education", prompt: "Some people believe synthetic tests are enough. Discuss.", targetWordCount: 250 },
      }),
    );
    assert.equal(writing.ok, true);
    const writingRows = await db.select().from(writingPrompts).where(eq(writingPrompts.sourceRef, "authored-writing-t2-1"));
    assert.equal(writingRows.length, 1);
    assert.equal(writingRows[0]!.publicationState, "draft");

    const speaking = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "speaking",
        contentType: "cue_card",
        sourceRef: "authored-speaking-p2",
        title: "Authored Cue Card",
        payload: { part: "part2", category: "part2", promptText: "Describe a synthetic object.", cueCard: "You should say…", prepSeconds: 60, answerSeconds: 120, followUps: ["Why?"] },
      }),
    );
    assert.equal(speaking.ok, true);
    const speakingRows = await db.select().from(speakingPrompts).where(eq(speakingPrompts.part, "part2"));
    assert.equal(speakingRows.length, 1);
    assert.deepEqual(speakingRows[0]!.followUps, ["Why?"]);

    const grammar = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "grammar",
        contentType: "topic",
        sourceRef: "authored-grammar-1",
        title: "Authored Grammar",
        payload: {
          title: "Present perfect",
          explanation: "Use it for unfinished time.",
          skillArea: "writing",
          exercises: [{ promptText: "She ___ gone.", options: ["has", "have"], correctOption: "has", explanation: "Third person singular." }],
        },
      }),
    );
    assert.equal(grammar.ok, true);
    if (!grammar.ok) return;
    const topic = await db.select().from(grammarTopics).where(eq(grammarTopics.sourceRef, "authored-grammar-1"));
    assert.equal(topic.length, 1);
    assert.equal(topic[0]!.publicationState, "draft", "an authored grammar topic is not live before publication");
  } finally {
    await database.close();
  }
});

test("AU7 publishing is role-gated, and only a published revision is startable content", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const actor = { ...owner, id: await staff(query) };
    const saved = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "listening",
        contentType: "full_test",
        sourceRef: "publish-listening-1",
        title: "Publish me",
        track: "academic",
        payload: listeningPayload(),
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    const refused = await db.transaction((tx) => publishContentVersion(tx, { actor: student(), versionId: saved.version.id, to: "published" }));
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.ok(refused.issues.some((issue) => issue.code === "publish_forbidden"));
    assert.equal(
      (await query<{ publication_state: string }>(`select publication_state from content_versions where id = $1`, [saved.version.id]))[0]!.publication_state,
      "draft",
      "a refused publish changed nothing",
    );

    const published = await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: saved.version.id, to: "published" }));
    assert.equal(published.ok, true);
    if (!published.ok) return;
    assert.equal(published.state, "published");
    const row = await query<{ publication_state: string; status: string; published_at: Date | null }>(
      `select publication_state, status, published_at from content_versions where id = $1`,
      [saved.version.id],
    );
    assert.equal(row[0]!.publication_state, "published");
    assert.equal(row[0]!.status, "published");
    assert.ok(row[0]!.published_at);
    const testRow = await query<{ publication_state: string }>(`select publication_state from listening_tests where id = $1`, [saved.version.targetId]);
    assert.equal(testRow[0]!.publication_state, "published", "the content row a student query reads is live too");
  } finally {
    await database.close();
  }
});

test("AU8 revising a published item creates a new version; the published one is untouched", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const actor = { ...owner, id: await staff(query) };
    const saved = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "writing",
        contentType: "task2",
        sourceRef: "revise-writing-1",
        title: "Revise me",
        payload: { taskType: "task2", category: "education", prompt: "Original prompt.", targetWordCount: 250 },
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const published = await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: saved.version.id, to: "published" }));
    assert.equal(published.ok, true);

    // Rewriting the published revision itself is refused…
    const rewrite = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "writing",
        contentType: "task2",
        sourceRef: "revise-writing-1",
        title: "Revise me",
        versionId: saved.version.id,
        payload: { taskType: "task2", category: "education", prompt: "Rewritten prompt.", targetWordCount: 250 },
      }),
    );
    assert.equal(rewrite.ok, false);
    if (!rewrite.ok) assert.ok(rewrite.issues.some((issue) => issue.code === "published_is_immutable"));

    // …while authoring the same item again produces version 2.
    const revised = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "writing",
        contentType: "task2",
        sourceRef: "revise-writing-1",
        title: "Revise me",
        payload: { taskType: "task2", category: "education", prompt: "A truly new prompt.", targetWordCount: 250 },
      }),
    );
    assert.equal(revised.ok, true);
    if (!revised.ok) return;
    assert.equal(revised.version.versionNo, 2);
    const rows = await versionsOf("writing", "task2", "revise-writing-1", db);
    assert.equal(rows.length, 2, "history is kept, not overwritten");
    assert.equal(rows.find((row) => row.versionNo === 1)!.status, "superseded");
    assert.equal(rows.find((row) => row.versionNo === 2)!.publicationState, "draft");
    const items = await listContentItems({ module: "writing" }, db);
    assert.equal(items.filter((item) => item.sourceRef === "revise-writing-1").length, 1, "one ROW per content item");
    assert.equal(items.find((item) => item.sourceRef === "revise-writing-1")!.versions, 2);
  } finally {
    await database.close();
  }
});

test("AU9 scheduling needs a moment, and a due schedule opens through the shared transition table", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const actor = { ...owner, id: await staff(query) };
    const saved = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "listening",
        contentType: "full_test",
        sourceRef: "schedule-listening-1",
        title: "Scheduled",
        payload: listeningPayload(),
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    const noMoment = await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: saved.version.id, to: "scheduled" }));
    assert.equal(noMoment.ok, false);
    if (!noMoment.ok) assert.ok(noMoment.issues.some((issue) => issue.code === "missing_publish_at"));

    const opening = new Date("2026-05-01T09:00:00Z");
    const scheduled = await db.transaction((tx) =>
      publishContentVersion(tx, { actor, versionId: saved.version.id, to: "scheduled", publishAt: opening }),
    );
    assert.equal(scheduled.ok, true);
    const row = await query<{ publication_state: string; publish_at: Date | null }>(
      `select publication_state, publish_at from listening_tests where id = $1`,
      [saved.version.targetId],
    );
    assert.equal(row[0]!.publication_state, "scheduled");
    assert.ok(row[0]!.publish_at);

    // Not due yet: the dispatcher opens nothing.
    const early = await db.transaction((tx) => activateDueVersions(tx, new Date("2026-04-30T09:00:00Z")));
    assert.equal(early.length, 0);

    // Due: the revision opens, and both the row and the version say published.
    const late = await db.transaction((tx) => activateDueVersions(tx, new Date("2026-05-01T09:00:01Z")));
    assert.equal(late.length, 1);
    assert.equal(
      (await query<{ publication_state: string }>(`select publication_state from listening_tests where id = $1`, [saved.version.targetId]))[0]!.publication_state,
      "published",
    );
    assert.equal(
      (await query<{ publication_state: string }>(`select publication_state from content_versions where id = $1`, [saved.version.id]))[0]!.publication_state,
      "published",
    );
  } finally {
    await database.close();
  }
});

test("AU10 a content type that cannot hold a moment cannot be scheduled, and archiving never deletes", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const actor = { ...owner, id: await staff(query) };
    const saved = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "grammar",
        contentType: "topic",
        sourceRef: "grammar-archive-1",
        title: "Grammar to archive",
        payload: {
          title: "Articles",
          explanation: "a / an / the",
          skillArea: "writing",
          exercises: [{ promptText: "___ apple", options: ["a", "an"], correctOption: "an", explanation: "Vowel sound." }],
        },
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    const unsupported = await db.transaction((tx) =>
      publishContentVersion(tx, { actor, versionId: saved.version.id, to: "scheduled", publishAt: new Date("2026-06-01T00:00:00Z") }),
    );
    assert.equal(unsupported.ok, false);
    if (!unsupported.ok) assert.ok(unsupported.issues.some((issue) => issue.code === "scheduling_unsupported"));

    const published = await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: saved.version.id, to: "published" }));
    assert.equal(published.ok, true);

    const archived = await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: saved.version.id, to: "archived" }));
    assert.equal(archived.ok, true);
    if (!archived.ok) return;
    assert.equal(archived.version.status, "archived");

    // Nothing deleted: the topic, its exercises and the revision are all still there.
    const topic = await db.select().from(grammarTopics).where(eq(grammarTopics.sourceRef, "grammar-archive-1"));
    assert.equal(topic.length, 1);
    assert.equal(topic[0]!.publicationState, "archived");
    assert.equal(
      (await query<{ count: string }>(`select count(*)::text as count from grammar_exercises where topic_id = $1`, [saved.version.targetId]))[0]!.count,
      "1",
    );
    assert.equal((await db.select().from(contentVersions).where(eq(contentVersions.id, saved.version.id))).length, 1);

    // A direct restore from the archive is a deliberate transition the shared CMS
    // table allows, and it brings the content row back live with it.
    const back = await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: saved.version.id, to: "published" }));
    assert.equal(back.ok, true);
    assert.equal(
      (await query<{ publication_state: string }>(`select publication_state from grammar_topics where id = $1`, [saved.version.targetId]))[0]!.publication_state,
      "published",
    );
  } finally {
    await database.close();
  }
});

test("AU11 a content item is one row across revisions, and every revision keeps its identity", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const actor = { ...owner, id: await staff(query) };
    const first = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "speaking",
        contentType: "part1_question",
        sourceRef: "identity-speaking-1",
        title: "Identity",
        payload: { part: "part1", category: "part1", promptText: "Where do you live?" },
      }),
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "speaking",
        contentType: "part1_question",
        sourceRef: "identity-speaking-1",
        title: "Identity",
        payload: { part: "part1", category: "part1", promptText: "Where do you live now?" },
      }),
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.version.versionNo, 2);
    assert.equal((await versionsOf("speaking", "part1_question", "identity-speaking-1", db)).length, 2);
    // Only the second version's row is the current one: the identity index is per version.
    const rows = await query<{ version_no: number; source_ref: string }>(`select version_no, source_ref from content_versions order by version_no`);
    assert.deepEqual(rows.map((row) => row.version_no), [1, 2]);
    assert.ok(rows.every((row) => row.source_ref === "identity-speaking-1"));
  } finally {
    await database.close();
  }
});

test("AU12 a published revision stays readable after the content row moves on", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const actor = { ...owner, id: await staff(query) };
    const v1 = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "listening",
        contentType: "full_test",
        sourceRef: "snapshot-listening-1",
        title: "Snapshot 1",
        track: "academic",
        payload: listeningPayload(),
      }),
    );
    assert.equal(v1.ok, true);
    if (!v1.ok) return;
    await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: v1.version.id, to: "published" }));

    // The item moves on: same source ref, a different answer key.
    const v2 = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "listening",
        contentType: "full_test",
        sourceRef: "snapshot-listening-1",
        title: "Snapshot 2",
        track: "academic",
        payload: listeningPayload({ correctAnswer: "C" }),
      }),
    );
    assert.equal(v2.ok, true);
    if (!v2.ok) return;
    assert.equal(v2.version.versionNo, 2);

    // The pinned revision still returns WHAT WAS SAT, not the current row.
    const snapshot = (await versionContent(v1.version.id, db)) as { questions: { correctAnswer: string }[] } | null;
    assert.ok(snapshot);
    assert.equal(snapshot!.questions[0]!.correctAnswer, "B");
    const current = (await versionContent(v2.version.id, db)) as { questions: { correctAnswer: string }[] } | null;
    assert.equal(current!.questions[0]!.correctAnswer, "C");
    assert.equal(v2.version.answerKeyHash === v1.version.answerKeyHash, false, "the answer-key hash says a key changed");
    // One row per item, still: the second revision updated the same test.
    assert.equal((await db.select().from(listeningTests).where(eq(listeningTests.sourceRef, "snapshot-listening-1"))).length, 1);
  } finally {
    await database.close();
  }
});
