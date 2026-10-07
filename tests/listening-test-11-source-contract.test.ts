import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8 } from "fflate";
import { readSafeArchive } from "../src/lib/import/archive";
import { listeningPackageSchema, LISTENING_ACTIVITY_IDS, type ListeningPackage } from "../src/lib/listening/package";
import {
  activityFacts,
  mapDiagramSections,
  packageActivities,
  supportsActivity,
  testActivities,
} from "../src/lib/listening/activities";
import { COLLECTION_TABS, collectionTabOf, productOfPackage } from "../src/lib/listening/product";
import { questionType, resolveQuestionType, questionTypesFor } from "../src/lib/content/question-types";
import { listeningInputModeFor } from "../src/lib/listening/question-control";
import { mapDiagramSchema, extractMapDiagram } from "../src/lib/listening/map-diagram";
import { buildMcqPayload } from "../src/lib/services/listening/mcq-payload";
import { MCQ_STAGES } from "../src/lib/services/listening/mcq-mastery";

/**
 * LISTENING TEST 11 — THE OWNER SOURCE CONTRACT.
 *
 * The owner supplied `Listening Test 11.zip` and a read-only Arena reference derived from it. This
 * file reads THAT REFERENCE PACKAGE ITSELF (through the repository's own safe archive reader, the
 * same one an import uses) rather than a transcription of it, and pins the facts the owner stated:
 * 4 parts / 40 questions, Q1–10 Completion, Q11–14 Map/Plan, Q15–25 MCQ, Q26–30 Matching, Q31–40
 * Completion, four full transcripts with six authored Script Completion gaps each, twenty
 * vocabulary items, and nine supported activity concepts.
 *
 * WHAT THIS FILE IS CAREFUL NOT TO DO:
 *   • it never claims to hold the owner's question text. The reference package deliberately carries
 *     METADATA, not the questions, and the 16.5 MB audio binary is deliberately absent, so the
 *     structure is proven with a clearly-labelled STRUCTURE FIXTURE that mirrors the reference —
 *     never with invented wording presented as the owner's;
 *   • it never executes the source HTML/JS, and never treats the reference ZIP as production
 *     content;
 *   • it never touches the separately pinned Test 10 contract (T11-24 asserts exactly that).
 *
 * The audio is therefore an OWNER DEPENDENCY, stated as such: T11-01 proves the binary is absent
 * and that nothing in the repository fabricates or substitutes it.
 */

const REFERENCE_DIR = join(import.meta.dirname, "..", "reference", "listening", "test-11");
const REFERENCE_ZIP = join(REFERENCE_DIR, "Listening_Test_11_ARENA_REFERENCE.zip");

/** Pinned by the reference itself; the owner's original package is a different, larger file. */
const ARENA_REFERENCE_SHA = "d951165448f269074cb870df40b54da7cb28abbda388a1b32bb0c0b5253a2bce";
const OWNER_ZIP_SHA = "ac09de62c60085185ccb540cb9baa1674d58ffc1cf8beaa8656e7ea1910f2a94";
const OWNER_AUDIO_SHA = "39dc7e45666d43585fc5841afed3d33d3ef2e3788b42e28e5693a7c769a64660";
const OWNER_AUDIO_BYTES = 16509954;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type Summary = {
  title: string;
  test_number: number;
  product: string;
  question_count: number;
  part_count: number;
  part_titles: string[];
  question_type_ranges: { from: number; to: number; type: string }[];
  question_type_counts: Record<string, number>;
  activities: string[];
  script_completion: { full_transcript_per_part: boolean; gaps_per_part: number[]; total_gaps: number };
  vocabulary_count: number;
  audio: { path_in_owner_zip: string; duration_seconds: number; bytes: number; sha256: string };
  original_owner_zip: { filename: string; sha256: string };
  /** Per-file fingerprints for the source files the reference deliberately does not ship. */
  source_file_hashes: Record<string, string>;
};

