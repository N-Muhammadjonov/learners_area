import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

/*
 * §02 — THE RETRY DEFECTS, DRIVEN AS A LEARNER WOULD DRIVE THEM.
 *
 * Independent source inspection found that PracticeStudio's topic-failure Retry button calls
 * `setSearch((s) => s)`. An identity updater is not a state change: React bails out, nothing re-renders,
 * and because the topic fetch is keyed on `[part, debouncedSearch]` the effect never re-runs. The button
 * is inert. AiExaminerSession's Retry calls `setFailed(false)`, which clears the message and returns the
 * learner to the mode grid without re-issuing the request that failed — also not a retry.
 *
 * Inspecting the neighbouring paths found a third defect that was not reported: when the FIRST page of
 * questions fails, `topicResolved` evaluates false, so `step` falls back to "topic" and the learner is
 * silently bounced out of the topic they deep-linked into, with no error and no retry. A network failure
 * becomes indistinguishable from "this topic has no questions" — which is precisely the confusion §04
 * forbids, and it destroys a `?part=&topic=` deep link.
 *
 * A dead Retry button is not a cosmetic problem. The whole point of bounded fetching is that a page can
 * fail on its own without the learner losing their place; if recovery requires a full reload, the
 * learner's selection, their loaded pages and any recording in progress are all discarded.
 *
 * These are interaction tests, so they run the real components in JSDOM with a controllable `fetch`,
 * exactly like the rest of tests/ui. Nothing here is inferred from reading source text.
 */

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: "http://localhost/app/speaking/practice" });
for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { PracticeStudio } = await import("../../src/components/speaking/PracticeStudio");
const { AiExaminerSession } = await import("../../src/components/speaking/AiExaminerSession");
// QuestionRecorder calls useInstantInteraction, so the provider is part of the real tree, not test scaffolding.
const { InstantInteractionProvider } = await import("../../src/components/interaction/InstantInteractionProvider");

const q = (selector: string) => document.querySelector(selector);
const all = (selector: string) => [...document.querySelectorAll(selector)];
const step = () => q("[data-practice-step]")?.getAttribute("data-practice-step") ?? null;

// ── fixtures: shapes taken from the routes, not invented ────────────────────────────────────────
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const topic = (key: string, title: string, count: number) => ({ key, title, count });
const prompt = (id: string, part: string, topicName: string, text: string) =>
  ({ id, part, topic: topicName, promptText: text, cueCard: null, prepSeconds: 0, answerSeconds: 45 });

const partsBody = () =>
  json({ parts: [{ part: "part1", count: 250 }, { part: "part2", count: 60 }, { part: "part3", count: 100 }],
         topics: [], topicCount: 0, hasMoreTopics: false, nextTopicCursor: null, matching: 410 });
const facets = (part: string) =>
  json({ parts: [], topics: [topic(`${part}-t1`, "Hometown", 3), topic(`${part}-t2`, "Work", 2)],
         topicCount: 4, hasMoreTopics: true, nextTopicCursor: `${part}-cur2`, matching: 4 });
const facetsPage2 = (part: string) =>
  json({ parts: [], topics: [topic(`${part}-t3`, "Travel", 1), topic(`${part}-t4`, "Food", 1)],
         topicCount: 4, hasMoreTopics: false, nextTopicCursor: null, matching: 4 });
const questions = (topicName: string, ids: string[]) =>
  json({ prompts: ids.map((id) => prompt(id, "part1", topicName, `Question ${id}?`)),
         hasMore: false, nextCursor: null, matching: ids.length, pageSize: 100 });
const questionsPage2 = (topicName: string) =>
  json({ prompts: [prompt("q3", "part1", topicName, "Question q3?")],
         hasMore: true, nextCursor: "qcur3", matching: 3, pageSize: 100 });
const questionsPage3 = (topicName: string) =>
  json({ prompts: [prompt("q4", "part1", topicName, "Question q4?")],
         hasMore: false, nextCursor: null, matching: 3, pageSize: 100 });
