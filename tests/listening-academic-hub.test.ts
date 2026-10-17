import test from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  contentVersions,
  listeningAnswers,
  listeningAttempts,
  listeningPackages,
  listeningQuestions,
  listeningTests,
} from "../src/db/schema";
import { listeningPackageSchema, type ListeningPackage } from "../src/lib/listening/package";
import { academicListeningCards, academicListeningTest } from "../src/lib/data/listening-academic";
import { createTestDatabase } from "./support/pglite";
import { listeningLearnerFacts } from "../src/lib/data/full-listening";
import { listeningProduct, productSql, type ListeningProductKind } from "../src/lib/listening/product";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ORIGINAL_TEST_ONE_ID } from "../src/lib/listening/original-test-one";

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

test('owner batch timestamp ties preserve explicit Test 2–32 ordinals across both bounded catalogue pages',async()=>{
 const database=await createTestDatabase();
 try{
  await database.query("insert into users(id,name,role,account_status)values($1,'Owner fixture','owner','active'),($2,'Learner fixture','student','active')",[OWNER,LEARNER]);
  const ids:Record<number,string>={};
  for(const n of [1,...Array.from({length:31},(_,i)=>32-i)]){
   const [row]=await database.db.insert(listeningTests).values({...(n===1?{id:ORIGINAL_TEST_ONE_ID}:{}),title:'Unrelated display label '+(33-n),audioType:'audio',publicationState:'published',createdByUserId:OWNER,createdAt:new Date(n===1?'2026-01-01':'2026-01-02')}).returning();
   ids[n]=row!.id;const sourceId='listening-test-'+n;
   await database.db.insert(listeningPackages).values({testId:row!.id,sourceId,payload:{...fixtureB(),testId:sourceId},audioObjectKey:'fixture/'+n+'.mp3',sourceHash:'0'.repeat(64)});
  }
  const first=await academicListeningCards(LEARNER,1,database.db),second=await academicListeningCards(LEARNER,2,database.db);
  assert.equal(first.total,32);assert.equal(first.cards.length,24);assert.equal(first.hasMore,true);assert.equal(second.cards.length,8);assert.equal(second.hasMore,false);
  assert.deepEqual([...first.cards,...second.cards].map(c=>c.testId),Array.from({length:32},(_,i)=>ids[i+1]));
 }finally{await database.close();}
});

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

/**
 * A legacy canonical import with NO `collection` and NO formal structure: it must never be
 * promoted into the Academic catalogue by guesswork.
 */
function legacyDrill(): ListeningPackage {
  const base = fixtureB();
  return listeningPackageSchema.parse({
    ...base,
    testId: "fixture-legacy-drill",
    title: "Fixture legacy drill",
    collection: undefined,
    sections: [section(1, "")],
    questions: [question(1, 1, "completion", [], "garden")],
    studyPack: undefined,
  });
}

/**
 * A legacy canonical import with NO `collection`: the only thing that may keep it in the
 * Academic catalogue is the structure the owner stated for a formal exam — four parts and
 * forty questions. (The QA fixture below it has neither, and is never promoted.)
 */
