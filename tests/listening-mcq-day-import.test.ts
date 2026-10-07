import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { listeningQuestions, listeningTests } from "../src/db/schema";
import { importCanonicalListeningPackage, importLegacyListeningRuntime } from "../src/lib/import/listening/importer";
import { listeningPackageSchema } from "../src/lib/listening/package";
import { listeningCanonicalContentSchema, listeningPreview } from "../src/lib/import/listening/canonical";
import { storedListeningPackage } from "../src/lib/import/listening";
import { mcqProgramDays } from "../src/lib/data/listening-mcq";
import { mcqDayPublicationBlock } from "../src/lib/listening/publication-guards";
import { MCQ_PROGRAM_REF } from "../src/lib/listening/mcq-program";
import { createTestDatabase } from "./support/pglite";

/**
 * IMPORTING A DAY — the staff door (§26–27).
 *
 * A day is authored where every other canonical Listening package is authored: the same inert parse,
 * the same canonical validation, the same preview, the same import transaction. What this suite adds
 * is the day's own identity and its checklist:
 *
 *   I1  a canonical MCQ package that declares a programme day becomes that day — the columns are
 *       written, and the learner's catalogue lists exactly that day at exactly that ordinal;
 *   I2  a SECOND item claiming the same day is refused in words (the database would refuse it too);
 *   I3  a day filed as anything but an MCQ item is refused — the destination is a fact, not a guess;
 *   I4  a partial day imports as a draft that cannot be published, and five valid questions make it
 *       publishable (the publication gate is the promise);
 *   I5  the preview answers the staff checklist from the package itself (count against five, options
 *       per question, answers present, evidence moments, the recording's source);
 *   I6  a day is REFUSED on the legacy authored-runtime path rather than quietly losing its relation;
 *   I7  fixtures are deleted, with the removal asserted.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const KEY = "QASECRETKEY-MUSEUM";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

/** A canonical MCQ day package: one recording, five questions, an explicit programme day. */
function dayPackage(input: { day: number; count?: number; collection?: string; sourceRef?: string } = { day: 1 }) {
  const count = input.count ?? 5;
  const raw = {
    schemaVersion: 2,
    module: "listening",
    contentType: "full_test",
    sourceRef: input.sourceRef ?? `qa-mcq-day-${input.day}`,
    title: `QA fixture — MCQ day ${input.day}`,
    language: "en",
    provenance: { source: "owner_authored", note: "QA fixture for the MCQ programme import door." },
    publication: { state: "draft" },
    assets: [{ key: "audio.full", role: "audio", required: true, mimeTypes: ["audio/mpeg"], path: "audio/day.mp3" }],
    content: {
      collection: input.collection ?? "mcq",
      programme: { ref: MCQ_PROGRAM_REF, day: input.day },
      audio: { durationSec: 300, assetKey: "audio.full", path: "audio/day.mp3" },
      sections: [{ number: 1, title: `Day ${input.day}`, transcript: "QA transcript." }],
      questions: Array.from({ length: count }, (_, index) => ({
        number: index + 1,
        section: 1,
        kind: "mcq",
        text: `QA day ${input.day} question ${index + 1}`,
        instruction: "Choose the correct answer",
        options: ["A) one", "B) two", "C) three"],
        key: KEY,
        alternatives: [],
        pair: [],
        evidence: { at: (index + 1) * 10, why: "QA evidence" },
      })),
      keyword1: [],
      keyword2: [],
      vocabulary: [],
    },
  };
  return { ...raw, content: listeningCanonicalContentSchema.parse(raw.content) } as never;
}

async function seed(): Promise<{ database: TestDatabase; importDay: (pkg: unknown, publish?: boolean) => ReturnType<typeof importCanonicalListeningPackage> }> {
  const database = await createTestDatabase();
  await database.query(`insert into users (id, name, role) values ('${OWNER}', 'Programme owner', 'owner')`);
  const importDay = (pkg: unknown, publish = false) =>
    database.db.transaction((tx) =>
      importCanonicalListeningPackage(tx, pkg as never, {
        actorUserId: OWNER,
        publish,
        publishAuthorized: publish,
        assets: [
          {
            key: "audio.full",
            role: "audio" as const,
            uploadId: "11111111-1111-4111-8111-111111111111",
            objectKey: `audio/${input(pkg)}.mp3`,
            mimeType: "audio/mpeg",
            size: 1024,
            originalName: "day.mp3",
          },
        ],
      }),
    );
  return { database, importDay };
}

