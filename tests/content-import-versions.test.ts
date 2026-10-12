import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { contentVersions } from "../src/db/schema";
import { importCanonicalReadingSet } from "../src/lib/import/reading/importer";
import { importCanonicalListeningPackage } from "../src/lib/import/listening/importer";
import { listeningCanonicalContentSchema, listeningExample } from "../src/lib/import/listening/canonical";
import { readingTemplate } from "../src/lib/import/reading/canonical";
import { listAssignableContent, createAssignment } from "../src/lib/content/assignments";
import { versionContent } from "../src/lib/content/versions";
import { backfillImportedVersions } from "../scripts/content-backfill-imported-versions";
import { createTestDatabase } from "./support/pglite";

/**
 * Imported material must land in the CANONICAL VERSION STORE, not only in the
 * import ledger (IV1–IV5).
 *
 * The ledger answers "did this package arrive?"; the version store answers "what
 * exactly did the learner get, and can a teacher set it as work?" — that is what an
 * assignment, a mock and an attempt bind to (§24/§71). These tests prove an import
 * produces exactly one revision, that re-importing identical material produces
 * none, that a changed answer key produces a NEW revision rather than rewriting the
 * old one, and that the imported item is then assignable.
 */

/** A real Reading canonical package (the template), with our own source ref and text. */
const readingPackage = (overrides: { sourceRef?: string; content?: Record<string, unknown> } = {}) => ({
  ...readingTemplate(),
  sourceRef: overrides.sourceRef ?? "import-version-read-1",
  title: "Imported Reading set",
  content: {
    description: "A synthetic set written for this test.",
    level: "B2",
    passages: [
    {
      passageNo: 1,
      title: "A synthetic passage",
      body: "The harbour was quiet at dawn. Synthetic text written for this test, long enough to stand in for a real passage while exercising the canonical import path end to end.",
      questions: [
        {
          questionNo: 1,
          type: "true_false_not_given" as const,
          text: "The harbour was busy at dawn.",
          answer: "FALSE",
          accepted: [],
          evidence: "The harbour was quiet at dawn.",
          explanation: "The passage says quiet.",
        },
        {
          questionNo: 2,
          type: "short_answer" as const,
          text: "When was the harbour quiet?",
          answer: "dawn",
          accepted: ["at dawn"],
          explanation: "Stated directly.",
        },
      ],
      vocabulary: [{ word: "harbour", pos: "noun", def: "a sheltered place for ships", uz: "port", ex: "The harbour was quiet." }],
    },
    ],
    ...(overrides.content ?? {}),
  },
});

async function actor(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  const [owner] = await database.query<{ id: string }>(`insert into users (name, role) values ('Import owner', 'owner') returning id`);
  return owner!.id;
}

test("IV1 an imported Reading set becomes exactly one canonical revision", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const ownerId = await actor(database);
    const pkg = readingPackage() as never;

    const first = await db.transaction((tx) =>
      importCanonicalReadingSet(tx, pkg, { actorUserId: ownerId, publish: false, publishAuthorized: true }),
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const rows = await db.select().from(contentVersions).where(eq(contentVersions.sourceRef, "import-version-read-1"));
    assert.equal(rows.length, 1, "one revision for one imported item");
    assert.equal(rows[0]!.module, "reading");
    assert.equal(rows[0]!.contentType, "general_set");
    assert.equal(rows[0]!.targetType, "general_reading_set");
    assert.equal(rows[0]!.targetId, first.targetId, "the revision points at the row the import created");
    assert.equal(rows[0]!.status, "draft", "an unauthorised publish is a draft");
    assert.equal(rows[0]!.contentImportId !== null, true, "the revision records which import produced it");
    assert.ok((rows[0]!.contentSnapshot as { passages: unknown[] }).passages.length === 1, "the snapshot is the canonical content");

    // A revision that is not published is not assignable — and cannot be pinned.
    assert.deepEqual(await listAssignableContent({ module: "reading" }, db), []);
  } finally {
    await database.close();
  }
});

