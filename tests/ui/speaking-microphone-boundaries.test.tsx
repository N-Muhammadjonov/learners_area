import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import en from "../../src/lib/i18n/en";
import { MicrophoneCheck } from "../../src/components/speaking/MicrophoneCheck";
import { AiQuestionRecorder } from "../../src/components/speaking/AiQuestionRecorder";
import { ShadowingStudio } from "../../src/components/speaking/ShadowingStudio";

const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Event", "DOMException"] as const) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let stopped = 0; let starts = 0; let closed = 0; let sample = 128;
let getMedia: () => Promise<MediaStream>;
const stream = () => ({ getTracks: () => [{ stop() { stopped++; } }] }) as unknown as MediaStream;
class Media extends dom.window.EventTarget {
  static isTypeSupported() { return true; } state = "inactive"; mimeType = "audio/webm";
  start() { starts++; this.state = "recording"; }
  stop() { this.state = "inactive"; const event = new dom.window.Event("dataavailable"); Object.defineProperty(event, "data", { value: new Blob(["voice"]) }); this.dispatchEvent(event); this.dispatchEvent(new dom.window.Event("stop")); }
}
class Context {
  state = "suspended";
  createAnalyser() { return { fftSize: 256, frequencyBinCount: 128, getByteTimeDomainData(data: Uint8Array) { data.fill(sample); } }; }
  createMediaStreamSource() { return { connect() {} }; }
  async resume() { this.state = "running"; }
  async close() { closed++; }
}
Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Media });
Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: Media });
Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: Context });
Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => getMedia() } });
const deadlines = new Map<number, { delay: number; fn: () => void }>(); const frames = new Map<number, () => void>(); const intervals = new Map<number, () => void>(); let timerId = 0;
Object.assign(globalThis, {
  setTimeout: ((fn: () => void, delay: number) => { deadlines.set(++timerId, { fn, delay }); return timerId; }), clearTimeout: ((id: number) => deadlines.delete(Number(id))),
  setInterval: ((fn: () => void) => { intervals.set(++timerId, fn); return timerId; }), clearInterval: ((id: number) => intervals.delete(Number(id))),
  requestAnimationFrame: ((fn: () => void) => { frames.set(++timerId, fn); return timerId; }), cancelAnimationFrame: ((id: number) => frames.delete(id)),
});
URL.createObjectURL = () => "blob:voice"; URL.revokeObjectURL = () => {};
globalThis.fetch = (async () => Response.json({ attempt: { id: "attempt" } })) as typeof fetch;
function button(label: string) { return [...document.querySelectorAll("button")].find(el => el.textContent === label)!; }
const prompt = { id: "prompt", part: "part1", answerSeconds: 45, promptText: "Question", cueCard: null } as React.ComponentProps<typeof AiQuestionRecorder>["prompt"];
async function fixture(element: React.ReactNode, run: () => Promise<void>) {
  stopped = 0; starts = 0; closed = 0; sample = 128; getMedia = async () => stream();
  const root = createRoot(document.getElementById("root")!);
  try { await act(async () => root.render(element)); await run(); }
  finally { await act(async () => root.unmount()); deadlines.clear(); frames.clear(); intervals.clear(); }
}

test("microphone check releases a permission grant arriving after unmount", async () => {
  let grant!: (stream: MediaStream) => void;
  const root = createRoot(document.getElementById("root")!); stopped = 0; closed = 0;
  getMedia = () => new Promise(resolve => { grant = resolve; });
  try {
    await act(async () => root.render(<MicrophoneCheck dict={en} onContinue={() => assert.fail("not checked")} />));
    await act(async () => button(en.speakingAi.testMicrophone).click());
    await act(async () => root.unmount());
    await act(async () => grant(stream()));
    assert.equal(stopped, 1); assert.equal(frames.size, 0); assert.equal(deadlines.size, 0);
  } finally { await act(async () => root.unmount()); deadlines.clear(); frames.clear(); }
});

test("microphone Continue requires measured nonzero energy and releases analyser resources", async () => {
  for (const value of [128, 140]) {
    await fixture(<MicrophoneCheck dict={en} onContinue={() => {}} />, async () => {
      sample = value;
      await act(async () => button(en.speakingAi.testMicrophone).click());
      assert.equal(document.querySelector("[data-microphone-check]")!.getAttribute("data-microphone-check"), "checking");
      const finish = [...deadlines.values()].find(timer => timer.delay === 2500)!;
      await act(async () => finish.fn());
      assert.equal(document.querySelector("[data-microphone-check]")!.getAttribute("data-microphone-check"), value === 128 ? "error" : "passed");
      assert.equal(Boolean(button(en.speakingAi.continue)), value !== 128);
      assert.equal(stopped, 1); assert.equal(closed, 1); assert.equal(frames.size, 0); assert.equal(deadlines.size, 0);
    });
  }
});

