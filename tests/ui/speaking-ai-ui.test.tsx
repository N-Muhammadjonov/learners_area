import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/*
 * Practice with AI, rendered (spec §63 UI matrix).
 *
 * These are DOM-level assertions about the things a learner would notice if they
 * were wrong: the microphone gate must not pass a dead device, feedback must say
 * "Checked by RIWI" and must never name a provider, an unassessed criterion must
 * read "Not assessed" rather than show a number, and a Part-1-only session must
 * refuse to produce an overall band.
 */
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: "http://localhost/speaking/ai" });
for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent", "location", "history", "DOMException"] as const)
  Object.defineProperty(globalThis, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });
// File/Blob are deliberately NOT taken from jsdom: Node 22 provides both
// natively, and mixing jsdom's Blob with Node's File (or vice versa) throws
// "must be an instance of Blob" even though both look like Blobs.
// jsdom implements neither: the composer uses them only to preview the local
// take, which is exactly the part these tests do not assert on.
if (!URL.createObjectURL) Object.defineProperty(URL, "createObjectURL", { value: () => "blob:preview", configurable: true });
if (!URL.revokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, configurable: true });

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { MicrophoneCheckPanel } = await import("../../src/components/speaking/ai/MicrophoneCheckPanel");
const { AiAnswerFeedback } = await import("../../src/components/speaking/ai/AiAnswerFeedback");
const { AiAnswerComposer } = await import("../../src/components/speaking/ai/AiAnswerComposer");
const { AiSessionSummaryCard } = await import("../../src/components/speaking/ai/AiSessionSummaryCard");
const { AiPracticeSession } = await import("../../src/components/speaking/ai/AiPracticeSession");
const { AiExaminerSession } = await import("../../src/components/speaking/AiExaminerSession");
const en = (await import("../../src/lib/i18n/en")).default;

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function render(element: React.ReactElement) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root.render(React.createElement(AppRouterContext.Provider, { value: router as never }, element));
  });
  return {
    root,
    text: () => document.body.textContent ?? "",
    q: (selector: string) => document.querySelector(selector),
    qa: (selector: string) => [...document.querySelectorAll(selector)],
    async unmount() { await act(async () => root.unmount()); },
  };
}

/** Waits for pending timers/effects without asserting on a fixed number of ticks. */
async function settle(ms = 200) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}


/**
 * The flow begins at the microphone gate. These tests are about what happens
 * after it, so they take the explicit "skip the check" path — which is a real
 * control, and does not pretend the check passed.
 */
async function skipMicCheck(view: { q: (s: string) => Element | null }) {
  const skip = view.q("[data-mic-skip]") as HTMLButtonElement | null;
  assert.ok(skip, "the microphone gate must offer a way past it");
  await act(async () => { skip!.click(); });
  await settle();
}

/**
 * Minimal MediaRecorder + getUserMedia so the composer takes its real path.
 *
 * The recorder is an EventTarget in the real API (`addEventListener`), which is
 * what `createRecorder` actually uses — a stub that only sets `ondataavailable`
 * would fail inside the component and produce a misleading test.
 */