/** The asset object key is derived from the package's own source identity, never a fixed string. */
function input(pkg: unknown): string {
  return (pkg as { sourceRef: string }).sourceRef;
}

test("I1 a canonical package that declares a day becomes that day, at that authored ordinal", async () => {
  const { database, importDay } = await seed();
  try {
    const result = await importDay(dayPackage({ day: 4 }));
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result));
    if (!result.ok) return;

    // The relation is written on the item, not inferred from a title later.
    const [row] = await database.db.select().from(listeningTests).where(eq(listeningTests.id, result.targetId));
    assert.equal(row?.programRef, MCQ_PROGRAM_REF);
    assert.equal(row?.programOrdinal, 4);
    assert.equal(row?.title, "QA fixture — MCQ day 4");

    // The five questions are canonical rows in their authored order, which is the day's sequence.
    const questions = await database.db
      .select()
      .from(listeningQuestions)
      .where(eq(listeningQuestions.testId, result.targetId))
      .orderBy(listeningQuestions.order);
    assert.deepEqual(questions.map((question) => question.order), [1, 2, 3, 4, 5]);
    assert.deepEqual(questions.map((question) => question.typeCode), ["mcq_single", "mcq_single", "mcq_single", "mcq_single", "mcq_single"]);

    // And the learner's programme home lists DAY 4 — the authored ordinal, not an index.
    const catalogue = await mcqProgramDays({ id: OWNER, role: "owner" }, { includeDrafts: true }, database.db);
    assert.deepEqual(catalogue.days.map((day) => day.day), [4]);
    assert.equal(catalogue.days[0]!.testId, result.targetId);
    assert.equal(catalogue.days[0]!.questionCount, 5);

    // The stored payload keeps the relation too, so a later reader never depends on the columns alone.
    const stored = storedListeningPackage(dayPackage({ day: 4 }));
    assert.deepEqual(stored.programme, { ref: MCQ_PROGRAM_REF, day: 4 });
  } finally {
    await database.close();
  }
});

test("I2 a second item claiming the same day is refused in words — and no second DAY 4 exists", async () => {
  const { database, importDay } = await seed();
  try {
    const first = await importDay(dayPackage({ day: 6 }));
    assert.equal(first.ok, true);

    // A different sourceRef, the same authored day: refused before the database has to say no.
    const second = await importDay(dayPackage({ day: 6, sourceRef: "qa-mcq-day-6-again" }));
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "source_conflict");
    const message = second.report.issues.map((entry) => entry.message).join(" | ");
    assert.match(message, /Day 6/, `the refusal names the day: ${message}`);
    assert.match(message, /already item/i, "and points at the item that claims it");

    const rows = await database.db.select().from(listeningTests).where(eq(listeningTests.programOrdinal, 6));
    assert.equal(rows.length, 1, "exactly one DAY 6 exists");

    // The SAME item may be re-imported (a corrected package) without colliding with itself.
    const again = await importDay(dayPackage({ day: 6 }));
    assert.equal(again.ok, true, "the same source identity updates in place");
    if (again.ok) assert.equal(again.targetId, first.ok ? first.targetId : again.targetId);
  } finally {
    await database.close();
  }
});

