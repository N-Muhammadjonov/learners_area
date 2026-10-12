import test from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { contentVersions, listeningQuestions, listeningTests } from "../src/db/schema";
import { publishContentVersion, saveContentDraft, type AuthoringActor } from "../src/lib/content/authoring";
import { resolveModuleAuthor, canAuthor, registerModuleAuthors } from "../src/lib/content/authors";
import { academicListeningCards, academicListeningTest } from "../src/lib/data/listening-academic";
import { generalListeningCards } from "../src/lib/data/listening-general";
import { fullListeningCards } from "../src/lib/data/full-listening";
import { inProgrammeSql, productSql, versionTypeSql } from "../src/lib/listening/product";
import { createTestDatabase } from "./support/pglite";

/**
 * THE NATIVE FULL-TEST GAP — DETERMINED, NOT ASSUMED (owner directive, 2026-10-07).
 *
 * The owner's instruction was exact: before calling the package-less native full test an owner
 * dependency, DETERMINE whether the existing Content OS full-test author can safely materialize
 * the canonical package/hub data. If it cannot — and only if — it stays OWNER REVIEW. Never invent
 * a package, never route a learner to a broken page, never classify the row as General, never show
 * a dead Academic card.
 *
 * This test answers the question by running the real pipeline against a real database and reading
 * what it produced. The finding, per assertion:
 *
 *   F1  the Content OS full-test author DOES publish a `listening:full_test` revision safely: the
 *       40-question structure rule passes, the row goes live, and its questions are materialized
 *       (append-only, revision-owned) — the author is not broken;
 *   F2  the authoring payload CANNOT EXPRESS the canonical package: an authored `sections` array
 *       is dropped by the schema, so the parts/titles/hub facts are unrepresentable;
 *   F3  publication writes NO `listening_packages` row — the Content OS author is not, and does
 *       not pretend to be, a package writer; the import pipeline is the only canonical writer;
 *   F4  therefore the learner surfaces exclude it, which is the SAFE outcome the owner demanded:
 *       the Academic catalogue does not list it, the hub URL is a truthful 404 rather than a
 *       broken hub, and it is never re-classified as General;
 *   F5  the decision the owner has to make is stated in the classifier's own terms: `productSql`
 *       calls a package-backed-less full_test "academic", while every catalogue requires a package
 *       row — the two facts together are the gap, and closing it needs owner content/schema
 *       decisions (extend the payload to carry 4 parts + hub metadata, and make the author a
 *       canonical package writer), not a guess by an implementer.
 *
 * Nothing here mutates a classification or writes a package. If a future change makes the author
 * able to materialize packages, F2/F3 fail and this test must be updated deliberately — the gap
 * cannot be closed silently.
 */

const owner: AuthoringActor = { id: "", role: "owner", mayPublish: true };