function legacyFullTest(): ListeningPackage {
  const base = fixtureB();
  return listeningPackageSchema.parse({
    ...base,
    testId: "fixture-legacy-full",
    title: "Fixture legacy full",
    collection: undefined,
    sections: [1, 2, 3, 4].map((number) => section(number, "")),
    questions: Array.from({ length: 40 }, (_, index) =>
      question(index + 1, Math.min(4, Math.floor(index / 10) + 1), "completion", [], `key${index + 1}`),
    ),
    studyPack: undefined,
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
    publicationState: "published" | "draft" | "archived",
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

  const legacyDrillPayload = legacyDrill();
  const a = await insert(fixtureA(), "listening-canonical-1-a", "published");
  const b = await insert(fixtureB(), "listening-canonical-2-b", "published");
  const draft = await insert(fixtureA(), "listening-canonical-3-draft", "draft", undefined, "fixture-a-draft");
  const essential = await insert(fixtureA(), "listening-canonical-4-essential", "published", "essential", "fixture-a-essential");
  const practice = await insert(fixtureA(), "listening-canonical-5-question-types", "published", "question_types", "fixture-a-question-types");
  // Deliberately authored LAST with a source reference that sorts FIRST as text: if the
  // catalogue were reading a title or sorting the reference lexicographically, this row
  // would jump to the top. It must stay last, where the centre authored it.
  const late = await insert(fixtureB(), "listening-canonical-0-authored-last", "published", undefined, "fixture-b-authored-last");
  // The dedicated MCQ training package the owner separated from Academic Listening. Its
  // canonical identity is untouched — it is simply not offered as an Academic full test.
  const mcq = await insert(fixtureB(), "listening-canonical-6-mcq", "published", "mcq", "fixture-mcq-day12");
  // A General Listening section (its own catalogue, never an Academic full test).
  const general = await insert(fixtureB(), "listening-canonical-7-general", "published", "general", "fixture-general-section");
  // An ARCHIVED academic test: no longer offered.
  const archived = await insert(fixtureA(), "listening-canonical-8-archived", "archived", undefined, "fixture-a-archived");
  // A legacy canonical import with NO collection that PROVES the formal structure (four
  // parts, forty questions): compatibility is preserved for it.
  const legacyFull = await insert(legacyFullTest(), "listening-canonical-9-legacy-full", "published", undefined, "fixture-legacy-full");
  // A legacy import with no collection that does NOT prove it: never promoted to Academic.
  const legacyDrillId = await insert(legacyDrillPayload, "listening-canonical-10-legacy-drill", "published", undefined, "fixture-legacy-drill-row");
  return { a, b, draft, essential, practice, late, mcq, general, archived, legacyFull, legacyDrill: legacyDrillId };
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

test("original Test 1 uses the same nine-activity destination from Academic for owner and student", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const payload = fixtureA();
    await database.db.insert(listeningTests).values({ id: ORIGINAL_TEST_ONE_ID, title: "Listening Test 1", audioType: "audio", publicationState: "published", publishAt: new Date(), createdByUserId: OWNER });
    await database.db.insert(listeningPackages).values({ testId: ORIGINAL_TEST_ONE_ID, sourceId: "listening-test-1", payload, audioObjectKey: "qa/original.mp3", sourceHash: "0".repeat(64), legacyRuntime: false });
    for (const user of [{ id: OWNER, role: "owner" as const }, { id: LEARNER, role: "student" as const }]) {
      const hub = await academicListeningTest(ORIGINAL_TEST_ONE_ID, user, database.db);
      assert.equal(hub?.originalRuntime, true, `${user.role} must enter the original renderer`);
      const card = (await academicListeningCards(user.id, 1, database.db)).cards.find(row => row.testId === ORIGINAL_TEST_ONE_ID);
      assert.equal(card?.activityCount, 9, "catalogue count agrees with the original HTML");
      assert.equal((await academicListeningTest(ids.a, user, database.db))?.originalRuntime, false, "other tests keep their registry");
    }
    await database.db.update(listeningPackages).set({ sourceId: "another-source" }).where(eq(listeningPackages.testId, ORIGINAL_TEST_ONE_ID));
    assert.equal((await academicListeningTest(ORIGINAL_TEST_ONE_ID, { id: OWNER, role: "owner" }, database.db))?.originalRuntime, false, "the UUID alone never substitutes another source");
    await database.db.update(listeningPackages).set({ sourceId: "listening-test-1" }).where(eq(listeningPackages.testId, ORIGINAL_TEST_ONE_ID));
    await database.db.update(listeningTests).set({ publicationState: "draft" }).where(eq(listeningTests.id, ORIGINAL_TEST_ONE_ID));
    assert.equal(await academicListeningTest(ORIGINAL_TEST_ONE_ID, { id: LEARNER, role: "student" }, database.db), null, "the redirect never bypasses publication permissions");
    assert.equal((await academicListeningTest(ORIGINAL_TEST_ONE_ID, { id: OWNER, role: "owner" }, database.db))?.originalRuntime, true);
  } finally {
    await database.close();
  }
});

test("A1–A6 the catalogue offers ONLY formal Academic full tests: category, publication and compatibility", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const page = await academicListeningCards(LEARNER, 1, database.db);
    const byId = new Map(page.cards.map((card) => [card.testId, card]));

    // A1 — a published full Academic test appears.
    assert.ok(byId.has(ids.a), "the published academic full test is listed");
    // A2 — a dedicated MCQ training package is NOT an Academic full test.
    assert.equal(byId.has(ids.mcq), false, "a dedicated MCQ package must not appear as an Academic full test");
    // A3 — question-type practice is not a full test either.
    assert.equal(byId.has(ids.practice), false, "question-type practice must not appear as an Academic full test");
    // …and neither is an Essential recording or a General section.
    assert.equal(byId.has(ids.essential), false);
    assert.equal(byId.has(ids.general), false, "a General section belongs to the General catalogue");
    // A4 — a draft is invisible.
    assert.equal(byId.has(ids.draft), false, "a draft is never listed");
    // A5 — an archived test is not offered.
    assert.equal(byId.has(ids.archived), false, "an archived test is not offered as a new test");
    // A6 — a legacy import that PROVES the formal structure keeps its compatibility…
    assert.ok(byId.has(ids.legacyFull), "a provable legacy full test stays in the catalogue");
    assert.equal(byId.get(ids.legacyFull)!.parts, 4);
    assert.equal(byId.get(ids.legacyFull)!.questions, 40);
    // …while one that does not prove it is never invented into the catalogue.
    assert.equal(byId.has(ids.legacyDrill), false, "an unprovable legacy row is not promoted");

    assert.deepEqual(
      page.cards.map((card) => card.testId),
      [ids.a, ids.b, ids.late, ids.legacyFull],
      "only formal academic full tests, in the authored sequence",
    );
    assert.equal(page.total, 4);
    assert.equal(page.hasMore, false);

    // The catalogue keeps the authored ordering facts and never parses a title.
    assert.equal(byId.get(ids.a)!.orderKey, "listening-canonical-1-a");
    const last = page.cards[page.cards.length - 1]!;
    assert.equal(last.testId, ids.legacyFull, "a row authored last with a textually-first reference stays last");
    assert.equal(byId.get(ids.a)!.minutes, 30);
    assert.equal(byId.get(ids.a)!.activityCount, 6, "fixture A supports six activities before the first attempt");
    assert.equal(byId.get(ids.b)!.activityCount, 2, "fixture B supports two — the catalogue never pads");
  } finally {
    await database.close();
  }
});

