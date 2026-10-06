import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { contentVersions, lexemes, lexicalOccurrences, videoLessons } from "../src/db/schema";
import { createVideoLesson } from "../src/lib/data/video-lessons";
import { MODULE_DESCRIPTORS, referenceProblems } from "../src/lib/content/taxonomy";
import { versionContent, versionsForContent } from "./support/version-helpers";
import { createTestDatabase } from "./support/pglite";

/**
 * Media lessons — TED and Podcast as canonical content (§27, §28, §29).
 *
 * The claims:
 *   • a Podcast episode is an AUDIO lesson, not a video with a missing picture;
 *   • the item gets stable identity and a revision, like every other content type;
 *   • re-authoring the same item revises it instead of creating a copy, and a
 *     published revision stays readable afterwards;
 *   • its vocabulary resolves through the SHARED lexical system (lexemes +
 *     occurrences) and never through a module-specific duplicate store;
 *   • a lesson block can reference it by name.
 */

async function actorId(db: Awaited<ReturnType<typeof createTestDatabase>>["query"]): Promise<string> {
  const [row] = await db<{ id: string }>(`insert into users (name, role) values ('Media owner', 'owner') returning id`);
  return row!.id;
}

test("MV1 a Podcast episode is authored as an audio lesson, a TED talk as a video lesson", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const owner = await actorId(query);

    const audio = await createVideoLesson(
      { title: "Synthetic podcast episode", videoUrl: "https://youtu.be/aaaaaaaaaaa", mediaKind: "audio", durationSeconds: 900 },
      owner,
      db,
    );
    assert.equal(audio.ok, true);
    const video = await createVideoLesson(
      { title: "Synthetic TED talk", videoUrl: "https://youtu.be/bbbbbbbbbbb", durationSeconds: 600 },
      owner,
      db,
    );
    assert.equal(video.ok, true);

    const rows = await db.select().from(videoLessons).orderBy(videoLessons.mediaKind);
    assert.deepEqual(rows.map((row) => row.mediaKind).sort(), ["audio", "video"]);
    assert.equal(rows.find((row) => row.mediaKind === "audio")!.title, "Synthetic podcast episode");

    const revisions = await db.select().from(contentVersions).orderBy(contentVersions.contentType);
    assert.deepEqual(
      revisions.map((row) => row.contentType).sort(),
      ["audio_lesson", "video_lesson"],
      "each media kind records its own canonical content type",
    );
    assert.ok(revisions.every((row) => row.module === "ted"));
    assert.equal(revisions.find((row) => row.contentType === "audio_lesson")!.track, "unspecified");
  } finally {
    await database.close();
  }
});

test("MV2 media identity is stable: a renamed item bumps its revision instead of duplicating", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const owner = await actorId(query);

    const first = await createVideoLesson({ title: "Original title", videoUrl: "https://youtu.be/ccccccccccc" }, owner, db);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const [row] = await db.select().from(videoLessons);
    const sourceRef = row!.sourceRef;
    assert.ok(sourceRef, "identity is derived, not left empty");
    assert.match(sourceRef!, /^video-youtube-ccccccccccc$/);

    const renamed = await createVideoLesson(
      { videoLessonId: first.videoLessonId, title: "A much better title", videoUrl: "https://youtu.be/ccccccccccc" },
      owner,
      db,
    );
    assert.equal(renamed.ok, true);
    const rows = await db.select().from(videoLessons);
    assert.equal(rows.length, 1, "still one row for one item");
    assert.equal(rows[0]!.sourceRef, sourceRef, "the identity did not move with the title");

    // A rename is METADATA: same revision, updated title, one version number.
    let revisions = await db.select().from(contentVersions).where(eq(contentVersions.sourceRef, sourceRef!)).orderBy(contentVersions.versionNo);
    assert.equal(revisions.length, 1, "a title change does not invent a revision");
    assert.equal(revisions[0]!.title, "A much better title");

    // Changing what the learner actually gets (the notes) IS a new revision.
    const withNotes = await createVideoLesson(
      { videoLessonId: first.videoLessonId, title: "A much better title", videoUrl: "https://youtu.be/ccccccccccc", notes: "New study notes." },
      owner,
      db,
    );
    assert.equal(withNotes.ok, true);
    revisions = await db.select().from(contentVersions).where(eq(contentVersions.sourceRef, sourceRef!)).orderBy(contentVersions.versionNo);
    assert.equal(revisions.length, 2, "a content change is a new revision, not a rewrite");
    assert.equal(revisions[0]!.versionNo, 1);
    assert.equal(revisions[1]!.versionNo, 2);
    assert.notEqual(revisions[0]!.contentHash, revisions[1]!.contentHash);
    // Both revisions stay readable: the first one keeps what it recorded.
    assert.equal(((await versionContent(revisions[0]!.id, db)) as { notes: string | null }).notes, null);
    assert.equal(((await versionContent(revisions[1]!.id, db)) as { notes: string | null }).notes, "New study notes.");
  } finally {
    await database.close();
  }
});

