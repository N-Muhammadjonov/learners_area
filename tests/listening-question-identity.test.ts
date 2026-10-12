import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { listeningQuestions } from "../src/db/schema";
import { importCanonicalListeningPackage } from "../src/lib/import/listening/importer";
import { listeningCanonicalContentSchema, listeningExample } from "../src/lib/import/listening/canonical";
import {
  canonicalListeningTypeId,
  listeningIdentityReviewNotes,
  listeningKindMap,
  listeningQuestionIdentity,
  listeningTypeSummary,
} from "../src/lib/listening/question-identity";
import { questionType, questionTypesFor, resolveQuestionType } from "../src/lib/content/question-types";
import { materializeListeningRevision } from "../src/lib/listening/question-set";
import { contentVersions, listeningTests } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";

/**
 * QUESTION-TYPE IDENTITY (I1–I6) — the canonical identity of a Listening question, decided ONCE at
 * the boundary where source material becomes stored content.
 *
 * The defect these pin: the canonical import wrote no type code at all and hand-rolled the coarse
 * two-value enum from `options.length`, so a COMPLETION question carrying a word bank and a MAP
 * carrying its A–I label pool were both stored as `multiple_choice` — the owner's explicitly
 * forbidden "options ⇒ MCQ", and, because `listMcqQuestions` filters exactly that value, a map or a
 * matching question would be served by MCQ Mastery.
 *
 * The rules being tested, in the owner's words: a SOURCE ALIAS is not a CANONICAL ID; a generic
 * `completion` canonical type must never be invented; a completion whose subtype the source did not
 * prove belongs in staff review, not in a guess; an ACTIVITY NAME is not a question type; and an
 * option pool never proves a type.
 */

const EXAMPLE_AUDIO_KEY = "listening-test-11-identity-qa.mp3";

type SourceQuestion = {
  number: number;
  section: number;
  /** What the source itself says — a canonical id, an alias, or one of the coarse words. */
  type: string;
  text: string;
  options: string[];
  key: string;
  alternatives: string[];
  instruction: string;
};

const POOL = ["A the sports hall", "B the library", "C the car park", "D the cafe"];

/**
 * Ten questions, one per interesting case. Numbers are 1–10 and sections 1–4 so the package is a
 * legal full test through the real validator.
 */
const SOURCE_QUESTIONS: SourceQuestion[] = [
  { number: 1, section: 1, type: "completion", text: "The registration desk is near ____ .", options: POOL, key: "the library", alternatives: [], instruction: "Complete the notes. Write ONE WORD AND/OR A NUMBER." },
  { number: 2, section: 1, type: "completion", text: "The course begins in ____ .", options: [], key: "September", alternatives: [], instruction: "Complete the notes." },
  { number: 3, section: 1, type: "note_completion", text: "The fee is ____ pounds.", options: [], key: "twenty", alternatives: [], instruction: "Complete the notes." },
  { number: 4, section: 2, type: "map", text: "Where is the water fountain?", options: POOL, key: "C", alternatives: [], instruction: "Choose the correct letter, A–D." },
  { number: 5, section: 2, type: "plan_labeling", text: "Where is the ticket office?", options: POOL, key: "A", alternatives: [], instruction: "Choose the correct letter, A–D." },
  { number: 6, section: 2, type: "matching", text: "Which service does the speaker describe?", options: POOL, key: "B", alternatives: [], instruction: "Choose the correct letter, A–D." },
  { number: 7, section: 3, type: "mcq", text: "How long does the tour last?", options: ["A one hour", "B two hours", "C three hours"], key: "B", alternatives: [], instruction: "Choose the correct letter, A, B or C." },
  { number: 8, section: 3, type: "mcq_multi", text: "Which TWO items are included?", options: ["A a map", "B a guidebook", "C a coffee", "D a ticket"], key: "A,C", alternatives: [], instruction: "Choose TWO letters." },
  { number: 9, section: 3, type: "SC", text: "Visitors should bring ____ .", options: [], key: "a notebook", alternatives: [], instruction: "Complete the sentence." },
  { number: 10, section: 4, type: "mcq_single", text: "The lecture is about ____ .", options: ["A Mayan writing", "B Roman roads", "C Greek drama"], key: "A", alternatives: [], instruction: "Choose the correct letter, A, B or C." },
];

