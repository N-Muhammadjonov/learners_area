import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { listeningQuestions, listeningTests } from "../src/db/schema";
import { mcqDayPublicationBlock } from "../src/lib/listening/publication-guards";
import { MCQ_PROGRAM_REF } from "../src/lib/listening/mcq-program";
import { createTestDatabase } from "./support/pglite";

/**
 * THE PUBLICATION DOOR OF THE MCQ PROGRAMME.
 *
 * The owner's rule: a learner-visible DAY holds EXACTLY five valid multiple-choice questions. A
 * draft may hold fewer while staff are working; PUBLISHING it may not. This suite proves the refusal
 * against real PostgreSQL for the day itself (four questions, six questions, a letter-answer
 * question, a missing key, a duplicated question, no recording), proves that exactly five valid
 * questions pass, and proves the door is wired into the ONE endpoint that publishes anything —
 * without changing the verdict for an Academic test or a General section.
 *
 * Fixtures are created here and deleted at the end, with the removal asserted.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const KEY = "QASECRETKEY-MUSEUM";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

async function insertDay(
  database: TestDatabase,
  input: { sourceRef: string; programRef?: string | null; programOrdinal?: number | null; audioUrl?: string | null; contentType?: string },
): Promise<string> {
  const [row] = await database.db
    .insert(listeningTests)
    .values({
      title: `QA fixture — ${input.sourceRef}`,
      audioType: "audio",
      sourceRef: input.sourceRef,
      createdByUserId: OWNER,
      publicationState: "draft",
      programRef: input.programRef === undefined ? MCQ_PROGRAM_REF : input.programRef,
      programOrdinal: input.programOrdinal === undefined ? 1 : input.programOrdinal,
      audioUrl: input.audioUrl === undefined ? "https://cdn.example.test/qa/day.mp3" : input.audioUrl,
    })
    .returning();
  return row!.id;
}

/** Question rows as the importer/authoring writes them: canonical type + options + a key. */
async function insertQuestions(
  database: TestDatabase,
  testId: string,
  questions: { order: number; text: string; typeCode?: string; type?: "multiple_choice" | "short_answer"; options?: string[] | null; correctAnswer?: string }[],
): Promise<void> {
  await database.db.insert(listeningQuestions).values(
    questions.map((question) => ({
      testId,
      order: question.order,
      questionText: question.text,
      type: question.type ?? "multiple_choice",
      typeCode: question.typeCode ?? "mcq_single",
      options: question.options === undefined ? ["A) one", "B) two", "C) three"] : question.options,
      correctAnswer: question.correctAnswer ?? KEY,
      explanation: "QA explanation (staff/QA only).",
    })),
  );
}

async function seed(): Promise<{ database: TestDatabase; day: (input: Parameters<typeof insertDay>[1]) => Promise<string> }> {
  const database = await createTestDatabase();
  await database.query(`insert into users (id, name, role) values ('${OWNER}', 'Programme owner', 'owner')`);
  return { database, day: (input) => insertDay(database, input) };
}

function five(): { order: number; text: string }[] {
  return [1, 2, 3, 4, 5].map((order) => ({ order, text: `Fixture question ${order}` }));
}

test("E1 a four-question day may not be published — and the fifth question is never invented", async () => {
  const { database, day } = await seed();
  try {
    const id = await day({ sourceRef: "listening-mcq-qa-four" });
    await insertQuestions(database, id, five().slice(0, 4));

    const block = await mcqDayPublicationBlock(id, database.db);
    assert.ok(block, "a four-question day is refused");
    assert.equal(block.error, "incomplete_mcq_day");
    assert.equal(block.required, 5, "the rule states the authored shape");
    assert.equal(block.present, 4, "and how many valid questions the day really holds");
    assert.ok(block.issues.some((issue) => issue.includes("exactly 5")), `the refusal states the rule: ${block.issues.join(" | ")}`);
    assert.ok(
      block.issues.every((issue) => !/Question 5\b.*(missing|invented|add)/.test(issue)),
      "and never proposes inventing the missing question",
    );
  } finally {
    await database.close();
  }
});

test("E2 a six-question day may not be published — the extra question is never silently dropped", async () => {
  const { database, day } = await seed();
  try {
    const id = await day({ sourceRef: "listening-mcq-qa-six" });
    await insertQuestions(database, id, [...five(), { order: 6, text: "Fixture question 6" }]);
    const block = await mcqDayPublicationBlock(id, database.db);
    assert.ok(block, "six questions is a refusal, not a trim");
    assert.equal(block.present, 6, "six valid questions were found");
    assert.ok(block.issues.some((issue) => issue.includes("this one has 6")));
  } finally {
    await database.close();
  }
});

