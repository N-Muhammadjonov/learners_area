import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import uz from "../../src/lib/i18n/uz";
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/video-lessons" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLAnchorElement", "HTMLImageElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
const React = await import("react"); Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { VideoLessonCard } = await import("../../src/components/video/VideoLessonCard");
const { VideoLessonStudio } = await import("../../src/components/courses/VideoLessonStudio");

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const q = <T extends Element = HTMLElement>(s: string) => { const el = document.querySelector<T>(s); assert.ok(el, s); return el; };
async function mounted(element: React.ReactNode, run: () => Promise<void> | void) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(q("#root"));
  try { await act(async () => root.render(<AppRouterContext.Provider value={{ push() {}, refresh() {}, back() {}, forward() {}, replace() {}, prefetch() {} }}>{element}</AppRouterContext.Provider>)); await run(); }
  finally { await act(async () => root.unmount()); }
}
const ID = "dQw4w9WgXcQ";
const card = (over: Partial<React.ComponentProps<typeof VideoLessonCard>> = {}) => (
  <ul><VideoLessonCard entryId="v1" standalone href="/video-lessons/v1" title="A talk about memory" provider="youtube" videoId={ID} durationSeconds={null} state="available" minutesLabel={en.videoLessons.minutes} {...over} /></ul>
);
const lesson = (over: Record<string, unknown> = {}) => ({ id: "v1", provider: "youtube", videoId: ID, title: "QA talk", beforeYouWatch: null, durationSeconds: null, transcript: null, transcriptSource: null, transcriptAttribution: null, notes: null, ...over });
const studio = (props: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => <VideoLessonStudio mode="standalone" dict={en} lessonId="v1" videoLesson={lesson(over)} questions={[]} initialProgress={null} {...props} />;
const libraryPage = read("src/app/(app)/video-lessons/page.tsx");
const detailPage = read("src/app/(app)/video-lessons/[id]/page.tsx");
const cardSrc = read("src/components/video/VideoLessonCard.tsx");
const thumbSrc = read("src/components/video/VideoThumbnail.tsx");
const studioSrc = read("src/components/courses/VideoLessonStudio.tsx");

test("01 the whole card is one internal link to the native lesson URL", () => mounted(card(), () => {
  const links = document.querySelectorAll("a");
  assert.equal(links.length, 1);
  assert.equal(links[0]!.getAttribute("href"), "/video-lessons/v1");
}));
test("02 a valid YouTube id gets the static YouTube still as a 16:9 thumbnail", () => mounted(card(), () => {
  assert.equal(q("img").getAttribute("src"), `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  assert.match(q("[data-video-thumb]").className, /aspect-video/);
}));
test("03 an invalid id shows the in-app fallback, never a broken image", () => mounted(card({ videoId: "PLACEHOLDER1" }), () => {
  assert.equal(document.querySelector("img"), null);
  assert.equal(q("[data-video-thumb]").getAttribute("data-video-thumb"), "fallback");
}));
test("04 a direct-media item uses the fallback, not a YouTube image", () => mounted(card({ provider: "direct", videoId: "clip.mp4" }), () => {
  assert.equal(document.querySelector("img"), null);
}));
test("05 an image that fails to load falls back", () => mounted(card(), async () => {
  await act(async () => { q("img").dispatchEvent(new Event("error")); });
  assert.equal(document.querySelector("img"), null);
  assert.equal(q("[data-video-thumb]").getAttribute("data-video-thumb"), "fallback");
}));
test("06 the title is clamped to 2-3 lines and the thumbnail is decorative", () => mounted(card(), () => {
  assert.match(q("[data-video-card-title]").className, /line-clamp-2/);
  assert.match(q("[data-video-card-title]").className, /sm:line-clamp-3/);
  assert.equal(q("img").getAttribute("alt"), "");
  assert.equal(q("a").textContent?.includes("A talk about memory"), true);
}));
test("07 duration appears only when stored", () => mounted(card({ durationSeconds: 754 }), () => {
  assert.equal(q("[data-video-card-meta]").textContent, "13 min");
}));
test("08 no stored metadata means no invented metadata line", () => mounted(card(), () => {
  assert.equal(document.querySelector("[data-video-card-meta]"), null);
}));
test("09 a library card never contains an iframe", () => mounted(card({ durationSeconds: 60, context: "IELTS · Unit 1" }), () => {
  assert.equal(document.querySelectorAll("iframe").length, 0);
}));
test("10 a library card has no external link and no big 'Open the lesson' button", () => mounted(card(), () => {
  assert.equal(document.querySelector('a[href^="http"]'), null);
  assert.equal(document.body.textContent?.includes(en.videoLessons.open), false);
}));
test("11 the progress status is shown on the card", () => mounted(card({ state: "completed" }), () => {
  assert.ok(document.querySelector("[data-video-lesson-entry] span"));
}));
test("12 the library is a responsive 1/2/3/4-column grid", () => {
  assert.match(libraryPage, /grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4/);
  assert.match(libraryPage, /data-video-library-grid/);
});
test("13 the library page renders no iframe and navigates with Next Link only", () => {
  for (const src of [libraryPage, cardSrc, thumbSrc]) {
    assert.doesNotMatch(src, /<iframe|window\.location|window\.open|<a\s/);
  }
  assert.match(cardSrc, /import Link from "next\/link"/);
});
test("14 the heading stays TED / PODCAST in both locales", () => {
  assert.equal(en.videoLessons.title, "TED / PODCAST");
  assert.equal(uz.videoLessons.title, "TED / PODCAST");
});
test("15 new UI strings exist in UZ and EN", () => {
  assert.equal(en.videoLessons.minutes, "{n} min");
  assert.equal(uz.videoLessons.minutes, "{n} daqiqa");
});
test("16 existing routes are kept: standalone and roadmap-linked hrefs", () => {
  assert.match(libraryPage, /href=\{`\/video-lessons\/\$\{row\.id\}`\}/);
  assert.match(libraryPage, /\/courses\/\$\{row\.courseSlug\}\/lessons\/\$\{row\.lesson\.id\}/);
});
test("17 detail order is title/metadata, then the player, with a Link back", () => {
  assert.ok(detailPage.indexOf("data-video-detail-header") < detailPage.indexOf("<VideoLessonStudio"));
  assert.match(detailPage, /<Link href="\/video-lessons"/);
  assert.doesNotMatch(detailPage, /<aside|lg:grid-cols-\[|window\.location/);
});
test("18 the player is YouTube's native /embed/ player with native controls", () => mounted(studio(), () => {
  const src = new URL(q<HTMLIFrameElement>("[data-video-frame]").src);
  assert.match(src.pathname, new RegExp(`^/embed/${ID}$`));
  assert.equal(src.searchParams.get("controls"), "1");
  assert.equal(src.searchParams.get("playsinline"), "1");
  assert.equal(src.searchParams.get("rel"), "0");
  assert.equal(src.searchParams.get("autoplay"), null);
}));
test("19 the JS API origin is the configured site origin, absent otherwise, never *", async () => {
  await mounted(studio({ embedOrigin: "https://learners.example" }), () => {
    const src = new URL(q<HTMLIFrameElement>("[data-video-frame]").src);
    assert.equal(src.searchParams.get("enablejsapi"), "1");
    assert.equal(src.searchParams.get("origin"), "https://learners.example");
  });
  await mounted(studio(), () => {
    assert.equal(new URL(q<HTMLIFrameElement>("[data-video-frame]").src).searchParams.get("origin"), null);
  });
  assert.doesNotMatch(studioSrc, /postMessage\([^)]*["']\*["']/);
});
test("20 iframe has a title, lazy loading, fullscreen and a minimal allow list", () => mounted(studio(), () => {
  const frame = q<HTMLIFrameElement>("[data-video-frame]");
  assert.equal(frame.getAttribute("title"), "QA talk");
  assert.equal(frame.getAttribute("loading"), "lazy");
  assert.ok(frame.hasAttribute("allowfullscreen"));
  assert.equal(frame.getAttribute("allow"), "encrypted-media; picture-in-picture; fullscreen");
}));
test("21 the non-escape sandbox is preserved (no popups, no top navigation)", () => mounted(studio(), () => {
  const sandbox = q("[data-video-frame]").getAttribute("sandbox") ?? "";
  assert.equal(sandbox, "allow-scripts allow-same-origin allow-presentation");
  assert.doesNotMatch(sandbox, /allow-popups|allow-top-navigation/);
}));
test("22 activities sit below the player, with no sidebar", () => mounted(studio(), () => {
  const frame = q("[data-video-frame]");
  const tabs = q("[data-video-tab]");
  assert.ok(frame.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(document.querySelector("aside"), null);
}));
test("23 Your opinion and Summary are kept; no Comprehension or gap-fill placeholders", () => mounted(studio(), () => {
  const tabs = [...document.querySelectorAll("[data-video-tab]")].map((el) => el.getAttribute("data-video-tab"));
  assert.deepEqual(tabs, ["opinion", "summary"]);
}));
test("24 Notes appear only when notes exist", async () => {
  await mounted(studio({}, { notes: "Key idea" }), () => { assert.ok(document.querySelector('[data-video-tab="notes"]')); });
  await mounted(studio(), () => { assert.equal(document.querySelector('[data-video-tab="notes"]'), null); });
});
test("25 no app-owned More videos / Copy link / Watch on YouTube; Transcript only when authored content exists", async () => {
  await mounted(studio({}, { transcript: [{ startSeconds: 12, text: "Welcome to the talk." }], transcriptText: null }), async () => {
    const text = document.body.textContent ?? "";
    for (const phrase of [/more videos/i, /copy link/i, /watch on youtube/i, /open on youtube/i]) assert.doesNotMatch(text, phrase);
    await act(async () => q<HTMLButtonElement>('[data-video-tab="transcript"]').click());
    assert.match(q("[data-video-transcript-panel]").textContent ?? "", /0:12\s*Welcome to the talk\./);
  });
  await mounted(studio({}, { transcriptText: "Plain paragraph." }), async () => {
    await act(async () => q<HTMLButtonElement>('[data-video-tab="transcript"]').click());
    assert.equal(q("[data-video-transcript-text]").textContent, "Plain paragraph.");
  });
  for (const empty of [{ transcript: null, transcriptText: null }, { transcript: [], transcriptText: "  \n " }, { transcript: [{ startSeconds: 0, text: "  " }] }]) {
    await mounted(studio({}, empty), () => { assert.equal(document.querySelector('[data-video-tab="transcript"]'), null); });
  }
});
test("26 the player fills the width at 16:9 with nothing layered over it while playing", () => mounted(studio(), () => {
  const frame = q("[data-video-frame]");
  const wrap = frame.parentElement!;
  assert.match(wrap.className, /aspect-video/);
  assert.match(wrap.className, /w-full/);
  assert.equal(wrap.children.length, 1, "no overlay sibling over the iframe");
}));
test("A1 resume: an unfinished lesson reopens at the saved position; a completed one starts at 0", async () => {
  const progress = (state: string, watchedSeconds: number) => ({ state, watchedSeconds, answers: {}, responseText: null, summaryText: null });
  await mounted(studio({ initialProgress: progress("in_progress", 73.6) }), () => {
    assert.equal(new URL(q<HTMLIFrameElement>("[data-video-frame]").src).searchParams.get("start"), "73");
  });
  for (const [state, seconds] of [["completed", 300], ["in_progress", 3], ["not_started", 0]] as const) {
    await mounted(studio({ initialProgress: progress(state, seconds) }), () => {
      assert.equal(new URL(q<HTMLIFrameElement>("[data-video-frame]").src).searchParams.get("start"), null);
    });
  }
});
test("A2 the verified end event sends the final position once and shows a localized replay", async () => {
  const original = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ ok: true, watchedSeconds: 120, state: "completed" }); }) as typeof fetch;
  try {
    await mounted(studio({}, { durationSeconds: 120 }), async () => {
      const frame = q<HTMLIFrameElement>("[data-video-frame]");
      const forged = new dom.window.MessageEvent("message", { data: JSON.stringify({ event: "onStateChange", info: 0 }), origin: "https://evil.example", source: frame.contentWindow });
      await act(async () => { window.dispatchEvent(forged); });
      assert.ok(document.querySelector("[data-video-frame]"), "untrusted origin is ignored");
      const real = new dom.window.MessageEvent("message", { data: JSON.stringify({ event: "onStateChange", info: 0 }), origin: "https://www.youtube-nocookie.com", source: frame.contentWindow });
      await act(async () => { window.dispatchEvent(real); await new Promise((r) => setTimeout(r, 0)); });
      assert.ok(q("[data-video-ended]").textContent?.includes(en.videoLesson.ended));
      assert.ok(q("[data-video-ended] button").textContent?.includes(en.videoLesson.replay));
      assert.deepEqual(bodies, [{ watchedSeconds: 120, ended: true }], "final write reports the end; the server decides the state");
      assert.equal(q("[data-video-progress-state]").textContent, en.videoLesson.stateCompleted);
    });
  } finally { globalThis.fetch = original; }
  assert.doesNotMatch(studioSrc, /Video tugadi|Qayta ko'rish/);
  assert.equal(uz.videoLesson.ended, "Video tugadi");
});
test("outbound-navigation regression: no external link, new tab, or scripted navigation anywhere in the module", async () => {
  for (const src of [libraryPage, detailPage, cardSrc, thumbSrc, studioSrc]) {
    assert.doesNotMatch(src, /target="_blank"|window\.open|window\.location|location\.href|watchUrlFor|allow-popups|allow-top-navigation/);
  }
  await mounted(<>{card()}{studio({}, { notes: "n", beforeYouWatch: "b" })}</>, () => {
    assert.equal(document.querySelector('a[href^="http"], a[target], form[action^="http"]'), null);
  });
});
