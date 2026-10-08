import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  contentVersions,
  listeningAttempts,
  listeningPackages,
  listeningQuestions,
  listeningTests,
} from "../src/db/schema";
import { listeningPackageSchema, type ListeningPackage } from "../src/lib/listening/package";
import { collectionTabOf } from "../src/lib/listening/product";
import { fullListeningCards } from "../src/lib/data/full-listening";
import { legacyListeningCards } from "../src/lib/data/listening";
import { createTestDatabase } from "./support/pglite";

/**
 * THE LISTENING LIBRARY'S TABS — the module page's own catalogue.
 *
 * The owner's rule is that a card must never STATE something untrue about the content it
 * describes. The Academic catalogue was corrected first; this test covers the SECOND place the
 * same mistake lived, on `/app/listening`:
 *
 *   • `fullListeningCards` filed every package as `coalesce(payload->>'collection', 'academic')`,
 *     so a package with no collection that does NOT prove a formal full test was presented as
 *     Academic Listening;
 *   • `legacyListeningCards` hard-coded `collection: 'academic'` and `40 questions` for EVERY
 *     row with no package, whatever it actually is.
 *
 * Both now read the ONE classifier (`collectionTabOf` / `collectionTabSql`, next to the ONE
 * decision table in `product.ts`), and a row nothing can prove lands in an honest
 * `uncatalogued` tab rather than being labelled Academic:
 *
 *   L1  every product maps to exactly one tab, and `unclassified` maps to `uncatalogued`;
 *   L2  a package with no collection and no proven 4×40 structure is NOT academic;
 *   L3  a package-less row is filed by the revision the CMS authored — `listening:full_test`
 *       → academic, `listening:section` → general, nothing → uncatalogued;
 *   L4  a package-less row states its REAL question count, never an assumed 40;
 *   L5  the fixtures are removed and the removal is proven.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";

function packageWith(overrides: Partial<ListeningPackage>): ListeningPackage {
  return listeningPackageSchema.parse({
    schemaVersion: 1,
    collection: "academic",
    testId: "fixture-library",
    title: "Fixture — library",
    category: "full",
    provenance: "QA fixture, library tab classification",
    audio: { path: "audio.mp3", durationSec: 600 },
    imagePath: null,
    sections: [{ number: 1, title: "Section 1", transcript: "", reviewRequired: false }],
    questions: [
      { number: 1, section: 1, text: "Q1", instruction: "Choose", kind: "mcq", options: ["A) one", "B) two"], key: "A", alternatives: [], pair: [], evidence: { at: 1, why: "authored" } },
    ],
    keyword1: [],
    keyword2: [],
    vocabulary: [],
    ...overrides,
  });
}

/** A package with NO collection that does NOT prove a formal full test (1 part, 1 question). */
const unprovenPackage = packageWith({ collection: undefined, questions: [
  { number: 1, section: 1, text: "Q1", instruction: "Choose", kind: "mcq", options: ["A) one", "B) two"], key: "A", alternatives: [], pair: [], evidence: { at: 1, why: "authored" } },
] } as Partial<ListeningPackage>);

test("L1 every product maps to exactly one tab — and nothing unproven becomes 'academic'", () => {
  assert.equal(collectionTabOf("academic_full_test"), "academic");
  assert.equal(collectionTabOf("general_section"), "general");
  assert.equal(collectionTabOf("mcq_programme"), "mcq");
  assert.equal(collectionTabOf("question_type_practice"), "question_types");
  assert.equal(collectionTabOf("essential_recording"), "essential");
  assert.equal(collectionTabOf("unclassified"), "uncatalogued", "an unprovable row is never filed as academic");
  // The library must ask this mapping rather than hard-code a collection into its reads.
  const full = readFileSync("src/lib/data/full-listening.ts", "utf8");
  const legacy = readFileSync("src/lib/data/listening.ts", "utf8");
  assert.ok(full.includes("collectionTabSql"), "the package read must classify");
  assert.ok(!full.includes("coalesce(${listeningPackages.payload}->>'collection', 'academic')"), "the old fallback must be gone");
  assert.ok(legacy.includes("collectionTabSql"), "the package-less read must classify");
  assert.ok(!legacy.includes("collection:sql<string>`'academic'`"), "the hard-coded collection must be gone");
});