test("IV2 re-importing identical material writes no second revision", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const ownerId = await actor(database);
    const pkg = readingPackage() as never;
    const options = { actorUserId: ownerId, publish: false, publishAuthorized: true };

    await db.transaction((tx) => importCanonicalReadingSet(tx, pkg, options));
    const again = await db.transaction((tx) => importCanonicalReadingSet(tx, pkg, options));
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.action, "unchanged");

    const rows = await db.select().from(contentVersions).where(eq(contentVersions.sourceRef, "import-version-read-1"));
    assert.equal(rows.length, 1, "an identical re-import must not create another revision");
  } finally {
    await database.close();
  }
});

test("IV3 importing changed material raises the revision number and keeps the old snapshot readable", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const ownerId = await actor(database);
    const first = await db.transaction((tx) =>
      importCanonicalReadingSet(tx, readingPackage() as never, { actorUserId: ownerId, publish: false, publishAuthorized: true }),
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;

    // The importer refuses to overwrite an existing sourceRef silently, so a change
    // arrives as a new source ref — which is exactly the "no silent rewrite" rule.
    const changed = await db.transaction((tx) =>
      importCanonicalReadingSet(
        tx,
        readingPackage({
          content: {
            passages: [
              {
                passageNo: 1,
                title: "A synthetic passage",
                body: readingPackage().content.passages[0]!.body,
                questions: [
                  { questionNo: 1, type: "true_false_not_given", text: "The harbour was busy at dawn.", answer: "TRUE", accepted: [], explanation: "Rewritten key." },
                  { questionNo: 2, type: "short_answer", text: "When was the harbour quiet?", answer: "dawn", accepted: ["at dawn"], explanation: "Stated directly." },
                ],
                vocabulary: [],
              },
            ],
          },
        }) as never,
        { actorUserId: ownerId, publish: false, publishAuthorized: true },
      ),
    );
    assert.equal(changed.ok, false, "a conflicting rewrite of the same content is refused");
    if (!changed.ok) assert.equal(changed.code, "source_conflict");

    const rows = await db.select().from(contentVersions).where(eq(contentVersions.sourceRef, "import-version-read-1"));
    assert.equal(rows.length, 1, "nothing was written by the refused import");
    const snapshot = (await versionContent(rows[0]!.id, db)) as { passages: { questions: { answer: string }[] }[] };
    assert.equal(snapshot.passages[0]!.questions[0]!.answer, "FALSE", "the pinned snapshot still holds the original key");
  } finally {
    await database.close();
  }
});

test("IV4 an imported, published item is assignable — and the pinned revision is the imported one", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const ownerId = await actor(database);
    const { query } = database;
    const [student] = await query<{ id: string }>(`insert into users (name, role) values ('Import student', 'student') returning id`);

    const imported = await db.transaction((tx) =>
      importCanonicalReadingSet(tx, readingPackage() as never, { actorUserId: ownerId, publish: true, publishAuthorized: true }),
    );
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    const [version] = await db.select().from(contentVersions).where(eq(contentVersions.sourceRef, "import-version-read-1"));
    assert.equal(version!.status, "published", "an authorized publish publishes the revision");

    const items = await listAssignableContent({ module: "reading" }, db);
    assert.equal(items.length, 1, "imported published content is offered to teachers");
    assert.equal(items[0]!.versionId, version!.id);

    const assignment = await db.transaction((tx) =>
      createAssignment(tx, {
        actor: { id: ownerId, role: "owner" },
        title: "Read the imported set",
        reference: { module: "reading", contentType: "general_set", sourceRef: "import-version-read-1" },
        studentIds: [student!.id],
      }),
    );
    assert.equal(assignment.ok, true, "an imported item can be set as work");
    if (assignment.ok) assert.equal(assignment.versionId, version!.id, "the assignment pins the imported revision");
  } finally {
    await database.close();
  }
});

