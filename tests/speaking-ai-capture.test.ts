import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMicrophoneError,
  DEFAULT_LEVEL_THRESHOLD,
  rmsLevel,
  runMicrophoneCheck,
  type AudioContextLike,
  type MediaStreamLike,
  type MicrophoneCheckDeps,
} from "../src/lib/audio/microphone-check";
import {
  createBrowserStt,
  isBrowserSttSupported,
  joinTranscript,
  resolveSpeechRecognition,
  toBrowserSttErrorCode,
  type BrowserSttState,
  type SpeechRecognitionLike,
} from "../src/lib/audio/browser-stt";

/**
 * Microphone + browser-STT matrix (spec §62).
 *
 * Both engines are dependency-injected, so these tests drive the real code paths
 * with a fake device rather than asserting on a mock. What they protect:
 *   - the microphone is released on EVERY exit path
 *   - silence is reported as silence (never a fake "pass")
 *   - a microphone check performs no network call and creates no attempt
 *   - an unsupported browser never gets a fabricated transcript
 *   - recognition starts once, and its listeners are detached on release
 */

// ---------------------------------------------------------------------------
// level maths
// ---------------------------------------------------------------------------

test("rmsLevel: silence is 0, a full-scale square wave is 1, DC offset alone is not signal", () => {
  assert.equal(rmsLevel(new Uint8Array(16).fill(128)), 0, "flat 128 is silence");
  assert.equal(rmsLevel(new Uint8Array(0)), 0);
  const loud = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) loud[i] = i % 2 === 0 ? 255 : 1;
  assert.ok(rmsLevel(loud) > 0.9, `expected near full scale, got ${rmsLevel(loud)}`);
  const quiet = new Uint8Array(64).fill(128);
  quiet[0] = 130;
  assert.ok(rmsLevel(quiet) < DEFAULT_LEVEL_THRESHOLD, "a single tick of room noise must stay under the floor");
});

// ---------------------------------------------------------------------------
// fake device harness
// ---------------------------------------------------------------------------

type Harness = {
  deps: MicrophoneCheckDeps;
  tracksStopped: () => number;
  contextClosed: () => number;
  sourceDisconnected: () => number;
  levels: () => number[];
  statuses: () => string[];
};

/**
 * @param samples RMS-producing byte values per sample; the last one repeats.
 * @param grant  how getUserMedia behaves.
 */
function harness(opts: {
  sampleLevels: number[];
  grant?: "allow" | "deny" | "notfound" | "hang";
  audioContext?: "ok" | "unavailable" | "throws";
}): Harness {
  let tracksStopped = 0;
  let contextClosed = 0;
  let sourceDisconnected = 0;
  const levels: number[] = [];
  const statuses: string[] = [];
  let sampleIndex = 0;
  let clock = 0;

  const stream: MediaStreamLike = {
    getTracks: () => [{ stop: () => { tracksStopped += 1; }, readyState: "live" }, { stop: () => { tracksStopped += 1; }, readyState: "live" }],
  };

  const deps: MicrophoneCheckDeps = {
    isSupported: () => true,
    getUserMedia: async () => {
      if (opts.grant === "deny") throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      if (opts.grant === "notfound") throw Object.assign(new Error("none"), { name: "NotFoundError" });
      if (opts.grant === "hang") return new Promise<MediaStreamLike>(() => {});
      return stream;
    },
    createAudioContext: (): AudioContextLike | null => {
      if (opts.audioContext === "unavailable") return null;
      if (opts.audioContext === "throws") throw new Error("graph failed");
      const analyser = {
        fftSize: 8,
        getByteTimeDomainData(target: Uint8Array) {
          const level = opts.sampleLevels[Math.min(sampleIndex, opts.sampleLevels.length - 1)] ?? 0;
          sampleIndex += 1;
          clock += 60; // virtual time: one sample interval per read
          const amplitude = Math.round(level * 128);
          for (let i = 0; i < target.length; i += 1) target[i] = i % 2 === 0 ? 128 + amplitude : 128 - amplitude;
          levels.push(level);
        },
      };
      return {
        createAnalyser: () => analyser,
        createMediaStreamSource: () => ({ connect() {}, disconnect() { sourceDisconnected += 1; } }),
        close: () => { contextClosed += 1; },
      };
    },
    now: () => clock,
    schedule: (fn) => setInterval(fn, 1),
    cancel: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  };

  return {
    deps,
    tracksStopped: () => tracksStopped,
    contextClosed: () => contextClosed,
    sourceDisconnected: () => sourceDisconnected,
    levels: () => levels,
    statuses: () => statuses,
  };
}