test("L2/L3/L4 the module library files each row by what it proves, and states the real question count", async () => {
  const database = await createTestDatabase();
  const { db, query } = database;
  const created: string[] = [];
  try {
    await query(`insert into users (id, name, role) values ('${OWNER}', 'Library owner', 'owner'), ('${LEARNER}', 'Library learner', 'student')`);

    const insertTest = async (title: string, sourceRef: string) => {
      const [row] = await db
        .insert(listeningTests)
        .values({ title, audioType: "audio", sourceRef, publicationState: "published", publishAt: new Date(), createdByUserId: OWNER })
        .returning();
      created.push(row!.id);
      return row!.id;
    };
    const attachPackage = async (testId: string, payload: ListeningPackage, sourceId: string) => {
      await db.insert(listeningPackages).values({
        testId, sourceId, payload, audioObjectKey: `qa/${sourceId}/audio.mp3`, sourceHash: "0".repeat(64), legacyRuntime: false,
      });
      await db.insert(listeningQuestions).values(payload.questions.map((q) => ({
        testId, order: q.number, questionText: q.text, correctAnswer: q.key,
        explanation: "Hidden explanation.", options: q.options,
        type: q.kind === "mcq" ? ("multiple_choice" as const) : ("short_answer" as const),
      })));
    };
    const authorRevision = async (testId: string, sourceRef: string, contentType: "full_test" | "section") => {
      await db.insert(contentVersions).values({
        module: "listening", contentType, sourceRef, versionNo: 1, status: "published", title: "Fixture revision",
        contentSnapshot: contentType === "section" ? { sectionNo: 2, questions: [] } : { questions: [] },
        contentHash: "0".repeat(64), semanticHash: "0".repeat(64), answerKeyHash: "0".repeat(64),
        targetType: "listening_test", targetId: testId, createdByUserId: OWNER,
      });
    };

    // A package WITH a collection: filed by its own label.
    const general = await insertTest("Fixture packaged general", "library-1-general");
    await attachPackage(general, packageWith({ collection: "general", testId: "library-general" }), "library-general");
    // A package with NO collection and no proven structure: NOT academic.
    const unproven = await insertTest("Fixture package without a collection", "library-2-unproven");
    await attachPackage(unproven, unprovenPackage, "library-unproven");
    // A package that DOES prove a formal full test (4 parts / 40 questions): academic.
    const proven = await insertTest("Fixture proven full test", "library-3-proven");
    const provenQuestions = Array.from({ length: 40 }, (_, index) => ({
      number: index + 1, section: Math.floor(index / 10) + 1, text: `Q${index + 1}`, instruction: "Choose",
      kind: "completion" as const, options: [], key: "answer", alternatives: [], pair: [], evidence: { at: index, why: "authored" },
    }));
    await attachPackage(proven, packageWith({
      collection: undefined, testId: "library-proven",
      sections: [1, 2, 3, 4].map((number) => ({ number, title: `Part ${number}`, transcript: "", reviewRequired: false })),
      questions: provenQuestions,
    } as Partial<ListeningPackage>), "library-proven");

    // Package-LESS rows: only the authored revision can say what they are.
    const nativeFull = await insertTest("Fixture native full test", "library-4-native-full");
    await db.insert(listeningQuestions).values([
      { testId: nativeFull, order: 1, questionText: "Q1", correctAnswer: "A", explanation: "hidden", options: null, type: "short_answer" as const },
      { testId: nativeFull, order: 2, questionText: "Q2", correctAnswer: "B", explanation: "hidden", options: null, type: "short_answer" as const },
    ]);
    await authorRevision(nativeFull, "library-4-native-full", "full_test");
    const nativeSection = await insertTest("Fixture native section", "library-5-native-section");
    await db.insert(listeningQuestions).values([
      { testId: nativeSection, order: 1, questionText: "Q1", correctAnswer: "A", explanation: "hidden", options: null, type: "short_answer" as const },
    ]);
    await authorRevision(nativeSection, "library-5-native-section", "section");
    const unknownRow = await insertTest("Fixture with nothing authored", "library-6-unknown");

    const cards = (await fullListeningCards(LEARNER, 1, false, db)).rows;
    const legacy = await legacyListeningCards(LEARNER, false, db);
    const tabOf = (id: string) => cards.find((card) => card.id === id)?.collection;

    assert.equal(tabOf(general), "general", "a packaged general section is General Listening");
    assert.equal(tabOf(unproven), "uncatalogued", "a package that proves nothing is NOT academic");
    assert.equal(tabOf(proven), "academic", "only a proven 4-part / 40-question package is academic");
    assert.equal(cards.find((card) => card.id === unproven)?.collection === "academic", false, "the old coalesce fallback is gone");

    const legacyBy = (id: string) => legacy.find((card) => card.id === id);
    assert.equal(legacyBy(nativeFull)?.collection, "academic", "a native full test is filed by its authored revision");
    assert.equal(legacyBy(nativeSection)?.collection, "general", "a native section is filed by its authored revision — never as academic");
    assert.equal(legacyBy(unknownRow)?.collection, "uncatalogued", "a row nothing can prove is honestly uncategorised");
    assert.equal(legacyBy(nativeFull)?.questions, 2, "the card states its REAL question count");
    assert.equal(legacyBy(nativeSection)?.questions, 1);
    assert.equal(legacyBy(unknownRow)?.questions, 0, "a row with no questions says zero, not forty");

    // The attempt flags of a package-less card must describe THIS learner's real attempts.
    // They used to compare the attempt's test_id with the attempt's own id (an unqualified
    // column inside the subquery), so a finished attempt was never reflected.
    const [attempt] = await db.insert(listeningAttempts).values({ userId: LEARNER, testId: nativeSection, status: "completed", submittedAt: new Date() }).returning();
    assert.ok(attempt);
    const afterAttempt = (await legacyListeningCards(LEARNER, false, db)).find((card) => card.id === nativeSection);
    assert.equal(afterAttempt?.started, true, "the learner has started this test");
    assert.equal(Number(afterAttempt?.completed), 1, "…and finished it");
    const stranger = (await legacyListeningCards(OWNER, false, db)).find((card) => card.id === nativeSection);
    assert.equal(Number(stranger?.completed), 0, "another account's progress is never adopted");

    // …and the library only offers the extra tab when such a card exists.
    const library = readFileSync("src/components/listening/FullListeningLibrary.tsx", "utf8");
    assert.ok(library.includes('key !== "uncatalogued" || cards.some'), "the uncatalogued tab is conditional");
    assert.ok(library.includes("t.questionsMeta"), "a package-less card states its real count");
    assert.ok(!library.includes("card.legacy ? t.badgeFull"), "the assumed '40 questions' claim is gone");
  } finally {
    for (const id of created) {
      await query(`delete from listening_questions where test_id = '${id}'`);
      await query(`delete from listening_packages where test_id = '${id}'`);
      await query(`delete from content_versions where target_id = '${id}'`);
      await query(`delete from listening_attempts where test_id = '${id}'`);
      await query(`delete from listening_tests where id = '${id}'`);
    }
    // L5 — the removal is proven, not assumed.
    const residue = await query<{ tests: number; packages: number; questions: number; versions: number }>(`
      select (select count(*)::integer from listening_tests where source_ref like 'library-%') as tests,
             (select count(*)::integer from listening_packages where source_id like 'library-%') as packages,
             (select count(*)::integer from listening_questions) as questions,
             (select count(*)::integer from content_versions where source_ref like 'library-%') as versions`);
    assert.deepEqual(residue[0], { tests: 0, packages: 0, questions: 0, versions: 0 }, "no fixture row remains");
    await database.close();
  }
});