test("A10 no answer key or hidden explanation is exposed by the catalogue or a hub payload", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const page = await academicListeningCards(LEARNER, 1, database.db);
    const serializedCatalogue = JSON.stringify(page);
    for (const leak of ["correctAnswer", "\"key\"", "answers", "explanation", "evidence"]) {
      assert.equal(serializedCatalogue.includes(leak), false, `the catalogue payload carries ${leak}`);
    }
    const hub = (await academicListeningTest(ids.a, { id: LEARNER, role: "student" as const }, database.db))!;
    const serializedHub = JSON.stringify(hub);
    for (const leak of ["correctAnswer", "\"key\"", "explanation", "evidence"]) {
      assert.equal(serializedHub.includes(leak), false, `the hub payload carries ${leak}`);
    }
    // The keys really are in the database — so the assertion above is not vacuous.
    const [row] = await database.query<{ count: number }>(`select count(*)::int as count from listening_questions where test_id = $1 and correct_answer <> ''`, [ids.a]);
    assert.ok(Number(row!.count) > 0, "the fixture must own answer keys for this test to mean anything");
  } finally {
    await database.close();
  }
});

test("A7 seventy Academic tests paginate without disappearance or duplication", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const { db, query } = database;
    const bulk: string[] = [];
    for (let index = 0; index < 70; index += 1) {
      const payload = listeningPackageSchema.parse({
        ...fixtureB(),
        testId: `fixture-bulk-${String(index).padStart(2, "0")}`,
        title: `Fixture bulk ${String(index).padStart(2, "0")}`,
      });
      const [row] = await db
        .insert(listeningTests)
        .values({ title: payload.title, audioType: "audio", sourceRef: `qa2-bulk-${String(index).padStart(2, "0")}`, publicationState: "published", createdByUserId: OWNER, publishAt: new Date() })
        .returning();
      await db.insert(listeningPackages).values({ testId: row!.id, sourceId: payload.testId, payload, audioObjectKey: `k/${payload.testId}`, sourceHash: "0".repeat(64), legacyRuntime: false });
      bulk.push(row!.id);
    }
    void query;

    const expected = [ids.a, ids.b, ids.late, ids.legacyFull, ...bulk];
    const seen: string[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= 10) {
      const result = await academicListeningCards(LEARNER, page, database.db);
      assert.ok(result.cards.length <= result.pageSize, "a page stays bounded");
      seen.push(...result.cards.map((card) => card.testId));
      hasMore = result.hasMore;
      page += 1;
    }
    assert.equal(seen.length, expected.length, `all ${expected.length} tests are reachable`);
    assert.equal(new Set(seen).size, seen.length, "no test is repeated between pages");
    assert.deepEqual([...seen].sort(), [...expected].sort(), "no test disappears");

    // A page entirely past the end is empty rather than an error, and says so.
    const beyond = await academicListeningCards(LEARNER, 99, database.db);
    assert.deepEqual(beyond.cards, []);
    assert.equal(beyond.hasMore, false);
    assert.equal(beyond.total, expected.length);
  } finally {
    await database.close();
  }
});