test("I3 a day filed as an Academic test or a General section is refused — the destination is a fact, not a guess", async () => {
  const { database, importDay } = await seed();
  try {
    for (const collection of ["academic", "general", "essential"]) {
      const result = await importDay(dayPackage({ day: 9, collection, sourceRef: `qa-mcq-day-9-${collection}` }));
      assert.equal(result.ok, false, `a day filed as ${collection} must not import`);
      if (result.ok) continue;
      assert.equal(result.code, "semantic_invalid");
      assert.match(
        result.report.issues.map((entry) => entry.message).join(" | "),
        /authored as an MCQ item/,
        "the refusal states the destination rule",
      );
    }

    /*
     * Question-type practice has a rule of its own that fires first (it must declare the practice
     * type it drills), so it is refused before the destination rule is reached. Refused is what
     * matters, and it is refused either way — the day is never created.
     */
    const practice = await importDay(dayPackage({ day: 9, collection: "question_types", sourceRef: "qa-mcq-day-9-question_types" }));
    assert.equal(practice.ok, false, "a day filed as question-type practice must not import either");
    if (!practice.ok) assert.equal(practice.code, "semantic_invalid");
    // Nothing was written by any of those attempts.
    assert.equal((await database.db.select().from(listeningTests)).length, 0);
    // The rule is stated at BOTH doors: the canonical validator staff meet, and the writer itself,
    // so a direct import call cannot create a day filed as anything else.
    const { readFileSync } = await import("node:fs");
    const importer = readFileSync(new URL("../src/lib/import/listening/importer.ts", import.meta.url), "utf8");
    assert.match(importer, /if \(payload\.collection !== "mcq"\)/, "the writer refuses a day that is not an MCQ item");
  } finally {
    await database.close();
  }
});

test("I4 a partial day imports as a draft that cannot be published; five valid questions can", async () => {
  const { database, importDay } = await seed();
  try {
    const four = await importDay(dayPackage({ day: 2, count: 4 }));
    assert.equal(four.ok, true, "four questions save as a draft — no fifth question is invented to let it through");
    if (!four.ok) return;
    const block = await mcqDayPublicationBlock(four.targetId, database.db);
    assert.ok(block, "and that draft cannot be published");
    assert.equal(block.present, 4);
    assert.ok(block.issues.some((issue) => issue.includes("exactly 5")));

    // Authoring completes the day, then publication is allowed.
    await database.db
      .insert(listeningQuestions)
      .values({
        testId: four.targetId,
        order: 5,
        questionText: "QA day 2 question 5",
        type: "multiple_choice",
        typeCode: "mcq_single",
        options: ["A) one", "B) two"],
        correctAnswer: KEY,
        explanation: "",
      });
    assert.equal(await mcqDayPublicationBlock(four.targetId, database.db), null, "five valid MCQs with a recording publish");

    // Six questions is a refusal again (the extra is never silently dropped).
    await database.db
      .insert(listeningQuestions)
      .values({
        testId: four.targetId,
        order: 6,
        questionText: "QA day 2 question 6",
        type: "multiple_choice",
        typeCode: "mcq_single",
        options: ["A) one", "B) two"],
        correctAnswer: KEY,
        explanation: "",
      });
    const six = await mcqDayPublicationBlock(four.targetId, database.db);
    assert.ok(six?.issues.some((issue) => issue.includes("this one has 6")));
  } finally {
    await database.close();
  }
});

test("I5 the preview answers the staff checklist from the package itself", async () => {
  const day = listeningPreview(dayPackage({ day: 7 }) as never);
  const line = (label: string) => day.lines.find((entry) => entry.label.startsWith(label))?.value;

  assert.match(String(line("Programme day")), new RegExp(`DAY 7$`), "the preview states the day it belongs to");
  assert.equal(line("Questions (needs 5)"), "5", "the count is stated against the five a day needs");
  assert.equal(line("Options per question"), "3 · 3 · 3 · 3 · 3", "each question's real option count");
  assert.equal(line("Answers present"), "5/5", "how many questions can actually be graded");
  assert.match(String(line("Recording source")), /audio\/day\.mp3 \(5 min\)/, "where the recording comes from, and how long it is");
  assert.match(String(line("Evidence timestamps")), /5\/5 questions/, "and whether review can point at the recording");
  assert.deepEqual(day.warnings, [], "a complete five-question day raises no warning");

  // A partial day warns in the preview — the same sentence the publication gate uses.
  const partial = listeningPreview(dayPackage({ day: 8, count: 3 }) as never);
  assert.ok(partial.warnings.some((warning) => warning.includes("exactly 5")), partial.warnings.join(" | "));
  assert.equal(partial.lines.find((entry) => entry.label.startsWith("Answers present"))?.value, "3/3");
  // Every warning is a statement about the material, never a suggestion to invent content.
  assert.ok(partial.warnings.every((warning) => !/add |invent|create /i.test(warning)));
});

