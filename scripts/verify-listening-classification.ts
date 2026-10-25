/**
 * REAL-DATABASE ACCEPTANCE — the owner's classification and pagination dataset.
 *
 *   Academic Listening:  70 published formal full tests
 *   dedicated MCQ:        5 published packages (`collection: mcq`)
 *   question types:       3 published packages (`collection: question_types`)
 *   drafts:               4 (invisible to learners)
 *   archived:             2 (not offered)
 *
 * It seeds exactly that into an ISOLATED QA database, then asserts the learner-visible result:
 *
 *   • the Academic catalogue offers the 70 formal full tests and NOTHING else;
 *   • every one of the 70 is reachable through the real page reader (no cap, no repeats,
 *     no disappearances) while each single query stays bounded;
 *   • an MCQ training package is not an Academic full test, and its canonical identity is
 *     untouched (`collection` in the row is still `mcq` — it was never relabelled);
 *   • drafts are invisible and archived content is not offered, while attempt history on a
 *     retired test stays readable;
 *   • ONE row whose identity cannot be proven is left unclassified and reported for owner
 *     review rather than guessed into the catalogue.
 *
 * Fixtures are removed at the end and the removal is proven. Read-only towards every other
 * database: it refuses to run unless DATABASE_URL points at a `qa`-named database, and it
 * refuses to run when PRODUCTION/VERCEL flags are present.
 *
 *   DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 \
 *     node --conditions=react-server --import tsx scripts/verify-listening-classification.ts
 */
import pg from "pg";
import { listeningProduct } from "../src/lib/listening/product";
import { academicListeningCards } from "../src/lib/data/listening-academic";

const url = process.env.DATABASE_URL ?? "";
if (!url) throw new Error("DATABASE_URL is required");
if (process.env.VERCEL || process.env.VERCEL_ENV) throw new Error("refusing to run with Vercel deployment flags set");
const databaseName = new URL(url).pathname.replace(/^\//, "");
if (!/qa/i.test(databaseName)) throw new Error(`refusing to seed fixtures into "${databaseName}": the database name must contain "qa"`);

const PREFIX = "qa-classify-";
const client = new pg.Client({ connectionString: url });
await client.connect();

let checks = 0;
let failures = 0;
function ok(condition: boolean, label: string, detail = "") {
  checks += 1;
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** The catalogue reader runs through the application's own drizzle path. */
const { db } = await import("../src/db/tooling-client").then((module) => ({ db: module.db }));
process.env.DATABASE_URL = url;

async function cleanup() {
  // Never the in-run id list: everything this script creates is named by its prefix, and
  // attempts/questions/packages go in FK order so cleanup cannot half-fail.
  await client.query(`delete from listening_attempts where test_id in (select id from listening_tests where source_ref like $1)`, [`${PREFIX}%`]);
  await client.query(`delete from listening_questions where test_id in (select test_id from listening_packages where source_id like $1)`, [`${PREFIX}%`]);
  await client.query(`delete from listening_packages where source_id like $1`, [`${PREFIX}%`]);
  await client.query(`delete from content_versions where source_ref like $1`, [`${PREFIX}%`]);
  await client.query(`delete from listening_tests where source_ref like $1`, [`${PREFIX}%`]);
}

async function insertTest(input: {
  key: string;
  title: string;
  publicationState: string;
  publishAt?: Date | null;
  package?: { collection?: string | null; parts: number; questions: number } | null;
  sourceId?: string | null;
  ownerId: string;
}): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into listening_tests (created_by_user_id, title, audio_type, audio_url, source_ref, is_active, publication_state, publish_at, created_at)
     values ($1, $2, 'audio', 'qa/audio.mp3', $3, true, $4::publication_state, $5, now())
     returning id`,
    [input.ownerId, input.title, `${PREFIX}${input.key}`, input.publicationState, input.publishAt ?? null],
  );
  const testId = rows[0]!.id;
  if (input.package) {
    const sections = Array.from({ length: input.package.parts }, (_, index) => ({ sectionNo: index + 1, title: `Part ${index + 1}` }));
    const questions = Array.from({ length: input.package.questions }, (_, index) => ({
      number: index + 1,
      type: "short_answer",
      questionText: `Question ${index + 1}: write the word you hear`,
      options: [],
      correctAnswer: "answer",
      explanation: "",
    }));
    const payload: Record<string, unknown> = { schemaVersion: 1, testId, title: input.title, sections, questions, studyPack: undefined };
    if (input.package.collection) payload.collection = input.package.collection;
    await client.query(
      `insert into listening_packages (test_id, source_id, payload, audio_object_key, source_hash, legacy_runtime)
       values ($1, $2, $3::jsonb, $4, $5, false)`,
      [testId, input.sourceId ?? `${PREFIX}${input.key}`, JSON.stringify(payload), `qa/${input.key}.mp3`, "0".repeat(64)],
    );
    for (const [index, question] of questions.entries()) {
      await client.query(
        `insert into listening_questions (test_id, type, question_text, options, correct_answer, explanation, "order")
         values ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [testId, question.type, question.questionText, JSON.stringify(question.options), question.correctAnswer, question.explanation, index + 1],
      );
    }
  }
  return testId;
}

