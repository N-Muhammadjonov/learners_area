import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  listeningAnswers,
  listeningAttempts,
  listeningPackages,
  listeningQuestions,
  listeningTests,
} from "../src/db/schema";
import { listeningPackageSchema, type ListeningPackage } from "../src/lib/listening/package";
import { academicListeningCards, academicListeningTest } from "../src/lib/data/listening-academic";
import { createTestDatabase } from "./support/pglite";

/**
 * ACADEMIC LISTENING — the catalogue and the per-test hub.
 *
 * What is protected here:
 *   AL1 the catalogue is the CANONICAL published content: drafts are invisible to a
 *       learner, a non-academic collection is excluded, `question_types`/`mcq` practice
 *       material is included, and the ordering is the authored identity (source_ref),
 *       never a parsed display title;
 *   AL2 the catalogue read is BOUNDED and the collection is a WHERE clause, not a
 *       post-filter that could hide a legitimate test behind newer unrelated rows;
 *   AL3 two genuinely different tests produce genuinely different hubs — fixture A
 *       (MCQ + Matching + Completion + transcript) versus fixture B (Completion only);
 *   AL4 nothing is faked: no transcript → no Script Completion, no MCQ → no MCQ card,
 *       no vocabulary → no vocabulary card, and no card is ever disabled to fill a grid;
 *   AL5 learner-gated cards are real: Review needs a submitted attempt, Retry Weak Areas
 *       needs questions actually missed, and a perfect attempt gets no Retry;
 *   AL6 a hub never leaks a non-live test to a learner, and staff see it as a draft;
 *   AL7 only what this learner did is counted — another learner's progress is not theirs.
 *
 * The fixtures are created inside the test database and removed at the end, with the
 * removal itself asserted, so nothing is left behind.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const STAFF = "44444444-4444-4444-8444-444444444444";

function section(number: number, transcript: string) {
  return { number, title: `Part ${number}`, transcript, reviewRequired: false };
}

function question(number: number, sectionNumber: number, kind: "completion" | "mcq" | "matching", options: string[], key: string) {
  return {
    number,
    section: sectionNumber,
    text: `Question ${number}`,
    instruction: "Choose the correct answer",
    kind,
    options,
    key,
    alternatives: [],
    pair: [],
    evidence: { at: number * 10, why: "The speaker says so" },
  };
}

/**
 * Fixture A — "MCQ + Matching + Completion + transcript": the rich canonical test. Its
 * sections carry full transcripts, so transcript work is genuinely possible.
 */
const PART_TEXTS = [
  "Good morning and welcome to the museum. Today we are opening the new gallery, and the first room holds the oldest items in the collection. Please keep your bags with you at all times. The tour lasts forty minutes and ends in the courtyard.",
  "The second part looks at how the collection itself was gathered. A local family donated most of the pieces in nineteen fifty-two, and a trust bought the rest at auction. Each object was catalogued by a curator before it came here.",
  "Now let us turn to how the items were valued. An independent expert estimated the whole group at two million pounds, although the figure is never published. Insurance cover was arranged separately, and the storage room is kept at a constant temperature.",
  "Finally, the panel answers questions from the audience. One visitor asked whether the museum lends objects to other cities, and the answer was a careful maybe. Another question concerned the missing portrait, which was returned after a long search.",
];

/** Six or seven strategic blanks per part — authored, not invented at render time. */
const PART_GAPS = [
  [["museum", "museum"], ["gallery", "gallery"], ["collection", "collection"], ["bags", "bags"], ["forty", "forty"], ["courtyard", "courtyard"]],
  [["gathered", "gathered"], ["donated", "donated"], ["trust", "trust"], ["curator", "curator"], ["auction", "auction"], ["catalogued", "catalogued"]],
  [["valued", "valued"], ["estimated", "estimated"], ["published", "published"], ["Insurance", "insurance"], ["temperature", "temperature"], ["separately", "separately"]],
  [["audience", "audience"], ["lends", "lends"], ["maybe", "maybe"], ["portrait", "portrait"], ["search", "search"], ["returned", "returned"], ["cities", "cities"]],
];

/**
 * Fixture A — "MCQ + Matching + Completion + transcript": the rich canonical test. Its
 * sections carry full transcripts with AUTHORED blanks, so Script Completion is a real
 * exercise here, not a transcript with nothing to fill in.
 */
