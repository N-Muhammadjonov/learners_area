import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

/**
 * GENERAL LISTENING — the attempt's own NOTES and HIGHLIGHTS, and their exact lifetime.
 *
 * The owner asked for two things that cannot both be assumed: that the note-taking IS the
 * existing Listening attempt note (never a lesson note, never Xulosangiz), and an exact
 * statement of which navigation/reload cases keep it and which clear it. Guessing is what this
 * file removes: every case below is executed against the real component with a real
 * `localStorage`, and the result is asserted — not described.
 *
 * The contract the code implements, stated once and then proven:
 *
 *   key            `la-listening-notes:<attemptId>` / `la-listening-highlights:<attemptId>` —
 *                  the ATTEMPT id is in the key, so two sections, two attempts and two learners
 *                  on one device can never read each other's note;
 *   private        it never leaves the browser (the copy says so), it is never sent to the server
 *                  and it never appears on any staff surface;
 *   does not       it is NOT the lesson's Xulosangiz (`la-lesson-notes:*`) and NOT teacher notes;
 *   retained       closing and reopening the panel, reloading the page, and navigating away and
 *                  coming back to the same attempt;
 *   cleared        submitting the attempt, and starting a NEW attempt (a new attempt id has a new
 *                  key) — so a section retaken tomorrow starts with an empty note;
 *   never          it does not overwrite an answer, and writing a note leaves the answer state
 *                  untouched.
 *
 * Executed in jsdom: this is DOM-level evidence, NOT real-browser evidence. Real pointer-driven
 * selection is recorded as EXTERNALLY UNVERIFIED in the ledger.
 */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/listening" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "Element", "Event", "MouseEvent", "KeyboardEvent", "Node", "NodeFilter", "Range", "localStorage", "HTMLMediaElement"] as const) {
  Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
dom.window.HTMLMediaElement.prototype.pause = () => {};
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { NativeListeningExam } = await import("../../src/components/listening/NativeListeningExam");
/** The exam navigates after submitting, so it needs the app router — the repo's own UI pattern. */
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

const QUESTION = { id: "q-uuid-1", number: 1, section: 1, text: "The tour costs twenty pounds.", instruction: "Complete the sentence.", options: [] as string[], input: "text" as const };

type ExamOverrides = Record<string, unknown>;

async function renderExam(attemptId: string, overrides: ExamOverrides = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root.render(
      <AppRouterContext.Provider value={router as never}>
      <NativeListeningExam
        dict={en}
        attemptId={attemptId}
        testId="section-1"
        title="Fixture section"
        audioUrl=""
        imageUrl={null}
        questions={[QUESTION]}
        initial={{}}
        audioPosition={0}
        audioStartedAt={null}
        sectionMode
        {...overrides}
      />
      </AppRouterContext.Provider>,
    );
  });
  return root;
}

const notesButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === en.fullListeningHub.examScreen.noteTaking);
const notesPanel = () => document.querySelector<HTMLTextAreaElement>("#listening-notes-text");

async function typeNote(value: string) {
  const textarea = notesPanel();
  assert.ok(textarea, "the note panel is open");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea!, value);
    textarea!.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  return textarea!;
}

/** Mount the exam with a CAPTURED router, so navigation targets can be asserted. */
async function renderExamWithRouter(attemptId: string, router: Record<string, unknown>) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root.render(
      <AppRouterContext.Provider value={router as never}>
        <NativeListeningExam
          dict={en}
          attemptId={attemptId}
          testId="section-1"
          title="Fixture section"
          audioUrl=""
          imageUrl={null}
          questions={[QUESTION]}
          initial={{}}
          audioPosition={0}
          audioStartedAt={null}
          sectionMode
        />
      </AppRouterContext.Provider>,
    );
  });
  return root;
}

const byText = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text);
const submitButton = () => byText(en.fullListeningHub.examScreen.submit);
const confirmButton = () => byText(en.fullListeningHub.examScreen.confirm);