try {
  await cleanup();
  const { rows: owners } = await client.query<{ id: string }>(`select id from users where role = 'owner' limit 1`);
  const ownerId = owners[0]?.id;
  if (!ownerId) throw new Error("QA database has no owner user (run npm run qa:pg)");
  const { rows: learners } = await client.query<{ id: string }>(`select id from users where role = 'student' limit 1`);
  const learnerId = learners[0]?.id;
  if (!learnerId) throw new Error("QA database has no student user (run npm run qa:pg)");

  console.log("seeding the owner's acceptance dataset (70 academic, 5 mcq, 3 question types, 4 drafts, 2 archived)…");
  const academicIds: string[] = [];
  for (let index = 1; index <= 70; index += 1) {
    academicIds.push(
      await insertTest({
        key: `academic-${String(index).padStart(3, "0")}`,
        title: `Academic Full Test ${index}`,
        publicationState: "published",
        publishAt: new Date(Date.now() - 86_400_000),
        package: { collection: "academic", parts: 4, questions: 40 },
        ownerId,
      }),
    );
  }
  const mcqIds: string[] = [];
  for (let index = 1; index <= 5; index += 1) {
    mcqIds.push(
      await insertTest({
        key: `mcq-${index}`,
        title: `MCQ Training Package ${index}`,
        publicationState: "published",
        publishAt: new Date(Date.now() - 86_400_000),
        package: { collection: "mcq", parts: 1, questions: 5 },
        ownerId,
      }),
    );
  }
  const questionTypeIds: string[] = [];
  for (let index = 1; index <= 3; index += 1) {
    questionTypeIds.push(
      await insertTest({
        key: `qtype-${index}`,
        title: `Question Type Practice ${index}`,
        publicationState: "published",
        publishAt: new Date(Date.now() - 86_400_000),
        package: { collection: "question_types", parts: 1, questions: 5 },
        ownerId,
      }),
    );
  }
  const draftIds: string[] = [];
  for (let index = 1; index <= 4; index += 1) {
    draftIds.push(
      await insertTest({
        key: `draft-${index}`,
        title: `Draft Academic Test ${index}`,
        publicationState: "draft",
        package: { collection: "academic", parts: 4, questions: 40 },
        ownerId,
      }),
    );
  }
  const archivedIds: string[] = [];
  for (let index = 1; index <= 2; index += 1) {
    archivedIds.push(
      await insertTest({
        key: `archived-${index}`,
        title: `Archived Academic Test ${index}`,
        publicationState: "archived",
        package: { collection: "academic", parts: 4, questions: 40 },
        ownerId,
      }),
    );
  }
  // ONE row whose identity cannot be proven: a legacy canonical import with no collection and
  // a structure that is not the formal exam. It must NOT be guessed into the catalogue.
  const unprovenId = await insertTest({
    key: "legacy-unproven",
    title: "Legacy Recording Without Provenance",
    publicationState: "published",
    publishAt: new Date(Date.now() - 86_400_000),
    package: { collection: null, parts: 1, questions: 5 },
    ownerId,
  });
  // A retired test the learner has history on: archived, not offered, history untouched.
  const historyId = archivedIds[0]!;
  await client.query(
    `insert into listening_attempts (test_id, user_id, status, score, total_questions, submitted_at)
     values ($1, $2, 'completed', 26, 40, now())`,
    [historyId, learnerId],
  );

  console.log("A1–A6 the catalogue offers the 70 formal full tests and nothing else");
  const page1 = await academicListeningCards(learnerId, 1, db);
  ok(page1.total === 70, "the catalogue reports 70 tests", `got ${page1.total}`);
  ok(page1.cards.length === 24, "one page is bounded (24)", `got ${page1.cards.length}`);
  ok(page1.hasMore, "the reader can move on");
  const titles = new Set(page1.cards.map((card) => card.title));
  ok([...titles].every((title) => title.startsWith("Academic Full Test")), "only formal full tests are listed");
  ok(mcqIds.every((id) => !page1.cards.some((card) => card.testId === id)), "no MCQ package on page 1");
  ok(questionTypeIds.every((id) => !page1.cards.some((card) => card.testId === id)), "no question-type practice on page 1");
  ok(draftIds.every((id) => !page1.cards.some((card) => card.testId === id)), "drafts are invisible");
  ok(archivedIds.every((id) => !page1.cards.some((card) => card.testId === id)), "archived tests are not offered");
  ok(!page1.cards.some((card) => card.testId === unprovenId), "an unprovable legacy row is not guessed into the catalogue");

  console.log("A7 every published test is reachable: paging covers the catalogue exactly once");
  const seen: string[] = [];
  let page = 1;
  let guard = 0;
  while (guard < 20) {
    guard += 1;
    const current = await academicListeningCards(learnerId, page, db);
    seen.push(...current.cards.map((card) => card.testId));
    if (!current.hasMore) break;
    page += 1;
  }
  ok(page === 3, "the catalogue is three pages", `reached page ${page}`);
  ok(seen.length === 70, "all 70 tests are reachable", `saw ${seen.length}`);
  ok(new Set(seen).size === 70, "no test is listed twice", `distinct ${new Set(seen).size}`);
  ok(academicIds.every((id) => seen.includes(id)), "every seeded full test appeared");
  const firstPageAgain = await academicListeningCards(learnerId, 1, db);
  ok(
    firstPageAgain.cards.map((card) => card.testId).join() === page1.cards.map((card) => card.testId).join(),
    "page 1 is stable across requests (deterministic order)",
  );

  console.log("A3 the canonical identity of practice content is untouched, and it is classified truthfully");
  const { rows: collections } = await client.query<{ collection: string; count: number }>(
    `select payload->>'collection' as collection, count(*)::int as count
       from listening_packages where source_id like $1 group by 1 order by 1`,
    [`${PREFIX}%`],
  );
  const byCollection = Object.fromEntries(collections.map((row) => [row.collection, row.count]));
  ok(byCollection.mcq === 5, "the five MCQ packages still say `mcq` in the database", JSON.stringify(byCollection));
  ok(byCollection.question_types === 3, "the three question-type packages still say `question_types`");
  const { rows: unproven } = await client.query<{ payload: Record<string, unknown> }>(
    `select payload from listening_packages where source_id = $1`,
    [`${PREFIX}legacy-unproven`],
  );
  ok(
    listeningProduct({
      collection: (unproven[0]!.payload as { collection?: string }).collection ?? null,
      hasPackage: true,
      parts: (unproven[0]!.payload as { sections: unknown[] }).sections.length,
      questions: (unproven[0]!.payload as { questions: unknown[] }).questions.length,
    }) === "unclassified",
    "the unprovable row classifies as `unclassified` (owner review, no guess)",
  );

  console.log("A2 archived content is not offered while history stays readable");
  const { rows: history } = await client.query<{ count: number }>(
    `select count(*)::int as count from listening_attempts where test_id = $1 and user_id = $2`,
    [historyId, learnerId],
  );
  ok(history[0]!.count === 1, "the learner's attempt on the retired test is still there");
  const { rows: archivedState } = await client.query<{ publication_state: string }>(`select publication_state from listening_tests where id = $1`, [historyId]);
  ok(archivedState[0]!.publication_state === "archived", "and the test itself is archived, not deleted");

  console.log("cleanup — the fixtures are removed and the removal is proven");
  await cleanup();
  const { rows: residue } = await client.query<{ tests: number; packages: number; versions: number }>(
    `select (select count(*)::int from listening_tests where source_ref like $1) as tests,
            (select count(*)::int from listening_packages where source_id like $1) as packages,
            (select count(*)::int from content_versions where source_ref like $1) as versions`,
    [`${PREFIX}%`],
  );
  ok(residue[0]!.tests === 0 && residue[0]!.packages === 0 && residue[0]!.versions === 0, "no fixture rows remain", JSON.stringify(residue[0]));
  const after = await academicListeningCards(learnerId, 1, db);
  ok(after.total === 0, "the catalogue is empty again", `got ${after.total}`);

  console.log(`\n${checks - failures} / ${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  await client.end();
  // The application pool is cached on the global object outside production; release it so the
  // script exits instead of hanging on an idle connection.
  const cached = (globalThis as { __learnersAreaPool?: { end: () => Promise<void> } }).__learnersAreaPool;
  await cached?.end().catch(() => {});
}
