import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useBrowserSpeechRecognition } from "../../src/components/speaking/useBrowserSpeechRecognition";

const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Event"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type EventData = { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static failStart = false;
  static failStop = false;
  lang = ""; continuous = false; interimResults = false;
  onresult: ((event: EventData) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  stops = 0; aborts = 0;
  constructor() { FakeRecognition.instances.push(this); }
  start() { if (FakeRecognition.failStart) throw new Error("start"); }
  stop() { this.stops++; if (FakeRecognition.failStop) throw new Error("stop"); }
  abort() { this.aborts++; }
  result(text: string, final = true) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: text } }] }); }
}
window.SpeechRecognition = FakeRecognition;
let api: ReturnType<typeof useBrowserSpeechRecognition>;
function Harness() { api = useBrowserSpeechRecognition(); return <output>{api.liveTranscript}</output>; }
async function mounted(run: () => Promise<void>) {
  FakeRecognition.failStart = false; FakeRecognition.failStop = false;
  const root = createRoot(document.getElementById("root")!);
  try { await act(async () => root.render(<Harness />)); await run(); }
  finally { await act(async () => root.unmount()); }
}

test("Stop preserves a late final result and waits for recognition end before transcript review", async () => {
  await mounted(async () => {
    await act(async () => { assert.equal(api.start(), true); });
    const recognition = FakeRecognition.instances.at(-1)!;
    await act(async () => recognition.result("I enjoy learning", false));
    let settled = false; let stopped!: Promise<string>;
    await act(async () => { stopped = api.stop(); assert.equal(api.stop(), stopped, "repeated Stop shares one finalization"); void stopped.then(() => { settled = true; }); });
    assert.equal(settled, false, "stop must wait for browser finalization");
    assert.equal(recognition.stops, 1);
    await act(async () => { recognition.result("I enjoy learning languages."); recognition.onend?.(); });
    assert.equal(await stopped, "I enjoy learning languages.");
    assert.deepEqual(api.state, { kind: "stopped", rawTranscript: "I enjoy learning languages." });
    assert.equal(recognition.onresult, null); assert.equal(recognition.onend, null);
  });
});

test("result snapshots replace interim text and do not duplicate final results on repeated events", async () => {
  await mounted(async () => {
    await act(async () => { api.start(); });
    const r = FakeRecognition.instances.at(-1)!;
    await act(async () => {
      r.result("First sentence."); r.result("First sentence.");
      r.onresult?.({ resultIndex: 1, results: [{ isFinal: true, 0: { transcript: "First sentence." } }, { isFinal: false, 0: { transcript: "second" } }] });
    });
    assert.equal(api.liveTranscript, "First sentence. second");
    await act(async () => {
      r.onresult?.({ resultIndex: 1, results: [{ isFinal: true, 0: { transcript: "First sentence." } }, { isFinal: true, 0: { transcript: "Second sentence." } }] });
      r.onend?.();
    });
    assert.equal(api.liveTranscript, "First sentence. Second sentence.");
    assert.equal(r.onresult, null); assert.equal(r.onerror, null); assert.equal(r.onend, null);
  });
});

test("reset settles a pending stop and stale callbacks cannot change a new recording", async () => {
  await mounted(async () => {
    await act(async () => { api.start(); });
    const old = FakeRecognition.instances.at(-1)!;
    const staleResult = old.onresult!; const staleEnd = old.onend!; const staleError = old.onerror!;
    let stopping!: Promise<string>;
    await act(async () => { old.result("Old final."); stopping = Promise.resolve(api.stop()); api.reset(); api.start(); });
    assert.equal(await stopping, "Old final.");
    const current = FakeRecognition.instances.at(-1)!;
    await act(async () => {
      current.result("New final.");
      staleResult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Stale text." } }] }); staleEnd(); staleError({ error: "not-allowed" });
    });
    assert.equal(api.liveTranscript, "New final.");
    assert.equal(api.state.kind, "listening");
  });
});

test("permission/start failures release handlers and allow retry; no-speech end remains editable", async () => {
  await mounted(async () => {
    FakeRecognition.failStart = true;
    await act(async () => { assert.equal(api.start(), false); });
    const failed = FakeRecognition.instances.at(-1)!;
    assert.equal(failed.onresult, null); assert.equal(failed.aborts, 1);
    FakeRecognition.failStart = false;
    await act(async () => { assert.equal(api.start(), true); });
    const denied = FakeRecognition.instances.at(-1)!;
    await act(async () => denied.onerror?.({ error: "not-allowed" }));
    assert.deepEqual(api.state, { kind: "error", code: "not-allowed", rawTranscript: "" });
    assert.equal(denied.onresult, null);
    await act(async () => { api.start(); FakeRecognition.instances.at(-1)!.onend?.(); });
    assert.equal(api.liveTranscript, "");
    assert.equal(FakeRecognition.instances.at(-1)!.onresult, null);
  });
});