/**
 * The canonical package the importer receives: the shipped example envelope, with a question set
 * written for this contract. `content` goes through the real content schema first (exactly what the
 * import pipeline does before it reaches `normalizeListeningPackage`), so the questions are the
 * canonical shape the door accepts — `key`, not the authoring alias `answer`.
 */
const pkgFor = (questions: SourceQuestion[], sourceRef: string) => {
  const raw = listeningExample() as { assets?: { key: string; role: string }[] };
  const example = listeningCanonicalContentSchema.parse((raw as { content: unknown }).content);
  const content = listeningCanonicalContentSchema.parse({
    ...example,
    audio: { ...example.audio, assetKey: EXAMPLE_AUDIO_KEY },
    questions: questions.map((question, index) => ({
      number: question.number,
      section: question.section,
      type: question.type,
      instruction: question.instruction,
      text: question.text,
      options: question.options,
      key: question.key,
      alternatives: question.alternatives,
      pair: [],
      evidence: { at: 30 + index * 20, end: 35 + index * 20, why: `The speaker states the answer for question ${question.number}.` },
    })),
  });
  return {
    ...(raw as Record<string, unknown>),
    sourceRef,
    content,
    assets: (raw.assets ?? []).map((asset) => (asset.role === "audio" ? { ...asset, key: EXAMPLE_AUDIO_KEY } : asset)),
  } as never;
};

const importOptions = (ownerId: string) => ({
  actorUserId: ownerId,
  publish: true,
  publishAuthorized: true,
  assets: [
    {
      key: EXAMPLE_AUDIO_KEY,
      role: "audio" as const,
      uploadId: "22222222-2222-4222-8222-222222222222",
      objectKey: "audio/identity-qa.mp3",
      mimeType: "audio/mpeg",
      size: 2048,
      originalName: "identity-qa.mp3",
    },
  ],
});

async function owner(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  const [row] = await database.query<{ id: string }>(`insert into users (name, role) values ('Identity owner', 'owner') returning id`);
  return row!.id;
}

test("I1 the kind table is EXHAUSTIVE over the registry's Listening types", () => {
  const registered = questionTypesFor("listening").map((type) => type.id).sort();
  const mapped = Object.keys(listeningKindMap()).sort();
  assert.deepEqual(
    mapped,
    registered,
    "every registered Listening type states its coarse kind — a new type cannot escape this table silently",
  );
  assert.equal(registered.length, 14, "the Listening registry states 14 canonical types");
  for (const [typeId, kind] of Object.entries(listeningKindMap())) {
    assert.ok(["completion", "mcq", "matching", "map"].includes(kind), `${typeId} carries a declared kind`);
  }
});

test("I2 the two registry doors stay two doors, and storage converges on the canonical id", () => {
  // The canonical door knows canonical ids only.
  assert.equal(questionType("mcq", "listening"), undefined, "a source alias is not a canonical id");
  assert.equal(questionType("SC", "listening"), undefined);
  assert.equal(questionType("mcq_single", "listening")?.id, "mcq_single");

  // The alias door knows the source's spellings.
  assert.equal(resolveQuestionType("mcq", "listening")?.id, "mcq_single");
  assert.equal(resolveQuestionType("map", "listening")?.id, "map_labeling");
  assert.equal(resolveQuestionType("plan", "listening")?.id, "plan_labeling");
  assert.equal(resolveQuestionType("SC", "listening")?.id, "sentence_completion");

  // Canonical storage: an alias loses the competition, the canonical id wins.
  assert.equal(canonicalListeningTypeId("mcq"), "mcq_single", "never store the alias as the permanent identity");
  assert.equal(canonicalListeningTypeId("mcq_single"), "mcq_single");
  assert.equal(canonicalListeningTypeId("SC"), "sentence_completion");
  assert.equal(canonicalListeningTypeId(undefined), null);

  // "completion" is a source GROUP, not a canonical type. The registry has no such type, this module
  // must not invent one, and the absence is the documented behaviour — not a bug to fix.
  assert.equal(canonicalListeningTypeId("completion"), null);
  assert.equal(questionTypesFor("listening").some((type) => type.id === "completion"), false, "no generic completion type exists");
});