const archive = readSafeArchive(new Uint8Array(readFileSync(REFERENCE_ZIP)));
const readJson = <T,>(name: string): T => JSON.parse(strFromU8(archive[name]!)) as T;
const summary = readJson<Summary>("source-summary.json");
const readme = strFromU8(archive["README.md"]!);

/** The reference's own activity vocabulary, mapped to the canonical registry ids. */
const SOURCE_ACTIVITY_TO_CANONICAL: Record<string, (typeof LISTENING_ACTIVITY_IDS)[number]> = {
  "Full IELTS Test": "exam",
  "Review & Revision": "review",
  "Script Completion": "script",
  "MCQ Mastery": "mcq",
  "Map / Plan Mastery": "map",
  "Matching Mastery": "matching",
  "Completion Mastery": "completion",
  "Vocabulary Builder": "vocab",
  "Retry Weak Areas": "retry",
};

/**
 * A STRUCTURE FIXTURE OF LISTENING TEST 11 — the reference's own ranges and counts, rendered as a
 * canonical package so the import contract can be exercised. The question TEXT is fixture text on
 * purpose: the owner's wording is not in the reference package and is never invented here.
 */
function test11Shape(): ListeningPackage {
  const kindFor = (number: number): "completion" | "mcq" | "matching" | "map" => {
    const range = summary.question_type_ranges.find((r) => number >= r.from && number <= r.to)!;
    return range.type === "MCQ" ? "mcq" : range.type === "Matching" ? "matching" : range.type === "Map / Plan" ? "map" : "completion";
  };
  const labels = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
  return listeningPackageSchema.parse({
    schemaVersion: 1,
    // NO collection on purpose: a real academic full test is proven by its own structure.
    testId: "fixture-test-11-shape",
    title: "Fixture — Listening Test 11 structure",
    category: "full",
    provenance: "Structure fixture derived from the owner's Listening Test 11 reference metadata (not the owner's question text)",
    audio: { path: "assets/audio/full.mp3", durationSec: Math.floor(summary.audio.duration_seconds) },
    imagePath: null,
    mapDiagram: {
      viewBox: [0, 0, 240, 160],
      label: "Plan of the park (structure fixture)",
      shapes: [
        { tag: "rect", x: 10, y: 10, width: 90, height: 60, stroke: "#333333", strokeWidth: 2 },
        { tag: "text", x: 20, y: 30, text: "A Entrance", fontSize: 12 },
        { tag: "circle", cx: 180, cy: 40, r: 8, stroke: "#333333" },
        { tag: "text", x: 170, y: 70, text: "B Cafe", fontSize: 12 },
      ],
    },
    sections: summary.part_titles.map((title, index) => ({
      number: index + 1,
      title,
      transcript: `Part ${index + 1} transcript (structure fixture, one paragraph).`,
      reviewRequired: false,
    })),
    questions: Array.from({ length: summary.question_count }, (_, index) => {
      const number = index + 1;
      const section = summary.question_type_ranges.find((r) => number >= r.from && number <= r.to)!;
      const part = summary.part_titles.findIndex((_, index2) => section.from <= number && number <= section.to && index2 >= 0);
      const kind = kindFor(number);
      return {
        number,
        section: Math.min(4, Math.max(1, section.from <= 10 ? 1 : section.from <= 20 ? 2 : section.from <= 30 ? 3 : 4)),
        text: `Fixture question ${number} (${kind})`,
        instruction: "Choose the correct letter",
        kind,
        options: kind === "completion" ? [] : labels.slice(0, kind === "map" ? 9 : 3).map((letter) => `${letter}) option`),
        key: kind === "completion" ? `answer${number}` : "A",
        alternatives: [],
        pair: [],
        evidence: { at: 60 + number, end: 90 + number, why: `Fixture evidence for question ${number}.` },
      };
    }),
    keyword1: [],
    keyword2: [],
    vocabulary: Array.from({ length: summary.vocabulary_count }, (_, index) => ({
      word: `fixtureword${index + 1}`,
      pos: "noun",
      uz: `fixture${index + 1}`,
      def: `Fixture definition ${index + 1}.`,
      ex: `Fixture example ${index + 1}.`,
      also: [],
    })),
    studyPack: {
      kind: "research-practice",
      activities: summary.activities.map((name) => SOURCE_ACTIVITY_TO_CANONICAL[name]!),
      partRanges: { "1": [0, 420], "2": [420, 840], "3": [840, 1260], "4": [1260, Math.ceil(summary.audio.duration_seconds)] },
      scriptParts: summary.part_titles.map((_, index) => ({
        part: index + 1,
        transcript: `Part ${index + 1} transcript (structure fixture, one paragraph).`,
        gaps: Array.from({ length: summary.script_completion.gaps_per_part[index]! }, (_, gap) => ({
          q: index * 10 + gap + 1,
          match: `fixture chunk ${gap + 1}`,
          answer: `fixture answer ${gap + 1}`,
        })),
      })),
    },
  });
}

