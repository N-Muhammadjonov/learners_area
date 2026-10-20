import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import uz from "../../src/lib/i18n/uz";

/*
 * General Reading (learning mode) — real interaction in the rendered session:
 * vocabulary is ON from the first second for the selected passage,
 * clicks resolve BY OCCURRENCE ID against the passage id, answers autosave per
 * passage and "Check answers" shows learning results. The stopwatch never locks answers.
 */
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: "http://localhost/reading/general/x" });
for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "localStorage", "sessionStorage", "getComputedStyle"] as const)
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis, ResizeObserver: class { observe() {} disconnect() {} } });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { GeneralReadingSession } = await import("../../src/components/reading/GeneralReadingSession");
const { GeneralReadingSets } = await import("../../src/components/reading/GeneralReadingSets");

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const SET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const passage = (n: number, body: string) => ({
  passageNo: n, passageId: pid(n), title: `Passage title ${n}`, body, paragraphs: [],
  occurrences: [{ id: `occ-${n}`, startChar: body.indexOf("bank"), endChar: body.indexOf("bank") + 4, surfaceForm: "bank" }],
  questions: [
    { id: `q${n}a`, questionNo: 1, order: 1, type: "true_false_not_given", questionText: `Statement ${n}`, options: null },
    { id: `q${n}b`, questionNo: 2, order: 2, type: "multiple_choice", questionText: `Choice ${n}`, options: ["A marathon", "A shop"] },
  ],
});
const passages = [passage(1, "The bank approved the loan."), passage(2, "Our bank charges a fee."), passage(3, "Every bank closed early.")];