function installRecorder() {
  const stream = { getTracks: () => [{ stop() {} }] };
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    value: { getUserMedia: async () => stream }, configurable: true,
  });

  class FakeMediaRecorder {
    static isTypeSupported() { return true; }
    state = "inactive";
    mimeType = "audio/webm";
    private listeners = new Map<string, ((event: unknown) => void)[]>();
    constructor(_stream: unknown, _options?: unknown) {}
    addEventListener(type: string, listener: (event: unknown) => void) {
      const list = this.listeners.get(type) ?? [];
      list.push(listener);
      this.listeners.set(type, list);
    }
    removeEventListener(type: string, listener: (event: unknown) => void) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
    }
    private emit(type: string, event: unknown) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.emit("dataavailable", { data: new Blob(["fake-audio"], { type: "audio/webm" }) });
      this.emit("stop", {});
    }
    pause() {}
    resume() {}
  }
  (dom.window as unknown as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;
  (globalThis as unknown as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;
}

// ---------------------------------------------------------------------------
// microphone check gate
// ---------------------------------------------------------------------------

type MicFixture = { tracksStopped: () => number; asked: () => number };

function installMic(options: { present?: boolean; grant?: "allow" | "deny"; level?: number }): MicFixture {
  const present = options.present ?? true;
  let asked = 0;
  let tracksStopped = 0;
  const stream = {
    getTracks: () => [{ stop: () => { tracksStopped += 1; } }],
  };

  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    value: present
      ? {
          getUserMedia: async () => {
            asked += 1;
            if (options.grant === "deny") throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
            return stream;
          },
        }
      : undefined,
    configurable: true,
  });

  const level = options.level ?? 0;
  class FakeAudioContext {
    createAnalyser() {
      return {
        fftSize: 8,
        getByteTimeDomainData(target: Uint8Array) {
          const amplitude = Math.round(level * 128);
          for (let i = 0; i < target.length; i += 1) target[i] = i % 2 === 0 ? 128 + amplitude : 128 - amplitude;
        },
      };
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    async close() {}
    async resume() {}
  }
  (dom.window as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
  (globalThis as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;

  return { tracksStopped: () => tracksStopped, asked: () => asked };
}

test("mic check: a refused permission is reported as denied and does NOT let the learner through", async () => {
  const fixture = installMic({ grant: "deny" });
  let passed = 0;
  const view = await render(React.createElement(MicrophoneCheckPanel, { dict: en, onPassed: () => { passed += 1; } }));

  await act(async () => { (view.q("[data-mic-start]") as HTMLButtonElement).click(); });
  await settle();

  assert.equal(passed, 0, "a denied microphone must not open the session");
  assert.ok(view.q('[data-mic-error="denied"]'), "the learner must be told the permission was refused");
  assert.match(view.text(), /refused/i);
  assert.equal(fixture.asked(), 1);
  await view.unmount();
});

test("mic check: an unsupported browser says so without asking for permission", async () => {
  const fixture = installMic({ present: false });
  let passed = 0;
  const view = await render(React.createElement(MicrophoneCheckPanel, { dict: en, onPassed: () => { passed += 1; } }));

  await act(async () => { (view.q("[data-mic-start]") as HTMLButtonElement).click(); });
  await settle();

  assert.equal(passed, 0);
  assert.ok(view.q('[data-mic-error="unsupported"]'));
  assert.equal(fixture.asked(), 0, "must not prompt for a permission that cannot be used");
  await view.unmount();
});

test("mic check: real audio energy passes the check and releases the device", async () => {
  const fixture = installMic({ level: 0.4 });
  let passed = 0;
  const view = await render(React.createElement(MicrophoneCheckPanel, { dict: en, onPassed: () => { passed += 1; } }));

  await act(async () => { (view.q("[data-mic-start]") as HTMLButtonElement).click(); });
  await settle(400);

  assert.equal(passed, 1, "a working microphone must let the learner through");
  assert.equal(fixture.tracksStopped(), 1, "the check must release the microphone before the session starts");
  await view.unmount();
});

test("mic check: the panel states its local-only privacy promise", async () => {
  installMic({ present: false });
  const view = await render(React.createElement(MicrophoneCheckPanel, { dict: en, onPassed: () => {} }));
  assert.match(view.text(), /nothing is recorded, stored or uploaded/i);
  await view.unmount();
});

// ---------------------------------------------------------------------------
// evidence feedback (§20–§26)
// ---------------------------------------------------------------------------

function evaluation(overrides: Record<string, unknown> = {}) {
  return {
    id: "eval-1",
    checkedBy: "RIWI" as const,
    fallbackUsed: false,
    overallEstimate: 6.5,
    confidence: 0.6,
    verdict: null,
    criteria: [
      { key: "fluency", label: "Fluency", band: 6.5, limited: false, note: null },
      { key: "grammar", label: "Grammar", band: 6.0, limited: false, note: null },
      { key: "pronunciation", label: "Pronunciation", band: null, limited: true, note: "Not assessed" },
    ],
    strengths: ["You extended your answer with a reason."],
    weaknesses: [],
    issues: [{ category: "SPEAKING_FILLERS", message: "You used 'um' several times.", excerpt: null, suggestion: "Pause instead.", severity: "medium" as const }],
    nextActions: ["Practise linking words."],
    recommendedExercises: [],
    createdAt: "2026-10-04T10:00:00.000Z",
    ...overrides,
  };
}

test("feedback: always says Checked by RIWI and never names a provider or model", async () => {
  const view = await render(React.createElement(AiAnswerFeedback, {
    dict: en, evaluation: evaluation(), transcriptEdited: false, transcriptSent: true, isLast: false,
    onTryAgain: () => {}, onNext: () => {},
  }));
  assert.equal(view.q("[data-ai-checked-by]")?.textContent?.trim(), "Checked by RIWI");
  const blob = document.body.innerHTML;
  for (const forbidden of ["openai", "gpt", "gemini", "claude", "providerId", "providerDisplayName", "model:"]) {
    assert.equal(blob.toLowerCase().includes(forbidden.toLowerCase()), false, `feedback leaked "${forbidden}"`);
  }
  await view.unmount();
});

test("feedback: an unassessed pronunciation reads Not assessed and shows no band for it", async () => {
  const view = await render(React.createElement(AiAnswerFeedback, {
    dict: en, evaluation: evaluation(), transcriptEdited: false, transcriptSent: true, isLast: false,
    onTryAgain: () => {}, onNext: () => {},
  }));
  const criterion = view.q('[data-ai-criterion="pronunciation"]');
  assert.ok(criterion);
  assert.ok(criterion!.querySelector("[data-ai-not-assessed]"), "pronunciation must be marked not assessed");
  // The number must not appear anywhere inside the pronunciation row.
  assert.doesNotMatch(criterion!.textContent ?? "", /[4-9]\.\d/);
  await view.unmount();
});

test("feedback: shows the estimate as text-based, never as an official band", async () => {
  const view = await render(React.createElement(AiAnswerFeedback, {
    dict: en, evaluation: evaluation(), transcriptEdited: false, transcriptSent: true, isLast: false,
    onTryAgain: () => {}, onNext: () => {},
  }));
  assert.match(view.text(), /not an official IELTS band/i);
  await view.unmount();
});

test("feedback: an edited transcript is disclosed; an untouched one is not", async () => {
  const edited = await render(React.createElement(AiAnswerFeedback, {
    dict: en, evaluation: evaluation(), transcriptEdited: true, transcriptSent: true, isLast: false,
    onTryAgain: () => {}, onNext: () => {},
  }));
  assert.ok(edited.q("[data-ai-transcript-edited]"), "the learner must be told their edit is on record");
  await edited.unmount();

  const untouched = await render(React.createElement(AiAnswerFeedback, {
    dict: en, evaluation: evaluation(), transcriptEdited: false, transcriptSent: true, isLast: false,
    onTryAgain: () => {}, onNext: () => {},
  }));
  assert.equal(untouched.q("[data-ai-transcript-edited]"), null);
  await untouched.unmount();
});

test("feedback: an audio-only answer says there is no transcript, without inventing one", async () => {
  const view = await render(React.createElement(AiAnswerFeedback, {
    dict: en, evaluation: evaluation(), transcriptEdited: false, transcriptSent: false, isLast: false,
    onTryAgain: () => {}, onNext: () => {},
  }));
  assert.ok(view.q("[data-ai-no-transcript]"));
  await view.unmount();
});

test("feedback: no evaluation at all is stated plainly rather than dressed up as advice", async () => {
  const view = await render(React.createElement(AiAnswerFeedback, {
    dict: en, evaluation: null, transcriptEdited: false, transcriptSent: true, isLast: false,
    onTryAgain: () => {}, onNext: () => {},
  }));
  assert.ok(view.q("[data-ai-no-evaluation]"));
  assert.match(view.text(), /no feedback could be produced/i);
  assert.equal(view.q("[data-ai-criterion]"), null, "no criteria may be rendered without an evaluation");
  await view.unmount();
});

test("feedback: the last question offers to finish, not to find another question", async () => {
  const view = await render(React.createElement(AiAnswerFeedback, {
    dict: en, evaluation: evaluation(), transcriptEdited: false, transcriptSent: true, isLast: true,
    onTryAgain: () => {}, onNext: () => {},
  }));
  assert.match(view.q("[data-ai-next-question]")!.textContent ?? "", /Finish session/);
  await view.unmount();
});

// ---------------------------------------------------------------------------
// session summary (§27–§29)
// ---------------------------------------------------------------------------

function summary(overrides: Record<string, unknown> = {}) {
  return {
    mode: "full" as const,
    totalCount: 4,
    answeredCount: 3,
    skippedCount: 1,
    unansweredCount: 0,
    estimate: { band: 6.5, labelKind: "text_based_estimate" as const, suppressedReason: null, basedOnAnswers: 3 },
    criteria: [
      { key: "fluency", label: "Fluency", band: 6.5, limited: false, assessedFrom: 3 },
      { key: "pronunciation", label: "Pronunciation", band: null, limited: true, assessedFrom: 0 },
    ],
    pronunciationAssessed: false,
    strengths: ["Clear structure."],
    weaknesses: [{ category: "SPEAKING_FILLERS", message: "Fillers recurred.", occurrences: 2, highestSeverity: "low" as const }],
    nextActions: ["Slow down."],
    topics: [{ part: "part1" as const, topicKey: "work", topicTitle: "Work", answered: 2, total: 3 }],
    limitations: [],
    fallbackUsed: false,
    ...overrides,
  };
}

test("summary: a Part-1-only session shows NO overall band and explains why", async () => {
  const view = await render(React.createElement(AiSessionSummaryCard, {
    dict: en,
    summary: summary({
      mode: "part1",
      estimate: { band: null, labelKind: "text_based_estimate", suppressedReason: "part1_only", basedOnAnswers: 0 },
    }),
    onRestart: () => {}, historyHref: "/speaking/history",
  }));
  assert.ok(view.q("[data-ai-summary-no-band]"), "no band may be shown for Part 1 alone");
  assert.equal(view.q("[data-ai-summary-suppressed]")?.getAttribute("data-ai-summary-suppressed"), "part1_only");
  assert.match(view.text(), /would not be honest/i);
  assert.equal(view.q("[data-ai-summary-band]")?.getAttribute("data-ai-summary-band"), "none");
  await view.unmount();
});

test("summary: an estimated session states that it is text-based and how many answers it used", async () => {
  const view = await render(React.createElement(AiSessionSummaryCard, {
    dict: en, summary: summary(), onRestart: () => {}, historyHref: "/speaking/history",
  }));
  assert.match(view.text(), /not an official IELTS band/i);
  assert.match(view.text(), /based on 3 answered questions/i);
  assert.equal(view.q("[data-ai-summary-band]")?.getAttribute("data-ai-summary-band"), "6.5");
  await view.unmount();
});

test("summary: unassessed pronunciation is Not assessed and is called out, never given a band", async () => {
  const view = await render(React.createElement(AiSessionSummaryCard, {
    dict: en, summary: summary(), onRestart: () => {}, historyHref: "/speaking/history",
  }));
  const criterion = view.q('[data-ai-summary-criterion="pronunciation"]');
  assert.ok(criterion);
  assert.ok(criterion!.querySelector("[data-ai-summary-not-assessed]"));
  assert.doesNotMatch(criterion!.textContent ?? "", /[4-9]\.\d/);
  assert.ok(view.q("[data-ai-summary-pronunciation-note]"), "the summary must explain the missing pronunciation band");
  await view.unmount();
});

test("summary: a published-bank shortfall is disclosed instead of hidden", async () => {
  const view = await render(React.createElement(AiSessionSummaryCard, {
    dict: en,
    summary: summary({ limitations: [{ part: "part1", topicKey: "work", topicTitle: "Work", requested: 3, available: 2 }] }),
    onRestart: () => {}, historyHref: "/speaking/history",
  }));
  assert.ok(view.q("[data-ai-summary-limitations]"));
  assert.match(view.text(), /never invents questions/i);
  await view.unmount();
});

test("summary: a local-evaluator session is attributed honestly and without naming a vendor", async () => {
  const view = await render(React.createElement(AiSessionSummaryCard, {
    dict: en, summary: summary({ fallbackUsed: true }), onRestart: () => {}, historyHref: "/speaking/history",
  }));
  assert.ok(view.q("[data-ai-summary-fallback]"));
  assert.match(view.text(), /RIWI's built-in checks/);
  await view.unmount();
});

// ---------------------------------------------------------------------------
// session orchestration
// ---------------------------------------------------------------------------

const SESSION = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "u1",
  mode: "part1",
  status: "active",
  planVersion: 1,
  sessionSeed: 42,
  currentItemIndex: 0,
  limitations: [],
  startedAt: "2026-10-05T09:00:00.000Z",
  completedAt: null,
  createdAt: "2026-10-05T09:00:00.000Z",
  items: [
    {
      id: "22222222-2222-4222-8222-222222222222", sessionId: "11111111-1111-4111-8111-111111111111",
      ordinal: 0, promptId: "33333333-3333-4333-8333-333333333333", part: "part1", topicKey: "work",
      topicTitle: "Work", topicPosition: 0, questionPosition: 1, clusterSize: 2, isCueCard: false,
      attemptId: null, status: "pending", createdAt: "2026-10-05T09:00:00.000Z",
      prompt: {
        id: "33333333-3333-4333-8333-333333333333", part: "part1", topic: "Work",
        promptText: "Do you work or are you a student?", cueCard: null, prepSeconds: 0, answerSeconds: 30,
      },
    },
    {
      id: "44444444-4444-4444-8444-444444444444", sessionId: "11111111-1111-4111-8111-111111111111",
      ordinal: 1, promptId: "55555555-5555-4555-8555-555555555555", part: "part1", topicKey: "work",
      topicTitle: "Work", topicPosition: 0, questionPosition: 2, clusterSize: 2, isCueCard: false,
      attemptId: null, status: "pending", createdAt: "2026-10-05T09:00:00.000Z",
      prompt: {
        id: "55555555-5555-4555-8555-555555555555", part: "part1", topic: "Work",
        promptText: "What do you enjoy about your job?", cueCard: null, prepSeconds: 0, answerSeconds: 30,
      },
    },
  ],
};

function mockFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined) {
  const calls: { url: string; body: unknown }[] = [];
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const parsedBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, body: parsedBody });
    const result = handler(url, init) ?? { status: 200, body: {} };
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(result.body),
    } as unknown as Response;
  };
  return calls;
}