function fixtureA(): ListeningPackage {
  return listeningPackageSchema.parse({
    schemaVersion: 1,
    collection: "academic",
    testId: "fixture-a-mcq-matching-completion",
    title: "Fixture A — Academic full test",
    category: "full",
    provenance: "QA fixture, authored for the Academic Listening hub contract",
    audio: { path: "audio.mp3", durationSec: 1800 },
    imagePath: null,
    sections: PART_TEXTS.map((transcript, index) => section(index + 1, transcript)),
    questions: [
      question(1, 1, "mcq", ["A) a museum", "B) a library", "C) a theatre"], "A"),
      question(2, 1, "mcq", ["A) Monday", "B) Tuesday", "C) Wednesday"], "C"),
      question(3, 2, "matching", ["A) donated", "B) bought", "C) lent"], "B"),
      question(4, 3, "completion", [], "collection"),
    ],
    keyword1: [],
    keyword2: [],
    vocabulary: [{ word: "collection", pos: "noun", uz: "to'plam", def: "a group of gathered items", ex: "The collection grew.", also: [] }],
    studyPack: {
      kind: "research-practice",
      activities: ["exam", "review", "script", "mcq", "matching", "completion", "vocab", "retry"],
      partRanges: { "1": [0, 400], "2": [400, 800], "3": [800, 1200], "4": [1200, 1700] },
      scriptParts: PART_TEXTS.map((transcript, index) => ({
        part: index + 1,
        transcript,
        gaps: PART_GAPS[index]!.map(([match, answer], gapIndex) => ({ q: index * 10 + gapIndex + 1, match: match!, answer: answer! })),
      })),
      recall: [
        { part: 1, title: "Opening", points: ["Where the talk is held"] },
        { part: 2, title: "The collection", points: ["How it was gathered"] },
        { part: 3, title: "Valuation", points: ["Who valued the items"] },
        { part: 4, title: "Questions", points: ["What the audience asked"] },
      ],
    },
  });
}

/**
 * Fixture B — "Completion only": one completion question, no transcript anywhere, no
 * vocabulary and no study pack. Its hub must be SMALLER and different, not padded out to
 * match fixture A.
 */
function fixtureB(): ListeningPackage {
  return listeningPackageSchema.parse({
    schemaVersion: 1,
    collection: "academic",
    testId: "fixture-b-completion-only",
    title: "Fixture B — Completion only",
    category: "full",
    provenance: "QA fixture, authored for the Academic Listening hub contract",
    audio: { path: "audio.mp3", durationSec: 1200 },
    imagePath: null,
    sections: [section(1, ""), section(2, ""), section(3, ""), section(4, "")],
    questions: [question(1, 1, "completion", [], "garden")],
    keyword1: [],
    keyword2: [],
    vocabulary: [],
    // The graded practice screens run only a kind the source AUTHORED, so a "completion
    // only" test authors exactly that: exam, review, completion, and a retry of real misses.
    studyPack: {
      kind: "research-practice",
      activities: ["exam", "review", "completion", "retry"],
      partRanges: { "1": [0, 300], "2": [300, 600], "3": [600, 900], "4": [900, 1150] },
      recall: [],
    },
  });
}

async function seed(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  const { db, query } = database;
  await query(`insert into users (id, name, role) values
    ('${OWNER}', 'Academic owner', 'owner'),
    ('${STAFF}', 'Academic teacher', 'teacher'),
    ('${LEARNER}', 'Academic learner', 'student'),
    ('${OTHER}', 'Other learner', 'student')`);

  const insert = async (
    payload: ListeningPackage,
    sourceRef: string,
    publicationState: "published" | "draft",
    collection?: NonNullable<ListeningPackage["collection"]>,
    sourceId = payload.testId,
  ) => {
    const [row] = await db
      .insert(listeningTests)
      .values({ title: payload.title, audioType: "audio", sourceRef, publicationState, createdByUserId: OWNER, publishAt: publicationState === "published" ? new Date() : null })
      .returning();
    await db.insert(listeningPackages).values({
      testId: row!.id,
      sourceId,
      payload: collection ? { ...payload, collection } : payload,
      audioObjectKey: `qa/${payload.testId}/audio.mp3`,
      sourceHash: "0".repeat(64),
      legacyRuntime: false,
    });
    await db.insert(listeningQuestions).values(
      payload.questions.map((q) => ({
        testId: row!.id,
        // `order` and `explanation` are NOT NULL storage columns with no default: the
        // canonical importer writes both, so the fixture does too.
        order: q.number,
        questionText: q.text,
        correctAnswer: q.key,
        explanation: "",
        options: q.options,
        type: q.kind === "mcq" ? ("multiple_choice" as const) : q.kind === "matching" ? ("short_answer" as const) : ("short_answer" as const),
      })),
    );
    return row!.id;
  };

  const a = await insert(fixtureA(), "listening-canonical-1-a", "published");
  const b = await insert(fixtureB(), "listening-canonical-2-b", "published");
  const draft = await insert(fixtureA(), "listening-canonical-3-draft", "draft", undefined, "fixture-a-draft");
  const essential = await insert(fixtureA(), "listening-canonical-4-essential", "published", "essential", "fixture-a-essential");
  const practice = await insert(fixtureA(), "listening-canonical-5-question-types", "published", "question_types", "fixture-a-question-types");
  // Deliberately authored LAST with a source reference that sorts FIRST as text: if the
  // catalogue were reading a title or sorting the reference lexicographically, this row
  // would jump to the top. It must stay last, where the centre authored it.
  const late = await insert(fixtureB(), "listening-canonical-0-authored-last", "published", undefined, "fixture-b-authored-last");
  return { a, b, draft, essential, practice, late };
}