/** Distinctive per prompt so a leaked response is detectable in the rendered text. */
const supportFor = (id: string) =>
  json({ promptId: id, support: { vocabularyHtml: "", modelAnswerHtml: "", ideasHtml: "",
         vocabulary: [{ term: `term-of-${id}`, definitionEn: "a definition" }] } });
const scriptBody = () =>
  json({ mode: "full", script: [prompt("s1", "part1", "Hometown", "Where do you live?"),
                                { ...prompt("s2", "part2", "Hometown", "Describe a place"), cueCard: "You should say…" }] });

/** Default dispatch: everything succeeds. Tests override by wrapping this. */
const baseDispatch = (url: string): Response => {
  if (url.includes("/ai/script")) return scriptBody();
  if (url.includes("/facets")) {
    if (url.includes("topicCursor=")) return facetsPage2(new URL(url, "http://localhost").searchParams.get("part") ?? "part1");
    const part = new URL(url, "http://localhost").searchParams.get("part");
    return part ? facets(part) : partsBody();
  }
  if (url.includes("/questions")) {
    const u = new URL(url, "http://localhost");
    const topicName = u.searchParams.get("topic") ?? "t1";
    if (u.searchParams.get("cursor") === "qcur2") return questionsPage2(topicName);
    if (u.searchParams.get("cursor") === "qcur3") return questionsPage3(topicName);
    return questions(topicName, ["q1", "q2"]);
  }
  // The prompt id precedes "/support": /api/speaking/prompts/<id>/support
  if (url.includes("/support")) return supportFor((url.split("/support")[0] ?? url).split("/").pop() ?? "q1");
  throw new Error(`unexpected request in test: ${url}`);
};

let handler: (url: string) => Response | Promise<Response> = baseDispatch;
let requests: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = typeof input === "string" ? input : String((input as { url: string }).url);
  requests.push(url);
  return handler(url);
}) as unknown as typeof fetch;

/** Settle every pending effect and promise. */
const settle = async () => { await act(async () => { await Promise.resolve(); }); };
const click = async (element: Element | null, label: string) => {
  assert.ok(element, `${label}: expected a clickable element`);
  await act(async () => { (element as HTMLButtonElement).click(); await Promise.resolve(); });
};
const countRequests = (fragment: string) => requests.filter((url) => url.includes(fragment)).length;

type Nav = (params: URLSearchParams) => Promise<void>;
async function mount(node: React.ReactElement, params: URLSearchParams, run: (nav: Nav) => Promise<void>) {
  document.body.innerHTML = '<div id="root"></div>';
  requests = [];
  const root = createRoot(document.querySelector("#root")!);
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  const render = (p: URLSearchParams, child: React.ReactElement) =>
    root.render(React.createElement(AppRouterContext.Provider, { value: router as never },
      React.createElement(PathnameContext.Provider, { value: "/app/speaking/practice" },
        React.createElement(SearchParamsContext.Provider, { value: p },
          React.createElement(InstantInteractionProvider, null, child)))));
  // A client-side navigation re-renders with new search params; that is what the router does.
  const nav: Nav = async (p) => { await act(async () => { render(p, node); await Promise.resolve(); }); };
  try {
    await act(async () => { render(params, node); await Promise.resolve(); });
    await run(nav);
  } finally {
    await act(async () => root.unmount());
    handler = baseDispatch;
  }
}
const studio = React.createElement(PracticeStudio, { dict: en as never });
const ai = React.createElement(AiExaminerSession, {
  dict: en as never, readiness: { transcription: true, aiEvaluation: true }, isStaff: false,
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
test("§02 topics: an initial failure is recoverable with the Retry button", async () => {
  let attempts = 0;
  handler = (url) => {
    if (url.includes("/facets") && url.includes("part=part1") && !url.includes("topicCursor=")) {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("offline"));
    }
    return baseDispatch(url);
  };
  await mount(studio, new URLSearchParams("part=part1"), async () => {
    await settle();
    assert.ok(q('[data-practice-error="topics"]'), "the failure must be visible to the learner");
    assert.equal(step(), "topic", "a failed topic fetch must stay on the topic step");
    const before = countRequests("part=part1");
    await click(q('[data-practice-error="topics"] button'), "topics retry");
    await settle();
    // THE DEFECT: setSearch((s) => s) changes nothing, so no request is ever re-issued.
    assert.equal(attempts, 2, "Retry must re-issue the failed topic request");
    assert.ok(countRequests("part=part1") > before, "Retry must actually reach the network");
    assert.equal(q('[data-practice-error="topics"]'), null, "the error must clear once the retry succeeds");
    assert.ok(all("[data-practice-topic]").length >= 2, "the topics must render after a successful retry");
  });
  assert.equal(attempts, 2, "exactly one retry, not a storm");
});

test("§02 questions: a first-page failure is reported and retryable, and never bounces the learner out of the topic", async () => {
  let attempts = 0;
  handler = (url) => {
    if (url.includes("/questions") && !url.includes("cursor=")) {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("offline"));
    }
    return baseDispatch(url);
  };
  await mount(studio, new URLSearchParams("part=part1&topic=part1-t1"), async () => {
    await settle();
    /*
     * THE DEFECT: with no questions in state and promptsFailed set, topicResolved is false, so step
     * falls back to "topic". The learner who deep-linked into ?part=part1&topic=part1-t1 is thrown back
     * to the topic list with no explanation, and a network failure looks exactly like an empty topic.
     */
    assert.equal(step(), "questions", "a questions failure must not eject the learner from the topic they opened");
    assert.ok(q('[data-practice-error="questions"]'), "a first-page questions failure must be reported on the questions step");
    await click(q('[data-practice-error="questions"] button'), "questions retry");
    await settle();
    assert.equal(attempts, 2, "Retry must re-issue the failed questions request");
    assert.equal(q('[data-practice-error="questions"]'), null, "the error must clear once the retry succeeds");
    assert.ok(all("[data-practice-question]").length >= 2, "the questions must render after a successful retry");
  });
});