test("A8 the catalogue and a hub URL enforce the SAME membership", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const learner = { id: LEARNER, role: "student" as const };
    const listed = new Set((await academicListeningCards(LEARNER, 1, database.db)).cards.map((card) => card.testId));
    for (const [name, id] of Object.entries(ids)) {
      const hub = await academicListeningTest(id as string, learner, database.db);
      assert.equal(Boolean(hub), listed.has(id as string), `${name}: catalogue membership and hub membership must agree`);
    }
  } finally {
    await database.close();
  }
});

test("A9 an Academic full test still offers MCQ Mastery for the MCQ questions it really contains", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const hub = (await academicListeningTest(ids.a, { id: LEARNER, role: "student" as const }, database.db))!;
    assert.ok(hub.activities.some((activity) => activity.id === "mcq"), "the source test's own MCQ questions become an activity inside ITS hub");
    assert.ok(hub.activities.some((activity) => activity.id === "matching"));
    assert.ok(hub.activities.some((activity) => activity.id === "completion"));
    // The dedicated MCQ package, by contrast, is not a hub of this catalogue at all.
    assert.equal(await academicListeningTest(ids.mcq, { id: LEARNER, role: "student" as const }, database.db), null);
  } finally {
    await database.close();
  }
});

test("A11 the classifier and the SQL it is expressed in agree on every case", async () => {
  // ONE rule, two expressions. Each case below is classified twice: by the TypeScript
  // classifier (what a loaded payload asks) and by the SQL the catalogue actually runs.
  const cases: {
    name: string;
    facts: Parameters<typeof listeningProduct>[0];
    payload: ListeningPackage;
    insertPackage?: boolean;
    /** The 0052 relation, when the case is a programme day. */
    programme?: { ref: string; day: number };
  }[] = [
    { name: "authored academic collection", facts: { collection: "academic", hasPackage: true, parts: 4, questions: 40 }, payload: pkg("academic", 4, 40) },
    { name: "authored general collection", facts: { collection: "general", hasPackage: true, parts: 1, questions: 8 }, payload: pkg("general", 1, 8) },
    { name: "mcq programme", facts: { collection: "mcq", hasPackage: true, parts: 4, questions: 40 }, payload: pkg("mcq", 4, 40) },
    { name: "question-type practice", facts: { collection: "question_types", hasPackage: true, parts: 1, questions: 6 }, payload: pkg("question_types", 1, 6) },
    { name: "essential recording", facts: { collection: "essential", hasPackage: true, parts: 1, questions: 10 }, payload: pkg("essential", 1, 10) },
    { name: "legacy import that proves the exam", facts: { collection: null, hasPackage: true, parts: 4, questions: 40 }, payload: pkg(undefined, 4, 40) },
    { name: "legacy drill that does not", facts: { collection: null, hasPackage: true, parts: 1, questions: 5 }, payload: pkg(undefined, 1, 5) },
    // No package: the item was authored natively, so the revision's content type is the
    // specific thing its author chose. The payload column is empty either way.
    { name: "authored natively as a full test", insertPackage: false, facts: { versionContentType: "full_test", collection: null, hasPackage: false, parts: 0, questions: 0 }, payload: pkg(undefined, 1, 5) },
    { name: "authored natively as a section", insertPackage: false, facts: { versionContentType: "section", collection: null, hasPackage: false, parts: 0, questions: 0 }, payload: pkg(undefined, 1, 5) },
    // The canonical IMPORTER stamps every imported package `full_test`
    // (src/lib/import/listening/canonical.ts). The stamp therefore cannot be allowed to
    // classify: an imported package says what it is through its own collection, and a
    // package with no collection must PROVE the formal structure or stay out.
    { name: "an imported general section (stamped full_test)", facts: { versionContentType: "full_test", collection: "general", hasPackage: true, parts: 1, questions: 8 }, payload: pkg("general", 1, 8) },
    { name: "an imported mcq package (stamped full_test)", facts: { versionContentType: "full_test", collection: "mcq", hasPackage: true, parts: 4, questions: 40 }, payload: pkg("mcq", 4, 40) },
    { name: "an imported package with no collection (stamped full_test)", facts: { versionContentType: "full_test", collection: null, hasPackage: true, parts: 1, questions: 5 }, payload: pkg(undefined, 1, 5) },
    /*
     * PROGRAMME DAYS (0052). The relation outranks every label, because the labels are exactly the
     * ones that would put a day in the wrong place: a canonically imported day is stamped
     * `full_test`, and a natively authored day carries a `full_test` revision. Neither is an
     * Academic full test, and both expressions must say so.
     */
    {
      name: "a DAY authored natively (a full_test revision, no package)",
      insertPackage: false,
      programme: { ref: "listening-mcq-program", day: 1 },
      facts: { inProgramme: true, versionContentType: "full_test", collection: null, hasPackage: false, parts: 0, questions: 0 },
      payload: pkg(undefined, 1, 5),
    },
    {
      name: "an imported DAY whose package declares its programme",
      programme: { ref: "listening-mcq-program", day: 2 },
      facts: { inProgramme: true, versionContentType: "full_test", collection: "mcq", hasPackage: true, parts: 1, questions: 5 },
      payload: { ...pkg("mcq", 1, 5), programme: { ref: "listening-mcq-program", day: 2 } },
    },
  ];

  const database = await createTestDatabase();
  try {
    // The fixture users must exist: `created_by_user_id` is a real foreign key.
    await seed(database);
    const { db } = database;
    const expected: { name: string; product: ListeningProductKind; id: string; insertPackage: boolean }[] = [];
    for (const [index, item] of cases.entries()) {
      const [row] = await db
        .insert(listeningTests)
        .values({
          title: item.name,
          audioType: "audio",
          sourceRef: `qa2-agree-${index}`,
          publicationState: "published",
          createdByUserId: OWNER,
          publishAt: new Date(),
          programRef: item.programme?.ref ?? null,
          programOrdinal: item.programme?.day ?? null,
        })
        .returning();
      // A natively authored item has no package at all — that absence is part of the case.
      if (item.insertPackage !== false)
        await db.insert(listeningPackages).values({ testId: row!.id, sourceId: `qa2-agree-${index}`, payload: item.payload, audioObjectKey: `k/${index}`, sourceHash: "0".repeat(64), legacyRuntime: false });
      if (item.facts.versionContentType)
        await db.insert(contentVersions).values({
          module: "listening",
          contentType: item.facts.versionContentType,
          sourceRef: `qa2-agree-${index}`,
          versionNo: 1,
          status: "published",
          title: item.name,
          contentHash: "0".repeat(64),
          semanticHash: "0".repeat(64),
          answerKeyHash: "0".repeat(64),
          targetType: "listening_test",
          targetId: row!.id,
          createdByUserId: OWNER,
        });
      expected.push({ name: item.name, product: listeningProduct(item.facts), id: row!.id, insertPackage: item.insertPackage !== false });
    }

    for (const item of expected) {
      // The REAL expression the catalogue runs — compiled from the module, never a copy of
      // it. A copy would only prove that two written-down rules agree today.
      const productExpression = productSql({
        testId: sql.raw("t.id"),
        payload: sql.raw("p.payload"),
        payloadIsNull: sql.raw("p.payload is null"),
        // The catalogue's own expression, programme fact included (0052).
        inProgramme: sql.raw("t.program_ref is not null"),
      });
      const compiled = new PgDialect().sqlToQuery(
        sql`select ${productExpression} as product from listening_tests t left join listening_packages p on p.test_id = t.id where t.id = ${item.id}`,
      );
      const [row] = await database.query<{ product: string }>(compiled.sql, compiled.params);
      assert.equal(row!.product, item.product, `${item.name}: the catalogue's SQL and the payload classifier must agree`);
    }

    // …and the catalogue lists exactly the rows both expressions call academic AND that can
    // actually be OPENED. An Academic test is offered at its activity HUB, and that hub is
    // served from the canonical package (`src/lib/data/full-listening.ts`): a card for an
    // item with no package would lead nowhere, which is the one thing a card must never do.
    //
    // A row authored natively as `listening:full_test` (no package) is therefore classified
    // academic but NOT offered. That asymmetry is recorded in the ledger as an OWNER-REVIEW
    // item — it is an authoring-path gap, not a catalogue lie — and it is asserted here so the
    // behaviour cannot change silently in either direction.
    const listed = new Set((await academicListeningCards(LEARNER, 1, database.db)).cards.map((card) => card.testId));
    for (const item of expected) {
      const openable = item.product === "academic_full_test" && item.insertPackage;
      assert.equal(listed.has(item.id), openable, `${item.name}: catalogue membership`);
    }
    const nativeFullTest = expected.find((item) => item.name === "authored natively as a full test")!;
    assert.equal(listed.has(nativeFullTest.id), false, "a full test with no canonical package opens no hub, so the catalogue does not offer it (ledger: owner-review item)");
  } finally {
    await database.close();
  }
});

