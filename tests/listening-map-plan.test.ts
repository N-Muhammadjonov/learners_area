import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listeningPackageSchema, type ListeningPackage } from "../src/lib/listening/package";
import {
  HISTORICAL_MAP_PART,
  activityFacts,
  mapDiagramSections,
  packageActivities,
  practiceKindOf,
  supportsActivity,
} from "../src/lib/listening/activities";
import { listeningInputModeFor } from "../src/lib/listening/question-control";
import { extractMapDiagram } from "../src/lib/listening/map-diagram";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";

/**
 * MAP / PLAN — A FIRST-CLASS LISTENING QUESTION KIND AND ACTIVITY.
 *
 * The owner's source (Listening Test 11) contains Q11–Q14 as MAP / PLAN: a learner locates things
 * on a plan by choosing from a shared A–I letter pool. Two mistakes this file exists to prevent,
 * because both were possible before it:
 *
 *   1. A map question counted as an MCQ. It carries an option pool, so the old "options ⇒ MCQ"
 *      reasoning would have filed it as multiple choice — inflating MCQ Mastery with questions
 *      that are not multiple choice, and grading a plan by the wrong rule.
 *   2. A hard-coded part. The package holds ONE plan drawing and every surface rendered it at
 *      Part 2 by position; a test whose plan lives in another part would have shown the plan on
 *      the wrong part (or nowhere) while its map questions sat elsewhere.
 *
 * And one rule about COUNT, which the owner stated explicitly: the number of activities is not
 * fixed at nine. A source may declare more, and a test with less material must show less.
 *
 *   M1 a map question is a map question — never an MCQ, even with an A–I pool;
 *   M2 the map activity appears only when the test HAS map questions and the source SAID so;
 *   M3 the plan renders on the parts that contain map questions, with the historical placement
 *      kept for packages that predate the kind;
 *   M4 Map/Plan Mastery is a graded practice whose answers are graded as labels;
 *   M5 the activity ceiling follows the activity registry — ten is not "too many";
 *   M6 the learner surfaces render the plan where the map questions are, not at a fixed part;
 *   M7 the new chrome is bilingual (EN + UZ, ASCII apostrophes) and the plan stays accessible.
 */

function section(number: number, transcript = `Transcript for part ${number}.`) {
  return { number, title: `Part ${number}`, transcript, reviewRequired: false };
}

function question(
  number: number,
  sectionNumber: number,
  kind: "completion" | "mcq" | "matching" | "map",
  options: string[],
  key: string,
) {
  return {
    number,
    section: sectionNumber,
    text: `Fixture question ${number}`,
    instruction: "Choose the correct letter",
    kind,
    options,
    key,
    alternatives: [],
    pair: [],
    evidence: { at: 30, end: 55, why: "Fixture evidence for the question." },
  };
}

const PLAN = {
  viewBox: [0, 0, 240, 160],
  label: "Plan of the park",
  shapes: [
    { tag: "rect", x: 10, y: 10, width: 90, height: 60, stroke: "#333333", strokeWidth: 2 },
    { tag: "text", x: 20, y: 30, text: "A Entrance", fontSize: 12 },
    { tag: "circle", cx: 180, cy: 40, r: 8, stroke: "#333333" },
    { tag: "text", x: 170, y: 70, text: "B Cafe", fontSize: 12 },
  ],
} as const;

const LABELS = ["A) the entrance", "B) the cafe", "C) the lake"];

/** A test whose plan sits in Part 4 — deliberately NOT the historical position. */
function mapPackage(overrides: Record<string, unknown> = {}): ListeningPackage {
  return listeningPackageSchema.parse({
    schemaVersion: 1,
    collection: "academic",
    testId: "fixture-map-late-part",
    title: "Fixture — plan in Part 4",
    category: "full",
    provenance: "QA fixture for the Map / Plan contract",
    audio: { path: "audio.mp3", durationSec: 1800 },
    imagePath: null,
    mapDiagram: PLAN,
    sections: [section(1), section(2), section(3), section(4)],
    questions: [
      question(31, 4, "map", LABELS, "A"),
      question(32, 4, "map", LABELS, "C"),
      question(1, 1, "completion", [], "garden"),
    ],
    keyword1: [],
    keyword2: [],
    vocabulary: [],
    studyPack: {
      kind: "research-practice",
      activities: ["exam", "review", "map", "completion"],
      partRanges: { "1": [0, 400], "2": [400, 800], "3": [800, 1200], "4": [1200, 1800] },
    },
    ...overrides,
  });
}