test("bounded stop timeout and stop exceptions preserve finals and release handlers", async () => {
  const originalSet = window.setTimeout; const originalClear = window.clearTimeout;
  const timers = new Map<number, () => void>(); let id = 0;
  window.setTimeout = ((fn: () => void) => { timers.set(++id, fn); return id; }) as typeof window.setTimeout;
  window.clearTimeout = (value) => { timers.delete(Number(value)); };
  try {
    await mounted(async () => {
      await act(async () => { api.start(); });
      const r = FakeRecognition.instances.at(-1)!; let stopped!: Promise<string>;
      await act(async () => { r.result("Preserved."); stopped = Promise.resolve(api.stop()); });
      assert.equal(timers.size, 1);
      await act(async () => { for (const expire of [...timers.values()]) expire(); });
      assert.equal(await stopped, "Preserved."); assert.equal(r.onresult, null); assert.equal(timers.size, 0);
      FakeRecognition.failStop = true;
      await act(async () => { api.start(); stopped = Promise.resolve(api.stop()); });
      assert.equal(await stopped, ""); assert.equal(timers.size, 0);
    });
  } finally { window.setTimeout = originalSet; window.clearTimeout = originalClear; }
});

test("unmount settles finalization and detaches handlers; unsupported recognition is optional", async () => {
  const root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<Harness />));
  let stopped!: Promise<string>;
  await act(async () => { api.start(); stopped = Promise.resolve(api.stop()); });
  const r = FakeRecognition.instances.at(-1)!;
  await act(async () => root.unmount());
  assert.equal(await stopped, ""); assert.equal(r.onresult, null); assert.equal(r.onerror, null); assert.equal(r.onend, null);
  delete window.SpeechRecognition;
  try { await mounted(async () => { assert.equal(api.supported, false); assert.equal(api.start(), false); assert.equal(await api.stop(), ""); }); }
  finally { window.SpeechRecognition = FakeRecognition; }
});

test("AI recorder waits for the late final before editable review and never uploads on Stop", async () => {
  const { AiQuestionRecorder } = await import("../../src/components/speaking/AiQuestionRecorder");
  const { default: en } = await import("../../src/lib/i18n/en");
  const originalFetch = globalThis.fetch;
  const originalMedia = window.MediaRecorder;
  const originalGlobalMedia = Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder");
  const originalDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
  let tracksStopped = 0; let revoked = 0; let audioStops = 0;
  const calls: string[] = [];
  class AudioRecorder extends dom.window.EventTarget {
    static isTypeSupported() { return true; }
    state = "inactive"; mimeType = "audio/webm";
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive"; audioStops++;
      const data = new dom.window.Event("dataavailable");
      Object.defineProperty(data, "data", { value: new Blob(["recorded audio"]) });
      this.dispatchEvent(data); this.dispatchEvent(new dom.window.Event("stop"));
    }
  }
  window.MediaRecorder = AudioRecorder as unknown as typeof MediaRecorder;
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: AudioRecorder });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() { tracksStopped++; } }] }) } });
  URL.createObjectURL = () => "blob:review"; URL.revokeObjectURL = () => { revoked++; };
  globalThis.fetch = (async (url) => {
    calls.push(String(url));
    assert.ok(["/api/live-partner", "/api/speaking/attempts"].includes(String(url)), "Stop must not upload or submit");
    return Response.json({ attempt: { id: "test-attempt" } });
  }) as typeof fetch;
  const root = createRoot(document.getElementById("root")!);
  const prompt = { id: "test-prompt", part: "part1", answerSeconds: 45, promptText: "What do you enjoy learning?", cueCard: null } as React.ComponentProps<typeof AiQuestionRecorder>["prompt"];
  try {
    await act(async () => root.render(<AiQuestionRecorder dict={en} prompt={prompt} sessionId="session" itemId="item" index={1} onEvaluated={() => assert.fail("Stop must not evaluate")} onNext={() => {}} />));
    const button = (label: string) => [...document.querySelectorAll("button")].find(el => el.textContent === label)!;
    await act(async () => button(en.speakingAi.startAnswer).click());
    assert.equal(document.querySelector("[data-ai-answer-phase]")!.getAttribute("data-ai-answer-phase"), "recording", document.body.textContent ?? "");
    const r = FakeRecognition.instances.at(-1)!;
    await act(async () => r.result("I enjoy learning", false));
    await act(async () => button(en.speakingAi.stop).click());
    assert.equal(audioStops, 1, "audio stops immediately while STT finalizes");
    assert.equal(tracksStopped, 1);
    assert.equal(document.querySelector("[data-ai-answer-phase]")!.getAttribute("data-ai-answer-phase"), "stopping");
    assert.equal(document.querySelector("textarea"), null, "cannot edit an unfinished transcript");
    assert.equal(calls.length, 2);
    await act(async () => { r.result("I enjoy learning languages with friends."); r.onend?.(); });
    const review = document.querySelector("textarea")!;
    assert.equal(review.value, "I enjoy learning languages with friends.");
    assert.equal(review.readOnly, false);
    assert.equal(document.querySelector("[data-ai-answer-phase]")!.getAttribute("data-ai-answer-phase"), "review");
    assert.equal(document.querySelector("audio")!.getAttribute("src"), "blob:review");
    assert.equal(calls.length, 2, "review requires explicit Send to RIWI");
    assert.equal(button(en.speakingAi.sendToRiwi).disabled, false);
    await act(async () => root.unmount());
    assert.equal(revoked, 1); assert.equal(r.onresult, null);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch; window.MediaRecorder = originalMedia;
    if (originalGlobalMedia) Object.defineProperty(globalThis, "MediaRecorder", originalGlobalMedia); else Reflect.deleteProperty(globalThis, "MediaRecorder");
    if (originalDevices) Object.defineProperty(navigator, "mediaDevices", originalDevices); else Reflect.deleteProperty(navigator, "mediaDevices");
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  }
});