async function submit(database: Awaited<ReturnType<typeof createTestDatabase>>, testId: string, userId: string, wrong: number[]) {
  const { db } = database;
  const [attempt] = await db
    .insert(listeningAttempts)
    .values({ userId, testId, status: "completed", score: 0, totalQuestions: 1, submittedAt: new Date() })
    .returning();
  const questions = await db.select().from(listeningQuestions).where(eq(listeningQuestions.testId, testId));
  await db.insert(listeningAnswers).values(
    questions.map((q) => ({
      attemptId: attempt!.id,
      questionId: q.id,
      userAnswer: wrong.includes(q.order) ? "wrong" : String(q.correctAnswer),
      isCorrect: !wrong.includes(q.order),
    })),
  );
  return attempt!.id;
}

test("AL1/AL2 the catalogue is canonical, published, academic, ordered by the authored sequence and bounded", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const cards = await academicListeningCards(LEARNER, undefined, database.db);
    const byId = new Map(cards.map((card) => [card.testId, card]));

    assert.deepEqual(
      cards.map((card) => card.testId),
      [ids.a, ids.b, ids.practice, ids.late],
      "only live academic-collection tests, in the order the centre authored them",
    );
    assert.equal(byId.has(ids.draft), false, "a draft is invisible in the learner catalogue");
    assert.equal(byId.has(ids.essential), false, "another collection is not academic listening");
    assert.equal(byId.get(ids.a)!.orderKey, "listening-canonical-1-a", "the authored reference identifies the row; no title is parsed");
    // Fixture A authors seven activities, but "Review by Part" needs a submitted attempt:
    // for a learner who has not sat the test yet the honest count is six, and the seventh
    // appears the moment there is a result to review (asserted below).
    assert.equal(byId.get(ids.a)!.activityCount, 6, "fixture A supports six activities before the first attempt");
    assert.equal(byId.get(ids.b)!.activityCount, 2, "fixture B supports two — the catalogue never pads");
    assert.equal(byId.get(ids.a)!.parts, 4);
    assert.equal(byId.get(ids.a)!.questions, 4);
    assert.equal(byId.get(ids.a)!.minutes, 30);

    // Bound: the caller's limit is honoured and can never exceed the endpoint cap.
    const one = await academicListeningCards(LEARNER, 1, database.db);
    assert.deepEqual(one.map((card) => card.testId), [ids.a]);
    const huge = await academicListeningCards(LEARNER, 10_000, database.db);
    assert.equal(huge.length, 4);

    // A submitted attempt is what turns Review on — and it is this learner's own attempt,
    // never another learner's: the OTHER learner's submission changes nothing here.
    await submit(database, ids.a, OTHER, [1, 2]);
    const stillUntouched = await academicListeningCards(LEARNER, undefined, database.db);
    assert.deepEqual(stillUntouched.map((card) => card.completed), [0, 0, 0, 0]);
    assert.equal(stillUntouched[0]!.activityCount, 6);
    assert.equal(stillUntouched[0]!.started, false, "another learner's attempt does not start my test");

    await submit(database, ids.a, LEARNER, [1]);
    const mine = await academicListeningCards(LEARNER, undefined, database.db);
    assert.equal(mine[0]!.started, true);
    assert.equal(mine[0]!.activityCount, 8, "one submitted attempt with a missed question adds Review and Retry");
    assert.equal(mine[0]!.completed, 1, "only the exam is finished so far");
    assert.deepEqual(mine[0]!.exam, { score: 0, total: 1 });
  } finally {
    await database.close();
  }
});