/** The same test with its map questions filed as MCQ — the shape a pre-`map` source has. */
function legacyShapePackage(): ListeningPackage {
  return mapPackage({
    testId: "fixture-map-legacy-shape",
    questions: [
      question(11, 2, "mcq", LABELS, "A"),
      question(12, 2, "mcq", LABELS, "C"),
      question(1, 1, "completion", [], "garden"),
    ],
    studyPack: { kind: "research-practice", activities: ["exam", "review", "mcq", "completion"], partRanges: { "1": [0, 400], "2": [400, 900] } },
  });
}

test("M1 a map question is never counted as an MCQ", () => {
  const mapOnly = mapPackage({ testId: "fixture-map-only", questions: [question(11, 2, "map", LABELS, "A")] });
  const facts = activityFacts(mapOnly);
  assert.equal(facts.map, true, "the map fact is derived from the question's own kind");
  assert.equal(facts.mcq, false, "a map question with an A–I pool is NOT a multiple-choice question");
  assert.equal(
    packageActivities(mapOnly).includes("mcq"),
    false,
    "so a map-only test is never offered MCQ Mastery",
  );
  assert.equal(packageActivities(mapOnly).includes("map"), true, "and it IS offered Map / Plan Mastery when the source says so");

  // A test with both keeps each activity scoped to its own questions.
  const mixed = mapPackage({ testId: "fixture-map-and-mcq", questions: [question(11, 2, "map", LABELS, "A"), question(15, 2, "mcq", ["A) yes", "B) no"], "B")] });
  const mixedFacts = activityFacts(mixed);
  assert.equal(mixedFacts.map && mixedFacts.mcq, true, "a test with both has both facts");
});

test("M2 the map card needs BOTH real map questions and the source's own declaration", () => {
  const declared = mapPackage();
  assert.equal(supportsActivity(declared, "map"), true, "map questions + the source's declaration → the card is real");

  // Real map questions, but the source never declared the activity: no card, because the route
  // that would run it refuses for exactly this reason.
  const undeclared = mapPackage({
    testId: "fixture-map-undeclared",
    studyPack: { kind: "research-practice", activities: ["exam", "completion"], partRanges: { "4": [1200, 1800] } },
  });
  assert.equal(activityFacts(undeclared).map, true, "the questions are still map questions");
  assert.equal(supportsActivity(undeclared, "map"), false, "but the activity is not offered — the card and the route agree");

  // Declared, but there is nothing to practise: no card either.
  const emptyDeclaration = mapPackage({
    testId: "fixture-map-no-questions",
    questions: [question(1, 1, "completion", [], "garden")],
    studyPack: { kind: "research-practice", activities: ["exam", "map"], partRanges: { "1": [0, 400] } },
  });
  assert.equal(supportsActivity(emptyDeclaration, "map"), false, "a declared but empty activity is never an empty card");
});

test("M3 the plan renders on the parts that contain map questions", () => {
  assert.deepEqual(mapDiagramSections(mapPackage()), [4], "the parts come from the questions themselves, not a fixed number");
  assert.deepEqual(
    mapDiagramSections(mapPackage({ testId: "fixture-map-two-parts", questions: [question(20, 2, "map", LABELS, "A"), question(31, 4, "map", LABELS, "B")] })),
    [2, 4],
    "a plan used by two parts renders on both, in part order",
  );
  // A package that predates the kind declares its map items as MCQ; its plan must not vanish.
  assert.deepEqual(mapDiagramSections(legacyShapePackage()), [HISTORICAL_MAP_PART], "the historical placement is preserved, and named");
  assert.equal(HISTORICAL_MAP_PART, 2, "the historical placement is Part 2 — the rule is explicit, not a magic number in a component");
});

test("M4 Map / Plan Mastery is a graded practice graded as labels", () => {
  assert.equal(practiceKindOf("map"), "map", "the registry declares it a practice activity");
  assert.equal(practiceKindOf("exam"), null, "and the exam is still not a practice");
  // The canonical registry says a map/plan question is answered by choosing a letter from a pool.
  assert.equal(listeningInputModeFor({ typeCode: "map_labeling", options: LABELS }), "select");
  assert.equal(listeningInputModeFor({ typeCode: "map", options: LABELS }), "select", "the source alias resolves through the same registry");
  assert.equal(listeningInputModeFor({ typeCode: "plan_labeling", options: LABELS }), "select");
  // A completion row that carries a hint list is still typed, never a menu.
  assert.equal(listeningInputModeFor({ typeCode: "note_completion", options: ["a hint", "another hint"] }), "text");
});