test("§02 pagination: a failed page 2 retries into the correct continuation with no duplicates and no skips", async () => {
  let pageTwoAttempts = 0;
  handler = (url) => {
    if (url.includes("/questions") && url.includes("cursor=qcur2")) {
      pageTwoAttempts += 1;
      if (pageTwoAttempts === 1) return Promise.reject(new Error("offline"));
    }
    if (url.includes("/questions") && !url.includes("cursor=")) {
      return json({ prompts: [prompt("q1", "part1", "Hometown", "Question q1?"), prompt("q2", "part1", "Hometown", "Question q2?")],
                    hasMore: true, nextCursor: "qcur2", matching: 4, pageSize: 100 });
    }
    if (url.includes("/questions") && url.includes("cursor=qcur3")) return questionsPage3("Hometown");
    return baseDispatch(url);
  };
  await mount(studio, new URLSearchParams("part=part1&topic=part1-t1"), async () => {
    await settle();
    const more = q("[data-practice-more-questions]");
    assert.ok(more, "a first page with a cursor must offer continuation");
    await click(more, "load more");
    await settle();
    assert.ok(q('[data-practice-error="questions-more"]'), "the failed continuation must be reported");
    assert.equal(all("[data-practice-question]").length, 2, "a failed page 2 must not lose or duplicate page 1");
    // The cursor must survive the failure, or the learner is stranded at page 1 forever.
    const retry = q('[data-practice-error="questions-more"] button') ?? q("[data-practice-more-questions]");
    assert.ok(retry, "there must be a way to retry a failed continuation");
    await click(retry, "questions continuation retry");
    await settle();
    assert.equal(pageTwoAttempts, 2, "the continuation must be re-requested");
    const ids = all("[data-practice-question]").map((element) => element.getAttribute("data-practice-question"));
    assert.deepEqual(ids, ["q1", "q2", "q3"], `continuation must append exactly page 2, got ${ids.join(",")}`);
    assert.equal(new Set(ids).size, ids.length, "no question may appear twice");
  });
});