test("T11-01 the reference package is present, checksummed, and honestly missing its audio", () => {
  assert.equal(sha256(new Uint8Array(readFileSync(REFERENCE_ZIP))), ARENA_REFERENCE_SHA, "the Arena reference ZIP is byte-for-byte the pinned one");
  // The fingerprints are pinned in two places, and both are checked: the repository copy the
  // reader sees, and the machine-readable summary the test consumes.
  const repositoryReadme = readFileSync(join(REFERENCE_DIR, "README.md"), "utf8");
  for (const [what, sha] of [["the original owner ZIP", OWNER_ZIP_SHA], ["the original audio", OWNER_AUDIO_SHA]] as const) {
    assert.ok(repositoryReadme.includes(sha), `the repository reference README pins ${what}'s SHA-256`);
  }
  assert.equal(summary.original_owner_zip.filename, "Listening Test 11.zip", "the summary names the owner's file");
  assert.equal(summary.original_owner_zip.sha256, OWNER_ZIP_SHA, "and agrees with the README on the owner ZIP");
  assert.equal(summary.audio.sha256, OWNER_AUDIO_SHA, "and on the audio");
  assert.equal(summary.audio.bytes, OWNER_AUDIO_BYTES, "and on its exact size");
  assert.deepEqual(summary.source_file_hashes["assets/audio/full.mp3"], OWNER_AUDIO_SHA, "the per-file hash table carries the same audio fingerprint");
  assert.ok(summary.source_file_hashes["index.html"], "and fingerprints the source page it deliberately does not execute");
  assert.ok(summary.source_file_hashes["Listening Test 11 - Answers.pdf"], "and the answers PDF that must never reach a learner");

  // The truth that governs what may be claimed: this reference is METADATA ONLY.
  assert.deepEqual(Object.keys(archive).sort(), ["README.md", "source-summary.json"], "the reference archive carries exactly the two metadata files");
  assert.equal(Object.keys(archive).some((name) => name.toLowerCase().endsWith(".mp3")), false, "the 16.5 MB audio binary is deliberately ABSENT");
  assert.equal(Object.keys(archive).some((name) => name.toLowerCase().endsWith(".pdf")), false, "and the answers PDF is not shipped to the app either");
  // The reference declares its own limits, in its own words.
  assert.ok(readme.includes("intentionally does not embed"), "the omission is stated, not glossed over");
  assert.ok(readme.includes("Do not invent missing data"), "and the reader is forbidden from filling the gap");
  assert.ok(readme.includes("/app/listening/academic"), "the reference states where the test belongs");
  assert.ok(readme.includes("LISTENING-SOURCE-ZIP-CONTRACT.md"), "and points at the Test 10 contract it must not replace");
  assert.ok(readme.includes("never be executed"), "and forbids executing the source HTML as production runtime");
});

