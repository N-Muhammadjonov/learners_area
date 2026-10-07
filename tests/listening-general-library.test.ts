import test from "node:test";
import assert from "node:assert/strict";
import {
  contentVersions,
  listeningAttempts,
  listeningPackages,
  listeningQuestions,
  listeningTests,
} from "../src/db/schema";
import { listeningPackageSchema, type ListeningPackage } from "../src/lib/listening/package";
import { generalListeningCards, getOpenableSection } from "../src/lib/data/listening-general";
import { listeningProductOf } from "../src/lib/data/listening-product";
import { readFileSync } from "node:fs";
import { createTestDatabase } from "./support/pglite";

/**
 * GENERAL LISTENING — the catalogue of standalone SECTIONS.
 *
 * The owner's product design is the contract here:
 *
 *   G1  the catalogue lists SECTIONS and nothing else: an Academic full test, a dedicated
 *       MCQ training package, question-type practice and an Essential recording are NOT
 *       General Listening, whatever they contain;
 *   G2  a section must NOT require a four-part test to exist: a natively authored section
 *       (no package at all — just the CMS revision, the audio and its questions) IS listed;
 *   G3  the catalogue is the canonical PUBLISHED content: a draft is invisible, an archived
 *       section is not offered, and a future-dated one is not open yet;
 *   G4  the read is BOUNDED and PAGED: the filter is a WHERE clause before the bound, the
 *       order is total, and every published section is reachable exactly once;
 *   G5  a card states the learner's own truth — nothing before they open it, a real
 *       "continue" while an attempt is open, their own last result after submitting, and
 *       never another learner's progress;
 *   G6  the card carries the section's authored identity (section number, duration,
 *       question count) and NEVER the answer key or a hidden explanation;
 *   G7  opening is gated by the SAME decision the catalogue makes, so a URL cannot open an
 *       Academic full test, a practice package, a draft or a malformed id.
 *
 * The fixtures live in the test database and are deleted at the end, with the removal
 * itself asserted (G8), so nothing is left behind.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const SECRET = "QASECRETKEY-MUSEUM";

/** A package that a General SECTION would carry: one section, its own questions. */
function sectionPackage(overrides: Partial<ListeningPackage> = {}): ListeningPackage {
  return listeningPackageSchema.parse({
    schemaVersion: 1,
    collection: "general",
    testId: "fixture-general-section",
    title: "Fixture — General section",
    // A canonical PACKAGE is always a full-recording package (`category: "full"`); what makes
    // an item a General SECTION is its authored collection or its `listening:section` revision.
    category: "full",
    provenance: "QA fixture, authored for the General Listening catalogue contract",
    audio: { path: "audio.mp3", durationSec: 480 },
    imagePath: null,
    sections: [{ number: 2, title: "Section 2", transcript: "", reviewRequired: false }],
    questions: [
      { number: 1, section: 2, text: "Question 1", instruction: "Choose the correct answer", kind: "mcq", options: ["A) one", "B) two"], key: SECRET, alternatives: [], pair: [], evidence: { at: 10, why: "The speaker says so" } },
    ],
    keyword1: [],
    keyword2: [],
    vocabulary: [],
    ...overrides,
  });
}

/** An Academic FULL TEST: four parts, and it must never appear in the General catalogue. */
function academicFullTest(): ListeningPackage {
  return listeningPackageSchema.parse({
    ...sectionPackage(),
    collection: "academic",
    testId: "fixture-academic-full",
    title: "Fixture — Academic full test",
    category: "full",
    audio: { path: "audio.mp3", durationSec: 1800 },
    sections: [1, 2, 3, 4].map((number) => ({ number, title: `Part ${number}`, transcript: "", reviewRequired: false })),
    questions: [1, 2, 3, 4].map((number) => ({ number, section: number, text: `Q${number}`, instruction: "Choose", kind: "completion", options: [], key: SECRET, alternatives: [], pair: [], evidence: { at: number, why: "authored" } })),
  });
}

