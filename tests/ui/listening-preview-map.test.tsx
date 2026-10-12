import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import uz from "../../src/lib/i18n/uz";
import { listeningPackageSchema } from "../../src/lib/listening/package";
import { packageActivities, testActivities } from "../../src/lib/listening/activities";
import { LISTENING_ACTIVITY_IDS } from "../../src/lib/listening/package";

/**
 * STAFF PREVIEW — the Map / Plan activity is a real activity (P1–P3).
 *
 * The preview is where a staff member decides whether a package may be published, so every surface it
 * offers must be complete: `testActivities(payload)` decides which tabs exist, and an activity it
 * returns WITHOUT a label renders as an empty button. Map / Plan was exactly that case — the activity
 * was derived, the label was missing — and the plan itself was pinned to Part 2, so a test whose map
 * questions live anywhere else showed the drawing on the wrong part (or not at all).
 *
 * The fixtures below put the map in Part 4 on purpose: "Part 2" is a historical accident of the material
 * this module grew up with, never a rule.
 */

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: "http://localhost/listening" });
for (const k of [
  "window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLInputElement",
  "HTMLSelectElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent",
  "localStorage", "sessionStorage",
] as const)
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });
dom.window.HTMLMediaElement.prototype.pause = () => {};
/*
 * The component calls the GLOBAL `URL.createObjectURL`, and Node's implementation insists on a Node
 * `Blob` (a jsdom `File` is not one). The object URL is meaningless in this environment anyway — the
 * audio element is never played — so both the global and the window copy are stubbed.
 */
const objectUrl = () => "blob:preview";
for (const target of [globalThis.URL, dom.window.URL] as unknown as { createObjectURL: unknown; revokeObjectURL: unknown }[]) {
  target.createObjectURL = objectUrl;
  target.revokeObjectURL = () => {};
}
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { ListeningTryout } = await import("../../src/components/import/ListeningTryout");

const POOL = ["A the sports hall", "B the library", "C the car park", "D the cafe"];

/** Four Parts; the map/plan questions are in Part 4 and Part 2 is ordinary MCQ. */
const payload = listeningPackageSchema.parse({
  schemaVersion: 1,
  legacyRuntime: false,
  collection: "academic",
  testId: "preview-map-qa",
  title: "Preview map QA",
  category: "full",
  provenance: "owner_authored",
  audio: { path: "audio/full.mp3", durationSec: 1800 },
  imagePath: "image.map",
  mapDiagram: {
    viewBox: [0, 0, 240, 160],
    label: "Plan of the park",
    shapes: [
      { tag: "rect", x: 10, y: 10, width: 90, height: 60, stroke: "#333333", strokeWidth: 2 },
      { tag: "text", x: 20, y: 30, text: "A Entrance", fontSize: 12 },
      { tag: "circle", cx: 180, cy: 40, r: 8, stroke: "#333333" },
      { tag: "text", x: 170, y: 70, text: "C Car park", fontSize: 12 },
    ],
  },
  sections: [1, 2, 3, 4].map((number) => ({
    number,
    title: `Part ${number}`,
    transcript: `Part ${number} transcript, long enough to be a real transcript for this QA fixture.`,
  })),
  questions: [
    { number: 1, section: 2, text: "How long is the tour?", instruction: "Choose the correct letter, A, B or C.", kind: "mcq", options: ["A one hour", "B two hours", "C three hours"], key: "B", alternatives: [], pair: [], evidence: { at: 60, why: "The speaker says two hours." } },
    // The completion question that ALSO carries a word bank: an option pool, but not a choice question.
    { number: 2, section: 2, text: "The tour costs ____ pounds.", instruction: "Write ONE WORD AND/OR A NUMBER.", kind: "completion", options: ["A ten", "B twenty"], key: "twenty", alternatives: [], pair: [], evidence: { at: 90, why: "The speaker says twenty." } },
    { number: 3, section: 4, text: "Where is the fountain?", instruction: "Choose the correct letter, A–D.", kind: "map", options: POOL, key: "A", alternatives: [], pair: [], evidence: { at: 600, why: "The speaker places the fountain by the gate." } },
    { number: 4, section: 4, text: "Where is the ticket office?", instruction: "Choose the correct letter, A–D.", kind: "map", options: POOL, key: "C", alternatives: [], pair: [], evidence: { at: 660, why: "The speaker places the ticket office by the car park." } },
  ],
  /*
   * The SOURCE declares what it supports — that is why the map tab exists here and not by inference from
   * the presence of an option pool. (The registry requires both: real map questions AND the source's own
   * declaration. Nothing is invented, and nothing is forced for a test that never claimed the activity.)
   */
  studyPack: {
    kind: "research-practice",
    activities: ["exam", "review", "mcq", "map", "completion", "vocab"],
    partRanges: { "1": [0, 450], "2": [450, 900], "3": [900, 1350], "4": [1350, 1800] },
  },
  keyword1: [],
  keyword2: [],
  vocabulary: [{ word: "fountain", pos: "noun", uz: "favvora", def: "a structure that sends water into the air", ex: "The fountain is by the gate.", also: [] }],
});