test("E3 a day of exactly five valid questions passes the door — publication is the only thing left", async () => {
  const { database, day } = await seed();
  try {
    const id = await day({ sourceRef: "listening-mcq-qa-five" });
    await insertQuestions(database, id, five());
    assert.equal(await mcqDayPublicationBlock(id, database.db), null, "five genuine MCQs with a recording are publishable");

    // Mixed canonical MCQ identities are fine: single and multi are both genuine MCQ.
    const multi = await day({ sourceRef: "listening-mcq-qa-multi", programOrdinal: 2 });
    await insertQuestions(
      database,
      multi,
      five().map((question) => ({ ...question, typeCode: "mcq_multi", text: `Multi ${question.text}` })),
    );
    assert.equal(await mcqDayPublicationBlock(multi, database.db), null, "choose-TWO days publish too");
  } finally {
    await database.close();
  }
});

test("E4 a question that is not genuinely multiple choice blocks the day — Matching, Map/Plan and letter answers included", async () => {
  const { database, day } = await seed();
  try {
    const matching = await day({ sourceRef: "listening-mcq-qa-matching" });
    await insertQuestions(database, matching, [
      ...five().slice(0, 4),
      { order: 5, text: "Match the speakers to their rooms", typeCode: "matching", options: ["A) one", "B) two", "C) three"], correctAnswer: "one" },
    ]);
    const matchBlock = await mcqDayPublicationBlock(matching, database.db);
    assert.ok(matchBlock?.issues.some((issue) => issue.includes("Question 5") && issue.includes("not a multiple-choice question")));

    const map = await day({ sourceRef: "listening-mcq-qa-map", programOrdinal: 2 });
    await insertQuestions(database, map, [
      ...five().slice(0, 4),
      { order: 5, text: "Label the museum plan", typeCode: "map_labeling", options: ["A) one", "B) two"], correctAnswer: "one" },
    ]);
    assert.ok((await mcqDayPublicationBlock(map, database.db))?.issues.some((issue) => issue.includes("not a multiple-choice question")));

    // A LEGACY row that only states the compatibility enum is refused as well: option pools and
    // letters are exactly what a map/plan import used to look like.
    const legacy = await day({ sourceRef: "listening-mcq-qa-legacy", programOrdinal: 3 });
    await insertQuestions(
      database,
      legacy,
      five().map((question) => ({ ...question, typeCode: "", options: ["A) one", "B) two"] })),
    );
    const legacyBlock = await mcqDayPublicationBlock(legacy, database.db);
    assert.ok(legacyBlock, "an unproven type does not publish as MCQ");
    assert.ok(legacyBlock.issues.some((issue) => issue.includes("not a multiple-choice question")));
  } finally {
    await database.close();
  }
});

test("E5 a question with no key, one usable option, or a duplicate of another question blocks the day", async () => {
  const { database, day } = await seed();
  try {
    const noKey = await day({ sourceRef: "listening-mcq-qa-nokey" });
    await insertQuestions(database, noKey, [...five().slice(0, 4), { order: 5, text: "Fixture question 5", correctAnswer: "   " }]);
    assert.ok((await mcqDayPublicationBlock(noKey, database.db))?.issues.some((issue) => issue.includes("no correct answer")));

    const oneOption = await day({ sourceRef: "listening-mcq-qa-oneoption", programOrdinal: 2 });
    await insertQuestions(database, oneOption, [...five().slice(0, 4), { order: 5, text: "Fixture question 5", options: ["A) only one"] }]);
    assert.ok((await mcqDayPublicationBlock(oneOption, database.db))?.issues.some((issue) => issue.includes("at least two")));

    // The same question twice — a duplicated import — is not five questions.
    const duplicate = await day({ sourceRef: "listening-mcq-qa-duplicate", programOrdinal: 3 });
    await insertQuestions(database, duplicate, [
      { order: 1, text: "Which room is next to the cafe?" },
      { order: 2, text: "Which room is next to the cafe?" },
      { order: 3, text: "Fixture question 3" },
      { order: 4, text: "Fixture question 4" },
      { order: 5, text: "Fixture question 5" },
    ]);
    const duplicateBlock = await mcqDayPublicationBlock(duplicate, database.db);
    assert.ok(duplicateBlock?.issues.some((issue) => issue.includes("repeats question 1")), duplicateBlock?.issues.join(" | "));
  } finally {
    await database.close();
  }
});

test("E6 a day with no recording may not be published — five questions nobody can hear are not a day", async () => {
  const { database, day } = await seed();
  try {
    const id = await day({ sourceRef: "listening-mcq-qa-noaudio", audioUrl: null });
    await insertQuestions(database, id, five());
    const block = await mcqDayPublicationBlock(id, database.db);
    assert.ok(block?.issues.some((issue) => issue.includes("no recording")), "an afternoon of silence is refused");
  } finally {
    await database.close();
  }
});

