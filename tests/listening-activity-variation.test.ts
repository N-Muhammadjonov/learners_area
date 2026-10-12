import test from "node:test";
import assert from "node:assert/strict";
import { listeningPackageSchema, LISTENING_ACTIVITY_IDS, type ListeningPackage } from "../src/lib/listening/package";
import { LISTENING_ACTIVITIES, activityDescriptor, activityFacts, packageActivities, supportsActivity, testActivities } from "../src/lib/listening/activities";

/**
 * THE SOURCE DECIDES — NOT A TEMPLATE.
 *
 * Listening Test 11 genuinely supports nine activity concepts, and the temptation that follows is
 * to make nine the shape of every test: pad a test that has no Matching with a Matching card, or
 * show Review before anyone has submitted anything. The owner's rule is the opposite — the
 * activities come from the material, so two tests are allowed to have different hubs, and a test
 * with less material MUST have less.
 *
 * Three fixtures, deliberately unequal:
 *   A — the rich one: MCQ + Map/Plan + Matching + Completion + transcripts with authored gaps
 *       + vocabulary + recall (the shape the owner's Test 11 has);
 *   B — Completion + MCQ + transcripts with gaps, and nothing else;
 *   C — Matching + Completion only.
 *
 *   V1 the three hubs are DIFFERENT, and the difference is visible without a learner;
 *   V2 nothing is faked: every activity offered is genuinely supported, and every activity
 *      genuinely absent is genuinely absent (no disabled placeholder cards);
 *   V3 the count is not pinned to nine — B and C are legitimately smaller, and a source may
 *      declare more than nine;
 *   V4 the learner-gated pair (Review, Retry) behaves identically across all three: it needs a
 *      submitted attempt and, for Retry, real misses;
 *   V5 the registry is the single authority: every id it can offer comes from LISTENING_ACTIVITIES,
 *      and no activity depends on a test's name.
 */

function section(number: number, transcript: string) {
  return { number, title: `Part ${number}`, transcript, reviewRequired: false };
}

function question(number: number, sectionNumber: number, kind: "completion" | "mcq" | "matching" | "map", options: string[], key: string) {
  return {
    number,
    section: sectionNumber,
    text: `Fixture question ${number}`,
    instruction: "Choose the correct answer",
    kind,
    options,
    key,
    alternatives: [],
    pair: [],
    evidence: { at: 20 + number, why: `Fixture evidence ${number}.` },
  };
}

const TRANSCRIPT = "The guide explains the route through the park in detail, naming each landmark as it is passed.";
const GAPS = [
  { q: 1, match: "the route", answer: "route" },
  { q: 2, match: "each landmark", answer: "landmark" },
  { q: 3, match: "in detail", answer: "detail" },
  { q: 4, match: "the guide", answer: "guide" },
  { q: 5, match: "the park", answer: "park" },
  { q: 6, match: "naming", answer: "naming" },
];

const LABELS = ["A) the entrance", "B) the cafe", "C) the lake"];

function base(overrides: Record<string, unknown>): ListeningPackage {
  return listeningPackageSchema.parse({
    schemaVersion: 1,
    collection: "academic",
    testId: "fixture-variation",
    title: "Fixture — variation",
    category: "full",
    provenance: "QA fixture for activity variation",
    audio: { path: "audio.mp3", durationSec: 1800 },
    imagePath: null,
    sections: [section(1, TRANSCRIPT), section(2, TRANSCRIPT), section(3, TRANSCRIPT), section(4, TRANSCRIPT)],
    keyword1: [],
    keyword2: [],
    vocabulary: [],
    ...overrides,
  });
}

const SCRIPT_PARTS = [1, 2, 3, 4].map((part) => ({ part, transcript: TRANSCRIPT, gaps: GAPS }));