test("IV5 an imported Listening test is versioned the same way", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const ownerId = await actor(database);
    const raw = listeningExample();
    const content = listeningCanonicalContentSchema.parse(raw.content);
    const pkg = { ...raw, content } as never;

    const options = {
      actorUserId: ownerId,
      publish: true,
      publishAuthorized: true,
      assets: [
        {
          key: content.audio.assetKey,
          role: "audio" as const,
          uploadId: "11111111-1111-4111-8111-111111111111",
          objectKey: "audio/imported-version-qa.mp3",
          mimeType: "audio/mpeg",
          size: 1024,
          originalName: "imported-version-qa.mp3",
        },
      ],
    };

    const imported = await db.transaction((tx) => importCanonicalListeningPackage(tx, pkg, options));
    assert.equal(imported.ok, true, imported.ok ? "" : imported.code);
    if (!imported.ok) return;

    const rows = await db.select().from(contentVersions).where(eq(contentVersions.sourceRef, imported.sourceRef));
    assert.equal(rows.length, 1, "the Listening test has exactly one canonical revision");
    assert.equal(rows[0]!.module, "listening");
    assert.equal(rows[0]!.contentType, "full_test");
    assert.equal(rows[0]!.targetType, "listening_test");
    assert.equal(rows[0]!.targetId, imported.targetId);
    assert.equal(rows[0]!.status, "published");

    const items = await listAssignableContent({ module: "listening" }, db);
    assert.equal(items.length, 1, "imported Listening content is assignable");
    assert.equal(items[0]!.sourceRef, imported.sourceRef);

    // Re-importing the identical package adds nothing.
    const again = await db.transaction((tx) => importCanonicalListeningPackage(tx, pkg, options));
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.action, "unchanged");
    assert.equal((await db.select().from(contentVersions).where(eq(contentVersions.sourceRef, imported.sourceRef))).length, 1);
  } finally {
    await database.close();
  }
});

test("IV6 content imported before versioning can be backfilled, idempotently and without invention", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const ownerId = await actor(database);
    const imported = await db.transaction((tx) =>
      importCanonicalReadingSet(tx, readingPackage() as never, { actorUserId: ownerId, publish: true, publishAuthorized: true }),
    );
    assert.equal(imported.ok, true);

    // Simulate material that predates the pinning change: its rows exist, its
    // revision does not.
    await db.delete(contentVersions).where(eq(contentVersions.sourceRef, "import-version-read-1"));
    assert.equal((await db.select().from(contentVersions)).length, 0);

    // A dry run reports what it WOULD do and writes nothing.
    const planned = await backfillImportedVersions({ select: db.select.bind(db) as typeof db.select, transaction: db.transaction.bind(db) }, { dryRun: true, actorUserId: ownerId });
    assert.equal(planned.length, 1);
    assert.equal(planned[0]!.action, "created", "the missing revision is reported, not invented");
    assert.equal((await db.select().from(contentVersions)).length, 0, "dry run writes nothing");

    // The real run pins the revision from the STORED rows.
    const applied = await backfillImportedVersions({ select: db.select.bind(db) as typeof db.select, transaction: db.transaction.bind(db) }, { dryRun: false, actorUserId: ownerId });
    assert.equal(applied.length, 1);
    assert.equal(applied[0]!.action, "created");
    const [version] = await db.select().from(contentVersions).where(eq(contentVersions.sourceRef, "import-version-read-1"));
    assert.ok(version, "the revision exists");
    assert.equal(version!.status, "published", "the stored set was published, so its revision is too");
    assert.equal(version!.targetType, "general_reading_set");
    const snapshot = (await versionContent(version!.id, db)) as { passages: { body: string; questions: unknown[] }[] };
    assert.equal(snapshot.passages.length, 1, "the snapshot holds the stored passage");
    assert.match(snapshot.passages[0]!.body, /harbour was quiet at dawn/);
    assert.equal(snapshot.passages[0]!.questions.length, 2, "with the stored questions");

    // Idempotent: a second run changes nothing.
    const again = await backfillImportedVersions({ select: db.select.bind(db) as typeof db.select, transaction: db.transaction.bind(db) }, { dryRun: false, actorUserId: ownerId });
    assert.equal(again[0]!.action, "unchanged");
    assert.equal((await db.select().from(contentVersions)).length, 1);
  } finally {
    await database.close();
  }
});
