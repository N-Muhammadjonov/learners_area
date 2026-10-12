import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/**
 * THE LESSON AUTHORING DESK, rendered for real in jsdom with a mocked network.
 *
 * The desk is where a human editor decides what a lesson contains, so what it does when
 * a lesson is SELECTED is the whole safety question:
 *
 *   • it loads the lesson's editable content through the staff edit endpoint and fills
 *     every field and every block — a blank form over real content is how a save
 *     overwrites a lesson;
 *   • Save posts the whole hydrated content back through the SAME editable draft
 *     revision, so changing one field changes one field;
 *   • a live lesson with no open draft offers "Create revision" and never a Save that
 *     would rewrite what students are reading;
 *   • a failed media replacement leaves the file the lesson already has, and Save is
 *     refused outright while an upload is still in flight.
 */

const dom = new JSDOM("<html><body></body></html>", { url: "http://localhost/app/listening/lessons/author" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "File", "Blob"] as const)
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { LessonAuthoringDesk } = await import("../../src/components/lessons/LessonAuthoringDesk");
const en = (await import("../../src/lib/i18n/en")).default;

const LESSON_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "44444444-4444-4444-8444-444444444444";

const textBlock = (text: string) => ({ type: "text", text, url: null, objectKey: null, originalName: null, mimeType: null, size: null, ref: null, quiz: null });

/** The editable projection the staff endpoint returns for a live lesson with a draft. */
const model = (overrides: Record<string, unknown> = {}) => ({
  lessonId: LESSON_ID,
  sourceRef: "lesson-why-notes-matter",
  title: "Why notes matter",
  slug: "why-notes-matter",
  unitId: "unit-1",
  learningArea: "listening",
  summary: "How to take notes while you listen.",
  teacherNotes: "Play the clip twice.",
  estimatedMinutes: 25,
  lessonState: "published",
  live: true,
  draft: { versionId: DRAFT_ID, versionNo: 4 },
  published: { versionId: "22222222-2222-4222-8222-222222222222", versionNo: 3, title: "Why notes matter" },
  scheduled: null,
  pastRevisions: 4,
  contentSource: "draft",
  blocks: [
    textBlock("First paragraph."),
    {
      type: "quiz",
      text: null,
      url: null,
      objectKey: null,
      originalName: null,
      mimeType: null,
      size: null,
      ref: null,
      quiz: { questionType: "mcq_single", prompt: "Which signal contrasts?", options: ["however", "moreover"], answer: "however", explanation: "Listen for the tone." },
    },
    {
      type: "image",
      text: null,
      url: null,
      objectKey: "private/images/original-diagram.png",
      originalName: "original-diagram.png",
      mimeType: "image/png",
      size: 2048,
      ref: null,
      quiz: null,
    },
  ],
  ...overrides,
});

type Call = { url: string; method: string; body: Record<string, unknown> | null };
const calls: Call[] = [];

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** PNG magic bytes, so the browser-side content check accepts the file we hand it. */
const pngFile = (name: string) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], name, { type: "image/png" });

async function mount(options: { model?: Record<string, unknown>; canPublish?: boolean; intent?: "fail" | "pending" }, run: () => Promise<void>) {
  const lessonModel = options.model ?? model();
  const revisedModel = options.model ? model() : lessonModel;
  calls.length = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url: href, method, body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null });
    if (/\/api\/admin\/content\/lessons\/[^/]+\/edit$/.test(href)) return response({ lesson: lessonModel });
    // Starting a revision returns the lesson NOW BEING EDITED (a draft exists), which is
    // what the real endpoint answers.
    if (/\/api\/admin\/content\/lessons\/[^/]+\/revision$/.test(href)) return response({ created: true, versionId: DRAFT_ID, versionNo: 4, lesson: revisedModel });
    if (href.startsWith("/api/admin/content/drafts")) return response({ ok: true, versionId: DRAFT_ID, versionNo: 4, created: false, targetId: LESSON_ID });
    if (href.startsWith("/api/uploads/intent")) {
      if (options.intent === "pending") return new Promise<Response>(() => {});
      return response({ error: "unsupported_type", message: "This file type is not accepted here." }, 400);
    }
    return response({ error: "unexpected_route" }, 404);
  }) as typeof fetch;

  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  try {
    await act(async () =>
      root.render(
        React.createElement(
          AppRouterContext.Provider,
          { value: router as never },
          React.createElement(LessonAuthoringDesk, {
            dict: en,
            area: "listening",
            lessons: [
              {
                id: LESSON_ID,
                title: "Why notes matter",
                slug: "why-notes-matter",
                sourceRef: "lesson-why-notes-matter",
                learningArea: "listening",
                publicationState: "published",
                draft: { id: DRAFT_ID, versionNo: 4, publicationState: "draft" },
                published: { id: "v3", versionNo: 3, publicationState: "published" },
              },
            ],
            units: [
              { id: "unit-1", label: "Course › Module › Unit 1" },
              { id: "unit-2", label: "Course › Module › Unit 2" },
            ],
            locale: "en",
            canPublish: options.canPublish ?? true,
          }),
        ),
      ),
    );
    await run();
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
  }
}