async function fixture() {
  // The server registers the authors before it can author anything; a test must do the same
  // (idempotent), otherwise `canAuthor` would answer about an empty registry rather than about
  // the pipeline the running application uses.
  registerModuleAuthors();
  const database = await createTestDatabase();
  const { query } = database;
  const [ownerUser, student] = await query<{ id: string }>(
    `insert into users (name, role, account_status) values ('Owner','owner','active'),('Learner','student','active') returning id`,
  );
  return { ...database, owner: { ...owner, id: ownerUser!.id }, studentId: student!.id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** 40 questions in the flat shape the Content OS full-test schema actually accepts. */
const fullTestPayload = () => ({
  audioType: "audio" as const,
  difficultyLevel: "B2",
  audioUrl: "/media/fixture-full-test.mp3",
  transcript: "A fixture transcript for the structure experiment.",
  /*
   * An author TRIES to describe the canonical 4 parts here. The schema has no such field, and
   * F2 asserts it is dropped — which is exactly why the hub data cannot be authored today.
   */
  sections: [
    { number: 1, title: "Part 1" },
    { number: 2, title: "Part 2" },
    { number: 3, title: "Part 3" },
    { number: 4, title: "Part 4" },
  ],
  questions: Array.from({ length: 40 }, (_, i) => ({
    order: i + 1,
    type: "short_answer",
    questionText: `Full-test fixture question ${i + 1}?`,
    correctAnswer: `answer ${i + 1}`,
    explanation: `Explanation for question ${i + 1}.`,
  })),
});

async function publishNativeFullTest(database: Fixture) {
  const saved = await database.db.transaction((tx) =>
    saveContentDraft(tx, {
      actor: database.owner,
      module: "listening",
      contentType: "full_test",
      sourceRef: "native-full-test-fixture",
      title: "Native full test fixture",
      payload: fullTestPayload(),
    }),
  );
  assert.equal(saved.ok, true, "the Content OS full-test author accepts a 40-question payload");
  const published = await database.db.transaction((tx) =>
    publishContentVersion(tx, { actor: database.owner, versionId: saved.ok ? saved.version.id : "", to: "published" }),
  );
  assert.equal(published.ok, true, "and publishes it (the 40-question structure rule is satisfied)");
  const [row] = await database.db
    .select({ id: listeningTests.id, state: listeningTests.publicationState })
    .from(listeningTests)
    .where(eq(listeningTests.sourceRef, "native-full-test-fixture"));
  // The snapshot is read back from the revision row — the same bytes preview and publication
  // consume — rather than trusting an in-memory object.
  const [version] = await database.db
    .select({ snapshot: contentVersions.contentSnapshot })
    .from(contentVersions)
    .where(eq(contentVersions.id, saved.ok ? saved.version.id : ""))
    .limit(1);
  return { row: row!, versionId: saved.ok ? saved.version.id : "", snapshot: (version?.snapshot ?? {}) as Record<string, unknown> };
}

test("F1 the Content OS full-test author publishes a native 40-question full test safely", async () => {
  const database = await fixture();
  try {
    assert.equal(canAuthor("listening", "full_test"), true, "the full-test author is registered in the Content OS");
    const author = resolveModuleAuthor("listening", "full_test");
    assert.ok(author, "and resolvable by the authoring pipeline");

    const { row, snapshot } = await publishNativeFullTest(database);
    assert.equal(row.state, "published", "the native full test is live");
    const questions = await database.db
      .select({ id: listeningQuestions.id })
      .from(listeningQuestions)
      .where(eq(listeningQuestions.testId, row.id));
    assert.equal(questions.length, 40, "publication materialized the revision's own 40 questions");
    assert.equal((snapshot.questions as unknown[]).length, 40, "and the revision carries them for preview and history");

    // The author is NOT broken: this is why the gap is narrow and specific rather than "authoring
    // a test does not work".
    assert.equal(database.owner.mayPublish, true);
  } finally {
    await database.close();
  }
});

test("F2 the authoring payload cannot express the canonical package, so parts are dropped", async () => {
  const database = await fixture();
  try {
    const { snapshot } = await publishNativeFullTest(database);
    assert.equal("sections" in snapshot, false, "an authored `sections` array never reaches the revision snapshot");
    assert.equal(snapshot.sectionNo, undefined, "and no part numbering is invented for it either");
    // The canonical package schema is what the hub reads; it is a different shape entirely.
    const packageSchema = await import("../src/lib/listening/package");
    const parsed = packageSchema.listeningPackageSchema.safeParse({ category: "full", questions: snapshot.questions });
    assert.equal(parsed.success, false, "a flat authored snapshot is not a valid canonical package (parts/audio/studyPack are missing)");
  } finally {
    await database.close();
  }
});

test("F3 publication writes no canonical package — the Content OS author is not a package writer", async () => {
  const database = await fixture();
  try {
    const { row } = await publishNativeFullTest(database);
    const [packageCount] = await database.query<{ packages: number }>(
      `select count(*)::int as packages from listening_packages where test_id = $1`,
      [row.id],
    );
    assert.equal(packageCount!.packages, 0, "no package row exists after a native full-test publication");
    // Only the import pipeline writes packages (`src/lib/import/listening/importer.ts`), which is
    // why the hub cannot serve this test yet.
    const writers = await database.query<{ count: number }>(
      `select count(*)::int as count from listening_packages`,
    );
    assert.equal(writers[0]!.count, 0, "the whole fixture database holds no package at all");
  } finally {
    await database.close();
  }
});

test("F4 the learner surfaces exclude it: no dead Academic card, no General misclassification", async () => {
  const database = await fixture();
  try {
    const { row } = await publishNativeFullTest(database);
    const user = { id: database.studentId, role: "student" as const };

    const academic = await academicListeningCards(database.studentId, 1, database.db);
    assert.equal(academic.total, 0, "the Academic catalogue does not list a package-less test");
    assert.equal(academic.cards.some((card) => card.testId === row.id), false);

    const hub = await academicListeningTest(row.id, user, database.db);
    assert.equal(hub, null, "and the hub URL is a truthful 404, never a broken hub");

    const general = await generalListeningCards(database.studentId, 1, database.db);
    assert.equal(general.cards.some((card) => card.testId === row.id), false, "it is never re-classified as a General section");

    const library = await fullListeningCards(database.studentId, 1, false, database.db);
    assert.equal(library.rows.some((card) => card.id === row.id), false, "and the generic listening library does not offer a package-less card either");
  } finally {
    await database.close();
  }
});

test("F5 the gap is an OWNER DECISION: the classifier calls it academic, every catalogue needs a package", async () => {
  const database = await fixture();
  try {
    const { row, snapshot } = await publishNativeFullTest(database);
    const [classified] = await database.db
      .select({
        product: productSql({
          testId: sql`${listeningTests.id}`,
          payload: sql`null::jsonb`,
          payloadIsNull: sql`true`,
          inProgramme: inProgrammeSql(sql`${listeningTests.programRef}`),
        }),
        revisionType: versionTypeSql(sql`${listeningTests.id}`),
      })
      .from(listeningTests)
      .where(eq(listeningTests.id, row.id));

    assert.equal(classified!.revisionType, "full_test", "the revision is filed as a full test");
    assert.equal(
      classified!.product,
      "academic_full_test",
      "the application's own decision table calls a package-less full_test academic — which is precisely why the catalogue's package requirement is the gap, and not a licence to list a test whose hub cannot serve it",
    );
    /*
     * The closing decision needs canonical content shape, proven BOUND by bound rather than by
     * reading zod internals:
     *   • the authored snapshot, bent into a package shape, is still refused — the author cannot
     *     produce a canonical package by accident or by wishful payload;
     *   • the package is a FULL-test package and demands the four parts the hub renders, which the
     *     authoring payload has no field for.
     * So the owner chooses between extending the payload (and making the Content OS a canonical
     * package writer) and leaving the row unreachable until canonical content exists — an
     * implementer must not pick either on their own.
     */
    const { listeningPackageSchema } = await import("../src/lib/listening/package");
    const bent = listeningPackageSchema.safeParse({ category: "full", ...snapshot });
    assert.equal(bent.success, false, "an authored full-test revision alone is not a canonical package");
    const onePart = listeningPackageSchema.safeParse({
      category: "full",
      audio: { durationSec: 1800, url: "/media/fixture-full-test.mp3" },
      sections: [{ number: 1, title: "Part 1", questions: [] }],
      questions: [],
    });
    assert.equal(onePart.success, false, "the canonical package refuses a one-part full test");
    if (!onePart.success) {
      const paths = onePart.error.issues.map((issue) => issue.path.join("."));
      assert.ok(paths.length > 0, "the refusal names what is missing");
      assert.equal(
        paths.some((path) => path.startsWith("category")),
        false,
        "and it is not the `full` discriminator that was wrong — the canonical package is missing authored material the full-test payload cannot carry",
      );
    }
  } finally {
    await database.close();
  }
});