test("session: the mode chooser offers exactly the four IELTS modes", async () => {
  mockFetch(() => ({ body: { ok: true, session: SESSION } }));
  const view = await render(React.createElement(AiPracticeSession, { dict: en, historyHref: "/speaking/history", initialSession: null }));
  await skipMicCheck(view);
  const modes = view.qa("[data-ai-mode]").map((el) => el.getAttribute("data-ai-mode"));
  assert.deepEqual(modes.sort(), ["full", "part1", "part2", "part3"]);
  await view.unmount();
});

test("session: choosing a mode asks the SERVER for a plan and renders what it returns", async () => {
  const calls = mockFetch(() => ({ body: { ok: true, session: SESSION } }));
  const view = await render(React.createElement(AiPracticeSession, { dict: en, historyHref: "/speaking/history", initialSession: null }));
  await skipMicCheck(view);

  const part1 = view.q('[data-ai-mode="part1"]') as HTMLButtonElement;
  await act(async () => { part1.click(); });
  await settle();

  const create = calls.find((c) => c.url === "/api/speaking/ai/sessions");
  assert.ok(create, "the client must ask the server to build the plan");
  assert.deepEqual(create!.body, { mode: "part1" }, "a client may send only the mode — no plan, seed or questions");
  assert.ok(view.q('[data-ai-stage="session"]'), "the session stage must open");
  assert.match(view.text(), /Do you work or are you a student\?/, "the first planned question renders");
  assert.match(view.text(), /Question 1 of 2/);
  assert.match(view.text(), /Topic: Work/);
  await view.unmount();
});