/** A — the rich hub: five always-on activities plus the learner-gated pair. */
function fixtureA(): ListeningPackage {
  return base({
    testId: "fixture-a-rich",
    mapDiagram: {
      viewBox: [0, 0, 100, 100],
      label: "Plan",
      shapes: [{ tag: "rect", x: 1, y: 1, width: 10, height: 10, stroke: "#333333" }],
    },
    questions: [
      question(1, 1, "completion", [], "route"),
      question(11, 2, "map", LABELS, "A"),
      question(15, 3, "mcq", ["A) one", "B) two", "C) three"], "B"),
      question(26, 4, "matching", LABELS, "C"),
    ],
    vocabulary: [{ word: "landmark", pos: "noun", uz: "mo'ljal", def: "a recognisable feature", ex: "The tower is a landmark.", also: [] }],
    studyPack: {
      kind: "research-practice",
      // Ten declared activities: the source's own list is kept in full, and "retry" is declared
      // because Retry Weak Areas needs the source to say it supports the drill.
      activities: ["exam", "review", "script", "mcq", "recall", "vocab", "matching", "completion", "map", "retry"],
      partRanges: { "1": [0, 450], "2": [450, 900], "3": [900, 1350], "4": [1350, 1800] },
      scriptParts: SCRIPT_PARTS,
      recall: [{ part: 1, title: "Route", points: ["Where the tour starts"] }],
    },
  });
}

/** B — Completion + MCQ + script: no map, no matching, no vocabulary, no recall. */
function fixtureB(): ListeningPackage {
  return base({
    testId: "fixture-b-completion-mcq",
    questions: [question(1, 1, "completion", [], "route"), question(15, 3, "mcq", ["A) one", "B) two"], "A")],
    studyPack: {
      kind: "research-practice",
      activities: ["exam", "review", "script", "mcq", "completion"],
      partRanges: { "1": [0, 900], "4": [900, 1800] },
      scriptParts: SCRIPT_PARTS,
    },
  });
}

/** C — Matching + Completion only: no MCQ anywhere. */
function fixtureC(): ListeningPackage {
  return base({
    testId: "fixture-c-matching-completion",
    questions: [question(1, 1, "completion", [], "route"), question(26, 4, "matching", LABELS, "B")],
    studyPack: {
      kind: "research-practice",
      activities: ["exam", "review", "matching", "completion"],
      partRanges: { "1": [0, 900], "4": [900, 1800] },
    },
  });
}

const submitted = { examSubmitted: true, missedQuestions: 0 };
const missed = { examSubmitted: true, missedQuestions: 2 };

test("V1 three genuinely different tests produce three genuinely different hubs", () => {
  const a = packageActivities(fixtureA(), submitted);
  const b = packageActivities(fixtureB(), submitted);
  const c = packageActivities(fixtureC(), submitted);

  assert.deepEqual(a, ["exam", "review", "script", "mcq", "recall", "vocab", "matching", "completion", "map"]);
  assert.deepEqual(b, ["exam", "review", "script", "mcq", "completion"]);
  assert.deepEqual(c, ["exam", "review", "matching", "completion"]);

  assert.notDeepEqual(a, b, "A and B are not the same hub");
  assert.notDeepEqual(b, c, "B and C are not the same hub");
  assert.notDeepEqual(a, c, "and A and C are not the same hub");
  // The architecture did not collapse into "every test looks like Test 11".
  assert.equal(a.includes("map") && !b.includes("map") && !c.includes("map"), true, "Map / Plan Mastery appears only where the source has it");
  assert.equal(!b.includes("matching") && c.includes("matching"), true, "Matching appears only in the tests that authored it");
  assert.equal(!c.includes("mcq"), true, "a test with no MCQ gets no MCQ card — not even a disabled one");
});

test("V2 nothing is faked: every card is supported, and every omission is justified", () => {
  /*
   * The biconditional that makes "no fake card" and "no arbitrary omission" the same assertion:
   *
   *     offered  ⇔  the TEST supports it  AND  its learner gate (if any) is satisfied
   *
   * Evaluated with a learner whose gates ARE satisfied, so a supported activity that is missing
   * could only be missing for an unjustifiable reason — the thing this test forbids.
   */
  for (const [name, pkg] of [["A", fixtureA()], ["B", fixtureB()], ["C", fixtureC()]] as const) {
    const offered = packageActivities(pkg, missed);
    for (const activity of LISTENING_ACTIVITIES) {
      const supported = supportsActivity(pkg, activity.id);
      const gate = activityDescriptor(activity.id)!.learnerGated;
      const gateOpen = gate === "submitted" ? missed.examSubmitted : gate === "weakness" ? missed.missedQuestions > 0 : true;
      assert.equal(
        offered.includes(activity.id),
        supported && gateOpen,
        `${name}: "${activity.id}" is offered exactly when the test supports it and its gate is open`,
      );
      if (offered.includes(activity.id)) {
        assert.equal(LISTENING_ACTIVITIES.some((row) => row.id === activity.id), true, `${name}: "${activity.id}" is a registered activity, not an ad-hoc card`);
      }
    }
  }
  // A card is never produced for an activity whose content does not exist, even when declared.
  const declaredButEmpty = base({
    testId: "fixture-declared-empty",
    questions: [question(1, 1, "completion", [], "route")],
    studyPack: { kind: "research-practice", activities: ["exam", "matching", "vocab", "map"], partRanges: { "1": [0, 900] } },
  });
  assert.deepEqual(packageActivities(declaredButEmpty, missed), ["exam"], "declared activities with no content produce no cards at all");
});

