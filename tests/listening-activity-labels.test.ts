import test from "node:test";
import assert from "node:assert/strict";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";
import { LISTENING_ACTIVITY_IDS } from "../src/lib/listening/package";
import { LISTENING_ACTIVITIES, packageActivities, testActivities } from "../src/lib/listening/activities";
import { listeningPackageSchema } from "../src/lib/listening/package";

/**
 * EVERY ACTIVITY THE REGISTRY CAN OFFER HAS A NAME AND A LINE OF COPY — IN BOTH LANGUAGES (L1–L2).
 *
 * The registry decides which activities exist for a test; the hub renders one card per activity using
 * `listening.academic.activity.<id>` and `<id>Hint`. If an id has no copy, the card renders with an
 * empty heading — a blank surface in the learner's hub, produced by a code change that never touched the
 * hub at all. That is exactly how Map / Plan Mastery reached the native hub with no label: the activity
 * was added to the registry before its copy existed.
 *
 * So the rule is asserted over the REGISTRY (not over a hand-written list of ids someone must remember
 * to update): a new activity cannot ship without its two strings in both dictionaries.
 */

type Dictionary = { listening: { academic: { activity: Record<string, string> } } };

test("L1 every canonical Listening activity has a label and a hint in EN and UZ", () => {
  /*
   * The registry is the SUPERSET: it still carries the legacy study surfaces (keyword1 / keyword2) that a
   * modern package does not declare, and that is deliberate. What must never happen is an activity a
   * package can declare existing in one list and not the other — so the package schema's ids must all be
   * registry ids.
   */
  const registryIds = LISTENING_ACTIVITIES.map((activity) => activity.id);
  for (const id of LISTENING_ACTIVITY_IDS)
    assert.ok(registryIds.includes(id), `${id} is declared by the package schema AND known to the registry`);
  assert.deepEqual(
    [...registryIds].sort(),
    [...new Set(registryIds)].sort(),
    "the registry lists each activity once",
  );

  for (const [locale, dict] of [["en", en], ["uz", uz]] as const) {
    const activity = (dict as unknown as Dictionary).listening.academic.activity;
    for (const id of LISTENING_ACTIVITY_IDS) {
      const label = activity[id];
      const hint = activity[`${id}Hint`];
      assert.ok(typeof label === "string" && label.trim().length > 2, `${locale}: listening.academic.activity.${id} is a real label`);
      assert.ok(typeof hint === "string" && hint.trim().length > 10, `${locale}: listening.academic.activity.${id}Hint is real help text`);
      assert.equal(/[a-z]+_[a-z]+/.test(label!), false, `${locale}: ${id}'s label is copy, not a raw key`);
    }
  }

  // The two locales name the same set — neither may lag behind.
  const enKeys = Object.keys((en as unknown as Dictionary).listening.academic.activity).sort();
  const uzKeys = Object.keys((uz as unknown as Dictionary).listening.academic.activity).sort();
  assert.deepEqual(uzKeys, enKeys, "the dictionaries carry the same activity copy");
  assert.equal(/[\u0400-\u04FF]/.test(JSON.stringify((uz as unknown as Dictionary).listening.academic.activity)), false, "Uzbek copy carries no Cyrillic");
});

test("L2 the ids a hub can actually render are all named — proved with a rich package, not a fixed list", () => {
  const rich = listeningPackageSchema.parse({
    schemaVersion: 1,
    legacyRuntime: false,
    collection: "academic",
    testId: "labels-qa",
    title: "Labels QA",
    category: "full",
    provenance: "owner_authored",
    audio: { path: "audio/full.mp3", durationSec: 1800 },
    imagePath: null,
    sections: [1, 2, 3, 4].map((number) => ({ number, title: `Part ${number}`, transcript: `Part ${number} transcript for the labels fixture.` })),
    questions: [
      { number: 1, section: 1, text: "Q1 gap", instruction: "Write ONE WORD.", kind: "completion", options: [], key: "garden", alternatives: [], pair: [], evidence: { at: 10, why: "authored" } },
      { number: 11, section: 2, text: "Q11 place", instruction: "Choose the correct letter, A–D.", kind: "map", options: ["A hall", "B library", "C cafe", "D gate"], key: "A", alternatives: [], pair: [], evidence: { at: 300, why: "authored" } },
      { number: 21, section: 3, text: "Q21 choice", instruction: "Choose the correct letter, A, B or C.", kind: "mcq", options: ["A one", "B two", "C three"], key: "B", alternatives: [], pair: [], evidence: { at: 600, why: "authored" } },
      { number: 26, section: 3, text: "Q26 match", instruction: "Choose the correct letter, A–C.", kind: "matching", options: ["A one", "B two", "C three"], key: "C", alternatives: [], pair: [], evidence: { at: 700, why: "authored" } },
    ],
    keyword1: [],
    keyword2: [],
    vocabulary: [{ word: "gate", pos: "noun", uz: "darvoza", def: "an opening in a wall", ex: "The gate is closed.", also: [] }],
    studyPack: {
      kind: "research-practice",
      activities: ["exam", "review", "script", "mcq", "recall", "vocab", "matching", "completion", "map", "retry"],
      partRanges: { "1": [0, 450], "2": [450, 900], "3": [900, 1350], "4": [1350, 1800] },
      recall: [{ part: 1, title: "Part 1 ideas", points: ["registration"] }],
    },
  });

  const derived = packageActivities(rich, { examSubmitted: true, missedQuestions: 3 });
  assert.ok(derived.includes("map"), "a package declaring Map / Plan offers it");
  assert.deepEqual(testActivities(rich).length > 0, true);

  const activity = (en as unknown as Dictionary).listening.academic.activity;
  const uzActivity = (uz as unknown as Dictionary).listening.academic.activity;
  for (const id of derived) {
    assert.ok(activity[id] && activity[id]!.trim().length > 2, `${id} — offered by the registry, so it must be nameable`);
    assert.ok(activity[`${id}Hint`] && activity[`${id}Hint`]!.trim().length > 10, `${id} — and it must carry a hint`);
    assert.ok(uzActivity[id] && uzActivity[id]!.trim().length > 2, `${id} — in Uzbek too`);
  }
});