function pkg(collection: string | undefined, parts: number, questions: number): ListeningPackage {
  const base = fixtureB();
  return {
    ...base,
    collection: collection as ListeningPackage["collection"],
    sections: Array.from({ length: parts }, (_, index) => section(index + 1, "")),
    questions: Array.from({ length: questions }, (_, index) => question(index + 1, Math.min(4, Math.floor(index / 10) + 1), "completion", [], `k${index}`)),
  };
}

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
    assert.equal((await academicListeningCards(LEARNER, 1, database.db)).cards.length, 4, "four fixtures are Academic full tests");

    // Every fixture is deleted — including the ones the catalogue never showed, so the
    // cleanup assertion covers what the seed created, not only what it listed.
    const all = Object.values(ids);
    await database.query(`delete from listening_tests where id = any($1::uuid[])`, [all]);
    assert.equal((await academicListeningCards(LEARNER, 1, database.db)).cards.length, 0, "the catalogue is empty again");
    const remaining = await database.query<{ count: number }>(`select count(*)::integer as count from listening_packages`);
    assert.equal(Number(remaining[0]!.count), 0, "the packages cascade with their tests");
    const questions = await database.query<{ count: number }>(`select count(*)::integer as count from listening_questions`);
    assert.equal(Number(questions[0]!.count), 0);
  } finally {
    await database.close();
  }
});