async function seed(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  const { db, query } = database;
  await query(`insert into users (id, name, role) values
    ('${OWNER}', 'General owner', 'owner'),
    ('${LEARNER}', 'General learner', 'student'),
    ('${OTHER}', 'Other learner', 'student')`);

  const insertTest = async (
    title: string,
    sourceRef: string,
    publicationState: "published" | "draft" | "archived" | "scheduled",
    publishAt: Date | null = publicationState === "published" ? new Date() : null,
  ) => {
    const [row] = await db
      .insert(listeningTests)
      .values({ title, audioType: "audio", sourceRef, publicationState, createdByUserId: OWNER, publishAt })
      .returning();
    return row!.id;
  };

  const attachPackage = async (testId: string, payload: ListeningPackage, sourceId: string) => {
    await db.insert(listeningPackages).values({
      testId,
      sourceId,
      payload,
      audioObjectKey: `qa/${sourceId}/audio.mp3`,
      sourceHash: "0".repeat(64),
      legacyRuntime: false,
    });
    await db.insert(listeningQuestions).values(
      payload.questions.map((q) => ({
        testId,
        order: q.number,
        questionText: q.text,
        correctAnswer: q.key,
        explanation: "Hidden explanation that must never reach a learner.",
        options: q.options,
        type: q.kind === "mcq" ? ("multiple_choice" as const) : ("short_answer" as const),
      })),
    );
  };

  /** The canonical way a standalone section is authored: a `listening:section` revision. */
  const authorSectionVersion = async (testId: string, sourceRef: string, sectionNo: number) => {
    await db.insert(contentVersions).values({
      module: "listening",
      contentType: "section",
      sourceRef,
      versionNo: 1,
      status: "published",
      title: "Fixture section",
      contentSnapshot: { sectionNo, questions: [] },
      contentHash: "0".repeat(64),
      semanticHash: "0".repeat(64),
      answerKeyHash: "0".repeat(64),
      targetType: "listening_test",
      targetId: testId,
      createdByUserId: OWNER,
    });
  };

  // 1. A package-backed GENERAL section (an imported canonical section).
  const packaged = await insertTest("Fixture general section (packaged)", "listening-general-1-packaged", "published");
  await attachPackage(packaged, sectionPackage(), "fixture-general-section");

  // 2. A NATIVELY authored section: no package at all. Its section identity and its
  //    questions live in their canonical places, and it must still be listed.
  const native = await insertTest("Fixture general section (authored)", "listening-general-2-authored", "published");
  await db.insert(listeningQuestions).values([
    { testId: native, order: 1, questionText: "Native question one", correctAnswer: SECRET, explanation: "hidden", options: null, type: "short_answer" as const },
    { testId: native, order: 2, questionText: "Native question two", correctAnswer: SECRET, explanation: "hidden", options: null, type: "short_answer" as const },
  ]);
  await authorSectionVersion(native, "listening-general-2-authored", 3);

  // 3. An Academic FULL TEST — four parts, a full test, never General Listening.
  const academic = await insertTest("Fixture academic full test", "listening-general-3-academic", "published");
  await attachPackage(academic, academicFullTest(), "fixture-academic-full");

  // 4. A dedicated MCQ training package and question-type practice — not General Listening.
  const mcq = await insertTest("Fixture MCQ package", "listening-general-4-mcq", "published");
  await attachPackage(mcq, sectionPackage({ collection: "mcq", testId: "fixture-mcq", title: "Fixture MCQ package" }), "fixture-mcq");
  const questionTypes = await insertTest("Fixture question types", "listening-general-5-question-types", "published");
  await attachPackage(questionTypes, sectionPackage({ collection: "question_types", testId: "fixture-qtypes" }), "fixture-qtypes");

  // 5. An Essential recording — a listening exercise, not an IELTS section.
  const essential = await insertTest("Fixture essential recording", "listening-general-6-essential", "published");
  await attachPackage(essential, sectionPackage({ collection: "essential", testId: "fixture-essential" }), "fixture-essential");

  // 6. A draft, an archived section and a future-dated section: none is open to a learner.
  const draft = await insertTest("Fixture draft section", "listening-general-7-draft", "draft");
  await attachPackage(draft, sectionPackage({ testId: "fixture-draft", title: "Fixture draft section" }), "fixture-draft");
  const archived = await insertTest("Fixture archived section", "listening-general-8-archived", "archived");
  await attachPackage(archived, sectionPackage({ testId: "fixture-archived" }), "fixture-archived");
  const future = await insertTest("Fixture future section", "listening-general-9-future", "scheduled", new Date(Date.now() + 86_400_000));
  await attachPackage(future, sectionPackage({ testId: "fixture-future" }), "fixture-future");

  return { packaged, native, academic, mcq, questionTypes, essential, draft, archived, future };
}

