import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { contentVersions, courseModules, courses, units } from "../src/db/schema";
import { publishContentVersion, saveContentDraft, type AuthoringActor } from "../src/lib/content/authoring";
import { loadLessonForLearner, saveLessonStructure } from "../src/lib/content/lessons";
import { previewContentVersion, previewInventory, previewLatestRevision } from "../src/lib/content/preview";
import { saveTopicPack } from "../src/lib/content/vocabulary-packs";
import { createTestDatabase } from "./support/pglite";

/**
 * NATIVE PREVIEW (§Z).
 *
 * The claims that make a preview safe to build:
 *   • every authorable type has a preview, and the inventory is computed from the
 *     registry rather than hand-maintained;
 *   • a DRAFT previews — that is the point — while the learner read still refuses it;
 *   • the preview identifies the exact revision and hands back the canonical content
 *     unchanged;
 *   • an optional region that cannot be resolved marks itself and the rest stands;
 *   • executable content is reported, never executed or handed over as HTML;
 *   • answer keys are shown, and the response says so explicitly.
 */

const owner: AuthoringActor = { id: "", role: "owner", mayPublish: true };

const read = (path: string) => readFileSync(path, "utf8");

async function staff(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  const [row] = await database.query<{ id: string }>(`insert into users (name, role) values ('Preview owner', 'owner') returning id`);
  return row!.id;
}

/** A course → module → unit chain, because a lesson must belong to structure. */
async function structure(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  const { db } = database;
  const [course] = await db.insert(courses).values({ slug: `preview-course-${Math.random().toString(36).slice(2, 8)}`, title: "Preview course" }).returning({ id: courses.id });
  const [module] = await db.insert(courseModules).values({ courseId: course!.id, slug: "m1", title: "Module 1", order: 1 }).returning({ id: courseModules.id });
  const [unit] = await db.insert(units).values({ moduleId: module!.id, slug: "u1", title: "Unit 1", order: 1 }).returning({ id: units.id });
  return unit!.id;
}

test("PV1 every authorable content type has a native preview, computed from the registry", () => {
  const inventory = previewInventory();
  assert.ok(inventory.length >= 16, `expected the registry to be listed, saw ${inventory.length}`);
  const missing = inventory.filter((item) => item.status === "MISSING");
  assert.deepEqual(missing.map((item) => `${item.module}:${item.contentType}`), [], "no authorable type is left without a preview");
  for (const item of inventory) assert.ok(item.requiredParts.length > 0, `${item.module}:${item.contentType} declares its core regions`);

  // The route that exposes it is staff-only, and the preview is not publication-gated.
  const route = read("src/app/api/admin/content/versions/[id]/preview/route.ts");
  assert.match(route, /isStaff\(user\.role\)/);
  assert.match(route, /status: 403/);
  assert.doesNotMatch(route, /published/, "a preview never requires publication");
});

test("PV2 a draft previews, identifies its exact revision, and the learner read still refuses it", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const actor = { ...owner, id: await staff(database) };

    const unitId = await structure(database);
    const saved = await db.transaction((tx) =>
      saveLessonStructure(tx, {
        actor,
        unitId,
        slug: "preview-me",
        title: "Preview me",
        learningArea: "listening",
        sourceRef: "preview-lesson-1",
        blocks: [{ type: "text", text: "A lesson body that a learner would read." }],
      }),
    );
    assert.equal(saved.ok, true, JSON.stringify(saved.ok ? {} : saved.issues));
    if (!saved.ok) return;
    const versionId = saved.version.id;

    const preview = await previewContentVersion(versionId, db);
    assert.ok(preview, "the draft previews");
    assert.equal(preview!.identity.versionId, versionId);
    assert.equal(preview!.identity.publicationState, "draft");
    assert.equal(preview!.identity.versionIdentity, `lesson:lesson:preview-lesson-1@v${preview!.identity.versionNo}`);
    const canonical = preview!.canonical as { blocks: { type: string; text: string | null }[] };
    assert.equal(canonical.blocks.length, 1, "the canonical snapshot is handed back unchanged");
    assert.equal(canonical.blocks[0]!.type, "text");
    assert.equal(canonical.blocks[0]!.text, "A lesson body that a learner would read.");
    assert.equal(preview!.status, "PREVIEW_READY");
    assert.equal(preview!.answerKeyVisible, true);

    // The same draft is invisible to the learner read path: preview is not a side door.
    assert.equal(await loadLessonForLearner(saved.lessonId, actor.id, db as never), null, "a draft lesson stays unreadable to a learner");
  } finally {
    await database.close();
  }
});