test("T11-02 the product is an Academic Listening full test, not General and not practice", () => {
  const pkg = test11Shape();
  assert.equal(summary.product, "academic_listening", "the owner's own reference says what it is");
  assert.equal(productOfPackage(pkg), "academic_full_test", "the application's decision table agrees from the structure alone (no collection field)");
  assert.equal(collectionTabOf("academic_full_test"), "academic", "so its catalogue tab is Academic");
  assert.equal(COLLECTION_TABS.includes("academic"), true);
  assert.equal(collectionTabOf("general_section"), "general", "and a General section still lands in General — the two are not conflated");
  assert.equal(collectionTabOf("mcq_programme"), "mcq", "a dedicated MCQ package stays MCQ");
});

test("T11-03 / T11-04 four parts and forty questions, from the reference's own ranges", () => {
  assert.equal(summary.part_count, 4, "four parts");
  assert.equal(summary.question_count, 40, "forty questions");
  assert.equal(summary.part_titles.length, 4, "four named parts");
  const pkg = test11Shape();
  assert.equal(pkg.sections.length, 4, "and the canonical package holds four parts");
  assert.equal(pkg.questions.length, 40, "and all forty questions");
  assert.deepEqual(
    [...new Set(pkg.questions.map((q) => q.number))].sort((a, b) => a - b),
    Array.from({ length: 40 }, (_, i) => i + 1),
    "Q1–Q40, each exactly once",
  );
  assert.equal(pkg.questions.every((q) => q.section >= 1 && q.section <= 4), true, "every question belongs to one of the four parts");
});

test("T11-05…T11-09 each range keeps its authored type — Map/Plan is never MCQ", () => {
  const expected: [string, number, number, string][] = [
    ["T11-05", 1, 10, "Completion"],
    ["T11-06", 11, 14, "Map / Plan"],
    ["T11-07", 15, 25, "MCQ"],
    ["T11-08", 26, 30, "Matching"],
    ["T11-09", 31, 40, "Completion"],
  ];
  for (const [id, from, to, type] of expected) {
    const range = summary.question_type_ranges.find((r) => r.from === from && r.to === to);
    assert.ok(range, `${id}: the reference states Q${from}–Q${to}`);
    assert.equal(range!.type, type, `${id}: as ${type}`);
  }
  assert.deepEqual(summary.question_type_counts, { Completion: 20, MCQ: 11, Matching: 5, "Map / Plan": 4 }, "and the totals add up to forty");

  const pkg = test11Shape();
  const kindOf = (n: number) => pkg.questions.find((q) => q.number === n)!.kind;
  assert.equal(kindOf(1), "completion");
  assert.equal(kindOf(10), "completion");
  assert.equal(kindOf(11), "map", "Q11 is a map question");
  assert.equal(kindOf(14), "map", "and so is Q14");
  assert.equal(kindOf(15), "mcq");
  assert.equal(kindOf(25), "mcq");
  assert.equal(kindOf(26), "matching");
  assert.equal(kindOf(30), "matching");
  assert.equal(kindOf(31), "completion");
  assert.equal(kindOf(40), "completion");

  const facts = activityFacts(pkg);
  assert.equal(facts.map, true, "the map fact comes from the questions");
  assert.equal(facts.mcq, true, "MCQ exists — but only from Q15–Q25");
  assert.equal(
    pkg.questions.filter((q) => q.kind !== "matching" && q.kind !== "completion" && q.kind !== "map" && q.options.length >= 2).length,
    11,
    "exactly eleven questions are genuine multiple choice — Q11–14 are not among them",
  );
});