/**
 * Every call of the registry from application code must hand over the learner's own facts.
 * A hub that forgets them does not merely look different: it hides "Review by Part" and
 * "Retry Weak Areas" from the only learner who has something to review or retry.
 */
function packageActivitiesCallsWithoutLearnerFacts(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const marker = "packageActivities(";
  const offenders: string[] = [];
  let index = code.indexOf(marker);
  while (index >= 0) {
    let depth = 1;
    let cursor = index + marker.length;
    let commas = 0;
    while (cursor < code.length && depth > 0) {
      const char = code[cursor]!;
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 1) commas += 1;
      cursor += 1;
    }
    if (commas === 0) offenders.push(code.slice(index, cursor).replace(/\s+/g, " "));
    index = code.indexOf(marker, cursor);
  }
  return offenders;
}

function* sourceFiles(directory: string): Generator<string> {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.tsx?$/.test(path) && path !== join(directory, "activities.ts")) yield path;
  }
}

test("AL9 every application call of the registry passes the learner's real facts", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles("src")) {
    if (file.endsWith("listening/activities.ts")) continue;
    for (const call of packageActivitiesCallsWithoutLearnerFacts(readFileSync(file, "utf8"))) {
      offenders.push(`${file}: ${call}`);
    }
  }
  assert.deepEqual(offenders, [], "a hub must ask packageActivities(payload, learner) so Review/Retry stay truthful");
  // The guard is not vacuous: it rejects the exact call it exists to prevent.
  assert.deepEqual(packageActivitiesCallsWithoutLearnerFacts("const a = packageActivities(pkg);"), ["packageActivities(pkg)"]);
  assert.deepEqual(packageActivitiesCallsWithoutLearnerFacts("const a = packageActivities(pkg, learner);"), []);
  // The staff import PREVIEW asks the other question on purpose — "what does this test
  // support" — because no learner exists before the test does. It is confined to that one
  // surface, so a learner page cannot quietly adopt the same call.
  const testOnly: string[] = [];
  for (const file of sourceFiles("src")) {
    if (/testActivities\(/.test(readFileSync(file, "utf8"))) testOnly.push(file);
  }
  assert.deepEqual(testOnly, [join("src", "components", "import", "ListeningTryout.tsx")], "the learner-free question belongs to the import preview");
});

test("AL10 the shared learner-facts helper reports exactly what the hubs gate on", async () => {
  const database = await createTestDatabase();
  try {
    const ids = await seed(database);
    const before = await listeningLearnerFacts(LEARNER, ids.a, database.db);
    assert.equal(before.examSubmitted, false, "before the first attempt there is nothing to review");
    assert.equal(before.missedQuestions, 0, "and nothing to retry");
    assert.equal(before.progress.exam, null);
    await submit(database, ids.a, LEARNER, [2]);
    const facts = await listeningLearnerFacts(LEARNER, ids.a, database.db);
    assert.equal(facts.examSubmitted, true);
    assert.equal(facts.missedQuestions, 1, "one question was answered wrongly");
    assert.ok(facts.progress.exam, "the submitted attempt is visible to the hub");
    assert.equal((await listeningLearnerFacts(OTHER, ids.a, database.db)).examSubmitted, false, "another learner's attempt is not mine");
  } finally {
    await database.close();
  }
});