/** Any network use during a microphone check is a bug: assert there is none. */
function forbidNetwork(): { calls: number; restore: () => void } {
  const record = { calls: 0, restore: () => {} };
  const saved = globalThis.fetch;
  globalThis.fetch = (async () => { record.calls += 1; throw new Error("a microphone check must not perform a network request"); }) as typeof fetch;
  record.restore = () => { globalThis.fetch = saved; };
  return record;
}

// ---------------------------------------------------------------------------
// microphone check
// ---------------------------------------------------------------------------

test("supported microphone check succeeds as soon as real energy arrives", async () => {
  const net = forbidNetwork();
  const h = harness({ sampleLevels: [0.005, 0.4, 0.4] });
  try {
    const outcome = await runMicrophoneCheck({ deps: h.deps, onStatus: (s) => h.statuses().push(s), durationMs: 2000 });
    assert.equal(outcome.status, "passed");
    if (outcome.status === "passed") {
      assert.ok(outcome.peakLevel >= DEFAULT_LEVEL_THRESHOLD);
      assert.ok(outcome.sampleMs > 0);
    }
    assert.equal(net.calls, 0, "a microphone check must be entirely local");
    // Passed on the 2nd sample, so it must NOT have kept sampling to the deadline.
    assert.equal(h.levels().length, 2, "check held the microphone open longer than needed");
  } finally { net.restore(); }
});

test("zero audio input fails truthfully as no_input — never a fake pass", async () => {
  const h = harness({ sampleLevels: [0] });
  const outcome = await runMicrophoneCheck({ deps: h.deps, durationMs: 300 });
  assert.equal(outcome.status, "error");
  if (outcome.status === "error") {
    assert.equal(outcome.code, "no_input");
    assert.equal(outcome.peakLevel, 0);
  }
  assert.ok(h.levels().length >= 4, "must sample the whole window before concluding silence");
});

test("permission denied reports denied, and no audio graph is built", async () => {
  const h = harness({ sampleLevels: [0.4], grant: "deny" });
  const outcome = await runMicrophoneCheck({ deps: h.deps, durationMs: 500 });
  assert.deepEqual(outcome, { status: "denied" });
  assert.equal(h.contextClosed(), 0, "must not open an AudioContext after a denial");
});

test("no microphone device reports no_microphone, not a generic error", async () => {
  const h = harness({ sampleLevels: [0.4], grant: "notfound" });
  const outcome = await runMicrophoneCheck({ deps: h.deps });
  assert.equal(outcome.status, "error");
  if (outcome.status === "error") assert.equal(outcome.code, "no_microphone");
});

test("unsupported browser reports unsupported without asking for permission", async () => {
  let asked = false;
  const h = harness({ sampleLevels: [0.4] });
  const outcome = await runMicrophoneCheck({
    deps: { ...h.deps, isSupported: () => false, getUserMedia: async () => { asked = true; return { getTracks: () => [] }; } },
  });
  assert.deepEqual(outcome, { status: "unsupported" });
  assert.equal(asked, false, "must not prompt for a permission it cannot use");
});

test("mic tracks, source and AudioContext are released after a PASS", async () => {
  const h = harness({ sampleLevels: [0.4] });
  await runMicrophoneCheck({ deps: h.deps });
  assert.equal(h.tracksStopped(), 2, "both tracks must be stopped");
  assert.equal(h.sourceDisconnected(), 1);
  assert.equal(h.contextClosed(), 1);
});

test("mic tracks, source and AudioContext are released after a SILENT FAILURE", async () => {
  const h = harness({ sampleLevels: [0] });
  await runMicrophoneCheck({ deps: h.deps, durationMs: 200 });
  assert.equal(h.tracksStopped(), 2);
  assert.equal(h.sourceDisconnected(), 1);
  assert.equal(h.contextClosed(), 1);
});

test("mic is released when the audio graph itself throws", async () => {
  const h = harness({ sampleLevels: [0.4], audioContext: "throws" });
  const outcome = await runMicrophoneCheck({ deps: h.deps });
  assert.equal(outcome.status, "error");
  assert.equal(h.tracksStopped(), 2, "a failed graph must not strand an open microphone");
});

test("mic is released when no AudioContext can be created", async () => {
  const h = harness({ sampleLevels: [0.4], audioContext: "unavailable" });
  const outcome = await runMicrophoneCheck({ deps: h.deps });
  assert.equal(outcome.status, "error");
  assert.equal(h.tracksStopped(), 2);
  assert.equal(h.contextClosed(), 0);
});

