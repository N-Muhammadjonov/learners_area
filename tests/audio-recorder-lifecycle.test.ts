import test from "node:test";
import assert from "node:assert/strict";
import { createRecorder, RecorderError } from "../src/lib/audio/recorder";

class Media extends EventTarget {
  static last: Media;
  static constructorFails = false; static startFails = false; static stopFails = false; static missingStop = false;
  static isTypeSupported() { return true; }
  state = "inactive"; mimeType = "audio/mp4"; stops = 0;
  listeners = new Set<string>();
  constructor(_stream: MediaStream) { super(); if (Media.constructorFails) throw new Error("constructor"); Media.last = this; }
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    this.listeners.add(type); super.addEventListener(type, callback, options);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    this.listeners.delete(type); super.removeEventListener(type, callback, options);
  }
  start() { if (Media.startFails) throw new Error("start"); this.state = "recording"; }
  stop() { this.stops++; if (Media.stopFails) throw new Error("stop"); this.state = "inactive"; if (!Media.missingStop) this.dispatchEvent(new Event("stop")); }
  data(bytes = "voice") { const event = new Event("dataavailable"); Object.defineProperty(event, "data", { value: new Blob([bytes], { type: this.mimeType }) }); this.dispatchEvent(event); }
}
let mediaCalls = 0; let tracksStopped = 0; let getMedia: () => Promise<MediaStream>;
const stream = () => ({ getTracks: () => [{ stop() { tracksStopped++; } }] }) as unknown as MediaStream;
Object.defineProperty(globalThis, "window", { configurable: true, value: { MediaRecorder: Media } });
Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: Media });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: () => { mediaCalls++; return getMedia(); } } } });
function reset() { mediaCalls = 0; tracksStopped = 0; getMedia = async () => stream(); Media.constructorFails = false; Media.startFails = false; Media.stopFails = false; Media.missingStop = false; }

test("an already-aborted request never asks for microphone permission", async () => {
  reset(); const ctl = new AbortController(); ctl.abort();
  await assert.rejects(createRecorder({ signal: ctl.signal }), RecorderError);
  assert.equal(mediaCalls, 0);
});
test("constructor and start failures release every acquired track and event handler", async () => {
  reset(); Media.constructorFails = true; await assert.rejects(createRecorder(), RecorderError); assert.equal(tracksStopped, 1);
  reset(); Media.startFails = true; const recorder = await createRecorder();
  await assert.rejects(recorder.start()); assert.equal(tracksStopped, 1); assert.equal(Media.last.listeners.size, 0);
});
test("duration excludes time between microphone acquisition and actual recording start", async () => {
  reset(); const original = Date.now; let now = 100; Date.now = () => now;
  try {
    const recorder = await createRecorder(); now = 5100; await recorder.start(); now = 8100; Media.last.data();
    const result = await recorder.stop(); assert.equal(result!.durationMs, 3000); assert.equal(result!.mimeType, "audio/mp4"); assert.equal(result!.size, 5);
    assert.equal(recorder.elapsedMs(), 3000); assert.equal(Media.last.listeners.size, 0);
  } finally { Date.now = original; }
});
test("duplicate Stop shares one result, one native stop and one track release", async () => {
  reset(); Media.missingStop = true; const recorder = await createRecorder(); await recorder.start(); Media.last.data();
  const first = recorder.stop(); const second = recorder.stop();
  assert.equal(first, second); assert.equal(Media.last.stops, 1);
  Media.last.dispatchEvent(new Event("stop"));
  assert.equal(await first, await second); assert.equal(tracksStopped, 1); recorder.cancel(); assert.equal(tracksStopped, 1);
  assert.equal(Media.last.listeners.size, 0);
});
test("cancel during Stop settles the pending result and rejects late chunks", async () => {
  reset(); Media.missingStop = true; const recorder = await createRecorder(); await recorder.start(); Media.last.data();
  const pending = recorder.stop(); recorder.cancel();
  assert.equal(await pending, null); Media.last.data("late"); Media.last.dispatchEvent(new Event("stop"));
  assert.equal(tracksStopped, 1); assert.equal(Media.last.listeners.size, 0);
});
test("abort remains effective after allocation and after recording starts", async () => {
  for (const start of [false, true]) {
    reset(); const ctl = new AbortController(); const recorder = await createRecorder({ signal: ctl.signal });
    if (start) await recorder.start(); ctl.abort(); assert.equal(tracksStopped, 1); assert.equal(Media.last.listeners.size, 0);
    await assert.rejects(recorder.start(), RecorderError); assert.equal(await recorder.stop(), null);
  }
});
test("stop failures and zero bytes finish without retaining listeners", async () => {
  for (const fail of [false, true]) {
    reset(); Media.stopFails = fail; const recorder = await createRecorder(); await recorder.start();
    assert.equal(await recorder.stop(), null); assert.equal(tracksStopped, 1); assert.equal(Media.last.listeners.size, 0);
  }
});

test("missing native stop/error events are bounded and detach all pending callbacks", async () => {
  const originalSet = globalThis.setTimeout; const originalClear = globalThis.clearTimeout;
  const deadlines = new Map<number, () => void>(); let next = 0;
  globalThis.setTimeout = ((fn: () => void) => { deadlines.set(++next, fn); return next; }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => deadlines.delete(Number(id))) as unknown as typeof clearTimeout;
  try {
    reset(); Media.missingStop = true; const recorder = await createRecorder(); await recorder.start(); Media.last.data();
    const pending = recorder.stop(); assert.equal(deadlines.size, 1);
    for (const expire of [...deadlines.values()]) expire();
    assert.equal(await pending, null); assert.equal(tracksStopped, 1); assert.equal(Media.last.listeners.size, 0); assert.equal(deadlines.size, 0);
    reset(); const errored = await createRecorder(); await errored.start(); Media.last.dispatchEvent(new Event("error"));
    assert.equal(await errored.stop(), null); assert.equal(tracksStopped, 1); assert.equal(Media.last.listeners.size, 0);
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});