test("MV3 TED/Podcast vocabulary lands in the shared lexical system, never in a module-local store", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const owner = await actorId(query);
    const body = "The speaker explains how a resilient system absorbs shocks without collapsing.";

    const created = await createVideoLesson(
      {
        title: "Synthetic vocabulary talk",
        videoUrl: "https://youtu.be/ddddddddddd",
        transcriptText: body,
        vocabulary: [{ word: "resilient", pos: "adj", def: "able to recover quickly", uz: "bardoshli", ex: "The speaker explains how a resilient system absorbs shocks without collapsing." }],
      },
      owner,
      db,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const occurrences = await db.select().from(lexicalOccurrences).where(eq(lexicalOccurrences.videoLessonId, created.videoLessonId));
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0]!.sourceType, "video", "the same lexical occurrence table every module writes to");
    assert.ok(occurrences[0]!.lexemeId, "resolved to a canonical lexeme");
    const senses = await db.select().from(lexemes).where(eq(lexemes.id, occurrences[0]!.lexemeId!));
    assert.equal(senses.length, 1);
    assert.equal(senses[0]!.term, "resilient");
  } finally {
    await database.close();
  }
});

test("MV4 a TED talk can be referenced by a lesson, and the reference resolves to the recorded revision", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const owner = await actorId(query);
    const created = await createVideoLesson({ title: "Referenced talk", videoUrl: "https://youtu.be/eeeeeeeeeee", notes: "Watch for the argument structure." }, owner, db);
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const [revision] = await db
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.contentType, "video_lesson"))
      .limit(1);
    assert.equal(revision!.targetType, "video_lesson");
    assert.equal(revision!.targetId, created.videoLessonId);

    const content = (await versionContent(revision!.id, db)) as { notes: string; mediaKind: string } | null;
    assert.equal(content?.mediaKind, "video");
    assert.equal(content?.notes, "Watch for the argument structure.");

    // The taxonomy accepts the reference, which is what a lesson block checks.
    assert.deepEqual(referenceProblems({ module: "ted", contentType: "video_lesson", sourceRef: revision!.sourceRef }), []);
    assert.deepEqual(referenceProblems({ module: "ted", contentType: "audio_lesson", sourceRef: revision!.sourceRef }), []);
    const ted = MODULE_DESCRIPTORS.find((descriptor) => descriptor.module === "ted");
    assert.deepEqual(ted?.contentTypes, ["video_lesson", "audio_lesson"]);
  } finally {
    await database.close();
  }
});

test("MV5 one identity per provider video: a duplicate talk is refused, not silently created twice", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const owner = await actorId(query);
    const first = await createVideoLesson({ title: "Talk", videoUrl: "https://youtu.be/fffffffffff" }, owner, db);
    assert.equal(first.ok, true);

    const duplicate = await createVideoLesson({ title: "Talk again", videoUrl: "https://youtu.be/fffffffffff" }, owner, db);
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.reason, "video_exists");
    assert.equal((await db.select().from(videoLessons)).length, 1);

    // Reading the history back is what staff review; there must be one item.
    const history = await versionsForContent("ted", "video_lesson", (await db.select().from(videoLessons))[0]!.sourceRef!, db);
    assert.equal(history.length, 1);
  } finally {
    await database.close();
  }
});