test("I3 only a genuine multiple choice may ever be stored as multiple_choice", () => {
  const registered = questionTypesFor("listening");
  const mcq: string[] = [];
  for (const type of registered) {
    const identity = listeningQuestionIdentity({ typeCode: type.id });
    assert.equal(identity.typeCode, type.id, `${type.id} keeps its exact canonical identity`);
    assert.equal(identity.review, null, `${type.id} is a named type: nothing is unproven`);
    const isChoice = identity.storageType === "multiple_choice";
    if (isChoice) mcq.push(type.id);
    assert.equal(
      isChoice,
      type.id === "mcq_single" || type.id === "mcq_multi",
      `${type.id}: the stored enum claims MCQ only for a type that IS multiple choice`,
    );
  }
  assert.deepEqual(mcq.sort(), ["mcq_multi", "mcq_single"], "the MCQ surfaces read the stored enum, so it may hold only these");
});

test("I4 what the source did not prove is REPORTED, never guessed", () => {
  const completion = listeningQuestionIdentity({ kind: "completion" });
  assert.equal(completion.typeCode, "short_answer", "an unproven completion is a typed answer — the answer model every completion kind shares");
  assert.equal(completion.storageType, "short_answer");
  assert.match(completion.review ?? "", /does not prove which completion kind/);

  const named = listeningQuestionIdentity({ kind: "completion", typeCode: "note_completion" });
  assert.deepEqual(named, { typeCode: "note_completion", storageType: "short_answer", review: null });

  const map = listeningQuestionIdentity({ kind: "map" });
  assert.equal(map.typeCode, "map_labeling");
  assert.equal(map.storageType, "short_answer", "a label pool is not multiple choice at the storage layer");
  assert.match(map.review ?? "", /map_labeling vs plan_labeling/);

  const matching = listeningQuestionIdentity({ kind: "matching" });
  assert.deepEqual(matching, { typeCode: "matching", storageType: "short_answer", review: null });

  const unknown = listeningQuestionIdentity({});
  assert.equal(unknown.typeCode, null, "no stated shape proves nothing at all");
  assert.ok(unknown.review);

  const strange = listeningQuestionIdentity({ kind: "mcq", typeCode: "choose_the_odd_one" });
  assert.equal(strange.typeCode, "mcq_single", "an unrecognised name does not stop the shape it stated");
  assert.match(strange.review ?? "", /choose_the_odd_one/, "and the unrecognised name is surfaced");

  // The shared helpers the import and the staff preview both use.
  const notes = listeningIdentityReviewNotes([
    { number: 1, kind: "completion" },
    { number: 2, kind: "completion" },
    { number: 3, kind: "completion", typeCode: "note_completion" },
    { number: 4, kind: "map" },
  ]);
  assert.equal(notes.length, 2, "identical notes are one note, and a proven type produces none");
  assert.match(notes[0]!, /^Q1, Q2: /);
  assert.match(notes[1]!, /^Q4: /);

  const summary = listeningTypeSummary([
    { kind: "completion", typeCode: "note_completion" },
    { kind: "completion", typeCode: "table_completion" },
    { kind: "map", typeCode: "map_labeling" },
    { kind: "mcq" },
  ]);
  assert.deepEqual(summary, [
    { typeId: "note_completion", count: 1 },
    { typeId: "table_completion", count: 1 },
    { typeId: "map_labeling", count: 1 },
    { typeId: "mcq_single", count: 1 },
  ]);
});