test("§02 rapid Part changes never leave stale topics on screen", async () => {
  let releasePart1: ((value: Response) => void) | null = null;
  handler = (url) => {
    if (url.includes("/facets") && url.includes("part=part1") && !url.includes("topicCursor=")) {
      // part1 answers LAST, after part3 has already rendered.
      return new Promise<Response>((resolve) => { releasePart1 = resolve; });
    }
    return baseDispatch(url);
  };
  await mount(studio, new URLSearchParams("part=part1"), async (nav) => {
    await settle();
    await nav(new URLSearchParams("part=part3"));
    await settle();
    const part3Topics = all("[data-practice-topic]").map((element) => element.getAttribute("data-practice-topic"));
    assert.ok(part3Topics.length > 0, "part3 topics must render");
    assert.ok(part3Topics.every((key) => key?.startsWith("part3-")), `expected only part3 topics, got ${part3Topics.join(",")}`);
    // Now the stale part1 response arrives.
    assert.ok(releasePart1, "the part1 request must have been made");
    await act(async () => { releasePart1!(facets("part1")); await Promise.resolve(); });
    await settle();
    const after = all("[data-practice-topic]").map((element) => element.getAttribute("data-practice-topic"));
    assert.ok(after.every((key) => key?.startsWith("part3-")),
      `a late part1 response overwrote part3's topics: ${after.join(",")}`);
  });
});

/*
 * Study Support hides its content behind a hold-to-reveal gate, so per-question vocabulary text is NOT
 * in the DOM and cannot be used as the leak marker — the first draft of this test did exactly that and
 * its positive control failed, which is the only reason the vacuity was caught.
 *
 * The discriminator used instead is structural and cannot be faked: q2's own support is made to FAIL
 * while q1's succeeds. The component renders the panel only when the payload's promptId matches the
 * selected question, so if q1's late success were wrongly accepted the panel would appear; if it is
 * correctly refused, q2's failure is what shows. "error" therefore means "no leak", and the positive
 * control proves the panel really does appear when the ids match.
 */
const panelRendered = () => q('[data-practice-support]') === null && q('[role="tab"]') !== null;

test("§02 rapid question changes never render another question's Study Support", async () => {
  let releaseQ1: ((value: Response) => void) | null = null;
  handler = (url) => {
    // The prompt id precedes "/support" in the real URL: /api/speaking/prompts/q1/support
    if (url.includes("/prompts/q1/support")) return new Promise<Response>((resolve) => { releaseQ1 = resolve; });
    if (url.includes("/prompts/q2/support")) return json({ error: "invalid_study_support" }, 502);
    return baseDispatch(url);
  };
  await mount(studio, new URLSearchParams("part=part1&topic=part1-t1"), async () => {
    await settle();
    const q2Button = q('[data-practice-question="q2"]');
    assert.ok(q2Button, "q2 must be listed");
    await click(q2Button, "select q2");
    await settle();
    assert.equal(q("[data-practice-selected]")?.textContent, "Question q2?", "q2 must be the selected question");
    // q1's support finally arrives — successfully — while q2 is selected and q2's own support failed.
    assert.ok(releaseQ1, "the q1 support request must have been made");
    await act(async () => { releaseQ1!(supportFor("q1")); await Promise.resolve(); });
    await settle();
    assert.equal(panelRendered(), false,
      "q1's Study Support rendered while q2 is selected — support from the wrong question leaked onto the page");
    assert.ok(q('[data-practice-support="error"]'),
      "with q2's own support failed and q1's refused, the learner must see q2's failure");
  });
});

test("§02 positive control: the selected question's own Study Support does render", async () => {
  // Without this the leak assertion above could pass simply because the panel never renders at all.
  await mount(studio, new URLSearchParams("part=part1&topic=part1-t1"), async () => {
    await settle();
    await click(q('[data-practice-question="q1"]'), "select q1");
    await settle();
    assert.equal(panelRendered(), true, "q1's own support must render, or the leak test is vacuous");
  });
});