test("T11-10 / T11-11 four full transcripts, six authored gaps each", () => {
  assert.equal(summary.script_completion.full_transcript_per_part, true, "the reference states a full transcript per part");
  assert.deepEqual(summary.script_completion.gaps_per_part, [6, 6, 6, 6], "six gaps per part");
  assert.equal(summary.script_completion.total_gaps, 24, "twenty-four in total");
  const pkg = test11Shape();
  const parts = pkg.studyPack!.scriptParts!;
  assert.equal(parts.length, 4, "the canonical study pack carries all four parts");
  assert.equal(parts.every((part) => (part.transcript ?? "").trim().length > 0), true, "each with a real transcript");
  assert.deepEqual(parts.map((part) => part.gaps.length), [6, 6, 6, 6], "and its authored gaps");
  // Script Completion is offered because the transcripts AND the blanks really exist.
  assert.equal(supportsActivity(pkg, "script"), true, "so Script Completion is a real exercise here");
  const noGaps = listeningPackageSchema.parse({ ...JSON.parse(JSON.stringify(pkg)), studyPack: { ...pkg.studyPack!, scriptParts: parts.map((part) => ({ ...part, gaps: [] })) } });
  assert.equal(supportsActivity(noGaps, "script"), false, "while a transcript without authored blanks is NOT dressed up as Script Completion");
});

test("T11-12 the twenty source vocabulary items fit the canonical model", () => {
  assert.equal(summary.vocabulary_count, 20, "the source has twenty items");
  const pkg = test11Shape();
  assert.equal(pkg.vocabulary.length, 20, "and the canonical package holds twenty");
  assert.equal(supportsActivity(pkg, "vocab"), true, "so Vocabulary Builder is offered");
  const without = listeningPackageSchema.parse({ ...JSON.parse(JSON.stringify(pkg)), vocabulary: [] });
  assert.equal(supportsActivity(without, "vocab"), false, "and no vocabulary means no vocabulary card — nothing is invented");
});

test("T11-13…T11-16 the canonical registry recognises every question type the source uses", () => {
  // Canonical ids resolve by id; source aliases resolve by shape. Both doors, asserted separately,
  // because a test that used the wrong one would "pass" while proving nothing.
  for (const code of ["mcq_single", "mcq_multi", "matching", "map_labeling", "plan_labeling", "note_completion", "form_completion"]) {
    const type = questionType(code, "listening");
    assert.ok(type, `${code} is a canonical Listening id`);
    assert.equal(type!.module, "listening", `${code} is a Listening type`);
  }
  for (const [alias, expected] of [["MAP", "map_labeling"], ["map", "map_labeling"], ["PLAN", "plan_labeling"], ["MCQ", "mcq_single"], ["matching", "matching"], ["NOTE", "note_completion"], ["form", "form_completion"]] as const) {
    assert.equal(resolveQuestionType(alias, "listening")?.id, expected, `the source alias "${alias}" resolves to ${expected}`);
  }
  // The source aliases an importer may carry resolve through the same registry.
  for (const alias of ["MAP", "map", "MCQ", "matching", "NOTE", "form"]) {
    assert.ok(resolveQuestionType(alias, "listening"), `the source alias "${alias}" resolves`);
  }
  // And the control a learner gets follows the registry, not the presence of options.
  assert.equal(listeningInputModeFor({ typeCode: "map_labeling", options: ["A) x"] }), "select");
  assert.equal(listeningInputModeFor({ typeCode: "note_completion", options: ["a hint"] }), "text");
  assert.ok(questionTypesFor("listening").length >= 5, "the Listening registry is populated");
});

test("T11-17 the plan/map visual is available to formal, practice and review from canonical content", async () => {
  const pkg = test11Shape();
  assert.ok(pkg.mapDiagram, "the canonical package carries the plan");
  assert.equal(mapDiagramSchema.safeParse(pkg.mapDiagram).success, true, "and it satisfies the sanitized drawing schema");
  assert.deepEqual(mapDiagramSections(pkg), [2], "and it renders on the part that holds the map questions");
  assert.equal(supportsActivity(pkg, "map"), true, "so Map / Plan Mastery is offered");

  // The extraction path is coordinate-and-text only: running the source page is never required.
  const dom = new (await import("jsdom")).JSDOM(
    `<svg viewBox="0 0 240 160" aria-label="Plan"><rect x="1" y="2" width="3" height="4"/><path d="M0 0 L10 10"/><text x="5" y="6">A Entrance</text><script>window.stolen=true</script><foreignObject><div>html</div></foreignObject></svg>`,
  );
  const diagram = extractMapDiagram(dom.window.document.querySelector("svg")!);
  assert.equal(diagram.shapes.some((shape) => shape.tag === "text" && shape.text === "A Entrance"), true, "labels survive as text");
  assert.equal(JSON.stringify(diagram).includes("script"), false, "no script node is carried across");
  assert.equal(JSON.stringify(diagram).includes("foreignObject"), false, "and no foreign HTML either");
});