test("I5 a real import stores each question's canonical identity, and MCQ surfaces get only real MCQ", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const ownerId = await owner(database);
    const imported = await db.transaction((tx) => importCanonicalListeningPackage(tx, pkgFor(SOURCE_QUESTIONS, "listening-identity-qa"), importOptions(ownerId)));
    assert.equal(imported.ok, true, imported.ok ? "" : imported.code);
    if (!imported.ok) return;

    const rows = await db
      .select()
      .from(listeningQuestions)
      .where(eq(listeningQuestions.testId, imported.targetId))
      .orderBy(listeningQuestions.order);
    assert.equal(rows.length, SOURCE_QUESTIONS.length);

    const expected: Record<number, { type: string; typeCode: string }> = {
      1: { type: "short_answer", typeCode: "short_answer" }, // completion carrying a word bank
      2: { type: "short_answer", typeCode: "short_answer" },
      3: { type: "short_answer", typeCode: "note_completion" }, // the source named its own type
      4: { type: "short_answer", typeCode: "map_labeling" }, // the forbidden Q11–14 → MCQ
      5: { type: "short_answer", typeCode: "plan_labeling" },
      6: { type: "short_answer", typeCode: "matching" },
      7: { type: "multiple_choice", typeCode: "mcq_single" },
      8: { type: "multiple_choice", typeCode: "mcq_multi" },
      9: { type: "short_answer", typeCode: "sentence_completion" }, // the alias "SC" converged
      10: { type: "multiple_choice", typeCode: "mcq_single" },
    };
    for (const row of rows) {
      const want = expected[row.order]!;
      assert.equal(row.type, want.type, `Q${row.order} is stored as the type it IS`);
      assert.equal(row.typeCode, want.typeCode, `Q${row.order} keeps its canonical identity`);
      assert.notEqual(row.typeCode, "mcq", `Q${row.order}: an alias is never the stored identity`);
    }

    // The MCQ surfaces (`listMcqQuestions`) read exactly this value; a map, a matching question or a
    // completion must never appear there.
    const mcqOrders = rows.filter((row) => row.type === "multiple_choice").map((row) => row.order);
    assert.deepEqual(mcqOrders, [7, 8, 10], "only genuine multiple choice reaches MCQ Mastery");

    // The staff who receive the material are told what the source did not prove.
    assert.ok(
      imported.warnings.some((warning) => warning.startsWith("Q1, Q2: ")),
      `the unproven completion subtype is reported for review (got: ${imported.warnings.join(" | ")})`,
    );
    assert.equal(
      imported.warnings.some((warning) => warning.includes("Q7") || warning.includes("Q8")),
      false,
      "a named multiple choice needs no review note",
    );
  } finally {
    await database.close();
  }
});

test("I6 re-importing converges the stored identity instead of keeping a NULL for ever", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const ownerId = await owner(database);
    const first = await db.transaction((tx) => importCanonicalListeningPackage(tx, pkgFor(SOURCE_QUESTIONS, "listening-identity-qa-2"), importOptions(ownerId)));
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const before = await db
      .select()
      .from(listeningQuestions)
      .where(eq(listeningQuestions.testId, first.targetId))
      .orderBy(listeningQuestions.order);

    // The staff confirmed the subtype of Q2 and Q1 with a corrected source.
    const corrected = SOURCE_QUESTIONS.map((question) =>
      question.number === 2 ? { ...question, type: "table_completion" } : question,
    );
    const second = await db.transaction((tx) => importCanonicalListeningPackage(tx, pkgFor(corrected, "listening-identity-qa-2"), importOptions(ownerId)));
    assert.equal(second.ok, true);
    if (!second.ok) return;

    const after = await db
      .select()
      .from(listeningQuestions)
      .where(eq(listeningQuestions.testId, first.targetId))
      .orderBy(listeningQuestions.order);
    assert.equal(after.length, before.length, "convergence updates rows, it does not duplicate them");
    assert.equal(after.find((row) => row.order === 2)?.typeCode, "table_completion", "the corrected type reaches the stored row");
    assert.equal(after.find((row) => row.order === 2)?.id, before.find((row) => row.order === 2)?.id, "the same row, so learner history keeps pointing at it");
    assert.equal(after.find((row) => row.order === 4)?.typeCode, "map_labeling", "and nothing else drifts");
    assert.equal(
      second.warnings.some((warning) => warning.startsWith("Q2")),
      false,
      "the confirmed subtype is no longer reported as unproven",
    );
  } finally {
    await database.close();
  }
});