test("session: a bank with nothing published is reported honestly, not padded", async () => {
  mockFetch(() => ({ status: 409, body: { error: "no_questions_available" } }));
  const view = await render(React.createElement(AiPracticeSession, { dict: en, historyHref: "/speaking/history", initialSession: null }));
  await skipMicCheck(view);

  await act(async () => { (view.q('[data-ai-mode="full"]') as HTMLButtonElement).click(); });
  await settle();

  assert.ok(view.q("[data-ai-error]"));
  assert.match(view.text(), /no published questions for this choice/i);
  assert.equal(view.q('[data-ai-stage="session"]'), null, "no session may open without a real plan");
  await view.unmount();
});

test("session: an unfinished session is resumed from the stored plan, never replanned", async () => {
  const calls = mockFetch(() => ({ body: { ok: true, session: SESSION } }));
  const resumed = { ...SESSION, currentItemIndex: 1 };
  const view = await render(React.createElement(AiPracticeSession, { dict: en, historyHref: "/speaking/history", initialSession: resumed as never }));

  assert.ok(view.q('[data-ai-stage="session"]'), "an active session opens straight into the interview");
  assert.match(view.text(), /Question 2 of 2/, "it resumes at the STORED cursor, not at question 1");
  assert.match(view.text(), /Topic: Work/);
  assert.equal(calls.length, 0, "resuming must not ask the server for a new plan — that would reshuffle the examiner");
  await view.unmount();
});