test("T11-18 the working view carries no key and no evidence, before or during the exam", () => {
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const page = strip(readFileSync("src/app/app/(focus)/listening/attempts/[id]/page.tsx", "utf8"));
  const projection = page.slice(page.indexOf("questions={pkg.payload.questions.map("), page.indexOf("questions={pkg.payload.questions.map(") + 400);
  assert.ok(projection.includes("text: q.text"), "the exam receives the question text");
  assert.ok(projection.includes("options: q.options"), "and its options");
  for (const secret of ["q.key", "correctAnswer", "q.evidence", "explanation", "transcript"]) {
    assert.equal(projection.includes(secret), false, `the formal exam projection must not carry ${secret}`);
  }
  // The evidence window an authored question carries is a REVIEW affordance; the exam screen
  // must not be able to replay it as a hint.
  assert.equal(/evidence/.test(projection), false, "no evidence window reaches the working exam");
});

test("T11-19 MCQ options are withheld by the server until the reveal stage", () => {
  const question = {
    id: "q-1",
    testId: "t-1",
    order: 15,
    type: "multiple_choice",
    storageType: "multiple_choice",
    typeCode: "mcq_single",
    questionText: "Fixture MCQ",
    options: ["A) first", "B) second", "C) third"],
    correctAnswer: "B",
    explanation: "Fixture explanation.",
    keywords: null,
    paraphrases: null,
    contentVersionId: null,
    createdAt: new Date(),
  } as unknown as Parameters<typeof buildMcqPayload>[1];
  const session = (stage: string) =>
    ({ id: "s-1", stage, notes: null, ownAnswer: null, chosenAnswer: null, reasoning: null }) as unknown as Parameters<typeof buildMcqPayload>[0];

  // STAGE 1 — the learner listens, writes their own notes and commits a prediction. The official
  // options do not exist in the browser at all: not hidden with CSS, not sent.
  for (const stage of ["listen", "notes", "committed"] as const) {
    const payload = buildMcqPayload(session(stage), question);
    assert.equal(payload.options, null, `at "${stage}" the official options are NOT SENT`);
    assert.equal(payload.correctAnswer, null, `and the answer key is not sent either`);
    assert.equal(JSON.stringify(payload).includes("B) second"), false, `no option text appears anywhere in the "${stage}" payload`);
  }
  // STAGE 2 — the reveal: the options arrive ONLY after the learner committed their own answer,
  // and even now the key is still withheld, because the learner has not chosen yet.
  const revealed = buildMcqPayload(session("revealed"), question);
  assert.deepEqual(revealed.options, question.options, "the options arrive at the reveal stage");
  assert.equal(revealed.correctAnswer, null, "the key is still withheld at the reveal — the learner chooses first");
  assert.equal(revealed.explanation, null, "and so is the explanation");
  assert.equal(revealed.outcome, null, "and no correctness is announced");
  // STAGE 3 — after choosing: the key, the explanation and the verdict appear together.
  const chosen = buildMcqPayload({ ...session("chosen"), chosenAnswer: "B" } as unknown as Parameters<typeof buildMcqPayload>[0], question);
  assert.equal(chosen.correctAnswer, "B", "the key appears only after the learner has chosen");
  assert.equal(chosen.explanation, question.explanation, "with the authored explanation");
  assert.equal(chosen.outcome, "correct", "and the verdict");
  assert.deepEqual([...MCQ_STAGES], ["listen", "notes", "committed", "revealed", "chosen", "reasoned"], "the staged flow the owner asked for");
});