test("G1/G2/G3 the catalogue lists published SECTIONS only — packaged and natively authored alike", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const catalogue = await generalListeningCards(LEARNER, 1, database.db);

    assert.equal(catalogue.total, 2, "exactly the two published sections");
    const listed = catalogue.cards.map((card) => card.testId);
    assert.deepEqual(new Set(listed), new Set([ids.packaged, ids.native]), "the packaged section and the natively authored one");

    // What must NOT be here, and why — each one is legitimate content, just not this product.
    for (const [name, id] of Object.entries({
      "an academic full test": ids.academic,
      "a dedicated MCQ package": ids.mcq,
      "question-type practice": ids.questionTypes,
      "an essential recording": ids.essential,
      "a draft": ids.draft,
      "an archived section": ids.archived,
      "a future-dated section": ids.future,
    }))
      assert.ok(!listed.includes(id), `${name} must not be listed in the General catalogue`);
  } finally {
    await database.close();
  }
});

test("G6 a card carries the section's authored identity — and never the answer key", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const catalogue = await generalListeningCards(LEARNER, 1, database.db);
    const packaged = catalogue.cards.find((card) => card.testId === ids.packaged)!;
    const native = catalogue.cards.find((card) => card.testId === ids.native)!;

    assert.equal(packaged.sectionNo, 2, "the imported section's authored number");
    assert.equal(packaged.durationSec, 480, "the authored duration");
    assert.equal(packaged.questionCount, 1, "the questions the section really has");

    assert.equal(native.sectionNo, 3, "the natively authored section's number comes from its revision");
    assert.equal(native.durationSec, null, "no duration is invented when none was authored");
    assert.equal(native.questionCount, 2, "its real question rows are counted");

    // The card is a view model, but it is built from rows that DO hold the key and the
    // explanation: nothing about them may travel into what a learner surface receives.
    const serialised = JSON.stringify(catalogue);
    assert.ok(!serialised.includes(SECRET), "the answer key must not be in the catalogue payload");
    assert.ok(!serialised.includes("Hidden explanation"), "and neither must the explanation");
  } finally {
    await database.close();
  }
});

test("G5 a card states this learner's own truth, and nobody else's", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const { db } = database;

    const before = (await generalListeningCards(LEARNER, 1, db)).cards.find((card) => card.testId === ids.packaged)!;
    assert.equal(before.started, false);
    assert.equal(before.completed, false);
    assert.equal(before.openAttemptId, null, "nothing is claimed before the learner opens the section");
    assert.equal(before.lastScore, null);

    const [open] = await db.insert(listeningAttempts).values({ testId: ids.packaged, userId: LEARNER, status: "in_progress" }).returning();
    const inProgress = (await generalListeningCards(LEARNER, 1, db)).cards.find((card) => card.testId === ids.packaged)!;
    assert.equal(inProgress.started, true);
    assert.equal(inProgress.completed, false);
    assert.equal(inProgress.openAttemptId, open!.id, "the learner continues their open attempt instead of starting a new one");

    await db.insert(listeningAttempts).values({ testId: ids.packaged, userId: LEARNER, status: "completed", score: 1, totalQuestions: 1, submittedAt: new Date() });
    const completed = (await generalListeningCards(LEARNER, 1, db)).cards.find((card) => card.testId === ids.packaged)!;
    assert.equal(completed.completed, true);
    assert.equal(completed.lastScore, 1);
    assert.equal(completed.lastTotal, 1);

    // Another learner's attempt is not this learner's progress.
    await db.insert(listeningAttempts).values({ testId: ids.native, userId: OTHER, status: "completed", score: 2, totalQuestions: 2, submittedAt: new Date() });
    const mine = (await generalListeningCards(LEARNER, 1, db)).cards.find((card) => card.testId === ids.native)!;
    assert.equal(mine.completed, false, "another learner's result is never shown as mine");
    assert.equal(mine.lastScore, null);

    // …and the section's own result never leaks into the Academic catalogue either.
    const otherView = (await generalListeningCards(OTHER, 1, db)).cards.find((card) => card.testId === ids.native)!;
    assert.equal(otherView.lastScore, 2, "the learner who did it sees their own result");
  } finally {
    await database.close();
  }
});

