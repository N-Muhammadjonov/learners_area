import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/app/video-lessons/v1" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
const React = await import("react"); Object.assign(globalThis, { React });
const { act, Profiler } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { VideoLessonStudio } = await import("../../src/components/courses/VideoLessonStudio");
const { NewVideoLessonForm } = await import("../../src/components/admin/NewVideoLessonForm");
const { resolveEmbedOrigin } = await import("../../src/lib/services/video/embed-origin");

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const q = <T extends Element = HTMLElement>(s: string) => { const el = document.querySelector<T>(s); assert.ok(el, s); return el; };
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const router = { push() {}, refresh() {}, back() {}, forward() {}, replace() {}, prefetch() {} };
async function mount(element: React.ReactNode) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(q("#root"));
  await act(async () => root.render(<AppRouterContext.Provider value={router}>{element}</AppRouterContext.Provider>));
  return { unmount: () => act(async () => root.unmount()) };
}
async function mounted(element: React.ReactNode, run: () => Promise<void> | void) {
  const m = await mount(element);
  try { await run(); } finally { await m.unmount(); }
}
const YT = "https://www.youtube-nocookie.com";
const questions = [
  { id: "q1", stage: "comprehension" as const, prompt: "What is the main idea?", atSeconds: null },
  { id: "q2", stage: "gap_fill" as const, prompt: "The speaker says ___", atSeconds: null },
];
const lesson = (over: Record<string, unknown> = {}) => ({ id: "v1", provider: "youtube", videoId: "dQw4w9WgXcQ", title: "QA talk", beforeYouWatch: null, durationSeconds: 120, transcript: null, transcriptSource: null, transcriptAttribution: null, notes: null, ...over });
type Mode = "standalone" | "course";
const studio = (mode: Mode, props: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => (
  <VideoLessonStudio mode={mode} dict={en} lessonId="v1" videoLesson={lesson(over)} questions={[]} initialProgress={null} {...props} />
);
const tabIds = () => [...document.querySelectorAll("[data-video-tab]")].map((el) => el.getAttribute("data-video-tab"));
const frame = () => q<HTMLIFrameElement>("[data-video-frame]");
function post(data: unknown, opts: { origin?: string; source?: unknown } = {}) {
  const event = new dom.window.MessageEvent("message", { data: JSON.stringify(data), origin: opts.origin ?? YT, source: (opts.source ?? frame().contentWindow) as Window });
  window.dispatchEvent(event);
}
type Call = { body: Record<string, unknown>; init: RequestInit };
function mockFetch(respond: (call: Call, index: number) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
    // API path, not a page URL: the endpoint is /api/video-lessons/<id>/progress.
    if (!String(url).includes("/api/video-lessons/") || !String(url).endsWith("/progress")) return Response.json({ ok: true });
    const call = { body: JSON.parse(String(init.body)), init };
    calls.push(call);
    return respond(call, calls.length - 1);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const ok = (state = "completed", watchedSeconds = 120) => Response.json({ state, watchedSeconds });
const finals = (calls: Call[]) => calls.filter((c) => c.body.ended === true);

// ---------- Standalone vs course questions ----------
test("S1 standalone exposes real authored Comprehension", () => mounted(studio("standalone", { questions: [questions[0]] }), () => {
  assert.ok(tabIds().includes("comprehension"));
}));
test("S2 standalone exposes real authored gap-fill", () => mounted(studio("standalone", { questions: [questions[1]] }), () => {
  assert.ok(tabIds().includes("gap"));
}));
test("S3 standalone authored stages retain their ordered learning flow", () => mounted(studio("standalone", { questions }, { beforeYouWatch: "Predict", notes: "N", transcriptText: "T" }), () => {
  assert.deepEqual(tabIds(), ["before", "transcript", "notes", "comprehension", "gap", "opinion", "summary"]);

}));
test("R4 course mode still renders authored Comprehension and gap-fill", () => mounted(studio("course", { questions }), () => {
  assert.deepEqual(tabIds(), ["comprehension", "gap", "opinion", "summary"]);
}));
test("mode is explicit at both call sites and authored data determines question tabs", () => {
  assert.match(read("src/app/app/(shell)/video-lessons/[id]/page.tsx"), /mode="standalone"/);
  assert.match(read("src/app/app/(shell)/courses/ielts/lessons/[lessonId]/page.tsx"), /mode="course"/);
  const src = read("src/components/courses/VideoLessonStudio.tsx");
  assert.match(src, /if \(comprehension\.length > 0\) list\.push\("comprehension"\);/);
  assert.match(src, /if \(gapFill\.length > 0\) list\.push\("gap"\);/);
});

// ---------- Management ----------
const lessons = [{ id: "11111111-1111-4111-8111-111111111111", title: "Course lesson 1" }];
async function choose(value: string) {
  await act(async () => { const el = q<HTMLSelectElement>("[data-video-lesson-select]"); el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function type(selector: string, value: string) {
  await act(async () => {
    const el = q<HTMLInputElement | HTMLTextAreaElement>(selector);
    const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
test("S4 standalone Management supports authored exercises", () => mounted(<NewVideoLessonForm dict={en} lessons={lessons} />, () => {
  assert.ok(document.querySelector("[data-video-questions-input]"));
}));
test("S5 selecting a course lesson makes the question editor available", () => mounted(<NewVideoLessonForm dict={en} lessons={lessons} />, async () => {
  await choose(lessons[0]!.id);
  assert.ok(document.querySelector("[data-video-questions-input]"));
}));
test("S6 changing the course link preserves the authored draft and submits it in standalone mode", async () => {
  const sent: Record<string, unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return Response.json({ ok: true }); }) as typeof fetch;
  try {
    await mounted(<NewVideoLessonForm dict={en} lessons={lessons} />, async () => {
      await choose(lessons[0]!.id);
      await type("[data-video-questions-input]", "What is the speaker's main point? || education matters");
      await choose("");
      assert.ok(document.querySelector("[data-video-questions-input]"));
      await choose(lessons[0]!.id);
      assert.equal(q<HTMLTextAreaElement>("[data-video-questions-input]").value, "What is the speaker's main point? || education matters", "course selection preserves the draft");
      await choose("");
      const inputs = [...document.querySelectorAll<HTMLInputElement>("form input:not([type=number])")];
      await type("form input:not([type=number])", "https://youtu.be/dQw4w9WgXcQ");
      if (inputs[1]) { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(inputs[1], "A standalone talk"); await act(async () => { inputs[1]!.dispatchEvent(new Event("input", { bubbles: true })); }); }
      await act(async () => { q<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      await tick();
    });
  } finally { globalThis.fetch = original; }
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.lessonId, null);
  assert.equal((sent[0]!.questions as {prompt: string}[]).length, 1);
  assert.equal((sent[0]!.questions as {prompt: string}[])[0]!.prompt, "What is the speaker's main point?");
});
test("S7 the admin API validates optional authored exercises for both modes", () => {
  assert.match(read("src/app/api/admin/video-lessons/route.ts"), /forwardToBackend as POST/);
  const route = read("services/backend/app/step30_admin_video_lessons.py");
  assert.doesNotMatch(route, /standalone_questions_not_allowed/);
  assert.match(route, /acceptedAnswers/);
  assert.match(route, /staff\['role'\] not in \('teacher','admin','owner'\)/);
});

// ---------- Final flush races ----------
test("F1 END -> one final write with the end report", async () => {
  const f = mockFetch(() => ok());
  try {
    await mounted(studio("standalone"), async () => {
      await act(async () => { post({ event: "onStateChange", info: 0 }); });
      await tick();
      assert.equal(finals(f.calls).length, 1);
      assert.deepEqual(finals(f.calls)[0]!.body, { watchedSeconds: 120, ended: true });
      assert.equal(finals(f.calls)[0]!.init.keepalive, true);
      assert.ok(q("[data-video-ended]"));
    });
  } finally { f.restore(); }
});
test("F2 END -> immediate Replay does not cancel the final write; replay starts at 0 and stays completed", async () => {
  let resolve!: (r: Response) => void;
  const f = mockFetch(() => new Promise<Response>((r) => { resolve = r; }));
  try {
    await mounted(studio("standalone", { initialProgress: { state: "in_progress", watchedSeconds: 40, answers: {}, responseText: null, summaryText: null } }), async () => {
      assert.equal(new URL(frame().src).searchParams.get("start"), "40");
      await act(async () => { post({ event: "onStateChange", info: 0 }); });
      // Replay while the final write is still pending on the (mocked) server.
      await act(async () => { q<HTMLButtonElement>("[data-video-ended] button").click(); });
      assert.equal(finals(f.calls).length, 1);
      assert.equal((finals(f.calls)[0]!.init.signal as AbortSignal).aborted, false, "Replay must not abort the final write");
      assert.equal(new URL(frame().src).searchParams.get("start"), null, "replay starts at 0");
      await act(async () => { resolve(ok()); }); await tick();
      assert.equal(q("[data-video-progress-state]").textContent, en.videoLesson.stateCompleted);
    });
  } finally { f.restore(); }
});
test("F3 END -> immediate unmount does not cancel the final write", async () => {
  const f = mockFetch(() => new Promise<Response>(() => {}));
  try {
    const m = await mount(studio("standalone"));
    await act(async () => { post({ event: "onStateChange", info: 0 }); });
    await m.unmount();
    assert.equal(finals(f.calls).length, 1);
    assert.equal((finals(f.calls)[0]!.init.signal as AbortSignal).aborted, false, "unmount must not abort the final write");
  } finally { f.restore(); }
});
test("F4 duplicated END (onStateChange + infoDelivery) -> one logical final write", async () => {
  const f = mockFetch(() => ok());
  try {
    await mounted(studio("standalone"), async () => {
      await act(async () => { post({ event: "onStateChange", info: 0 }); post({ event: "infoDelivery", info: { playerState: 0, currentTime: 120 } }); post({ event: "onStateChange", info: 0 }); });
      await tick();
      assert.equal(finals(f.calls).length, 1);
    });
  } finally { f.restore(); }
});
test("F5 END while a periodic write is in flight -> final write still sent", async () => {
  const f = mockFetch((_c, i) => (i === 0 ? new Promise<Response>(() => {}) : ok()));
  try {
    await mounted(studio("standalone", {}, { durationSeconds: null }), async () => {
      await act(async () => { post({ event: "infoDelivery", info: { currentTime: 30 } }); });
      assert.equal(f.calls.length, 1, "periodic write in flight");
      await act(async () => { post({ event: "infoDelivery", info: { currentTime: 95, playerState: 0 } }); });
      await tick();
      assert.equal(finals(f.calls).length, 1);
      assert.deepEqual(finals(f.calls)[0]!.body, { watchedSeconds: 95, ended: true }, "unknown duration sends the real last position");
    });
  } finally { f.restore(); }
});
test("F8 unknown-duration END without a fresh currentTime uses the last acknowledged position", async () => {
  const f = mockFetch(() => ok());
  try {
    await mounted(studio("standalone", { initialProgress: { state: "in_progress", watchedSeconds: 35, answers: {}, responseText: null, summaryText: null } }, { durationSeconds: null }), async () => {
      await act(async () => { post({ event: "onStateChange", info: 0 }); });
      await tick();
      assert.equal(finals(f.calls).length, 1);
      assert.deepEqual(finals(f.calls)[0]!.body, { watchedSeconds: 35, ended: true });
    });
  } finally { f.restore(); }
});
test("F6/F7 forged END from a wrong origin or another window -> no final write, no end screen", async () => {
  const f = mockFetch(() => ok());
  try {
    await mounted(studio("standalone"), async () => {
      await act(async () => {
        post({ event: "onStateChange", info: 0 }, { origin: "https://evil.example" });
        post({ event: "onStateChange", info: 0 }, { source: window });
        post({ event: "onStateChange", info: 0 }, { origin: "https://www.youtube.com" });
        window.dispatchEvent(new dom.window.MessageEvent("message", { data: "{not json", origin: YT, source: frame().contentWindow as Window }));
        window.dispatchEvent(new dom.window.MessageEvent("message", { data: JSON.stringify({ event: "somethingElse", info: 0 }), origin: YT, source: frame().contentWindow as Window }));
      });
      await tick();
      assert.equal(f.calls.length, 0);
      assert.equal(document.querySelector("[data-video-ended]"), null);
    });
  } finally { f.restore(); }
});
test("resume contract: >=5 unfinished resumes, completed/<5 start at 0; never NaN/negative", async () => {
  const p = (state: string, watchedSeconds: number) => ({ state, watchedSeconds, answers: {}, responseText: null, summaryText: null });
  for (const [state, secs, expected] of [["in_progress", 5, "5"], ["in_progress", 43200, "43200"], ["in_progress", 4.9, null], ["completed", 100, null], ["in_progress", Number.NaN, null], ["in_progress", -10, null]] as const) {
    await mounted(studio("standalone", { initialProgress: p(state, secs) }), () => {
      assert.equal(new URL(frame().src).searchParams.get("start"), expected, `${state} ${secs}`);
    });
  }
});

// ---------- Origin ----------
const H = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
test("O1-O6 origin resolution is exact, safe and never *", () => {
  assert.equal(resolveEmbedOrigin(H({ host: "evil.example" }), "https://learnersarea.uz", {}), "https://learnersarea.uz");
  assert.equal(resolveEmbedOrigin(H({ host: "x", "x-forwarded-host": "example-preview.vercel.app", "x-forwarded-proto": "https" }), null, { VERCEL: "1" }), "https://example-preview.vercel.app");
  assert.equal(resolveEmbedOrigin(H({ host: "localhost:3000" }), null, {}), "http://localhost:3000");
  assert.equal(resolveEmbedOrigin(H({ host: "example-preview.vercel.app" }), null, {}), "https://example-preview.vercel.app");
  assert.equal(resolveEmbedOrigin(H({ host: "example.com/path" }), null, {}), null);
  assert.equal(resolveEmbedOrigin(H({ host: "user:password@example.com" }), null, {}), null);
  assert.equal(resolveEmbedOrigin(H({}), "https://example.com/path", {}), null);
  assert.equal(resolveEmbedOrigin(H({}), "https://user:pw@example.com", {}), null);
  assert.equal(resolveEmbedOrigin(H({}), "https://*.example.com", {}), null, "configured wildcard hosts are rejected");
  assert.equal(resolveEmbedOrigin(H({ host: "*" }), null, {}), null);
  assert.equal(resolveEmbedOrigin(H({ host: "x", "x-forwarded-host": "*", "x-forwarded-proto": "https" }), null, { VERCEL: "1" }), "https://x");
  assert.equal(resolveEmbedOrigin(H({ host: "[::1]:3000" }), null, {}), "http://[::1]:3000");
  // Forwarded headers are ignored unless proxy headers are trusted.
  assert.equal(resolveEmbedOrigin(H({ host: "real.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" }), null, {}), "https://real.example");
});
test("O7/O8 both player routes pass the resolved origin; the player emits it and never *", async () => {
  for (const page of ["src/app/app/(shell)/video-lessons/[id]/page.tsx", "src/app/app/(shell)/courses/ielts/lessons/[lessonId]/page.tsx"]) {
    assert.match(read(page), /embedOrigin=\{resolveEmbedOrigin\(/);
  }
  for (const mode of ["standalone", "course"] as const) {
    await mounted(studio(mode, { embedOrigin: "https://learnersarea.uz" }), () => {
      const src = new URL(frame().src);
      assert.equal(src.searchParams.get("enablejsapi"), "1");
      assert.equal(src.searchParams.get("origin"), "https://learnersarea.uz");
    });
  }
});

// ---------- Accessibility ----------
test("A1-A7 activity selector is a tablist with linked tabs/panel and arrow/Home/End keys", () => mounted(studio("standalone", {}, { notes: "N", transcriptText: "T" }), async () => {
  const list = q("[role=tablist]");
  assert.equal(list.getAttribute("aria-label"), en.videoLesson.stagesLabel);
  const tabs = [...list.querySelectorAll<HTMLButtonElement>("[role=tab]")];
  assert.equal(tabs.length, 4);
  const panel = q("[role=tabpanel]");
  assert.equal(tabs[0]!.getAttribute("aria-selected"), "true");
  assert.equal(tabs[1]!.getAttribute("aria-selected"), "false");
  assert.equal(tabs[0]!.getAttribute("tabindex"), "0");
  assert.equal(tabs[1]!.getAttribute("tabindex"), "-1");
  for (const t of tabs) assert.equal(t.getAttribute("aria-controls"), panel.id);
  assert.equal(panel.getAttribute("aria-labelledby"), tabs[0]!.id);
  assert.match(tabs[0]!.className, /focus-visible:outline/);
  const key = async (el: Element, k: string) => act(async () => { el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true })); });
  await key(tabs[0]!, "ArrowRight");
  assert.equal(q('[data-video-tab="notes"]').getAttribute("aria-selected"), "true");
  assert.equal(document.activeElement, q('[data-video-tab="notes"]'));
  assert.equal(q("[role=tabpanel]").getAttribute("aria-labelledby"), q('[data-video-tab="notes"]').id);
  await key(q('[data-video-tab="notes"]'), "End");
  assert.equal(q('[data-video-tab="summary"]').getAttribute("aria-selected"), "true");
  await key(q('[data-video-tab="summary"]'), "ArrowRight");
  assert.equal(q('[data-video-tab="transcript"]').getAttribute("aria-selected"), "true", "wraps to first");
  await key(q('[data-video-tab="transcript"]'), "ArrowLeft");
  assert.equal(q('[data-video-tab="summary"]').getAttribute("aria-selected"), "true", "wraps to last");
  await key(q('[data-video-tab="summary"]'), "Home");
  assert.equal(q('[data-video-tab="transcript"]').getAttribute("aria-selected"), "true");
  await act(async () => q<HTMLButtonElement>('[data-video-tab="opinion"]').click());
  assert.ok(q("[data-video-opinion]"));
}));
test("A8 the player stays a native, titled iframe with nothing layered over it", () => mounted(studio("standalone"), () => {
  assert.equal(frame().getAttribute("title"), "QA talk");
  assert.equal(frame().parentElement!.children.length, 1);
}));

// ---------- Performance ----------
test("P1-P3 position ticks do not re-render per timestamp; progress posts per >=5 s, one at a time", async () => {
  let release!: () => void;
  const f = mockFetch(() => new Promise<Response>((r) => { release = () => r(Response.json({ state: "in_progress", watchedSeconds: 6 })); }));
  let renders = 0;
  try {
    await mounted(<Profiler id="s" onRender={() => { renders++; }}>{studio("standalone", {}, { durationSeconds: 600 })}</Profiler>, async () => {
      const base = renders;
      await act(async () => { for (let i = 1; i <= 40; i++) post({ event: "infoDelivery", info: { currentTime: i * 0.1 } }); });
      assert.ok(renders - base <= 1, `40 sub-5s ticks caused ${renders - base} renders (only the one-time tracking flag may render)`);
      assert.equal(f.calls.length, 0, "no write below the 5 s delta");
      assert.equal(q("[data-video-live-transcript]").getAttribute("data-video-live-transcript"), "yes");
      await act(async () => { for (let i = 0; i < 30; i++) post({ event: "infoDelivery", info: { currentTime: 6 + i } }); });
      assert.equal(f.calls.length, 1, "one write in flight, no request storm");
      await act(async () => { release(); }); await tick();
      await act(async () => { post({ event: "infoDelivery", info: { currentTime: 40 } }); });
      assert.equal(f.calls.length, 2, "next write after acknowledgement and a new >= 5 s delta");
    });
  } finally { f.restore(); }
});
test("P4/P5 opinion and summary keep focus, cursor and draft while the player reports progress", async () => {
  const f = mockFetch(() => Response.json({ state: "in_progress", watchedSeconds: 10 }));
  try {
    await mounted(studio("standalone"), async () => {
      for (const [tabId, selector] of [["opinion", "[data-video-opinion-input]"], ["summary", "[data-video-summary-input]"]] as const) {
        await act(async () => q<HTMLButtonElement>(`[data-video-tab="${tabId}"]`).click());
        await type(selector, "My draft text");
        const el = q<HTMLTextAreaElement>(selector);
        el.focus(); el.setSelectionRange(3, 3);
        await act(async () => { for (let i = 0; i < 20; i++) post({ event: "infoDelivery", info: { currentTime: 10 + i } }); });
        await tick();
        assert.equal(document.activeElement, el);
        assert.equal(el.value, "My draft text");
        assert.equal(el.selectionStart, 3);
      }
    });
  } finally { f.restore(); }
});

test("standalone Vocabulary renders the authored sense and saves its occurrence through the real API contract", async () => {
  const original = globalThis.fetch;
  const calls: {url: string; body: unknown}[] = [];
  globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
    if (String(url).endsWith('/video-lessons/v1/vocabulary')) calls.push({url: String(url), body: JSON.parse(String(init.body))});
    return Response.json({ok: true});
  }) as typeof fetch;
  try {
    await mounted(studio('standalone', {vocabulary: [{occurrenceId: 'occurrence-1', id: 'sense-1', term: 'bank', partOfSpeech: 'noun', definitionEn: 'a financial institution', translationUz: 'bank', exampleSentence: 'She saved her money in the bank.'}]}), async () => {
      await act(async () => q('[data-video-tab="vocabulary"]').click());
      assert.match(q('[data-video-vocabulary]').textContent ?? '', /a financial institution/);
      await act(async () => q<HTMLButtonElement>('[data-video-vocabulary] button').click());
      await tick();
      assert.deepEqual(calls, [{url: '/api/video-lessons/v1/vocabulary', body: {occurrenceId: 'occurrence-1'}}]);
      assert.equal(q<HTMLButtonElement>('[data-video-vocabulary] button').disabled, true);
      assert.match(q('[data-video-vocabulary] button').textContent ?? '', new RegExp(en.videoLesson.vocabularySaved));
    });
  } finally {globalThis.fetch = original;}
});
