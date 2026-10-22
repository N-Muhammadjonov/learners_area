import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

/*
 * Reading mode separation (src/lib/reading/lexical-policy.ts).
 * The SAME passage and the SAME precomputed occurrence are rendered in the active
 * Academic exam and in the post-submission Academic review: only the mode differs.
 */
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: "http://localhost/reading" });
for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "HTMLAnchorElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "KeyboardEvent", "localStorage", "sessionStorage", "getComputedStyle"] as const)
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis, ResizeObserver: class { observe() {} disconnect() {} } });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { ReadingExam } = await import("../../src/components/reading/ReadingExam");
const { ClickableText } = await import("../../src/components/vocabulary/ClickableText");
const { ReadingAnalysis } = await import("../../src/components/reading/ReadingAnalysis");
const { readingLexicalAssistanceAllowed } = await import("../../src/lib/reading/lexical-policy");

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const body = "The bank approved the loan. He took the cost into account.";
const occurrences = [
  { id: "occ-bank", startChar: 4, endChar: 8, surfaceForm: "bank" },
  { id: "occ-take-into-account", startChar: 31, endChar: 57, surfaceForm: "took the cost into account" },
];
const material = { id: "mat-1", type: "text", position: 0, textContent: "Glossary-free note about the loan.", linkUrl: null, fileKey: null, fileName: null, mimeType: null, title: null } as never;

async function mount(element: React.ReactElement, run: () => Promise<void>) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  try {
    await act(async () => root.render(React.createElement(AppRouterContext.Provider, { value: router as never }, element)));
    await run();
  } finally {
    await act(async () => root.unmount());
  }
}

function recordFetch() {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    if (String(url).includes("folders")) return new Response(JSON.stringify({ folders: [] }), { headers: { "Content-Type": "application/json" } });
    if (String(url).includes("/api/vocabulary/lookup")) return new Response(JSON.stringify({ status: "resolved", contextual: { definitionEn: "An organisation that keeps money", translationUz: "bank", verificationStatus: "verified", partOfSpeech: "noun", lexicalType: "word", ipa: null }, known: null }), { headers: { "Content-Type": "application/json" } });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

const examProps = {
  dict: en, attemptId: "11111111-1111-4111-8111-111111111111", passageTitle: "Banks", passageBody: body, passageMeta: null,
  questions: [], groups: [], paragraphs: [], savedAnswers: {}, startedAt: new Date().toISOString(), suggestedMinutes: 20, materials: [material],
};

test("General phrase: either word opens the full authored phrase and never its nested word sense", async () => {
  const net=recordFetch();
  const text="food poisoning";
  try { await mount(React.createElement(ClickableText,{dict:en,text,sourceType:"reading",sourceId:"passage",phraseAware:true,occurrences:[{id:"word",startChar:0,endChar:4,surfaceForm:"food"},{id:"phrase",startChar:0,endChar:14,surfaceForm:text}]}),async()=>{
    await act(async()=>{document.querySelector("[data-word=food]")!.dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true,detail:0}));});
    assert.equal(document.querySelector("[role=dialog]")?.getAttribute("aria-label"),text);
    assert.ok(net.urls.some(url=>url.includes("occurrenceId=phrase")));
    assert.ok(!net.urls.some(url=>url.includes("occurrenceId=word")));
  }); } finally {net.restore();}
});

test("General phrase: find you out never displays the checked definition of the isolated word find", async () => {
  const net=recordFetch();
  try { await mount(React.createElement(ClickableText,{dict:en,text:"find you out",sourceType:"reading",sourceId:"passage",phraseAware:true,occurrences:[{id:"find-only",startChar:0,endChar:4,surfaceForm:"find"}]}),async()=>{
    await act(async()=>{document.querySelector("[data-word=find]")!.dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true,detail:0}));});
    assert.equal(document.querySelector("[role=dialog]")?.getAttribute("aria-label"),"find you out");
    assert.ok(!net.urls.some(url=>url.includes("/lookup")||url.includes("/search")),"no guessed spelling/single-word meaning");
  }); } finally {net.restore();}
});