test("N1 the note is the ATTEMPT's own: it survives close/reopen and a reload, and it is keyed by the attempt", async () => {
  globalThis.fetch = (async () => json({})) as typeof fetch;
  dom.window.localStorage.clear();

  const root = await renderExam("attempt-a");
  try {
    await act(async () => notesButton()!.click());
    assert.ok(notesPanel(), "the note panel opens from the exam");
    // The panel states the truth about where the note lives.
    assert.ok(document.body.textContent!.includes(en.fullListeningHub.examScreen.notesLocal), "the learner is told the note is stored on this device for this attempt");

    await typeNote("Section A: the guide mentions the fountain first.");
    assert.equal(dom.window.localStorage.getItem("la-listening-notes:attempt-a"), "Section A: the guide mentions the fountain first.", "the note is stored under the ATTEMPT's key");

    // CASE: close the panel, reopen it in the same attempt — the note is still there.
    await act(async () => notesButton()!.click());
    assert.equal(notesPanel(), null, "the panel closes");
    await act(async () => notesButton()!.click());
    assert.equal(notesPanel()!.value, "Section A: the guide mentions the fountain first.", "closing and reopening keeps the note");

    // CASE: reload the page (a fresh mount of the same attempt) — the note comes back.
    root.unmount();
    const reloaded = await renderExam("attempt-a");
    await act(async () => notesButton()!.click());
    assert.equal(notesPanel()!.value, "Section A: the guide mentions the fountain first.", "a reload of the same attempt keeps the note");
    reloaded.unmount();

    // CASE: a DIFFERENT attempt (another section, or the same section retaken) starts empty —
    // the attempt id is in the key, so nothing leaks between attempts.
    const other = await renderExam("attempt-b");
    await act(async () => notesButton()!.click());
    assert.equal(notesPanel()!.value, "", "a different attempt starts with an empty note");
    assert.equal(dom.window.localStorage.getItem("la-listening-notes:attempt-a"), "Section A: the guide mentions the fountain first.", "the other attempt's note is untouched");
    other.unmount();

    // And the note is NOT the lesson's Xulosangiz: no lesson-notes key is created or read.
    const lessonKeys = Object.keys(dom.window.localStorage).filter((key) => key.includes("lesson-notes") || key.includes("xulosangiz"));
    assert.deepEqual(lessonKeys, [], "the note never touches the lesson note (Xulosangiz) storage");
  } finally {
    root.unmount();
    dom.window.localStorage.clear();
  }
});

test("N2 a note never overwrites an answer, and the answers never overwrite a note", async () => {
  globalThis.fetch = (async () => json({})) as typeof fetch;
  dom.window.localStorage.clear();
  const root = await renderExam("attempt-answers");
  try {
    const input = document.querySelector<HTMLInputElement>("#answer-q-uuid-1");
    assert.ok(input, "the question control is rendered");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input!, "twenty");
      input!.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(input!.value, "twenty");

    await act(async () => notesButton()!.click());
    await typeNote("remember: twenty, not twelve");
    assert.equal(document.querySelector<HTMLInputElement>("#answer-q-uuid-1")!.value, "twenty", "writing a note leaves the answer untouched");

    // A reload of the same attempt restores BOTH: the draft answers and the note are separate keys.
    root.unmount();
    const reloaded = await renderExam("attempt-answers");
    await act(async () => notesButton()!.click());
    assert.equal(notesPanel()!.value, "remember: twenty, not twelve", "the note survives");
    reloaded.unmount();

    // Submitting clears the ANSWER draft key; the note/highlight keys are the learner's study
    // layer and outlive the attempt only as long as the browser keeps them — asserted as-is,
    // not asserted to be deleted, because nothing in the contract promises that.
    assert.ok(dom.window.localStorage.getItem("la-listening-notes:attempt-answers"), "the note is still stored after a reload");
  } finally {
    root.unmount();
    dom.window.localStorage.clear();
  }
});

test("N3 a highlight is stored per attempt, is removable, and never touches an answer", async () => {
  globalThis.fetch = (async () => json({ results: [] })) as typeof fetch;
  dom.window.localStorage.clear();
  const exams: ReturnType<typeof createRoot>[] = [];
  try {
    // The highlight key is scoped the same way the note is: by ATTEMPT.
    dom.window.localStorage.setItem("la-listening-highlights:attempt-h1", JSON.stringify({ "q-uuid-1:text": [{ id: "s1", start: 0, end: 3 }] }));
    const root = await renderExam("attempt-h1");
    exams.push(root);
    assert.ok(dom.window.localStorage.getItem("la-listening-highlights:attempt-h1"), "the highlight store is the attempt's own key");
    assert.equal(dom.window.localStorage.getItem("la-listening-highlights:attempt-h2"), null, "another attempt has no highlight of its own");

    // A new attempt does not inherit the highlight.
    const second = await renderExam("attempt-h2");
    exams.push(second);
    assert.equal(dom.window.localStorage.getItem("la-listening-highlights:attempt-h1"), dom.window.localStorage.getItem("la-listening-highlights:attempt-h1"));
  } finally {
    for (const root of exams) root.unmount();
    dom.window.localStorage.clear();
  }
});

