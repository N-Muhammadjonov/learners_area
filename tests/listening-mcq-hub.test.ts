import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { contentVersions, listeningPackages, listeningQuestions, listeningTests } from "../src/db/schema";
import { listeningPackageSchema } from "../src/lib/listening/package";
import { academicListeningCards } from "../src/lib/data/listening-academic";
import { generalListeningCards } from "../src/lib/data/listening-general";
import { mcqProgramDays } from "../src/lib/data/listening-mcq";
import { MCQ_PROGRAM_REF } from "../src/lib/listening/mcq-program";
import { createTestDatabase } from "./support/pglite";

/**
 * THE LISTENING HUB AND ITS FOUR DESTINATIONS (owner §35–37).
 *
 * Listening is four different products, and a learner must never be handed one in the place of
 * another. That is a rule about PLACEMENT, so this suite checks placement twice: the hub as a
 * surface (four doors, and no content of its own), and the destinations against a real database —
 * where a day must be invisible to Academic Listening and General Listening, and an Academic test's
 * own MCQs must never become programme days.
 *
 * The wrong list, each named and refuted:
 *   • a Test's MCQ activity inside the MCQ programme      → the programme is a relation, not a type;
 *   • a DAY opening the Academic hub                      → a day is mcq_programme, always;
 *   • a General section opening as a Day                  → the day reader asks the relation only;
 *   • the MCQ catalogue listing full tests                → it asks the relation, not `collection`.
 *
 * Fixtures are created here and deleted at the end, with the removal asserted.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const KEY = "QASECRETKEY-HUB";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const HUB = "src/app/app/(shell)/listening/page.tsx";

test("F1 the hub opens the owner's four destinations — and lists no content of its own", () => {
  const hub = code(HUB);
  const navigation = code("src/components/navigation/ModuleNavigation.tsx");
  const routes = [...navigation.matchAll(/href: "(\/app\/listening\/[a-z]+)"/g)].map(match => match[1]);
  assert.deepEqual(routes, ["/app/listening/lessons", "/app/listening/academic", "/app/listening/general", "/app/listening/mcq"]);
  assert.match(code("src/app/app/(shell)/listening/layout.tsx"), /<ModuleNavigation module="listening"/);
  for (const product of ["lessons", "academic", "general", "mcqProgram"])
    assert.ok(navigation.includes(`dict.listening.${product}.title`));
  const links = code("src/components/navigation/ModuleSectionNav.tsx");
  assert.match(links, /<Link key=\{link.key\} href=\{href\}/);
  assert.doesNotMatch(hub, /data-listening-destination|className="card/);

  // No catalogue, no library component, no data read: a hub that lists content is where the wrong
  // placement happened (a Test's MCQ card beside Academic tests, a day under Academic).
  for (const forbidden of ["FullListeningLibrary", "fullListeningCards", "legacyListeningCards", "academicListeningCards", "generalListeningCards", "mcqProgramDays", "RegionFailureNotice"])
    assert.ok(!hub.includes(forbidden), `the hub must not read or list content (${forbidden})`);
  assert.doesNotMatch(hub, /<\s*audio|autoPlay/, "and it starts nothing by itself");

  // Old bookmarks and old paging links still land here, and every destination exists as a route.
  assert.match(hub, /requireActiveUser\(\)/, "the module door is still server-gated");
  assert.match(hub, /redirect\("\/app\/listening\/lessons"\)/, "old bookmarks and paging URLs lead to the real Lessons section");
  assert.match(code("src/app/app/(shell)/listening/lessons/page.tsx"), /data-route-usable="listening-lessons"/);
  assert.doesNotMatch(hub, /searchParams.*parseInt\(query\.page/s, "…and is simply unused: the hub has no pages");
  for (const route of ["lessons", "academic", "general", "mcq", "history"])
    assert.ok(existsSync(new URL(`../src/app/app/(shell)/listening/${route}/page.tsx`, import.meta.url)), `/app/listening/${route} exists`);
});

test("F2 each destination reads its OWN catalogue — no page borrows another product's reader", () => {
  const expectations: [string, string][] = [
    ["lessons", "listLessonLibrary"],
    ["academic", "academicListeningCards"],
    ["general", "generalListeningCards"],
    ["mcq", "mcqProgramDays"],
  ];
  for (const [route, reader] of expectations) {
    const page = code(`src/app/app/(shell)/listening/${route}/page.tsx`);
    assert.ok(page.includes(reader), `/app/listening/${route} reads ${reader}`);
  }
  // …and nothing else: a destination that also read another product's catalogue would be the mix-up.
  for (const [route, reader] of expectations)
    for (const [, other] of expectations.filter(([, name]) => name !== reader))
      assert.ok(
        !code(`src/app/app/(shell)/listening/${route}/page.tsx`).includes(other),
        `/app/listening/${route} must not read ${other}`,
      );

  // The MCQ reader asks the PROGRAMME RELATION. It must never classify by a package's collection,
  // which is what would let a full test filed as "mcq" (or a General section holding MCQs) in.
  const mcq = code("src/lib/data/listening-mcq.ts");
  assert.match(mcq, /eq\(listeningTests\.programRef, MCQ_PROGRAM_REF\)/, "membership is the relation");
  assert.match(mcq, /sql`\$\{listeningTests\.programOrdinal\} is not null`/, "at an explicit ordinal");
  assert.ok(!mcq.includes("listeningPackages"), "and it never consults a package's collection");
  assert.ok(!/collection/i.test(mcq), "no collection string appears in the programme reads at all");
});

test("F3 a day is invisible to Academic Listening and General Listening — the wrong lists cannot happen", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    await database.query(`insert into users (id, name, role) values ('${OWNER}', 'Hub owner', 'owner'), ('${LEARNER}', 'Hub learner', 'student')`);

    const insert = async (input: { title: string; sourceRef: string; programOrdinal?: number | null; contentType?: "full_test" | "section" | null }) => {
      const [row] = await db
        .insert(listeningTests)
        .values({
          title: input.title,
          audioType: "audio",
          sourceRef: input.sourceRef,
          publicationState: "published",
          publishAt: new Date(),
          createdByUserId: OWNER,
          programRef: input.programOrdinal === undefined || input.programOrdinal === null ? null : MCQ_PROGRAM_REF,
          programOrdinal: input.programOrdinal ?? null,
        })
        .returning();
      await db.insert(listeningQuestions).values(
        Array.from({ length: 5 }, (_, index) => ({
          testId: row!.id,
          order: index + 1,
          questionText: `${input.title} question ${index + 1}`,
          type: "multiple_choice" as const,
          typeCode: "mcq_single",
          options: ["A) one", "B) two"],
          correctAnswer: KEY,
          explanation: "QA explanation.",
        })),
      );
      if (input.contentType)
        await db.insert(contentVersions).values({
          module: "listening",
          contentType: input.contentType,
          sourceRef: input.sourceRef,
          versionNo: 1,
          status: "published",
          title: input.title,
          contentSnapshot: { questions: [] },
          contentHash: "0".repeat(64),
          semanticHash: "0".repeat(64),
          answerKeyHash: "0".repeat(64),
          targetType: "listening_test",
          targetId: row!.id,
          createdByUserId: OWNER,
        });
      return row!.id;
    };

    // A day authored NATIVELY (no package) with a full_test revision: without the programme fact it
    // would be classified as an Academic full test and offered at the Academic hub.
    const nativeDay = await insert({ title: "QA native day", sourceRef: "hub-native-day", programOrdinal: 1, contentType: "full_test" });
    // A day authored as a section revision — the revision alone must not file it as General either.
    const sectionDay = await insert({ title: "QA section-shaped day", sourceRef: "hub-section-day", programOrdinal: 2, contentType: "section" });
    // An ordinary General section (no programme) and an ordinary Academic full test: both keep
    // behaving exactly as before. The Academic one is CANONICAL (a package with the academic
    // collection), because that is what an Academic catalogue entry is — a native full-test row
    // with no package is a recorded authoring-path gap, unrelated to the programme, and asserted
    // as such by tests/listening-academic-hub.test.ts.
    const section = await insert({ title: "QA general section", sourceRef: "hub-general", contentType: "section" });
    const academic = await insert({ title: "QA academic test", sourceRef: "hub-academic", contentType: "full_test" });
    await db.insert(listeningPackages).values({
      testId: academic,
      sourceId: "hub-academic",
      payload: listeningPackageSchema.parse({
        schemaVersion: 1,
        collection: "academic",
        testId: "hub-academic",
        title: "QA academic test",
        category: "full",
        provenance: "QA fixture, hub placement",
        audio: { path: "audio/academic.mp3", durationSec: 1800 },
        imagePath: null,
        sections: [1, 2, 3, 4].map((number) => ({ number, title: `Part ${number}`, transcript: "", reviewRequired: false })),
        questions: [
          { number: 1, section: 1, text: "Q1", instruction: "Choose", kind: "mcq", options: ["A) one", "B) two"], key: KEY, alternatives: [], pair: [], evidence: { at: 5, why: "QA evidence" } },
        ],
        keyword1: [],
        keyword2: [],
        vocabulary: [],
      }),
      audioObjectKey: "qa/hub-academic/audio.mp3",
      sourceHash: "0".repeat(64),
      legacyRuntime: false,
    });

    const academicIds = (await academicListeningCards(LEARNER, 1, db)).cards.map((card) => card.testId);
    const generalIds = (await generalListeningCards(LEARNER, 1, db)).cards.map((card) => card.testId);
    const days = (await mcqProgramDays({ id: LEARNER, role: "student" }, {}, db)).days.map((card) => card.testId);

    for (const day of [nativeDay, sectionDay]) {
      assert.ok(!academicIds.includes(day), "a DAY is never offered by Academic Listening");
      assert.ok(!generalIds.includes(day), "and never by General Listening");
      assert.ok(days.includes(day), "it is offered by the MCQ programme, at its own ordinal");
    }
    assert.ok(generalIds.includes(section), "a real General section is still General");
    assert.ok(academicIds.includes(academic), "a real Academic test is still Academic");
    assert.ok(days.includes(nativeDay) && days.includes(sectionDay), "the programme lists its own days");
    assert.ok(!days.includes(academic) && !days.includes(section), "and nothing else, however many MCQs it holds");

    // A day's ordinal is authored: the catalogue lists DAY 1 and DAY 2 by the stored numbers.
    const catalogue = await mcqProgramDays({ id: LEARNER, role: "student" }, {}, db);
    assert.deepEqual(catalogue.days.map((card) => card.day), [1, 2]);

    // The product a single row resolves to is the same decision the catalogues made.
    const { listeningProductOf } = await import("../src/lib/data/listening-product");
    assert.equal(await listeningProductOf(nativeDay, db), "mcq_programme", "a native day is a programme day");
    assert.equal(await listeningProductOf(section, db), "general_section");
    assert.equal(await listeningProductOf(academic, db), "academic_full_test");

    // Cleanup, with the removal proven.
    const ids = [nativeDay, sectionDay, section, academic];
    for (const id of ids) {
      await database.query(`delete from listening_mcq_sessions where test_id = '${id}'`);
      await database.query(`delete from listening_questions where test_id = '${id}'`);
      await database.query(`delete from listening_packages where test_id = '${id}'`);
      await database.query(`delete from content_versions where target_id = '${id}'`);
      await database.query(`delete from listening_tests where id = '${id}'`);
    }
    const residue = await database.query<{ tests: number; questions: number; versions: number; packages: number }>(`
      select (select count(*)::integer from listening_tests) as tests,
             (select count(*)::integer from listening_questions) as questions,
             (select count(*)::integer from content_versions where source_ref like 'hub-%') as versions,
             (select count(*)::integer from listening_packages where source_id like 'hub-%') as packages`);
    assert.deepEqual(residue[0], { tests: 0, questions: 0, versions: 0, packages: 0 }, "no QA row remains");
  } finally {
    await database.close();
  }
});

test("F4 the four doors are stated once, and the day's own address is not the Academic hub", () => {
  // The day page lives under the MCQ destination and goes back there, never to a hub of another
  // product.
  const day = code("src/app/app/(shell)/listening/mcq/day/[day]/page.tsx");
  assert.match(day, /BackLink fallbackHref="\/app\/listening\/mcq"/, "a day returns to the programme");
  assert.ok(!day.includes("academicListeningTest("), "a day never opens a test hub");

  // The hub's four subtitles exist in BOTH languages, and the MCQ destination's title is the
  // product's own name — never the word "Academic", never a general wording.
  const en = read("src/lib/i18n/en.ts");
  const uz = read("src/lib/i18n/uz.ts");
  for (const source of [en, uz]) {
    assert.match(source, /title: "Listening MCQ"/, "the MCQ destination is named as its own product");
    assert.match(source, /subtitle: "Four separate destinations|subtitle: "To'rt alohida yo'nalish/);
  }
  assert.ok(!/Listening MCQ[\s\S]{0,80}Academic Listening/.test(en.slice(en.indexOf("mcqProgram: {"), en.indexOf("mcqProgram: {") + 600)), "the MCQ copy never borrows Academic's name");

  // Every existing Listening deep link still resolves: the history page and the legacy import
  // redirect are untouched by the hub's change.
  assert.ok(existsSync(new URL("../src/app/app/(shell)/listening/history/page.tsx", import.meta.url)));
  const legacyImport = read("src/app/app/(shell)/listening/import/page.tsx");
  assert.match(legacyImport, /redirect\(administrator \? "\/app\/admin\/listening\/import" : "\/app\/listening"\)/, "the legacy import URL still redirects somewhere real");
});