async function mount(element: React.ReactElement, run: () => Promise<void>) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  try {
    await act(async () => root.render(React.createElement(AppRouterContext.Provider, { value: router as never }, element)));
    await run();
  } finally { await act(async () => root.unmount()); }
}
function net() {
  const calls: { url: string; body: unknown }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
    if (String(url).includes("folders")) return json({ folders: [] });
    if (String(url).includes("/api/vocabulary/lookup")) return json({ status: "resolved", contextual: { definitionEn: "A business that keeps money", translationUz: "bank", verificationStatus: "verified", partOfSpeech: "noun", lexicalType: "word", ipa: null }, known: null });
    if (String(url).includes("/api/reading/general/progress")) {
      const body = JSON.parse(String(init!.body));
      return json({ ok: true, score: body.check ? 1 : null, total: body.check ? 2 : null, result: body.check ? [
        { questionId: "q1a", isCorrect: true, correctAnswer: "TRUE", evidenceQuote: "The bank approved the loan.", explanation: "The source explicitly confirms approval." },
        { questionId: "q1b", isCorrect: false, correctAnswer: "A marathon", evidenceQuote: null, explanation: null },
      ] : null });
    }
    return json({});
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function openWord(region: HTMLElement) {
  region.focus();
  await act(async () => { region.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  await act(async () => { region.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  await act(async () => { region.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await tick();
}

test("General single passage: vocabulary is ON immediately — click resolves by occurrence id with the passage id, Add to Vocabulary shown, elapsed time counts up", async () => {
  const n = net();
  try {
    await mount(React.createElement(GeneralReadingSession, { userId: "test-user", dict: en, setId: SET, setTitle: "Set one", passages: [passages[0]!], initialProgress: {}, mode: 1 }), async () => {
      const region = document.querySelector("[data-general-passage='1'] [data-clickable-text]") as HTMLElement;
      assert.ok(region, "the General passage is vocabulary-interactive from the start");
      assert.equal(document.querySelector("[data-exam-passage-text]"), null, "not the exam's plain text");
      await openWord(region);
      assert.ok(document.querySelector("[role=dialog]"), "popup opens");
      const lookup = n.calls.find((c) => c.url.includes("/api/vocabulary/lookup"))!.url;
      assert.ok(lookup.includes("occurrenceId=occ-1") && lookup.includes(`sourceId=${pid(1)}`) && lookup.includes("sourceType=reading"), lookup);
      assert.ok(!/mode=|general/i.test(lookup), "the client never claims a mode");
      assert.ok(document.querySelector("[data-word-save]"));
      for (const timer of ["[data-exam-timer]", "[data-timer]", "[role=timer]"]) assert.equal(document.querySelector(timer), null, timer);
      assert.equal(document.querySelector("[data-read-aloud]"),null);
      assert.equal(document.querySelector("[data-general-elapsed]")?.textContent,"00:00");
      await tick(1100);
      assert.equal(document.querySelector("[data-general-elapsed]")?.textContent,"00:01");
    });
  } finally { n.restore(); }
});

test("each selected General passage has its own vocabulary source and no sibling passage tabs", async () => {
  const n = net();
  try {
    for (const no of [1,2,3] as const) await mount(React.createElement(GeneralReadingSession, { userId: "test-user", dict: en, setId: SET, setTitle: "Set one", passages, initialProgress: {}, mode: no }), async () => {
      const tabs = Array.from(document.querySelectorAll("[data-general-passage-tab]"));
      assert.deepEqual(tabs.map(t=>t.getAttribute("data-general-passage-tab")),[String(no)]);
      const region=document.querySelector(`[data-general-passage='${no}'] [data-clickable-text]`) as HTMLElement;
      await openWord(region);
      const last=n.calls.filter(c=>c.url.includes("/api/vocabulary/lookup")).at(-1)!.url;
      assert.ok(last.includes(`occurrenceId=occ-${no}`) && last.includes(`sourceId=${pid(no)}`),last);
    });
  } finally {n.restore();}
});

test("answers autosave for the chosen passage and Check shows learning results with evidence", async () => {
  const n = net();
  try {
    await mount(React.createElement(GeneralReadingSession, { userId: "test-user", dict: en, setId: SET, setTitle: "Set one", passages, initialProgress: { [pid(3)]: { answers: { q3a: "false" }, score: null, total: null, checked: false } }, mode: "full" }), async () => {
      const radio = document.querySelector("[data-question='q1a'] [data-answer-option='true']") as HTMLInputElement;
      assert.ok(radio, "TFNG offers TRUE/FALSE/NOT GIVEN");
      assert.equal(document.querySelectorAll("[data-question='q1a'] [role='radio']").length, 3);
      await act(async () => radio.click());
      await tick(800);
      // API path, not a page URL: the endpoint is /api/reading/general/progress.
      const save = n.calls.find((c) => c.url.includes("/api/reading/general/progress"))!;
      assert.deepEqual(save.body, { passageId: pid(1), answers: { q1a: "true" }, check: false });
      await act(async () => (document.querySelector("input[name='answer-q1b'][value='A shop']") as HTMLInputElement).click());
      await act(async () => (document.querySelector("[data-general-check]") as HTMLButtonElement).click());
      await tick();
      const check = n.calls.filter((c) => c.url.includes("/api/reading/general/progress")).at(-1)!;
      assert.deepEqual(check.body, { passageId: pid(1), answers: { q1a: "true", q1b: "A shop" }, check: true });
      assert.equal(document.querySelector("[data-general-explanation]")?.textContent?.includes("The source explicitly confirms approval."),true);
      assert.equal(document.querySelectorAll("[data-general-explanation-missing]").length,1);
      assert.equal(document.querySelectorAll("[data-general-result='correct']").length, 1);
      assert.equal(document.querySelectorAll("[data-general-result='incorrect']").length, 1);
      assert.equal(document.querySelector("[data-general-evidence]")?.textContent?.includes("The bank approved the loan."), true);
      assert.equal(document.querySelector("[data-general-evidence] [data-clickable-text]"), null, "evidence is not a vocabulary target");
      assert.ok(document.querySelector("[data-general-score]")?.textContent?.includes("1"));
      assert.equal((document.querySelector("[data-question='q1a'] [data-answer-option='true']") as HTMLElement).getAttribute("aria-checked"), "true");
      assert.equal(document.querySelector("[data-question='q3a']"),null);

    });
  } finally { n.restore(); }
});

test("learner-facing text shows no internal ids or enum names (en + uz Latin)", async () => {
  for (const dict of [en, uz]) {
    await mount(React.createElement(GeneralReadingSession, { userId: "test-user", dict, setId: SET, setTitle: "Set one", passages, initialProgress: {}, mode: "full" }), async () => {
      const text = document.body.textContent ?? "";
      for (const banned of [SET, pid(1), "occ-1", "general_practice", "GENERAL_PRACTICE", "ACADEMIC", "true_false_not_given", "multiple_choice", "q1a"]) assert.equal(text.includes(banned), false, banned);
      assert.equal(/[\u0400-\u04FF]/.test(text), false, "no Cyrillic");
    });
  }
  await mount(React.createElement(GeneralReadingSets, { dict: en, sets: [{ id: SET, title: "Set one", description: null, level: "B1", passages: [{ passageNo: 1, title: "A" }, { passageNo: 2, title: "B" }, { passageNo: 3, title: "C" }], started: 0, checked: 0 }] }), async () => {
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    for (const p of ["1", "2", "3"]) assert.ok(hrefs.includes(`/app/reading/general/${SET}?passage=${p}`), p);
    assert.equal(hrefs.some(href=>href?.includes("passage=full")),false);
  });
});

test("VD-003 XSS: HTML-like source, question and popup strings render as literal text, never as elements", async () => {
  const evil = '<img src=x onerror="globalThis.__xss=1"> bank <script>globalThis.__xss=2</script>';
  const xssPassage = { ...passages[0]!, body: evil, title: "<b>T</b>",
    occurrences: [{ id: "occ-x", startChar: evil.indexOf("bank"), endChar: evil.indexOf("bank") + 4, surfaceForm: "bank" }],
    questions: [{ id: "qx", questionNo: 1, order: 1, type: "short_answer", questionText: "<svg onload=alert(1)>Q</svg>", options: null }] };
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => new Response(JSON.stringify(String(url).includes("folders") ? { folders: [] }
    : { status: "resolved", contextual: { definitionEn: "<img src=y onerror=alert(2)>money place", translationUz: "<i>bank</i>", verificationStatus: "verified", partOfSpeech: "noun", lexicalType: "word", ipa: null }, known: null }),
    { headers: { "Content-Type": "application/json" } })) as typeof fetch;
  try {
    await mount(React.createElement(GeneralReadingSession, { userId: "test-user", dict: en, setId: SET, setTitle: "<i>S</i>", passages: [xssPassage], initialProgress: {}, mode: 1 }), async () => {
      for (const tag of ["img", "script", "svg", "b", "i"]) assert.equal(document.querySelector(`[data-general-reading] ${tag}`), null, `no <${tag}> element from data`);
      assert.ok(document.body.textContent!.includes('<img src=x onerror="globalThis.__xss=1">'), "source text kept verbatim, not stripped");
      assert.ok(document.body.textContent!.includes("<svg onload=alert(1)>Q</svg>"));
      const region = document.querySelector("[data-clickable-text]") as HTMLElement;
      const bank = Array.from(region.querySelectorAll("[data-token]")).find((el) => el.textContent === "bank") as HTMLElement;
      region.focus();
      for (let i = 0; i < 40 && region.querySelector(".bg-signal-50")?.textContent !== "bank"; i += 1)
        await act(async () => { region.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
      assert.ok(bank, "bank token exists");
      await act(async () => { region.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
      await tick();
      const dialog = document.querySelector("[role=dialog]")!;
      assert.ok(dialog.textContent!.includes("<img src=y onerror=alert(2)>money place"), "popup meaning shown as text");
      assert.equal(dialog.querySelector("img,i"), null);
      assert.equal((globalThis as { __xss?: number }).__xss, undefined, "nothing executed");
    });
  } finally { globalThis.fetch = original; }
});

test("checked reload restores authored feedback without another Check request; editing removes it immediately", async () => {
  const n = net();
  try {
    await mount(React.createElement(GeneralReadingSession, {
      userId:'test-user',dict:en,setId:SET,setTitle:'Set one',passages,mode:'full',
      initialProgress:{[pid(1)]:{answers:{q1a:'true'},score:1,total:2,checked:true,result:[
        {questionId:'q1a',isCorrect:true,correctAnswer:'TRUE',acceptedAnswers:['true'],evidenceQuote:'The bank approved the loan.',explanation:'Authored explanation on reload'},
        {questionId:'q1b',isCorrect:false,correctAnswer:'A marathon',evidenceQuote:null,explanation:null},
      ]}},
    }),async()=>{
      assert.equal(document.querySelectorAll('[data-general-result]').length,2);
      assert.ok(document.querySelector('[data-general-explanation]')?.textContent?.includes('Authored explanation on reload'));
      assert.ok(document.querySelector('[data-general-accepted]')?.textContent?.includes('true'));
      assert.ok(document.querySelector('[data-general-explanation-missing]'));
      assert.equal(n.calls.filter(call=>call.url.includes('/api/reading/general/progress')).length,0,'reload does not perform Check');
      await act(async()=> (document.querySelector("[data-question='q1a'] [data-answer-option='false']") as HTMLButtonElement).click());
      assert.equal(document.querySelector('[data-general-result]'),null);
      assert.equal(document.querySelector('[data-general-score]'),null,'old checked score is not shown for edited answers');
      await tick(800);
      const saved = n.calls.filter(call=>call.url.includes('/api/reading/general/progress'));
      assert.equal(saved.length,1);
      assert.equal((saved[0]!.body as {check:boolean}).check,false,'an edit saves a draft, not an automatic Check');
    });
  } finally { n.restore(); }
});

test("GEN-06 a late Check response that was overtaken by an edit cannot restore stale feedback", async () => {
  // The learner presses Check, then edits an answer BEFORE the server replies.
  // The in-flight reply describes answers that no longer exist, so it must be
  // discarded: showing it would tell the learner their current answer is graded.
  const original = globalThis.fetch;
  let releaseCheck!: () => void;
  const held = new Promise<void>((resolve) => { releaseCheck = resolve; });
  const calls: { url: string; body: { check?: boolean } }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), body });
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
    if (String(url).includes("folders")) return json({ folders: [] });
    if (String(url).includes("/api/reading/general/progress")) {
      if (body.check) {
        await held; // the Check reply arrives only after the learner has edited
        return json({ ok: true, score: 1, total: 2, result: [
          { questionId: "q1a", isCorrect: true, correctAnswer: "TRUE", evidenceQuote: "The bank approved the loan.", explanation: "Stale authored explanation" },
          { questionId: "q1b", isCorrect: false, correctAnswer: "A marathon", evidenceQuote: null, explanation: null },
        ] });
      }
      return json({ ok: true, score: null, total: null, result: null });
    }
    return json({});
  }) as typeof fetch;
  try {
    await mount(React.createElement(GeneralReadingSession, {
      userId: "test-user", dict: en, setId: SET, setTitle: "Set one", passages, mode: "full", initialProgress: {},
    }), async () => {
      await act(async () => (document.querySelector("[data-question='q1a'] [data-answer-option='true']") as HTMLButtonElement).click());
      await tick(800);
      const checkButton = Array.from(document.querySelectorAll("button")).find((b) => /check/i.test(b.textContent ?? ""))!;
      assert.ok(checkButton, "the explicit Check control exists");
      await act(async () => checkButton.click());
      assert.equal(document.querySelector("[data-general-result]"), null, "nothing is shown while the Check is in flight");

      // The learner changes their mind while the Check is still in flight.
      await act(async () => (document.querySelector("[data-question='q1a'] [data-answer-option='false']") as HTMLButtonElement).click());
      releaseCheck();
      await tick(900);

      assert.equal(document.querySelector("[data-general-result]"), null, "the overtaken Check reply is discarded");
      assert.equal(document.querySelector("[data-general-score]"), null, "no stale score is restored");
      assert.equal(document.body.textContent!.includes("Stale authored explanation"), false, "no stale authored explanation is painted");
      assert.ok(calls.some((c) => c.body.check === true), "a real Check request was actually issued");
    });
  } finally { globalThis.fetch = original; }
});