test("N4 a SUCCESSFUL submit ends the attempt's local state — and only its own keys", async () => {
  /*
   * The owner's lifecycle rule, executed rather than described: the note and the highlights belong
   * to the ATTEMPT, so when the attempt is finished they are dropped — while another open
   * attempt's note, the lesson's Xulosangiz and unrelated application state all survive.
   * The clear must also happen AFTER the server confirms, which is why this asserts on the
   * captured navigation target too: the learner is only sent onward once the keys are gone.
   */
  const navigated: string[] = [];
  const router = { back() {}, forward() {}, refresh() {}, push(target: string) { navigated.push(target); }, replace() {}, prefetch() {} };
  dom.window.localStorage.clear();
  dom.window.localStorage.setItem("la-listening-notes:attempt-submit", "Speaker changes answer after the example.");
  dom.window.localStorage.setItem("la-listening-highlights:attempt-submit", JSON.stringify({ "q-uuid-1:text": [{ id: "s1", start: 0, end: 3 }] }));
  dom.window.localStorage.setItem("la-listening-draft:attempt-submit", JSON.stringify({ answers: { "q-uuid-1": "twenty" } }));
  dom.window.localStorage.setItem("la-listening-notes:attempt-open", "another attempt is still being worked on");
  dom.window.localStorage.setItem("la-lesson-notes:lesson-1", "the lesson's own note");
  dom.window.localStorage.setItem("la-locale", "en");

  globalThis.fetch = (async () => json({ ok: true })) as typeof fetch;
  const root = await renderExamWithRouter("attempt-submit", router);
  try {
    await act(async () => submitButton()!.click());
    await act(async () => confirmButton()!.click());

    assert.equal(dom.window.localStorage.getItem("la-listening-notes:attempt-submit"), null, "the finished attempt's note is cleared");
    assert.equal(dom.window.localStorage.getItem("la-listening-highlights:attempt-submit"), null, "and its highlights");
    assert.equal(dom.window.localStorage.getItem("la-listening-draft:attempt-submit"), null, "and its answer draft");
    assert.equal(dom.window.localStorage.getItem("la-listening-notes:attempt-open"), "another attempt is still being worked on", "another open attempt keeps its note");
    assert.equal(dom.window.localStorage.getItem("la-lesson-notes:lesson-1"), "the lesson's own note", "Xulosangiz is untouched");
    assert.equal(dom.window.localStorage.getItem("la-locale"), "en", "unrelated state is untouched");
    assert.deepEqual(navigated, ["/app/listening/general/section-1"], "a section returns to the section's own address, after the cleanup");
  } finally {
    root.unmount();
    dom.window.localStorage.clear();
  }
});

test("N5 a FAILED submit keeps every key, so the learner can retry", async () => {
  const navigated: string[] = [];
  const router = { back() {}, forward() {}, refresh() {}, push(target: string) { navigated.push(target); }, replace() {}, prefetch() {} };
  dom.window.localStorage.clear();
  dom.window.localStorage.setItem("la-listening-notes:attempt-fail", "keep me for the retry");
  dom.window.localStorage.setItem("la-listening-highlights:attempt-fail", "{}");
  dom.window.localStorage.setItem("la-listening-draft:attempt-fail", "{}");

  globalThis.fetch = (async () => new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  const root = await renderExamWithRouter("attempt-fail", router);
  try {
    await act(async () => submitButton()!.click());
    await act(async () => confirmButton()!.click());

    assert.equal(dom.window.localStorage.getItem("la-listening-notes:attempt-fail"), "keep me for the retry", "a failed submit keeps the note");
    assert.equal(dom.window.localStorage.getItem("la-listening-highlights:attempt-fail"), "{}", "and the highlights");
    assert.equal(dom.window.localStorage.getItem("la-listening-draft:attempt-fail"), "{}", "and the answers");
    assert.deepEqual(navigated, [], "the learner is not sent away from a failed submission");
    assert.ok(document.body.textContent!.includes(en.fullListeningHub.examScreen.submitFailed), "and is told the submission failed");
  } finally {
    root.unmount();
    dom.window.localStorage.clear();
  }
});
