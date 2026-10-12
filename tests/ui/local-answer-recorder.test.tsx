import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import uz from "../../src/lib/i18n/uz";

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: "http://localhost/app/speaking/practice" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLMediaElement", "Element", "Node", "Event"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { LocalAnswerRecorder } = await import("../../src/components/speaking/LocalAnswerRecorder");

class TestMediaRecorder extends dom.window.EventTarget {
  state = "inactive";
  mimeType = "audio/mp4";
  static isTypeSupported(mime: string) { return mime === "audio/mp4"; }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    const event = new dom.window.Event("dataavailable");
    Object.defineProperty(event, "data", { value: new Blob(["recorded answer"], { type: this.mimeType }) });
    this.dispatchEvent(event);
    this.dispatchEvent(new dom.window.Event("stop"));
  }
}
Object.defineProperty(window, "MediaRecorder", { value: TestMediaRecorder, configurable: true });
Object.defineProperty(globalThis, "MediaRecorder", { value: TestMediaRecorder, configurable: true });
const busy = () => undefined;
const q = (selector: string) => { const node = document.querySelector(selector); assert.ok(node, selector); return node; };
const click = async (selector: string) => act(async () => { (q(selector) as HTMLButtonElement).click(); });

test("deleting one question's recording releases its playback URL while preserving another question in EN and UZ", async () => {
  const originalFetch = globalThis.fetch;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  const paused: HTMLMediaElement[] = [];
  let stoppedTracks = 0;
  let created = 0;
  const endpoints: string[] = [];
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] }) } });
  dom.window.HTMLMediaElement.prototype.pause = function () { paused.push(this); };
  dom.window.HTMLMediaElement.prototype.load = function () {};
  URL.createObjectURL = () => `blob:answer-${++created}`;
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  globalThis.fetch = (async (input: RequestInfo | URL) => { endpoints.push(String(input)); return new Response("{}", { status: 200 }); }) as typeof fetch;
  try {
    for (const dict of [en, uz]) {
      document.body.innerHTML = '<div id="root"></div>';
      const root = createRoot(q("#root"));
      const render = (firstActive: boolean) => React.createElement(React.Fragment, null,
        React.createElement(LocalAnswerRecorder, { key: "a", dict, id: "a", part: "part1", active: firstActive, lockedBy: null, onBusyChange: busy }),
        React.createElement(LocalAnswerRecorder, { key: "b", dict, id: "b", part: "part1", active: !firstActive, lockedBy: null, onBusyChange: busy }));
      try {
        await act(async () => root.render(render(true)));
        await click('[data-local-recorder="a"] button');
        await click('[data-local-recorder="a"] button');
        const aAudio = q('[data-local-recorder="a"] audio') as HTMLAudioElement;
        const aUrl = aAudio.getAttribute("src")!;
        await act(async () => root.render(render(false)));
        assert.ok(paused.includes(aAudio), "selection change stops the previous question's playback");
        await click('[data-local-recorder="b"] button');
        await click('[data-local-recorder="b"] button');
        const bUrl = q('[data-local-recorder="b"] audio').getAttribute("src")!;
        assert.equal(q('[data-delete-recording="a"]').textContent, dict.speakingStudy.deleteRecording);
        await click('[data-delete-recording="a"]');
        assert.ok(revoked.includes(aUrl));
        assert.equal(aAudio.getAttribute("src"), null);
        assert.equal(document.querySelector('[data-local-recorder="a"] audio'), null);
        assert.equal(q('[data-local-recorder="b"] audio').getAttribute("src"), bUrl);
        assert.ok(!revoked.includes(bUrl));
        await act(async () => root.unmount());
        assert.ok(revoked.includes(bUrl), "unmount releases the remaining recording");
      } finally { await act(async () => root.unmount()); }
    }
    assert.equal(stoppedTracks, 4, "all microphone streams released on stop");
    assert.deepEqual(endpoints, Array(4).fill("/api/live-partner"), "local practice only updates presence and never creates or submits a server attempt");
  } finally {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("permission denial, missing microphone and unavailable recording show their actual EN and UZ cause and unlock recording", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  try {
    for (const dict of [en, uz]) for (const code of ["permission_denied", "no_microphone", "unsupported"] as const) {
      Object.defineProperty(window, "MediaRecorder", { value: code === "unsupported" ? undefined : TestMediaRecorder, configurable: true });
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { throw new DOMException("unavailable", code === "permission_denied" ? "NotAllowedError" : "NotFoundError"); } } });
      document.body.innerHTML = '<div id="root"></div>';
      const root = createRoot(q("#root"));
      const states: boolean[] = [];
      try {
        await act(async () => root.render(React.createElement(LocalAnswerRecorder, { dict, id: "error", part: "part1", lockedBy: null, onBusyChange: (_id: string, state: boolean) => states.push(state) })));
        await click('[data-local-recorder="error"] button');
        assert.equal(q('[role="alert"]').textContent, dict.speakingPractice.errors[code]);
        assert.equal(states.at(-1), false, "failed microphone acquisition releases the busy state");
        assert.equal(document.querySelector("audio"), null);
        assert.equal(q('[data-local-recorder="error"] button').textContent?.includes(dict.speakingStudy.record), true);
      } finally { await act(async () => root.unmount()); }
    }
  } finally {
    Object.defineProperty(window, "MediaRecorder", { value: TestMediaRecorder, configurable: true });
    globalThis.fetch = originalFetch;
  }
});

test("leaving while microphone permission is pending releases a late stream and never creates playback", async () => {
  const originalFetch = globalThis.fetch;
  let release: ((stream: unknown) => void) | undefined;
  let stopped = 0;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => new Promise((resolve) => { release = resolve; }) } });
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(q("#root"));
  try {
    await act(async () => root.render(React.createElement(LocalAnswerRecorder, { dict: en, id: "late", part: "part1", lockedBy: null, onBusyChange: busy })));
    await click('[data-local-recorder="late"] button');
    assert.ok(release);
    await act(async () => root.unmount());
    await act(async () => release!({ getTracks: () => [{ stop: () => { stopped += 1; } }] }));
    assert.equal(stopped, 1);
    assert.equal(document.querySelector("audio"), null);
  } finally { await act(async () => root.unmount()); globalThis.fetch = originalFetch; }
});

test("leaving during an active recording stops the microphone without uploading or creating playback", async () => {
  const originalFetch = globalThis.fetch;
  let stopped = 0;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped += 1; } }] }) } });
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(q("#root"));
  try {
    await act(async () => root.render(React.createElement(LocalAnswerRecorder, { dict: en, id: "active", part: "part1", lockedBy: null, onBusyChange: busy })));
    await click('[data-local-recorder="active"] button');
    assert.equal(q('[data-local-recorder="active"] button').textContent?.includes(en.speakingStudy.stop), true);
    assert.equal(stopped, 0);
    await act(async () => root.unmount());
    assert.equal(stopped, 1);
    assert.equal(document.querySelector("audio"), null);
  } finally { await act(async () => root.unmount()); globalThis.fetch = originalFetch; }
});
