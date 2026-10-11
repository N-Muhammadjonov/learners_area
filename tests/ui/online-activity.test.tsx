import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { OnlineActivity } from "../../src/components/shell/OnlineActivity";

const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Event"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("online heartbeat releases pending requests, intervals and listeners across repeated mounts", async () => {
  const originalFetch = globalThis.fetch;
  const originalInterval = window.setInterval; const originalClear = window.clearInterval;
  const timers = new Map<number, () => void>(); let next = 0;
  const signals: AbortSignal[] = [];
  window.setInterval = ((callback: () => void) => { timers.set(++next, callback); return next; }) as typeof window.setInterval;
  window.clearInterval = (id) => { timers.delete(Number(id)); };
  globalThis.fetch = ((_url, options) => {
    assert.equal(options?.method, "POST");
    const signal = options?.signal as AbortSignal; signals.push(signal);
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  }) as typeof fetch;
  try {
    for (let cycle = 0; cycle < 25; cycle++) {
      const root = createRoot(document.getElementById("root")!);
      await act(async () => root.render(<OnlineActivity />));
      const before = signals.length;
      for (const tick of timers.values()) tick();
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      assert.equal(signals.length, before, "pending heartbeats cannot overlap");
      await act(async () => root.unmount());
      assert.equal(timers.size, 0);
      assert.equal(signals.at(-1)!.aborted, true);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      assert.equal(signals.length, before, "unmounted listeners cannot send requests");
    }
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const before = signals.length;
    const root = createRoot(document.getElementById("root")!);
    await act(async () => root.render(<OnlineActivity />));
    for (const tick of timers.values()) tick();
    assert.equal(signals.length, before);
    await act(async () => root.unmount());
  } finally { globalThis.fetch = originalFetch; window.setInterval = originalInterval; window.clearInterval = originalClear; }
});


test("a hung heartbeat expires and permits a later online update without leaking timers", async () => {
  const originalFetch = globalThis.fetch;
  const originalInterval = window.setInterval; const originalClearInterval = window.clearInterval;
  const originalTimeout = window.setTimeout; const originalClearTimeout = window.clearTimeout;
  const intervals = new Map<number, () => void>(); const deadlines = new Map<number, () => void>();
  let next = 0; const signals: AbortSignal[] = [];
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  window.setInterval = ((callback: () => void) => { intervals.set(++next, callback); return next; }) as typeof window.setInterval;
  window.clearInterval = (id) => { intervals.delete(Number(id)); };
  window.setTimeout = ((callback: () => void, delay: number) => {
    assert.equal(delay, 15_000); deadlines.set(++next, callback); return next;
  }) as typeof window.setTimeout;
  window.clearTimeout = (id) => { deadlines.delete(Number(id)); };
  // Even a transport that never settles after abort must not block later ticks.
  globalThis.fetch = ((_url, options) => { signals.push(options!.signal as AbortSignal); return new Promise(() => {}); }) as typeof fetch;
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(<OnlineActivity />));
    assert.equal(signals.length, 1);
    assert.equal(deadlines.size, 1);
    for (const [id, expire] of deadlines) { deadlines.delete(id); expire(); }
    assert.equal(signals[0]!.aborted, true);
    for (const tick of intervals.values()) tick();
    assert.equal(signals.length, 2, "next heartbeat must recover from the hung transport");
    await act(async () => root.unmount());
    assert.equal(signals[1]!.aborted, true);
    assert.equal(intervals.size, 0);
    assert.equal(deadlines.size, 0);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    window.setInterval = originalInterval; window.clearInterval = originalClearInterval;
    window.setTimeout = originalTimeout; window.clearTimeout = originalClearTimeout;
  }
});

test("hidden and offline tabs send no heartbeat; visibility and connectivity resume it; closed tabs stay silent", async () => {
  const originalFetch = globalThis.fetch;
  const originalInterval = window.setInterval, originalClear = window.clearInterval;
  const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
  const timers = new Map<number, () => void>(); let next = 0, requests = 0;
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
  window.setInterval = ((callback: () => void) => { timers.set(++next, callback); return next; }) as typeof window.setInterval;
  window.clearInterval = id => { timers.delete(Number(id)); };
  globalThis.fetch = (async () => { requests++; return new Response(null, { status: 204 }); }) as typeof fetch;
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(<OnlineActivity />));
    for (const tick of timers.values()) tick();
    assert.equal(requests, 0, "offline tabs cannot extend the user's online clock");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("online"));
    for (const tick of timers.values()) tick();
    assert.equal(requests, 0, "connected background tabs remain inactive");
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    assert.equal(requests, 1);
    await act(async () => root.unmount());
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    for (const tick of timers.values()) tick();
    assert.equal(requests, 1);
    assert.equal(timers.size, 0);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch; window.setInterval = originalInterval; window.clearInterval = originalClear;
    if (onlineDescriptor) Object.defineProperty(navigator, "onLine", onlineDescriptor);
    else Reflect.deleteProperty(navigator, "onLine");
  }
});