test("I6 a day is refused on the legacy authored-runtime path, with the reason stated", async () => {
  const { database } = await seed();
  try {
    /*
     * The legacy path is the compatibility one for material that still needs its own HTML runtime. A
     * day is native — its five questions are canonical rows — so a legacy bundle claiming to be a day
     * is refused in words instead of importing with its programme relation quietly dropped.
     */
    const stored = storedListeningPackage(dayPackage({ day: 3 }));
    const legacy = listeningPackageSchema.parse({
      ...stored,
      authoredRuntime: { entryPath: "index.html", files: { "index.html": "<p>QA legacy bundle</p>" } },
    });

    const outcome = await database.db.transaction((tx) =>
      importLegacyListeningRuntime(tx, legacy, {
        actorUserId: OWNER,
        publish: false,
        publishAuthorized: false,
        assets: [
          {
            key: "audio.full",
            role: "audio" as const,
            uploadId: "11111111-1111-4111-8111-111111111111",
            objectKey: "audio/legacy-day.mp3",
            mimeType: "audio/mpeg",
            size: 1024,
            originalName: "day.mp3",
          },
        ],
      }),
    );
    assert.equal(outcome.ok, false, "a day is not legacy material");
    if (outcome.ok) return;
    assert.equal(outcome.code, "invalid_input");
    const message = outcome.report.issues.map((entry) => entry.message).join(" | ");
    assert.match(message, /canonical package, not as legacy authored material/);
    assert.equal((await database.db.select().from(listeningTests)).length, 0, "and nothing was written");
  } finally {
    await database.close();
  }
});

test("I7 the fixtures are removed: no imported day remains", async () => {
  const { database, importDay } = await seed();
  try {
    const days = await Promise.all([1, 2, 3, 4, 5].map((day) => importDay(dayPackage({ day }))));
    assert.ok(days.every((day) => day.ok), "five QA days imported");
    assert.equal((await mcqProgramDays({ id: OWNER, role: "owner" }, { includeDrafts: true }, database.db)).days.length, 5);

    /*
     * The fixtures are found by the identity the IMPORTER writes: a canonical import stores the
     * source identity on its package (`listening_packages.source_id`) and on its revision — the
     * item's own legacy `source_ref` column is not part of that path, so cleanup must not pretend
     * it is.
     */
    const fixtureIds = `(select test_id from listening_packages where source_id like 'qa-mcq-day-%')`;
    await database.query(`delete from listening_mcq_sessions where test_id in ${fixtureIds}`);
    await database.query(`delete from listening_questions where test_id in ${fixtureIds}`);
    await database.query(`delete from resource_blocks where owner_type = 'listening' and owner_id in ${fixtureIds}`);
    await database.query(`delete from listening_packages where source_id like 'qa-mcq-day-%'`);
    await database.query(`delete from content_imports where source_ref like 'qa-mcq-day-%'`);
    await database.query(`delete from content_versions where source_ref like 'qa-mcq-day-%'`);
    await database.query(`delete from listening_tests where id in (select id from listening_tests where title like 'QA fixture — MCQ day %')`);

    const page = await mcqProgramDays({ id: OWNER, role: "owner" }, { includeDrafts: true }, database.db);
    assert.equal(page.days.length, 0, "the programme is empty again");
    const residue = await database.query<{ tests: number; questions: number; packages: number }>(`
      select (select count(*)::integer from listening_tests) as tests,
             (select count(*)::integer from listening_questions) as questions,
             (select count(*)::integer from listening_packages) as packages`);
    assert.deepEqual(residue[0], { tests: 0, questions: 0, packages: 0 }, "no QA row remains");
  } finally {
    await database.close();
  }
});