test("session: the composer stays locked behind the server-built question when its prompt is gone", async () => {
  mockFetch(() => ({ body: { ok: true, session: SESSION } }));
  const missing = {
    ...SESSION,
    items: [{ ...SESSION.items[0]!, prompt: null, promptId: null }],
  };
  const view = await render(React.createElement(AiPracticeSession, { dict: en, historyHref: "/speaking/history", initialSession: missing as never }));

  assert.ok(view.q("[data-ai-prompt-missing]"), "a deleted prompt must be reported as unavailable");
  assert.match(view.text(), /no longer available/i);
  assert.equal(view.q("[data-ai-start-answer]"), null, "no answer can be started for a question that no longer exists");
  await view.unmount();
});

test("entry: with no external evaluator the screen says so AND still runs the interview", async () => {
  mockFetch(() => ({ body: { ok: true, session: SESSION } }));
  const view = await render(React.createElement(AiExaminerSession, {
    dict: en, readiness: { transcription: false, aiEvaluation: false }, isStaff: false, initialSession: null,
  }));
  const notice = view.q("[data-ai-readiness]");
  assert.equal(notice?.getAttribute("data-ai-readiness"), "local");
  assert.match(view.text(), /RIWI's own checks/, "the local path is named honestly");
  assert.match(view.text(), /not an official IELTS band/i);
  // The interview is NOT blocked: server transcription is no longer required.
  await skipMicCheck(view);
  assert.equal(view.qa("[data-ai-mode]").length, 4, "a deployment without STT must still offer the full session");
  assert.equal(view.q("[data-ai-staff-setup]"), null, "setup hints are for staff only");
  await view.unmount();
});

test("entry: staff see the setup pointer, learners do not", async () => {
  mockFetch(() => ({ body: { ok: true, session: SESSION } }));
  const view = await render(React.createElement(AiExaminerSession, {
    dict: en, readiness: { transcription: false, aiEvaluation: false }, isStaff: true, initialSession: null,
  }));
  assert.ok(view.q("[data-ai-staff-setup]"));
  await view.unmount();
});

// ---------------------------------------------------------------------------
// the composer: STOP must never send (§5, §18)
// ---------------------------------------------------------------------------

/** SpeechRecognition stub whose results the test drives explicitly. */
function installSpeechRecognition() {
  const instances: {
    lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
    start(): void; stop(): void; abort(): void;
    onresult: ((e: unknown) => void) | null; onerror: ((e: unknown) => void) | null;
    onend: (() => void) | null; onstart: (() => void) | null;
  }[] = [];
  class FakeRecognition {
    lang = ""; continuous = false; interimResults = false; maxAlternatives = 0;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onstart: (() => void) | null = null;
    constructor() { instances.push(this as never); }
    start() {}
    stop() {}
    abort() {}
  }
  (dom.window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
  (globalThis as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
  return {
    latest: () => instances[instances.length - 1],
    /** Emits a FINAL result, the way the browser does mid-answer. */
    emitFinal(text: string) {
      const instance = instances[instances.length - 1]!;
      instance.onresult?.({
        resultIndex: 0,
        results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: text } } },
      });
    },
  };
}