test("AI and Shadowing consumers abort pending microphone acquisition on unmount", async () => {
  for (const element of [
    <AiQuestionRecorder key="ai" dict={en} prompt={prompt} sessionId="session" itemId="item" index={1} onEvaluated={() => {}} onNext={() => {}} />,
    <ShadowingStudio key="shadow" dict={en} tracks={[{ id: "track", title: "Track", url: "/track", category: "general" }]} />,
  ]) {
    let grant!: (stream: MediaStream) => void; stopped = 0; starts = 0;
    getMedia = () => new Promise(resolve => { grant = resolve; });
    const root = createRoot(document.getElementById("root")!);
    try {
      await act(async () => root.render(element));
      await act(async () => { const shadow = document.querySelector<HTMLButtonElement>("[data-shadowing-start]"); if (shadow) shadow.click(); else button(en.speakingAi.startAnswer).click(); });
      await act(async () => root.unmount());
      await act(async () => grant(stream()));
      assert.equal(starts, 0, "a detached consumer must never start the recorder"); assert.equal(stopped, 1); assert.equal(deadlines.size, 0); assert.equal(intervals.size, 0);
    } finally { await act(async () => root.unmount()); deadlines.clear(); intervals.clear(); }
  }
});

test("audio recording and editable manual review remain available without browser STT", async () => {
  await fixture(<AiQuestionRecorder dict={en} prompt={prompt} sessionId="session" itemId="item" index={1} onEvaluated={() => assert.fail("no implicit send")} onNext={() => {}} />, async () => {
    await act(async () => button(en.speakingAi.startAnswer).click());
    assert.equal(starts, 1);
    await act(async () => button(en.speakingAi.stop).click());
    assert.equal(document.querySelector("[data-ai-answer-phase]")!.getAttribute("data-ai-answer-phase"), "review");
    assert.equal(document.querySelector("textarea")!.readOnly, false); assert.equal(stopped, 1); assert.equal(intervals.size, 0);
  });
});

test("permission denial and timeout release deadlines and keep Continue unavailable", async () => {
  for (const kind of ['denied','timeout']) {
    await fixture(<MicrophoneCheck dict={en} onContinue={() => assert.fail("permission was not accepted")} />, async () => {
      getMedia = kind === 'denied' ? async () => { throw new DOMException('Denied','NotAllowedError'); } : () => new Promise(() => {});
      await act(async () => { const start = button(en.speakingAi.testMicrophone); start.click(); start.click(); });
      if (kind === 'timeout') await act(async () => [...deadlines.values()].find(timer => timer.delay === 30_000)!.fn());
      assert.equal(document.querySelector('[data-microphone-check]')!.getAttribute('data-microphone-check'), kind === 'denied' ? 'denied' : 'error');
      assert.equal(button(en.speakingAi.continue), undefined); assert.equal(frames.size, 0); assert.equal(deadlines.size, 0);
    });
  }
});


test("unmount during asynchronous recorder Stop releases tracks and the pending stop deadline", async () => {
  class DelayedMedia extends Media { stop() { this.state = "inactive"; } }
  Object.defineProperty(window, "MediaRecorder", { configurable: true, value: DelayedMedia });
  const root = createRoot(document.getElementById("root")!);
  stopped = 0; starts = 0; getMedia = async () => stream();
  try {
    await act(async () => root.render(<AiQuestionRecorder dict={en} prompt={prompt} sessionId="session" itemId="item" index={1} onEvaluated={() => assert.fail("no implicit send")} onNext={() => {}} />));
    await act(async () => button(en.speakingAi.startAnswer).click());
    await act(async () => button(en.speakingAi.stop).click());
    assert.equal(document.querySelector("[data-ai-answer-phase]")!.getAttribute("data-ai-answer-phase"), "stopping");
    assert.equal(stopped, 0);
    await act(async () => root.unmount());
    assert.equal(stopped, 1); assert.equal(deadlines.size, 0); assert.equal(intervals.size, 0);
  } finally {
    await act(async () => root.unmount());
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Media });
    deadlines.clear(); intervals.clear();
  }
});