test("T11-20 / T11-21 Review needs a submitted attempt, Retry needs genuine misses", () => {
  const pkg = test11Shape();
  // Without a learner: no review, no retry — a brand-new learner is not shown cards they cannot use.
  // Two different questions, answered by two different functions — and both must be right:
  //   `supportsActivity`   → does THIS TEST support the activity at all? (true for review)
  //   `packageActivities`  → what may THIS LEARNER be shown now? (review absent)
  //   `testActivities`     → what would a staff preview offer, with no learner in the picture?
  const fresh = packageActivities(pkg);
  assert.equal(fresh.includes("review"), false, "Review is absent before any attempt exists");
  assert.equal(fresh.includes("retry"), false, "and so is Retry");
  assert.equal(supportsActivity(pkg, "review"), true, "but the TEST genuinely supports review — it needs a learner state, not different content");
  assert.equal(supportsActivity(pkg, "retry"), true, "and retry likewise");
  assert.equal(testActivities(pkg).includes("review"), false, "a staff preview, having no learner, offers neither");

  // After a submitted attempt: Review appears.
  const submitted = packageActivities(pkg, { examSubmitted: true, missedQuestions: 0 });
  assert.equal(submitted.includes("review"), true, "Review appears once there is a result to review");
  assert.equal(submitted.includes("retry"), false, "a perfect attempt still gets no Retry — nothing was missed");

  // With real misses: Retry appears.
  const missed = packageActivities(pkg, { examSubmitted: true, missedQuestions: 3 });
  assert.equal(missed.includes("retry"), true, "Retry appears only from genuine missed questions");
});

test("T11-22 / T11-23 Test 11 enters the Academic catalogue and no other", () => {
  const pkg = test11Shape();
  const product = productOfPackage(pkg);
  assert.equal(product, "academic_full_test", "the product is Academic");
  assert.notEqual(product, "general_section", "it is not a General section");
  assert.notEqual(product, "mcq_programme", "and it is not a dedicated MCQ package");
  assert.notEqual(product, "question_type_practice", "nor question-type practice");
  assert.equal(collectionTabOf(product), "academic", "so the General catalogue cannot list it and neither can the MCQ catalogue");
  // The nine source activity concepts map onto the canonical registry one-for-one, and only
  // those — no invented tenth capability.
  assert.equal(Object.keys(SOURCE_ACTIVITY_TO_CANONICAL).length, summary.activities.length, "every source activity concept maps to a canonical id");
  assert.equal(summary.activities.length, 9, "the source supports nine activity concepts");
  assert.equal(new Set(Object.values(SOURCE_ACTIVITY_TO_CANONICAL)).size, 9, "and they are nine DISTINCT canonical ids");
  for (const id of Object.values(SOURCE_ACTIVITY_TO_CANONICAL)) {
    assert.equal(LISTENING_ACTIVITY_IDS.includes(id), true, `${id} is a canonical activity id`);
  }
  // A missing asset is never a classification reason: the product comes from the test's own
  // structure and collection, which is why this package is provably academic with no audio binary.
  assert.equal(productOfPackage(pkg), "academic_full_test");
});