/**
 * CAP-01 — UNLIMITED CAPACITY: the staff legacy catalogue must not hide real content.
 *
 * The owner's rule is that no section which is supposed to keep accepting content may carry an
 * artificial maximum. `/app/admin/listening` renders `fullListeningCards` (paginated) together
 * with `legacyListeningCards`. The legacy reader took no page at all and ended in `.limit(200)`,
 * so a centre with more than 200 legacy listening tests could never see or manage the rest —
 * and the same 200 rows were re-rendered on every page.
 *
 * A bounded PAGE is fine. An unreachable REMAINDER is not.
 */
test("CAP-01 every legacy listening test stays reachable through paging, beyond any fixed ceiling", async () => {
  const database = await createTestDatabase();
  const { db, query } = database;
  try {
    const OWNER = "00000000-0000-4000-8000-0000000000c1";
    await query(`insert into users (id, name, role) values ('${OWNER}', 'Capacity owner', 'owner')`);
    await db.insert(listeningTests).values(
      Array.from({ length: 205 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(900000000000 + index)}`,
        title: `Legacy ${String(index + 1).padStart(3, "0")}`,
        createdByUserId: OWNER,
        audioType: "audio" as const,
        audioUrl: `https://example.invalid/legacy-${index + 1}.mp3`,
        publicationState: "published" as const,
        createdAt: new Date(Date.UTC(2024, 0, 1) + index * 1000),
      })),
    );

    // Walk every page the staff surface can actually reach.
    const seen = new Set<string>();
    for (let page = 1; page <= 40; page += 1) {
      const rows = await legacyListeningCards(OWNER, true, db, page);
      if (!rows.length) break;
      for (const row of rows) seen.add(row.title);
    }

    assert.equal(seen.size, 205, `every authored legacy test must be reachable, saw ${seen.size}`);
    assert.ok(seen.has("Legacy 205"), "the 205th legacy test must be reachable beyond the old 200 ceiling");
    assert.ok(seen.has("Legacy 201"), "the 201st legacy test must be reachable beyond the old 200 ceiling");
  } finally {
    await database.close();
  }
});