test("AL3/AL4/AL5 the two fixtures produce different hubs, and no card is faked", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const learner = { id: LEARNER, role: "student" as const };

    const hubA = (await academicListeningTest(ids.a, learner, database.db))!;
    const hubB = (await academicListeningTest(ids.b, learner, database.db))!;
    const idsOf = (hub: { activities: { id: string }[] }) => hub.activities.map((activity) => activity.id);

    assert.deepEqual(idsOf(hubA), ["exam", "script", "mcq", "matching", "completion", "vocab"]);
    assert.deepEqual(idsOf(hubB), ["exam", "completion"], "completion only: no MCQ, no Matching, no transcript work, no vocabulary");
    assert.notDeepEqual(idsOf(hubA), idsOf(hubB), "the two hubs differ because the two tests differ");
    assert.equal(hubA.transcriptAvailable, true);
    assert.equal(hubB.transcriptAvailable, false, "fixture B has no transcript, so none is invented");
    assert.equal(hubA.draft, false);
    assert.equal(hubB.progress.completed, 0, "a learner who has done nothing has completed nothing");
    assert.equal(hubB.progress.total, 2);

    // Every card points at a real existing activity route, never a placeholder.
    for (const activity of hubA.activities) {
      assert.ok(activity.path.length > 0, `${activity.id} must carry a route`);
      assert.equal(activity.complete, false);
    }

    // Review needs a submitted attempt; a PERFECT attempt earns no Retry Weak Areas.
    await submit(database, ids.a, LEARNER, []);
    const perfect = (await academicListeningTest(ids.a, learner, database.db))!;
    // The authored order is preserved: review takes the place the source gave it.
    assert.deepEqual(idsOf(perfect), ["exam", "review", "script", "mcq", "matching", "completion", "vocab"]);
    assert.equal(perfect.activities.find((activity) => activity.id === "exam")!.complete, true, "the submitted exam is the finished activity");
    assert.equal(perfect.activities.find((activity) => activity.id === "review")!.complete, false, "review is offered by the result, not auto-completed by it");
    assert.equal(idsOf(perfect).includes("retry"), false, "all answers correct → nothing to retry");
    assert.deepEqual(perfect.progress.exam, { score: 0, total: 1 });
    assert.equal(perfect.progress.completed, 1);

    // A wrong answer creates real weakness, so Retry appears — and says what it drills.
    await submit(database, ids.a, LEARNER, [1, 3, 4]);
    const weak = (await academicListeningTest(ids.a, learner, database.db))!;
    assert.deepEqual(idsOf(weak), ["exam", "review", "script", "mcq", "matching", "completion", "vocab", "retry"]);

    // Fixture B shows the same two learner-gated cards and nothing more.
    await submit(database, ids.b, LEARNER, [1]);
    assert.deepEqual(idsOf((await academicListeningTest(ids.b, learner, database.db))!), ["exam", "review", "completion", "retry"]);
  } finally {
    await database.close();
  }
});

test("AL6/AL7 access: drafts are staff-only, unknown or malformed ids are one answer, progress is per learner", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const learner = { id: LEARNER, role: "student" as const };
    const staff = { id: STAFF, role: "teacher" as const };

    assert.equal(await academicListeningTest(ids.draft, learner, database.db), null, "a learner cannot open an unpublished test");
    const preview = (await academicListeningTest(ids.draft, staff, database.db))!;
    assert.equal(preview.draft, true, "staff preview the draft and see that it is one");
    assert.ok(preview.activities.length > 0);

    assert.equal(await academicListeningTest("44444444-4444-4444-8444-444444444444", learner, database.db), null, "unknown id");
    assert.equal(await academicListeningTest("not-a-uuid", learner, database.db), null, "malformed id");
    assert.equal(await academicListeningTest(ids.essential, learner, database.db), null, "another collection is not a hub of this catalogue");

    await submit(database, ids.a, LEARNER, []);
    assert.equal((await academicListeningTest(ids.a, { id: OTHER, role: "student" as const }, database.db))!.progress.exam, null, "another learner's attempt is not mine");
  } finally {
    await database.close();
  }
});

test("AL8 the fixtures are removed: the catalogue is empty again and the removal is proven", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    assert.equal((await academicListeningCards(LEARNER, undefined, database.db)).length, 4);

    await database.query(`delete from listening_tests where id in ('${ids.a}','${ids.b}','${ids.draft}','${ids.essential}','${ids.practice}','${ids.late}')`);
    assert.equal((await academicListeningCards(LEARNER, undefined, database.db)).length, 0);
    const remaining = await database.query<{ count: number }>(`select count(*)::integer as count from listening_packages`);
    assert.equal(Number(remaining[0]!.count), 0, "the packages cascade with their tests");
    const questions = await database.query<{ count: number }>(`select count(*)::integer as count from listening_questions`);
    assert.equal(Number(questions[0]!.count), 0);
  } finally {
    await database.close();
  }
});