test("E7 the day rule applies to programme days ONLY — an Academic test and a General section keep their own verdicts", async () => {
  const { database, day } = await seed();
  try {
    // An Academic full test: not in a programme, however its questions look.
    const academic = await day({ sourceRef: "listening-mcq-qa-academic", programRef: null, programOrdinal: null });
    await insertQuestions(database, academic, [
      { order: 1, text: "Academic question 1", typeCode: "completion", options: null, correctAnswer: "one" },
    ]);
    assert.equal(await mcqDayPublicationBlock(academic, database.db), null, "not this module's business");

    // A General section with five MCQs and no recording: still not a programme day.
    const general = await day({ sourceRef: "listening-mcq-qa-general", programRef: null, programOrdinal: null, audioUrl: null });
    await insertQuestions(database, general, five());
    assert.equal(await mcqDayPublicationBlock(general, database.db), null, "a section is judged by the section rules");

    // A row of ANOTHER programme is not this programme's day either.
    const other = await day({ sourceRef: "listening-mcq-qa-other", programRef: "another-programme", programOrdinal: 1, audioUrl: null });
    await insertQuestions(database, other, five().slice(0, 3));
    assert.equal(await mcqDayPublicationBlock(other, database.db), null, "a day number only means something within its own programme");

    // A published revision's set is what is judged (the same live-set resolver the drill uses),
    // so a superseded set cannot rescue a day — asserted in the source contract in E8.
  } finally {
    await database.close();
  }
});

test("E8 the refusal is enforced at the ONE publication endpoint, for admins only — and it is the day's own rule that runs first", () => {
  const code = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  const route = code("src/app/api/admin/content/[type]/[id]/publication/route.ts");
  assert.match(route, /requireAdministrator\(\)/, "publication is admin/owner only — a teacher prepares, never publishes");
  assert.match(route, /await mcqDayPublicationBlock\(id\)/, "the day rule runs at the publication door");
  assert.match(route, /if \(dayBlock\) return NextResponse\.json\(dayBlock, \{ status: 409 \}\)/, "and it refuses with 409, not a warning");
  // It runs BEFORE the package rule and only on the way IN (published/scheduled), never on archive.
  const guardIndex = route.indexOf("await mcqDayPublicationBlock(id)");
  const packageIndex = route.indexOf("publicationIssues(pkg.payload)");
  assert.ok(guardIndex > 0 && packageIndex > guardIndex, "the day's own rule is decided first");
  assert.match(route, /state === "published" \|\| state === "scheduled"/, "archiving and drafting are never blocked");

  // The staff surface states the rule in the reader's language, with the day's real count.
  const control = code("src/components/admin/PublicationControl.tsx");
  assert.match(control, /data\?\.error === "incomplete_mcq_day"/, "the control recognises the refusal");
  assert.match(control, /dict\.listening\.mcqProgram\.publishRequiresFive/, "and shows the owner's rule sentence");
  assert.match(control, /dict\.listening\.mcqProgram\.publishHolds/, "with the day's own present/required count");

  // The guard is a programme rule: it consults the SAME membership predicate as the learner reads.
  const guard = code("src/lib/listening/publication-guards.ts");
  assert.match(guard, /isMcqDayRow\(\{ programRef: row\.programRef, programOrdinal: row\.programOrdinal \}\)/, "membership is the relation + ordinal");
  assert.match(guard, /listeningQuestionsForLiveTest\(testId, database\)/, "and the day is judged on its LIVE question set");
});

test("the fixtures are removed: the publication door has nothing left to judge", async () => {
  const { database, day } = await seed();
  try {
    const id = await day({ sourceRef: "listening-mcq-qa-cleanup" });
    await insertQuestions(database, id, five().slice(0, 4));
    assert.ok(await mcqDayPublicationBlock(id, database.db), "a refused day exists");

    await database.query(`delete from listening_questions where test_id in (select id from listening_tests where source_ref like 'listening-mcq-qa-%')`);
    await database.query(`delete from content_versions where source_ref like 'listening-mcq-qa-%'`);
    await database.query(`delete from listening_tests where source_ref like 'listening-mcq-qa-%'`);

    const residue = await database.query<{ tests: number; questions: number; versions: number }>(`
      select (select count(*)::integer from listening_tests where source_ref like 'listening-mcq-qa-%') as tests,
             (select count(*)::integer from listening_questions) as questions,
             (select count(*)::integer from content_versions where source_ref like 'listening-mcq-qa-%') as versions`);
    assert.deepEqual(residue[0], { tests: 0, questions: 0, versions: 0 }, "no QA row remains");
    assert.equal(await mcqDayPublicationBlock(id, database.db), null, "and a deleted day has nothing to block");
  } finally {
    await database.close();
  }
});