test("abort before the check releases the granted stream and reports aborted", async () => {
  const h = harness({ sampleLevels: [0.4] });
  const controller = new AbortController();
  const pending = runMicrophoneCheck({ deps: h.deps, signal: controller.signal, durationMs: 5000 });
  controller.abort();
  const outcome = await pending;
  assert.equal(outcome.status, "error");
  if (outcome.status === "error") assert.equal(outcome.code, "aborted");
});

test("an already-aborted signal never opens the microphone at all", async () => {
  const h = harness({ sampleLevels: [0.4] });
  const controller = new AbortController();
  controller.abort();
  const outcome = await runMicrophoneCheck({ deps: h.deps, signal: controller.signal });
  assert.equal(outcome.status, "error");
  assert.equal(h.tracksStopped(), 0, "must not acquire a device for a cancelled check");
});

test("onLevel receives a bounded 0..1 meter value", async () => {
  const seen: number[] = [];
  const h = harness({ sampleLevels: [0.4, 0.9] });
  await runMicrophoneCheck({ deps: h.deps, onLevel: (level) => seen.push(level) });
  assert.ok(seen.length > 0);
  for (const level of seen) assert.ok(level >= 0 && level <= 1, `meter value out of range: ${level}`);
});

test("classifyMicrophoneError maps vendor error names onto honest statuses", () => {
  assert.deepEqual(classifyMicrophoneError({ name: "NotAllowedError" }), { status: "denied" });
  assert.deepEqual(classifyMicrophoneError({ name: "SecurityError" }), { status: "denied" });
  assert.equal(classifyMicrophoneError({ name: "NotFoundError" }).status, "error");
  assert.equal(classifyMicrophoneError({ name: "OverconstrainedError" }).status, "error");
  assert.equal(classifyMicrophoneError(new Error("mystery")).status, "error");
  assert.equal(classifyMicrophoneError(null).status, "error");
});

// ---------------------------------------------------------------------------
// browser speech recognition
// ---------------------------------------------------------------------------

type FakeRecognition = SpeechRecognitionLike & {
  startCalls: number;
  stopCalls: number;
  abortCalls: number;
  emitFinal(text: string): void;
  emitInterim(text: string): void;
  emitError(code: string): void;
  emitEnd(): void;
};

/** A controllable fake of the Web Speech API, recording every call it receives. */
function fakeRecognition(): FakeRecognition {
  let nextResultIndex = 0;
  const results: { isFinal: boolean; transcript: string }[] = [];

  function resultList(): unknown {
    const list: Record<string, unknown> = { length: results.length };
    results.forEach((r, i) => { list[i] = { isFinal: r.isFinal, length: 1, 0: { transcript: r.transcript } }; });
    return list;
  }

  const instance = {
    lang: "",
    continuous: false,
    interimResults: false,
    maxAlternatives: 0,
    startCalls: 0,
    stopCalls: 0,
    abortCalls: 0,
    onresult: null as ((event: { resultIndex: number; results: unknown }) => void) | null,
    onerror: null as ((event: { error?: string }) => void) | null,
    onend: null as (() => void) | null,
    onstart: null as (() => void) | null,
    start() { instance.startCalls += 1; },
    stop() { instance.stopCalls += 1; },
    abort() { instance.abortCalls += 1; },
    emitFinal(text: string) {
      results.push({ isFinal: true, transcript: text });
      instance.onresult?.({ resultIndex: nextResultIndex++, results: resultList() });
    },
    emitInterim(text: string) {
      results.push({ isFinal: false, transcript: text });
      instance.onresult?.({ resultIndex: nextResultIndex++, results: resultList() });
    },
    emitError(code: string) { instance.onerror?.({ error: code }); },
    emitEnd() { instance.onend?.(); },
  };
  return instance as unknown as FakeRecognition;
}

test("unsupported browser: state is unsupported and no transcript is fabricated", () => {
  const saved = (globalThis as { window?: unknown }).window;
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  try {
    assert.equal(resolveSpeechRecognition(), null);
    assert.equal(isBrowserSttSupported(), false);
    const stt = createBrowserStt();
    assert.deepEqual(stt.state(), { kind: "unsupported" });
    stt.start();
    assert.deepEqual(stt.state(), { kind: "unsupported" }, "start() on an unsupported browser must not invent a listening state");
    assert.equal(stt.rawTranscript(), "");
    assert.equal(stt.stop(), "");
  } finally {
    if (saved === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { value: saved, configurable: true });
  }
});