const click = async (selector: string) => {
  const element = document.querySelector(selector) as HTMLButtonElement | null;
  assert.ok(element, `expected ${selector} to be rendered`);
  await act(async () => element!.click());
};

/** Change a controlled React input the way a browser does (native setter + event). */
const type = async (selector: string, value: string) => {
  const element = document.querySelector(selector) as HTMLTextAreaElement | HTMLInputElement | null;
  assert.ok(element, `expected ${selector} to be rendered`);
  const prototype = element!.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  await act(async () => element!.dispatchEvent(new dom.window.Event("input", { bubbles: true })));
};

const valueOf = (selector: string) => (document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement).value;

async function openLesson() {
  await click(`[data-lesson-authoring-item="${LESSON_ID}"]`);
}

test("quiz types expose one option per canonical value and retain the saved choice", async () => {
  await mount({}, async () => {
    await openLesson();
    const select = document.querySelector<HTMLSelectElement>("[data-lesson-authoring-quiz-type]")!;
    const values = Array.from(select.options, (option) => option.value);
    assert.equal(new Set(values).size, values.length);
    const { QUESTION_TYPES } = await import("../../src/lib/content/question-types");
    assert.deepEqual(new Set(values), new Set(QUESTION_TYPES.map((type) => type.id)));
    assert.equal(select.value, "mcq_single");
  });
});

test("the desk loads exactly what is inside the lesson, and says which revision it is editing", async () => {
  await mount({}, async () => {
    await openLesson();
    assert.ok(
      calls.some((call) => call.method === "GET" && call.url === `/api/admin/content/lessons/${LESSON_ID}/edit`),
      "selection loads the editable projection as its own request",
    );
    assert.equal(valueOf("#lesson-title"), "Why notes matter");
    assert.equal(valueOf("#lesson-slug"), "why-notes-matter");
    assert.equal(valueOf("#lesson-minutes"), "25");
    assert.equal(valueOf("#lesson-summary"), "How to take notes while you listen.");
    assert.equal(valueOf("#lesson-teacher-notes"), "Play the clip twice.");
    assert.equal(valueOf("#lesson-unit"), "unit-1");
    assert.equal((document.querySelector('[data-lesson-authoring-source-ref]') as HTMLInputElement).disabled, true, "the stable reference is locked while editing");
    const blocks = [...document.querySelectorAll("[data-lesson-authoring-block]")];
    assert.deepEqual(blocks.map((block) => block.getAttribute("data-lesson-authoring-block")), ["text", "quiz", "image"], "every block, in authored order");
    assert.ok(document.body.textContent!.includes("First paragraph."), "the text block is rendered with its content");
    assert.ok((document.querySelector('[data-lesson-authoring-quiz-type]') as HTMLSelectElement).value === "mcq_single");
    assert.ok((document.querySelector('[data-lesson-authoring-object]') as HTMLElement).textContent!.includes("original-diagram.png"), "the media block shows the file it holds");
    assert.equal(document.querySelector("[data-lesson-authoring-published]")!.getAttribute("data-lesson-authoring-published"), "3");
    assert.equal(document.querySelector("[data-lesson-authoring-draft]")!.getAttribute("data-lesson-authoring-draft"), "4");
  });
});