const COMPOSER_ITEM = SESSION.items[0]!;

test("STOP does not send anything: it opens review with the recording and an editable transcript", async () => {
  installRecorder();
  const stt = installSpeechRecognition();
  const calls = mockFetch(() => ({ body: { ok: true } }));

  const view = await render(React.createElement(AiAnswerComposer, {
    dict: en, sessionId: SESSION.id, item: COMPOSER_ITEM as never, busy: false,
    retryOfAttemptId: null, onBusyChange: () => {}, onSent: () => {},
  }));

  await act(async () => { (view.q("[data-ai-start-answer]") as HTMLButtonElement).click(); });
  await settle(300);
  assert.ok(view.q('[data-ai-composer="recording"]'), "the recorder must reach the recording phase");

  // The learner speaks; the browser recognizes it live.
  await act(async () => { stt.emitFinal("I work as a teacher in Tashkent."); });
  await settle(50);
  const live = view.q("[data-ai-live-transcript]")?.textContent ?? "";
  assert.match(live, /I work as a teacher in Tashkent\./, "the live transcript must show what was recognized");

  // STOP.
  await act(async () => { (view.q("[data-ai-stop]") as HTMLButtonElement).click(); });
  await settle(300);

  assert.ok(view.q('[data-ai-review]'), "stop must open the review step, not finish the answer");
  assert.ok(view.q('[data-ai-transcript-input]'), "the transcript must be editable before sending");
  assert.equal(
    (view.q("[data-ai-transcript-input]") as HTMLTextAreaElement).value,
    "I work as a teacher in Tashkent.",
    "the recognized text must be in the box the learner reviews",
  );
  assert.match(view.q("[data-ai-not-sent]")?.textContent ?? "", /Nothing has been sent yet/i);

  // THE CRITICAL ASSERTION (§5): nothing left the browser on Stop.
  const sent = calls.filter((c) => /\/submit$|\/api\/uploads|\/items\/.*\/complete/.test(c.url));
  assert.deepEqual(sent, [], `Stop must not submit or upload anything, but these were called: ${JSON.stringify(sent)}`);
  assert.deepEqual(
    calls.map((c) => c.url),
    ["/api/live-partner"],
    "stopping may only have touched partner presence — never storage or evaluation",
  );

  await view.unmount();
});