test("PV3 an optional region fails locally, and a broken core region is reported as MISSING", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const actor = { ...owner, id: await staff(database) };

    // A lesson whose content reference points at content that does not exist: the block
    // list still previews, and only that block is marked.
    const draft = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "writing",
        contentType: "task2",
        sourceRef: "preview-task-1",
        title: "Preview task",
        payload: { taskType: "task2", category: "education", prompt: "A prompt long enough to be real.", targetWordCount: 250 },
      }),
    );
    assert.equal(draft.ok, true);
    if (!draft.ok) return;

    const good = await previewContentVersion(draft.version.id, db);
    assert.equal(good!.status, "PREVIEW_READY");
    assert.deepEqual(good!.problems, []);
    assert.equal((good!.parts.find((part) => part.key === "prompt")!.value as string).length > 10, true, "the prompt is the canonical prompt");

    // A version whose snapshot is empty is MISSING core content, not a tidy empty preview.
    const [empty] = await db
      .insert(contentVersions)
      .values({
        module: "writing",
        contentType: "task2",
        sourceRef: "preview-empty-1",
        versionNo: 1,
        status: "draft",
        title: "Empty",
        track: "academic",
        contentHash: "2".repeat(64),
        semanticHash: "2".repeat(64),
        answerKeyHash: "2".repeat(64),
        publicationState: "draft",
      })
      .returning({ id: contentVersions.id });
    const missing = await previewContentVersion(empty!.id, db);
    assert.equal(missing!.status, "MISSING");
    assert.ok(missing!.problems.includes("content_snapshot_missing"), missing!.problems.join(","));
  } finally {
    await database.close();
  }
});

test("PV4 executable material is reported, never executed or handed over as HTML", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const [row] = await db
      .insert(contentVersions)
      .values({
        module: "listening",
        contentType: "full_test",
        sourceRef: "preview-legacy-runtime",
        versionNo: 1,
        status: "published",
        title: "Legacy runtime",
        track: "academic",
        contentHash: "3".repeat(64),
        semanticHash: "3".repeat(64),
        answerKeyHash: "3".repeat(64),
        publicationState: "published",
        contentSnapshot: { authoredRuntime: { entryPath: "index.html", files: { "index.html": "<script>alert(1)</script>" } }, questions: [] },
      })
      .returning({ id: contentVersions.id });

    const preview = await previewContentVersion(row!.id, db);
    // Executable material cannot be previewed here at all — and it is WITHHELD, not
    // echoed: the honest answer is MISSING, with the reason named.
    assert.equal(preview!.status, "MISSING");
    assert.equal(preview!.canonical, null, "the authored runtime is redacted from the response");
    assert.ok(preview!.problems.includes("executable_content_not_previewable"), preview!.problems.join(","));
    assert.deepEqual(preview!.problems.filter((problem) => problem.startsWith("executable_runtime")).length, 1, preview!.problems.join(","));
    assert.equal(preview!.parts[0]!.key, "executable_runtime");

    const serialized = JSON.stringify(preview);
    assert.doesNotMatch(serialized, /alert\(1\)/, "no authored HTML travels through the preview");
    assert.doesNotMatch(serialized, /<script/, "and no script tag either");
    assert.doesNotMatch(serialized, /index\.html/, "nor the runtime's own file list");
  } finally {
    await database.close();
  }
});