test("changing one field saves the whole lesson through the SAME draft revision", async () => {
  await mount({}, async () => {
    await openLesson();
    await type("#lesson-teacher-notes", "Play the clip once, then mark the schwa.");
    await click("[data-lesson-authoring-save]");

    const saved = calls.find((call) => call.method === "POST" && call.url === "/api/admin/content/drafts");
    assert.ok(saved, "Save posts to the one authoring endpoint");
    assert.equal(saved!.body!.versionId, DRAFT_ID, "the save continues the revision the desk opened — not a new one");
    assert.equal(saved!.body!.sourceRef, "lesson-why-notes-matter", "one logical lesson: the same stable reference");
    const payload = saved!.body!.payload as Record<string, unknown>;
    assert.equal(payload.teacherNotes, "Play the clip once, then mark the schwa.", "the field the author changed");
    assert.equal(payload.summary, "How to take notes while you listen.", "and NOTHING else was blanked");
    assert.equal(payload.slug, "why-notes-matter");
    assert.equal(payload.unitId, "unit-1");
    assert.equal(payload.learningArea, "listening");
    assert.equal(payload.estimatedMinutes, 25);
    const blocks = payload.blocks as Record<string, unknown>[];
    assert.equal(blocks.length, 3, "all three blocks are written back, not dropped");
    assert.equal(blocks[0]!.text, "First paragraph.");
    assert.deepEqual((blocks[1]!.quiz as Record<string, unknown>).options, ["however", "moreover"]);
    assert.equal((blocks[1]!.quiz as Record<string, unknown>).answer, "however", "the staff surface keeps the answer key");
    assert.equal(blocks[2]!.objectKey, "private/images/original-diagram.png", "media keeps its private object key");
  });
});

test("a live lesson with no open draft offers a revision instead of a Save that would overwrite it", async () => {
  await mount({ model: model({ draft: null, contentSource: "lesson" }) }, async () => {
    await openLesson();
    const save = document.querySelector("[data-lesson-authoring-save]") as HTMLButtonElement;
    assert.equal(save.disabled, true, "Save is refused while the lesson is live and no revision is open");
    assert.ok(document.querySelector("[data-lesson-authoring-needs-revision]"), "and the reason is on screen");
    await click("[data-lesson-authoring-start-revision]");
    const revision = calls.find((call) => call.method === "POST" && call.url === `/api/admin/content/lessons/${LESSON_ID}/revision`);
    assert.ok(revision, "Create revision asks the server to copy the published content");
    assert.equal(document.querySelector("[data-lesson-authoring-draft]")!.getAttribute("data-lesson-authoring-draft"), "4");
    assert.equal(document.querySelector("[data-lesson-authoring-needs-revision]"), null, "the editor is now editing a revision");
  });
});

test("a failed media replacement keeps the file the lesson already has", async () => {
  await mount({ intent: "fail" }, async () => {
    await openLesson();
    const uploadButton = document.querySelector("[data-lesson-authoring-upload]") as HTMLButtonElement;
    assert.ok(uploadButton, "the media block offers an upload/replace control");
    const input = document.querySelector("[data-lesson-authoring-file]") as HTMLInputElement;
    const file = pngFile("replacement-diagram.png");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await click("[data-lesson-authoring-upload]");
    await act(async () => input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
    assert.ok(document.querySelector('[data-lesson-authoring-upload-state="failed"]'), "the failure is shown to the author");
    const held = document.querySelector("[data-lesson-authoring-object]") as HTMLElement;
    assert.ok(held && held.textContent!.includes("original-diagram.png"), "the lesson still holds the file it had");
    assert.equal(held.getAttribute("data-lesson-authoring-object"), "private/images/original-diagram.png", "and the private key was not cleared");
  });
});

test("Save is refused while an upload is still running", async () => {
  await mount({ intent: "pending" }, async () => {
    await openLesson();
    const input = document.querySelector("[data-lesson-authoring-file]") as HTMLInputElement;
    const file = pngFile("slow-replacement.png");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await click("[data-lesson-authoring-upload]");
    await act(async () => input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
    assert.ok(document.querySelector('[data-lesson-authoring-upload-state="uploading"]'), "the upload is in flight");
    await click("[data-lesson-authoring-save]");
    assert.ok(document.querySelector('[data-lesson-authoring-issue="upload_in_progress"]'), "the author is told to wait");
    assert.equal(calls.filter((call) => call.method === "POST" && call.url === "/api/admin/content/drafts").length, 0, "and no half-uploaded lesson is saved");
  });
});