test("M5 the activity ceiling follows the registry — nine is not a cap", () => {
  const ten = listeningPackageSchema.safeParse({
    ...JSON.parse(JSON.stringify(mapPackage())),
    testId: "fixture-ten-activities",
    studyPack: {
      kind: "research-practice",
      activities: ["exam", "review", "script", "mcq", "map", "matching", "completion", "vocab", "recall", "retry"],
      partRanges: { "1": [0, 400] },
    },
  });
  assert.equal(ten.success, true, "a source that genuinely supports ten activities can say so");
  if (ten.success) {
    const facts = activityFacts(ten.data);
    assert.equal(facts.authored?.length, 10, "and the declaration is kept in full, not truncated to nine");
  }
});

test("M6 the learner surfaces render the plan where the map questions are", () => {
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  for (const file of ["src/components/listening/NativeListeningExam.tsx", "src/components/listening/FullListeningStudy.tsx"]) {
    const code = strip(readFileSync(file, "utf8"));
    assert.doesNotMatch(code, /section === 2 && mapDiagram/, `${file} must not place the plan by a hard-coded part`);
    assert.match(code, /\(mapSections \?\? \[HISTORICAL_MAP_PART\]\)\.includes\(section\)/, `${file} places it by the test's own map parts`);
  }
  /*
   * Review is part-scoped too, so the plan must follow the part the learner selected: showing Part 2's
   * drawing above Part 1's questions is the same mistake as pinning it to a part number. A package
   * without per-part study data lists every question at once, and for that shape the plan stays visible.
   */
  const review = strip(readFileSync("src/components/listening/FullListeningActivity.tsx", "utf8"));
  assert.doesNotMatch(review, /activity === 2 && data\.mapDiagram && </, "review must not show the plan unconditionally");
  assert.match(review, /\(mapSections \?\? \[HISTORICAL_MAP_PART\]\)\.includes\(reviewPart\)/, "review places it by the test's own map parts");
  assert.match(
    strip(readFileSync("src/app/app/(focus)/listening/tests/[id]/[activity]/page.tsx", "utf8")),
    /mapSections=\{mapDiagramSections\(/,
    "and the activity page derives those parts from the package",
  );
  // The pages that know the package pass the derived parts in.
  for (const file of [
    "src/app/app/(focus)/listening/attempts/[id]/page.tsx",
    "src/app/app/(focus)/listening/tests/[id]/study/page.tsx",
  ]) {
    assert.match(strip(readFileSync(file, "utf8")), /mapSections=\{mapDiagramSections\(/, `${file} derives the map parts from the package`);
  }
});

test("M7 the plan is bilingual chrome and stays keyboard-usable", async () => {
  // The hub labels are `listening.academic.activity.<id>`; the compiler already forces both
  // languages to carry them, and this pins that the copy is real in each.
  const hubEn = en.listening.academic.activity;
  const hubUz = uz.listening.academic.activity;
  assert.ok(hubEn.map.length > 0 && hubUz.map.length > 0, "both languages name the map activity");
  assert.notEqual(hubEn.map, hubUz.map, "and the UZ name is a real translation, not a copy of the English");
  assert.ok(en.fullListeningHub.research.map.length > 0, "the practice page title exists in EN");
  assert.ok(uz.fullListeningHub.research.map.length > 0, "and in UZ");
  assert.ok(en.fullListeningHub.research.yourLocation.length > 0, "the map choice has its own EN label");
  assert.ok(uz.fullListeningHub.research.yourLocation.length > 0, "and its own UZ label");

  const uzMapCopy = [hubUz.map, hubUz.mapHint, uz.fullListeningHub.research.map, uz.fullListeningHub.research.yourLocation].join(" ");
  assert.doesNotMatch(uzMapCopy, /[\u2018\u2019\u02BC]/, "UZ copy uses ASCII apostrophes only");

  // The drawing is rendered as a labelled figure from sanitized coordinates — never raw SVG.
  const dom = new (await import("jsdom")).JSDOM(`<svg viewBox="0 0 240 160" aria-label="Plan of the park"><rect x="10" y="10" width="90" height="60"/><text x="20" y="30">A Entrance</text><script>alert(1)</script></svg>`);
  const diagram = extractMapDiagram(dom.window.document.querySelector("svg")!);
  assert.equal(diagram.label, "Plan of the park", "the plan keeps its accessible name");
  assert.equal(diagram.shapes.some((shape) => shape.tag === "script" as never), false, "no script node survives extraction");
  assert.equal(JSON.stringify(diagram).includes("alert(1)"), false, "and no executable content is carried into canonical content");
});