const dict = { importPreview: en.importPreview, fullListeningHub: en.fullListeningHub };

async function render() {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(ListeningTryout, { dict, payload, audioFile: new dom.window.File([], "full.mp3", { type: "audio/mpeg" }), image: null }));
  });
  return container;
}

const click = async (node: Element) => {
  await act(async () => {
    node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
};

const text = (node: Element) => (node.textContent ?? "").trim();

test("P1 the Map / Plan tab is derived AND labelled — an activity never renders as a blank tab", async () => {
  const container = await render();
  const tabs = [...container.querySelectorAll("nav button")].filter((button) => button.getAttribute("aria-label") === null);
  const labels = tabs.map(text).filter((label) => label.length > 0 && label !== "PART 1" && label !== "PART 2" && label !== "PART 3" && label !== "PART 4");
  assert.ok(labels.includes("Map / Plan Mastery"), `the map tab is labelled (got: ${labels.join(" | ")})`);
  assert.equal(labels.every((label) => label.length > 0), true, "no derived activity renders an empty label");

  // The registry is the authority for which tabs exist, so this cannot drift into a hard-coded list.
  const derived = testActivities(payload);
  assert.ok(derived.includes("map"), "the registry offers the map activity for this package");
  for (const id of derived) assert.ok((LISTENING_ACTIVITY_IDS as readonly string[]).includes(id), `${id} is a canonical activity id`);
});

test("P2 the plan is drawn on the part that HAS map questions, not on Part 2 by habit", async () => {
  const container = await render();
  const partButton = [...container.querySelectorAll("nav button")].find((button) => text(button) === "PART 4");
  assert.ok(partButton, "Part 4 is selectable");
  const mapTab = [...container.querySelectorAll("nav button")].find((button) => text(button) === "Map / Plan Mastery");
  assert.ok(mapTab, "the map tab exists");
  await click(mapTab!);
  await click(partButton!);

  assert.ok(container.querySelector("svg"), "the plan renders on the part that contains the map questions");
  const body = text(container);
  assert.ok(body.includes("Where is the fountain?"), "and the map questions are listed under it");
  assert.ok(body.includes("Where is the ticket office?"));

  // Part 2 holds the MCQ and the word-bank completion — the plan must NOT be drawn there.
  const partTwo = [...container.querySelectorAll("nav button")].find((button) => text(button) === "PART 2")!;
  await click(partTwo);
  assert.equal(container.querySelector("svg"), null, "no plan on a part without map questions");
});

test("P3 the MCQ tab lists genuine multiple choice only — a word bank is not a choice question", async () => {
  const container = await render();
  const mcqTab = [...container.querySelectorAll("nav button")].find((button) => text(button) === "MCQ Mastery");
  assert.ok(mcqTab, "the MCQ tab exists");
  await click(mcqTab!);
  const partTwo = [...container.querySelectorAll("nav button")].find((button) => text(button) === "PART 2")!;
  await click(partTwo);

  const body = text(container);
  assert.ok(body.includes("How long is the tour?"), "the genuine MCQ is listed");
  assert.equal(body.includes("The tour costs ____ pounds."), false, "a completion carrying a word bank is not listed as multiple choice");

  // And the map questions are never folded into the MCQ practice, whichever part they live in.
  const partFour = [...container.querySelectorAll("nav button")].find((button) => text(button) === "PART 4")!;
  await click(partFour);
  assert.equal(text(container).includes("Where is the fountain?"), false, "a map question is not MCQ practice");
  assert.deepEqual(packageActivities(payload).includes("mcq"), true, "the package genuinely has MCQ activity");

  // Both dictionaries carry every activity name the preview can render, so neither locale can be blank.
  for (const [locale, dictionary] of [["en", en], ["uz", uz]] as const) {
    const research = dictionary.fullListeningHub.research as unknown as Record<string, string>;
    for (const key of ["map", "mcq", "matching", "completion", "retry", "script", "recall", "yourLocation"])
      assert.ok(research[key] && research[key]!.length > 2, `${locale}.fullListeningHub.research.${key} is a real label`);
  }
});