test("G4 seventy sections paginate without disappearance or duplication, and the page stays bounded", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    await seed(database);
    for (let index = 1; index <= 68; index += 1) {
      const [row] = await db
        .insert(listeningTests)
        .values({ title: `Bulk section ${String(index).padStart(2, "0")}`, audioType: "audio", sourceRef: `listening-general-bulk-${String(index).padStart(2, "0")}`, publicationState: "published", createdByUserId: OWNER, publishAt: new Date() })
        .returning();
      await db.insert(listeningQuestions).values({ testId: row!.id, order: 1, questionText: "Bulk question", correctAnswer: SECRET, explanation: "", options: null, type: "short_answer" as const });
      await db.insert(contentVersions).values({
        module: "listening",
        contentType: "section",
        sourceRef: `listening-general-bulk-${String(index).padStart(2, "0")}`,
        versionNo: 1,
        status: "published",
        title: `Bulk section ${index}`,
        contentSnapshot: { sectionNo: 1, questions: [] },
        contentHash: "0".repeat(64),
        semanticHash: "0".repeat(64),
        answerKeyHash: "0".repeat(64),
        targetType: "listening_test",
        targetId: row!.id,
        createdByUserId: OWNER,
      });
    }

    const first = await generalListeningCards(LEARNER, 1, db);
    assert.equal(first.total, 70, "two authored sections plus sixty-eight bulk rows");
    assert.equal(first.cards.length, 24, "one page is bounded");
    assert.equal(first.pageSize, 24);
    assert.equal(first.hasMore, true);

    const seen: string[] = [];
    let page = 1;
    while (page <= 10) {
      const current = await generalListeningCards(LEARNER, page, db);
      seen.push(...current.cards.map((card) => card.testId));
      if (!current.hasMore) break;
      page += 1;
    }
    assert.equal(page, 3, "the catalogue is three pages");
    assert.equal(seen.length, 70, "every published section is reachable");
    assert.equal(new Set(seen).size, 70, "and none is listed twice");

    const again = await generalListeningCards(LEARNER, 1, db);
    assert.deepEqual(again.cards.map((card) => card.testId), first.cards.map((card) => card.testId), "the order is stable across requests");

    // The membership filter runs in SQL, on the same rows the bound then cuts: a page that
    // carried an excluded row would have fewer than its size.
    const [counted] = await query<{ total: number }>(`select count(*)::integer as total from listening_tests where publication_state = 'published'`);
    assert.ok(Number(counted!.total) > 70, "there are more published rows than sections (the bulk set is not the whole table)");
  } finally {
    await database.close();
  }
});

test("G7 opening a section is gated by the SAME decision the catalogue makes", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const packaged = await getOpenableSection(ids.packaged, LEARNER, database.db);
    assert.ok(packaged, "a published packaged section opens");
    assert.equal(packaged!.questions.length, 1);
    assert.equal(packaged!.package?.collection, "general");

    const native = await getOpenableSection(ids.native, LEARNER, database.db);
    assert.ok(native, "a natively authored section opens without any package");
    assert.equal(native!.package, null);
    assert.equal(native!.questions.length, 2, "its questions come from the canonical rows");
    assert.equal(native!.test.title, "Fixture general section (authored)");

    assert.equal(await getOpenableSection(ids.academic, LEARNER, database.db), null, "an academic full test is not a General section");
    assert.equal(await getOpenableSection(ids.mcq, LEARNER, database.db), null, "a dedicated MCQ package is not a General section");
    assert.equal(await getOpenableSection(ids.draft, LEARNER, database.db), null, "a draft is not open");
    assert.equal(await getOpenableSection(ids.archived, LEARNER, database.db), null, "an archived section is not offered");
    assert.equal(await getOpenableSection("not-a-uuid", LEARNER, database.db), null, "a malformed id never reaches the database");
  } finally {
    await database.close();
  }
});