test("I7 the AUTHORING writer files an authored question exactly as the import does", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const ownerId = await owner(database);
    const [test] = await db
      .insert(listeningTests)
      .values({ title: "Authored identity QA", audioType: "audio", sourceRef: "identity-authored-qa", publicationState: "draft", createdByUserId: ownerId })
      .returning();
    const [version] = await db
      .insert(contentVersions)
      .values({
        module: "listening",
        contentType: "section",
        sourceRef: "identity-authored-qa",
        versionNo: 1,
        status: "published",
        title: "Authored identity QA",
        contentSnapshot: { sectionNo: 1, questions: [] },
        contentHash: "1".repeat(64),
        semanticHash: "1".repeat(64),
        answerKeyHash: "1".repeat(64),
        targetType: "listening_test",
        targetId: test!.id,
        createdByUserId: ownerId,
      })
      .returning();

    /*
     * A snapshot in the shape authoring actually writes: the CANONICAL id (what `listeningProjection`
     * stores), plus the older spellings that must keep materializing exactly as they always did, plus
     * one spelling nobody knows — which must be preserved rather than turned into a question type.
     */
    const authoredTypes = ["mcq_single", "mcq_multi", "matching", "map_labeling", "form_completion", "mcq", "multiple_choice", "SC", "cloze"];
    const written = await materializeListeningRevision(db, {
      targetId: test!.id,
      versionId: version!.id,
      snapshot: {
        sectionNo: 1,
        questions: authoredTypes.map((type, index) => ({
          order: index + 1,
          type,
          questionText: `Authored question ${index + 1}`,
          options: ["A one", "B two", "C three"],
          correctAnswer: "A one",
          explanation: "Authored evidence.",
        })),
      },
    });
    assert.equal(written, authoredTypes.length);

    const rows = await db
      .select()
      .from(listeningQuestions)
      .where(eq(listeningQuestions.testId, test!.id))
      .orderBy(listeningQuestions.order);

    assert.deepEqual(
      rows.map((row) => [row.order, row.type, row.typeCode]),
      [
        [1, "multiple_choice", "mcq_single"],
        [2, "multiple_choice", "mcq_multi"],
        [3, "short_answer", "matching"],
        [4, "short_answer", "map_labeling"],
        [5, "short_answer", "form_completion"],
        [6, "multiple_choice", "mcq_single"],
        [7, "multiple_choice", "mcq_single"],
        [8, "short_answer", "sentence_completion"],
        // An unknown authored spelling is refused at draft time; if one reaches here it keeps its own
        // name and is treated as a typed answer — never promoted into multiple choice.
        [9, "short_answer", "cloze"],
      ],
      "authored rows carry the canonical identity, whichever spelling the author used",
    );

    const mcqOrders = rows.filter((row) => row.type === "multiple_choice").map((row) => row.order);
    assert.deepEqual(mcqOrders, [1, 2, 6, 7], "an authored single-choice question is not lost to MCQ Mastery");
  } finally {
    await database.close();
  }
});