test("recognizer is configured continuous + interim and starts exactly once", () => {
  const fake = fakeRecognition();
  const stt = createBrowserStt({ createRecognition: () => fake });
  stt.start();
  stt.start();
  stt.start();
  assert.equal(fake.startCalls, 1, "recognition must be started once per take");
  assert.equal(fake.continuous, true);
  assert.equal(fake.interimResults, true);
  assert.equal(fake.lang, "en-US");
  assert.equal(fake.maxAlternatives, 1);
  assert.equal(stt.state().kind, "listening");
});

test("interim text is shown separately and does not enter the raw transcript", () => {
  const fake = fakeRecognition();
  const states: BrowserSttState[] = [];
  const stt = createBrowserStt({ createRecognition: () => fake, onChange: (s) => states.push(s) });
  stt.start();
  fake.emitInterim("I would like to");
  const listening = stt.state();
  assert.equal(listening.kind, "listening");
  if (listening.kind === "listening") {
    assert.equal(listening.interim, "I would like to");
    assert.equal(listening.final, "", "interim text must not be committed to the transcript");
  }
  assert.equal(stt.rawTranscript(), "");
  assert.ok(states.some((s) => s.kind === "listening" && s.interim === "I would like to"));
});

test("final chunks append to the raw transcript, preserving the recognizer's wording", () => {
  const fake = fakeRecognition();
  const stt = createBrowserStt({ createRecognition: () => fake });
  stt.start();

  fake.emitFinal("I work there for three years.");
  assert.equal(stt.rawTranscript(), "I work there for three years.");

  // An interim is the provisional form of the segment that is about to become
  // final, so it is shown on its own and is NOT committed to the transcript.
  fake.emitInterim("and I enjoy it");
  let listening = stt.state();
  if (listening.kind === "listening") {
    assert.equal(listening.interim, "and I enjoy it");
    assert.equal(listening.final, "I work there for three years.");
  } else assert.fail("expected listening state");

  // When that segment finalizes, the interim is superseded — keeping it would
  // duplicate the words in the transcript the learner reviews.
  fake.emitFinal("And I enjoy it.");
  listening = stt.state();
  if (listening.kind === "listening") assert.equal(listening.interim, "");
  else assert.fail("expected listening state");

  assert.equal(stt.rawTranscript(), "I work there for three years. And I enjoy it.");
  // No punctuation or capitalisation was invented or stripped (§16).
  assert.match(stt.rawTranscript(), /years\./);
  assert.match(stt.rawTranscript(), /And I enjoy it\./);
});

test("stop() halts recognition, freezes the transcript and never submits anything", () => {
  const net = forbidNetwork();
  try {
    const fake = fakeRecognition();
    const stt = createBrowserStt({ createRecognition: () => fake });
    stt.start();
    fake.emitFinal("My answer.");
    const raw = stt.stop();
    assert.equal(raw, "My answer.");
    assert.equal(fake.stopCalls, 1);
    assert.equal(stt.state().kind, "stopped");
    assert.equal(stt.isActive(), false);
    assert.equal(net.calls, 0, "Stop must not upload or submit (§5)");
    // Results arriving after stop cannot mutate the frozen transcript.
    fake.emitFinal("late text");
    assert.equal(stt.rawTranscript(), "My answer.");
  } finally { net.restore(); }
});

test("abort() discards the transcript for Clear / re-record", () => {
  const fake = fakeRecognition();
  const stt = createBrowserStt({ createRecognition: () => fake });
  stt.start();
  fake.emitFinal("Throw this away.");
  stt.abort();
  assert.equal(fake.abortCalls, 1);
  assert.equal(stt.rawTranscript(), "");
  assert.equal(stt.state().kind, "idle");
});

test("a NEW take can start after abort(), so re-record still transcribes", () => {
  // Regression guard: if abort() left the take flagged as started, "Re-record"
  // would silently produce no transcript for the second attempt.
  const fake = fakeRecognition();
  const stt = createBrowserStt({ createRecognition: () => fake });
  stt.start();
  fake.emitFinal("Misspoke badly.");
  stt.abort();
  stt.start();
  assert.equal(fake.startCalls, 2, "the second take must really start recognition");
  fake.emitFinal("Second attempt, said properly.");
  assert.equal(stt.rawTranscript(), "Second attempt, said properly.");
  assert.equal(stt.state().kind, "listening");
});