test("Clear discards the take and uploads nothing", async () => {
  installRecorder();
  installSpeechRecognition();
  const calls = mockFetch(() => ({ body: { ok: true } }));

  const view = await render(React.createElement(AiAnswerComposer, {
    dict: en, sessionId: SESSION.id, item: COMPOSER_ITEM as never, busy: false,
    retryOfAttemptId: null, onBusyChange: () => {}, onSent: () => {},
  }));

  await act(async () => { (view.q("[data-ai-start-answer]") as HTMLButtonElement).click(); });
  await settle(300);
  await act(async () => { (view.q("[data-ai-stop]") as HTMLButtonElement).click(); });
  await settle(300);

  await act(async () => { (view.q("[data-ai-clear]") as HTMLButtonElement).click(); });
  await settle(150);

  assert.ok(view.q("[data-ai-start-answer]"), "clearing returns the learner to the start of the question");
  assert.equal(view.q("[data-ai-review]"), null, "the discarded take must not remain on screen");
  assert.deepEqual(
    calls.filter((c) => /\/submit$|\/api\/uploads/.test(c.url)),
    [],
    "a discarded take must never be uploaded",
  );
  await view.unmount();
});

test("Re-record abandons the take and starts a fresh one without uploading the old audio", async () => {
  installRecorder();
  installSpeechRecognition();
  const calls = mockFetch(() => ({ body: { ok: true } }));

  const view = await render(React.createElement(AiAnswerComposer, {
    dict: en, sessionId: SESSION.id, item: COMPOSER_ITEM as never, busy: false,
    retryOfAttemptId: null, onBusyChange: () => {}, onSent: () => {},
  }));

  await act(async () => { (view.q("[data-ai-start-answer]") as HTMLButtonElement).click(); });
  await settle(300);
  await act(async () => { (view.q("[data-ai-stop]") as HTMLButtonElement).click(); });
  await settle(300);

  await act(async () => { (view.q("[data-ai-rerecord]") as HTMLButtonElement).click(); });
  await settle(300);

  assert.ok(view.q('[data-ai-composer="recording"]'), "re-record must start a new take");
  assert.equal((view.q("[data-ai-transcript-input]") as HTMLTextAreaElement | null), null, "the old draft must be gone");
  assert.deepEqual(
    calls.filter((c) => /\/submit$|\/api\/uploads/.test(c.url)),
    [],
    "the abandoned take must never be uploaded",
  );
  await view.unmount();
});