test("ACADEMIC_EXAM (active test): the passage reveals nothing — no word target, popup, Add to Vocabulary, hint text or lookup request", async () => {
  const net = recordFetch();
  try {
    await mount(React.createElement(ReadingExam, examProps), async () => {
      const passage = document.querySelector("[data-passage-body]")!;
      assert.ok(passage.textContent?.includes("The bank approved the loan."), "the text itself is readable");
      assert.ok(passage.querySelector("[data-exam-passage-text]"));
      for (const selector of ["[data-clickable-text]", "[data-word]", "[data-token]", "[data-word-popover]", "[data-word-save]", "[role=dialog]"])
        assert.equal(document.querySelector(selector), null, `no ${selector} in the active exam`);
      // Unrestricted attachments are not assessment material and can contain keys.
      assert.equal(document.querySelector("[data-resource-blocks]"),null);
      assert.equal(document.body.textContent?.includes(en.readingPractice.wordSaveHint), false, "no 'click a word to save' hint");
      // Reading V4: one keyboard-reachable annotation surface, but no lexical target.
      assert.equal(passage.querySelectorAll("[tabindex]").length, 1, "highlight has a keyboard-reachable text region");
      assert.equal(passage.querySelectorAll("[data-word],a").length,0);
      const classes = Array.from(passage.querySelectorAll("*")).map((el) => el.getAttribute("class") ?? "").join(" ");
      for (const banned of ["cursor-pointer", "underline", "decoration-", "bg-signal", "hover:"]) assert.equal(classes.includes(banned), false, `no ${banned} on passage text`);
      // Interaction attempts: click and keyboard on the passage produce no lookup.
      const text = passage.querySelector("[data-exam-passage-text]") as HTMLElement;
      await act(async () => { text.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: 1 })); });
      await act(async () => { text.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
      assert.equal(document.querySelector("[role=dialog]"), null);
      assert.deepEqual(net.urls.filter((url) => url.includes("/api/vocabulary")), []);
      const surface=passage.querySelector("[data-highlight-text]") as HTMLElement;
      const walker=document.createTreeWalker(surface,dom.window.NodeFilter.SHOW_TEXT);
      let node:Node|null; let position=0; const range=document.createRange();
      while((node=walker.nextNode())) { const length=node.textContent!.length;
        if(position<=4 && position+length>4) range.setStart(node,4-position);
        if(position<8 && position+length>=8) {range.setEnd(node,8-position);break;} position+=length;
      }
      window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
      await act(async()=>surface.dispatchEvent(new dom.window.KeyboardEvent("keyup",{key:"Shift",bubbles:true})));
      await act(async()=> (document.querySelector("[data-highlight-control] button") as HTMLButtonElement).click());
      assert.equal(surface.querySelector("mark")?.textContent,"bank");
      assert.equal(surface.textContent,body,"highlight does not change text offsets");
      assert.equal(document.querySelector("[data-reading-remove-highlight]"),null,"there is no permanent remove-highlight button");
      const highlighted=surface.querySelector("mark")!;
      const selectedHighlight=document.createRange();selectedHighlight.setStart(highlighted.firstChild!,0);selectedHighlight.setEnd(highlighted.firstChild!,highlighted.textContent!.length);
      window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(selectedHighlight);
      await act(async()=>surface.dispatchEvent(new dom.window.KeyboardEvent("keyup",{key:"Shift",bubbles:true})));
      const remove=document.querySelector("[data-highlight-control] button") as HTMLButtonElement;
      assert.equal(remove.textContent,en.listening.general.clearHighlight,"removal is offered only for the selected highlighted text");
      await act(async()=>remove.click());
      assert.equal(surface.querySelector("mark"),null);
      assert.equal(surface.textContent,body,"removal never deletes text");
      assert.deepEqual(net.urls.filter(url=>url.includes("/api/vocabulary")),[]);

    });
  } finally { net.restore(); }
});

test("ACADEMIC_EXAM: exam component cannot receive lexical data (no occurrences prop, no ClickableText import)", () => {
  const source = readFileSync("src/components/reading/ReadingExam.tsx", "utf8");
  for (const banned of ["ClickableText", "occurrenceSpans", "OccurrenceSpan", "occurrences", "wordSaveHint"]) assert.equal(source.includes(banned), false, banned);
  const page = readFileSync("src/app/app/(focus)/reading/attempts/[id]/page.tsx", "utf8");
  const examJsx = page.slice(page.indexOf("<ReadingExam"), page.indexOf("/>", page.indexOf("questions={questions.map")));
  assert.equal(examJsx.includes("occurrences"), false, "the page does not send occurrences to the exam");
});

test("ACADEMIC_REVIEW uses canonical occurrence lookup after submission; server permission remains authoritative", async () => {
  const net = recordFetch();
  try {
    await mount(React.createElement(ReadingAnalysis, { dict: en, score: 0, total: 0, questions: [], answers: [], passageBody: body, passageTitle: "Banks", attemptId: examProps.attemptId, locale: "en", occurrences }), async () => {
      const show = Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-expanded") !== null)!;
      await act(async () => show.click());
      const region = document.querySelector("[data-retention-passage]") as HTMLElement;
      assert.ok(region.textContent?.includes(body));
      assert.ok(region.querySelector("[data-clickable-text],[data-word],[tabindex]"));
      await act(async () => region.querySelector("[data-word=bank]")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail:0 })));
      assert.ok(document.querySelector("[role=dialog]"));
      assert.ok(net.urls.some((url) => url.includes("occurrenceId=occ-bank")));
    });
  } finally { net.restore(); }
});

test("Reading policy table: active exam never; review only after submission with no active exam; General learning unchanged", () => {
  const states = [
    { submitted: false, examInProgress: false, staff: false },
    { submitted: true, examInProgress: false, staff: false },
    { submitted: true, examInProgress: true, staff: false },
    { submitted: true, examInProgress: true, staff: true },
  ];
  assert.deepEqual(states.map((s) => readingLexicalAssistanceAllowed("ACADEMIC_EXAM", s)), [false, false, false, false]);
  assert.deepEqual(states.map((s) => readingLexicalAssistanceAllowed("ACADEMIC_REVIEW", s)), [false, true, false, false]);
  assert.deepEqual(states.map((s) => readingLexicalAssistanceAllowed("GENERAL_READING", s)), [true, true, true, true]);
});

test("General MWE: clicking 'account' (or 'took') opens the WHOLE expression by its occurrence, never 'account' alone", async () => {
  const net = recordFetch();
  try {
    await mount(React.createElement(ClickableText, { dict: en, text: body, sourceType: "reading", sourceId: "general-passage", lexicalAssistance: true, occurrences }), async () => {
      for (const word of ["account", "took"]) {
        net.urls.length = 0;
        const target = document.querySelector(`[data-word="${word}"]`) as HTMLElement;
        await act(async () => { target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: 0 })); });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        assert.equal(document.querySelector("[role=dialog]")?.getAttribute("aria-label"), "took the cost into account", word);
        assert.ok(net.urls.some((url) => url.includes("occurrenceId=occ-take-into-account")), word);
        await act(async () => { document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      }
    });
  } finally { net.restore(); }
});