test("PV5 references resolve per block, and a published one shows the revision it would open", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const actor = { ...owner, id: await staff(database) };

    const referenced = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "writing",
        contentType: "task2",
        sourceRef: "preview-reference-target",
        title: "Referenced task",
        payload: { taskType: "task2", category: "education", prompt: "A referenced prompt, long enough to be real.", targetWordCount: 250 },
      }),
    );
    assert.equal(referenced.ok, true);
    if (!referenced.ok) return;
    await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: referenced.version.id, to: "published" }));

    const unitId = await structure(database);
    const savedLesson = await db.transaction((tx) =>
      saveLessonStructure(tx, {
        actor,
        unitId,
        slug: "preview-refs",
        title: "Refs",
        learningArea: "listening",
        sourceRef: "preview-refs",
        blocks: [
          { type: "content_reference", ref: { module: "writing", contentType: "task2", sourceRef: "preview-reference-target" } },
          { type: "content_reference", ref: { module: "writing", contentType: "task2", sourceRef: "preview-reference-missing" } },
          { type: "text", text: "Still here." },
        ],
      }),
    );
    assert.equal(savedLesson.ok, true, JSON.stringify(savedLesson.ok ? {} : savedLesson.issues));
    if (!savedLesson.ok) return;

    const preview = await previewContentVersion(savedLesson.version.id, db);
    const blocks = preview!.parts.find((part) => part.key === "blocks")!.value as { resolved?: { versionId?: string; unavailable?: boolean } }[];
    assert.equal(blocks[0]!.resolved!.versionId, referenced.version.id, "the published reference names the revision it would open");
    assert.equal(blocks[1]!.resolved!.unavailable, true, "a missing reference is marked on that block only");
    assert.ok(preview!.parts.find((part) => part.key === "blocks"), "the block list still previews");

    // And the newest-revision entry point agrees with the explicit one.
    const latest = await previewLatestRevision("lesson", "lesson", "preview-refs", db);
    assert.equal(latest!.identity.versionId, preview!.identity.versionId);
  } finally {
    await database.close();
  }
});

test("PV6 a media lesson previews its reference and a vocabulary pack previews canonical senses", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const actor = { ...owner, id: await staff(database) };

    // Vocabulary: the preview shows the canonical senses the version holds, not a
    // pack-local copy.
    const pack = await db.transaction((tx) =>
      saveTopicPack(tx, {
        actorUserId: actor.id,
        sourceRef: "preview-pack-1",
        slug: "preview-pack",
        labelEn: "Preview pack",
        words: [{ term: "resilient", partOfSpeech: "adjective", definitionEn: "able to recover quickly", translationUz: "bardoshli", example: "She stayed resilient." }],
      }),
    );
    assert.equal(pack.ok, true);
    if (!pack.ok) return;
    const packPreview = await previewContentVersion(pack.versionId, db);
    assert.equal(packPreview!.status, "PREVIEW_READY");
    const words = packPreview!.parts.find((part) => part.key === "words")!.value as { term: string }[];
    assert.equal(words[0]!.term, "resilient");

    // A media lesson revision: the preview names the media reference and the questions,
    // and never a signed URL or an object body.
    const [mediaVersion] = await db
      .insert(contentVersions)
      .values({
        module: "ted",
        contentType: "video_lesson",
        sourceRef: "preview-talk-1",
        versionNo: 1,
        status: "draft",
        title: "Preview talk",
        track: "unspecified",
        contentHash: "4".repeat(64),
        semanticHash: "4".repeat(64),
        answerKeyHash: "4".repeat(64),
        publicationState: "draft",
        targetType: "video_lesson",
        targetId: null,
        contentSnapshot: {
          media: { provider: "youtube", mediaKind: "video" },
          notes: "Centre notes.",
          questions: [{ stage: "comprehension", prompt: "What is the talk about?" }],
        },
      })
      .returning({ id: contentVersions.id });

    const mediaPreview = await previewContentVersion(mediaVersion!.id, db);
    assert.equal(mediaPreview!.status, "PREVIEW_READY");
    assert.equal(mediaPreview!.parts.find((part) => part.key === "media")!.problem, undefined);
    assert.doesNotMatch(JSON.stringify(mediaPreview), /https:\/\/www\.youtube\.com/, "the preview names the provider, never a URL to fetch");
  } finally {
    await database.close();
  }
});