test("§02 a retry never resets an in-progress recorder", async () => {
  let supportAttempts = 0;
  handler = (url) => {
    if (url.includes("/support")) {
      supportAttempts += 1;
      if (supportAttempts === 1) return Promise.reject(new Error("offline"));
    }
    return baseDispatch(url);
  };
  await mount(studio, new URLSearchParams("part=part1&topic=part1-t1"), async () => {
    await settle();
    const recorder = q('[data-local-recorder="q1"]');
    assert.ok(recorder, "the recorder for the selected question must be mounted");
    const before = recorder!.outerHTML;
    assert.ok(q('[data-practice-support="error"]'), "support must have failed");
    await click(q("[data-practice-support-retry]"), "support retry");
    await settle();
    const after = q('[data-local-recorder="q1"]');
    /*
     * Node identity is the property that matters: a remount destroys any recording in progress, its
     * elapsed timer and its buffered audio. JSDOM has no MediaRecorder, so an actual capture cannot be
     * started here — that half is covered in the browser (§04) and is recorded as an environment limit
     * rather than claimed as tested.
     */
    assert.equal(after, recorder, "the retry must reuse the recorder element, not remount it");
    assert.equal(after!.outerHTML, before, "the recorder's rendered state must be untouched by a support retry");
    assert.equal(supportAttempts, 2, "the support retry must re-issue the request");
  });
});

test("§02 AI: a failed script request is recoverable with the Retry button", async () => {
  let attempts = 0;
  handler = (url) => {
    if (url.includes("/ai/script")) {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("offline"));
    }
    return baseDispatch(url);
  };
  await mount(ai, new URLSearchParams(), async () => {
    await settle();
    await click(q('[data-ai-mode="full"]'), "start a full interview");
    await settle();
    assert.ok(q("[data-ai-error]"), "the script failure must be visible");
    assert.equal(q("[data-ai-session]")?.getAttribute("data-ai-session"), "choose", "still on the mode grid");
    await click(q("[data-ai-retry]"), "script retry");
    await settle();
    // THE DEFECT: setFailed(false) only hides the message; the failed request is never re-issued.
    assert.equal(attempts, 2, "Retry must re-issue the failed script request");
    assert.equal(q("[data-ai-session]")?.getAttribute("data-ai-session"), "running", "a successful retry must start the interview");
    assert.ok(q("[data-ai-progress]"), "the examiner must be asking the first question");
    assert.equal(q("[data-ai-error]"), null, "the error must clear");
  });
  assert.equal(attempts, 2, "exactly one retry");
});

test("§02 AI: a script request in flight cannot be started twice or superseded mid-flight", async () => {
  /*
   * The first draft of this test assumed the learner could pick a second mode while the first request
   * was pending. They cannot, and should not: the mode buttons are disabled during the request. That
   * guard is the property worth pinning — without it a double activation could start two concurrent
   * draws and interleave two scripts into one interview.
   */
  let releaseFirst: ((value: Response) => void) | null = null;
  let scriptRequests = 0;
  handler = (url) => {
    if (url.includes("/ai/script")) {
      scriptRequests += 1;
      if (scriptRequests === 1) return new Promise<Response>((resolve) => { releaseFirst = resolve; });
    }
    return baseDispatch(url);
  };
  await mount(ai, new URLSearchParams(), async () => {
    await settle();
    await click(q('[data-ai-mode="full"]'), "start a full interview");
    await settle();
    assert.equal(scriptRequests, 1, "one activation must issue exactly one script request");
    assert.ok(q("[data-ai-loading]"), "the learner must be told a script is being drawn");
    for (const mode of ["full", "part1", "part2", "part3"]) {
      const button = q(`[data-ai-mode="${mode}"]`) as HTMLButtonElement | null;
      assert.ok(button, `${mode} button must exist`);
      assert.equal(button!.disabled, true, `${mode} must be disabled while a script is in flight`);
      await click(button, `${mode} while loading`);
    }
    await settle();
    assert.equal(scriptRequests, 1, "activating other modes mid-flight must not start further draws");
    assert.ok(releaseFirst, "the first script request must have been made");
    await act(async () => { releaseFirst!(scriptBody()); await Promise.resolve(); });
    await settle();
    assert.equal(q("[data-ai-session]")?.getAttribute("data-ai-session"), "running",
      "the single in-flight script must still start the interview");
    assert.ok(q("[data-ai-progress]"), "the examiner must be asking the first question");
  });
});