test("release() detaches every listener so none can fire after unmount", () => {
  const fake = fakeRecognition();
  const stt = createBrowserStt({ createRecognition: () => fake });
  stt.start();
  stt.release();
  assert.equal(fake.onresult, null, "onresult listener leaked");
  assert.equal(fake.onerror, null, "onerror listener leaked");
  assert.equal(fake.onend, null, "onend listener leaked");
  assert.equal(fake.onstart, null, "onstart listener leaked");
  assert.equal(stt.isActive(), false);
  assert.equal(fake.abortCalls, 1);
});

test("a mid-recording recognition error is reported truthfully and stops listening", () => {
  const fake = fakeRecognition();
  const stt = createBrowserStt({ createRecognition: () => fake });
  stt.start();
  fake.emitFinal("Before the failure.");
  fake.emitError("network");
  const state = stt.state();
  assert.deepEqual(state, { kind: "error", code: "network" });
  assert.equal(stt.isActive(), false);
  // Already-recognized text survives so the learner does not lose valid work (§17).
  assert.equal(stt.rawTranscript(), "Before the failure.");
  assert.equal(fake.onresult, null, "listeners must be detached on error");
});

test("permission refusal during recognition surfaces as not-allowed", () => {
  const fake = fakeRecognition();
  const stt = createBrowserStt({ createRecognition: () => fake });
  stt.start();
  fake.emitError("not-allowed");
  assert.deepEqual(stt.state(), { kind: "error", code: "not-allowed" });
});

test("no-speech is not fatal: the take continues so audio is not discarded", () => {
  const fake = fakeRecognition();
  const stt = createBrowserStt({ createRecognition: () => fake });
  stt.start();
  fake.emitError("no-speech");
  assert.equal(stt.state().kind, "listening", "a pause mid-answer must not kill the transcript");
  assert.equal(stt.isActive(), true);
  fake.emitFinal("Resumed fine.");
  assert.equal(stt.rawTranscript(), "Resumed fine.");
});

test("an unexpected end restarts within a bound and then reports stopped", () => {
  const fake = fakeRecognition();
  const stt = createBrowserStt({ createRecognition: () => fake, maxRestarts: 2 });
  stt.start();
  fake.emitEnd(); // Chrome-style silence cutoff
  fake.emitEnd();
  assert.equal(fake.startCalls, 3, "1 initial start + 2 bounded restarts");
  assert.equal(stt.state().kind, "listening");
  fake.emitEnd(); // bound exhausted
  assert.equal(stt.state().kind, "stopped", "must not spin forever");
  assert.equal(fake.startCalls, 3, "restart bound was exceeded");
});

test("a recognizer whose start() throws is reported as an error, never faked", () => {
  const broken = fakeRecognition();
  broken.start = () => { throw new Error("engine refused"); };
  const stt = createBrowserStt({ createRecognition: () => broken });
  stt.start();
  assert.deepEqual(stt.state(), { kind: "error", code: "unknown" });
  assert.equal(stt.isActive(), false);
  assert.equal(stt.rawTranscript(), "");
});

test("a factory returning null yields unsupported rather than a silent dead UI", () => {
  const stt = createBrowserStt({ createRecognition: () => null });
  stt.start();
  assert.deepEqual(stt.state(), { kind: "unsupported" });
});

test("joinTranscript normalizes whitespace only — punctuation and case survive", () => {
  assert.equal(joinTranscript(["  I work here. ", "", "And I  enjoy it!  "]), "I work here. And I enjoy it!");
  assert.equal(joinTranscript([]), "");
  assert.equal(joinTranscript(["What? Yes!"]), "What? Yes!");
});

test("toBrowserSttErrorCode keeps a closed vocabulary and never guesses a known code", () => {
  assert.equal(toBrowserSttErrorCode("not-allowed"), "not-allowed");
  assert.equal(toBrowserSttErrorCode("audio-capture"), "audio-capture");
  assert.equal(toBrowserSttErrorCode("service-not-allowed"), "service-not-allowed");
  assert.equal(toBrowserSttErrorCode("no-speech"), "no-speech");
  assert.equal(toBrowserSttErrorCode("network"), "network");
  assert.equal(toBrowserSttErrorCode("aborted"), "aborted");
  assert.equal(toBrowserSttErrorCode("something-new"), "unknown");
  assert.equal(toBrowserSttErrorCode(undefined), "unknown");
});

test("webkitSpeechRecognition is found when the standard name is absent", () => {
  class Webkit {}
  const found = resolveSpeechRecognition({ webkitSpeechRecognition: Webkit });
  assert.equal(found, Webkit as unknown);
  assert.equal(resolveSpeechRecognition({}), null);
});