test("V3 the activity count is source-driven, not nine", () => {
  const a = testActivities(fixtureA()).length;
  const b = testActivities(fixtureB()).length;
  const c = testActivities(fixtureC()).length;
  assert.equal(a, 8, "A offers eight before any learner state");
  assert.equal(b, 4, "B offers four — legitimately fewer, and no card is invented to close the gap");
  assert.equal(c, 3, "C offers three");
  assert.ok(b < a && c < a, "the smaller tests really are smaller");
  assert.ok(a - c <= 5, "and the spread is a consequence of the material, not a quota");
  // The ceiling follows the registry: a source may declare the whole set.
  const everything = listeningPackageSchema.safeParse({
    ...JSON.parse(JSON.stringify(fixtureA())),
    testId: "fixture-everything",
    vocabulary: [{ word: "w", pos: "noun", uz: "w", def: "d", ex: "e", also: [] }],
    studyPack: {
      kind: "research-practice",
      activities: [...LISTENING_ACTIVITY_IDS],
      partRanges: { "1": [0, 450], "2": [450, 900], "3": [900, 1350], "4": [1350, 1800] },
      scriptParts: SCRIPT_PARTS,
      recall: [{ part: 1, title: "Route", points: ["Where the tour starts"] }],
    },
  });
  assert.equal(everything.success, true, "a source may declare every activity the registry knows");
});

test("V4 Review and Retry obey one rule, in every test that has them", () => {
  // Review is content-independent: any full test supports reviewing a submitted attempt.
  for (const [name, pkg] of [["A", fixtureA()], ["B", fixtureB()], ["C", fixtureC()]] as const) {
    assert.equal(packageActivities(pkg).includes("review"), false, `${name}: no attempt → no Review`);
    assert.equal(packageActivities(pkg, submitted).includes("review"), true, `${name}: submitted → Review`);
    assert.equal(packageActivities(pkg, submitted).includes("retry"), false, `${name}: a perfect attempt → no Retry, even where the drill is authored`);
  }
  // Retry additionally needs the SOURCE to support the drill, and it never appears without real
  // misses. A test whose source did not author it stays without it — including with misses, which
  // is the honest outcome: a card that could not drill anything is not shown.
  assert.equal(packageActivities(fixtureA(), missed).includes("retry"), true, "A declares the drill → real misses → Retry");
  for (const [name, pkg] of [["B", fixtureB()], ["C", fixtureC()]] as const) {
    assert.equal(supportsActivity(pkg, "retry"), false, `${name} never declared the drill`);
    assert.equal(packageActivities(pkg, missed).includes("retry"), false, `${name}: so not even real misses produce a Retry card`);
  }
});

test("V5 no activity is derived from a test's name, and none is hard-coded per test", async () => {
  // The registry reads structure; the same questions under a different id/title yield the same
  // activities, which is the property that makes Test 11 ordinary rather than special.
  const renamed = listeningPackageSchema.parse({ ...JSON.parse(JSON.stringify(fixtureA())), testId: "listening-test-99", title: "Listening Test 99" });
  assert.deepEqual(packageActivities(renamed, submitted), packageActivities(fixtureA(), submitted), "renaming a test changes nothing");
  const facts = activityFacts(fixtureA());
  assert.equal(typeof facts.authored === "object" && facts.authored !== null, true, "the source's own declaration is the leading fact");
  assert.equal(facts.authored!.length, 10, "and it is kept in full — the declaration is not truncated to fit a grid");
});