test("T11-24 the separately pinned Test 10 source contract is untouched", () => {
  const contract = readFileSync("docs/LISTENING-SOURCE-ZIP-CONTRACT.md", "utf8");
  assert.ok(contract.includes("full-listening-10"), "the Test 10 source contract still pins its own test id");
  assert.ok(contract.includes("16,451,023"), "and its own audio byte size");
  assert.ok(contract.includes("publicationIssues"), "and its own review-flag count");
  assert.equal(contract.includes("Test 11"), false, "Test 11 was not folded into the Test 10 contract");
  // The two tests the contract names still exist and still read the SAME owner-source variable.
  for (const file of ["tests/full-listening-package.test.ts", "tests/full-listening-write-db.test.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes("LISTENING_SOURCE_ZIP"), `${file} still keys off the pinned owner source`);
  }
  assert.equal(readFileSync("docs/LISTENING-SOURCE-ZIP-CONTRACT.md", "utf8").includes("39dc7e45"), false, "the Test 10 contract carries no Test 11 fingerprint");
});

test("T11-25 the reference's own facts derive exactly the activities it supports — and no others", () => {
  const pkg = test11Shape();

  /*
   * The golden hub, stated by the owner: a NEW learner sees the seven activities this source genuinely
   * supports; Review appears only after a submitted attempt; Retry only after real misses. These are
   * DERIVED from the package's facts — the assertions below remove one fact at a time and watch the card
   * go with it, which is what proves the registry is source-driven rather than a fixed list of nine.
   */
  const fresh = packageActivities(pkg);
  assert.deepEqual(fresh, ["exam", "script", "mcq", "map", "matching", "completion", "vocab"], "a new learner sees the seven supported activities");
  assert.deepEqual(
    packageActivities(pkg, { examSubmitted: true, missedQuestions: 0 }),
    ["exam", "review", "script", "mcq", "map", "matching", "completion", "vocab"],
    "a submitted, perfect attempt adds Review",
  );
  assert.deepEqual(
    packageActivities(pkg, { examSubmitted: true, missedQuestions: 3 }),
    ["exam", "review", "script", "mcq", "map", "matching", "completion", "vocab", "retry"],
    "and genuine misses add Retry",
  );
  assert.equal(fresh.length, 7, "which is seven, not nine: the two learner-gated activities are absent");

  // Each capability traces to a fact in the reference, not to the source's list of activity names.
  const facts = summary.question_type_counts;
  assert.deepEqual(facts, { Completion: 20, "Map / Plan": 4, MCQ: 11, Matching: 5 }, "the reference's own type counts");
  assert.equal(pkg.questions.filter((q) => q.kind === "map").length, facts["Map / Plan"], "the map card comes from real map questions");
  assert.equal(pkg.questions.filter((q) => q.kind === "mcq").length, facts.MCQ, "the MCQ card comes from real MCQ");
  assert.equal(pkg.questions.filter((q) => q.kind === "matching").length, facts.Matching, "Matching stays Matching");
  assert.equal(pkg.questions.filter((q) => q.kind === "completion").length, facts.Completion, "and the completion family is counted as itself");
  assert.equal(pkg.studyPack!.scriptParts!.length, 4, "Script Completion comes from four authored transcripts");

  // Take a fact away and its card goes — the activity list is never hard-coded.
  const withoutMap = { ...pkg, questions: pkg.questions.filter((q) => q.kind !== "map") };
  assert.equal(packageActivities(withoutMap).includes("map"), false, "no map questions → no Map / Plan activity");
  assert.equal(packageActivities({ ...pkg, vocabulary: [] }).includes("vocab"), false, "no vocabulary → no Vocabulary Builder");
  assert.equal(
    packageActivities({ ...pkg, studyPack: { ...pkg.studyPack!, scriptParts: undefined } }).includes("script"),
    false,
    "no authored script parts → no Script Completion",
  );
  const withoutMcq = { ...pkg, questions: pkg.questions.filter((q) => q.kind !== "mcq") };
  assert.equal(packageActivities(withoutMcq).includes("mcq"), false, "no MCQ questions → no MCQ Mastery");

  /*
   * And a source that declares NOTHING still gets the activities its material proves on its own — the
   * declaration ADDS the practice drills, it is never the only reason a card exists.
   */
  const undeclared = testActivities({ ...pkg, studyPack: { ...pkg.studyPack!, activities: undefined } });
  assert.deepEqual(undeclared, ["exam", "script", "vocab", "mcq"], "an undeclared source keeps what its content proves");

  // The staff preview derives the same set as a learner with no state, so the two cannot disagree.
  assert.deepEqual(testActivities(pkg), fresh, "staff preview and the fresh-learner hub offer the same activities");
});