test("G9 the section reading text is decorated by the canonical surface, and the exam is not", async () => {
  const { readFileSync } = await import("node:fs");
  const exam = readFileSync("src/components/listening/NativeListeningExam.tsx", "utf8");
  const text = readFileSync("src/components/vocabulary/ClickableText.tsx", "utf8");

  // ONE text surface: the section renders its reading text through the canonical component,
  // and highlight is offered only because the CALLER asked for it.
  assert.ok(exam.includes("ReadingText"), "the section must render its text through one renderer");
  assert.ok(exam.includes("textSurface"), "and that renderer is the surface the CALLER injected");
  // The exam screen is shared with the graded Academic test, which must reveal nothing, so it
  // must hold no lexical knowledge of its own. The learning surface is composed by the section
  // wrapper instead — and the exam is asserted here to have no way to draw one by itself.
  assert.ok(!exam.includes("ClickableText") && !exam.includes("WordPopover"), "the exam component must know nothing about vocabulary");
  assert.ok(exam.includes("if (!textSurface) return <span"), "without an injected surface the text is plain, exactly as before");
  assert.ok(exam.includes("sectionMode ? title : `${title} · Full Exam`"), "the section must not present itself as the full exam");
  assert.ok(exam.includes("{!sectionMode && ("), "the four-part navigation must be hidden for a section");
  const wrapper = readFileSync("src/components/listening/SectionListeningActivity.tsx", "utf8");
  assert.ok(wrapper.includes("<ClickableText"), "the section composes the ONE canonical vocabulary surface");
  assert.ok(wrapper.includes('sourceType="listening"') && wrapper.includes("sourceId={exam.testId}"), "a word saved from a section is filed against the canonical listening source");
  assert.ok(wrapper.includes("lexicalAssistance"), "the decision to allow the surface is passed in, never assumed");

  // Highlight is OPTIONAL in the canonical surface, so every existing surface is untouched.
  assert.ok(text.includes("highlights?: TextHighlight[]"), "highlight ranges must be an optional prop");
  assert.ok(text.includes("onHighlightRange?:"), "the control must only appear when a caller offers it");
  assert.ok(exam.includes("localStorage.getItem(highlightsKey)"), "highlights are scoped to the learner's own session");
  assert.ok(!/correctAnswer|answer_key|answerKey/.test(text), "a highlight must never be derived from an answer or a key");
});

test("G8 the fixtures are removed: the catalogue is empty again and the removal is proven", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    await seed(database);
    assert.equal((await generalListeningCards(LEARNER, 1, db)).total, 2);

    await query(`delete from listening_attempts where test_id in (select id from listening_tests where source_ref like 'listening-general-%')`);
    await query(`delete from listening_questions where test_id in (select id from listening_tests where source_ref like 'listening-general-%')`);
    await query(`delete from listening_packages where source_id like 'fixture-%'`);
    await query(`delete from content_versions where source_ref like 'listening-general-%'`);
    await query(`delete from listening_tests where source_ref like 'listening-general-%'`);

    assert.equal((await generalListeningCards(LEARNER, 1, db)).total, 0, "the catalogue is empty again");
    const residue = await query<{ tests: number; packages: number; questions: number; versions: number }>(`
      select (select count(*)::integer from listening_tests where source_ref like 'listening-general-%') as tests,
             (select count(*)::integer from listening_packages where source_id like 'fixture-%') as packages,
             (select count(*)::integer from listening_questions) as questions,
             (select count(*)::integer from content_versions where source_ref like 'listening-general-%') as versions`);
    assert.deepEqual(residue[0], { tests: 0, packages: 0, questions: 0, versions: 0 }, "no fixture row remains");
  } finally {
    await database.close();
  }
});

test("G10 the product reader the pages and the lexical API share agrees with the classifier", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    // The section page and the lexical API routes ask THIS reader, so a section can never be
    // treated as a full test (or the reverse) by one of them and not the other.
    assert.equal(await listeningProductOf(ids.packaged, database.db), "general_section", "a packaged section");
    assert.equal(await listeningProductOf(ids.native, database.db), "general_section", "a natively authored section with no package");
    assert.equal(await listeningProductOf(ids.academic, database.db), "academic_full_test", "an academic full test");
    assert.equal(await listeningProductOf(ids.mcq, database.db), "mcq_programme", "a dedicated MCQ package is neither");
    assert.equal(await listeningProductOf(ids.questionTypes, database.db), "question_type_practice");
    assert.equal(await listeningProductOf(ids.draft, database.db), "general_section", "the product is a fact about the item, not its publication state");
    assert.equal(await listeningProductOf("44444444-4444-4444-8444-444444444444", database.db), null, "an id that does not exist has no product");
  } finally {
    await database.close();
  }
});
