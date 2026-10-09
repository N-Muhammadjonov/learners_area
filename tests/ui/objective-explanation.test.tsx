import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import en from "../../src/lib/i18n/en";
import { ObjectiveExplanation } from "../../src/components/riwi/ObjectiveExplanation";

const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Event"] as const) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const props = { domain: "reading" as const, attemptId: "aaaaaaaa-0000-4000-8000-000000000001", questionId: "aaaaaaaa-0000-4000-8000-000000000002", dict: en };
const result = { status: "explained", ...props, dict: undefined, question: "Question", userAnswer: "six", officialAnswer: "six", isCorrect: true, explanation: '<script>alert("inject")</script>', evidence: "The library closes at six.", method: "Use authored source.", provenance: { contractKey: "reading.short-answer", promptVersion: "v1", rubricVersion: "v1", providerId: "authored-source", model: null, sourceHash: "a".repeat(64), sourceBasis: "submission_snapshot" } };

test("explanation requires explicit click, sends IDs only, blocks duplicate dispatch and renders source as text", async () => {
  const root = createRoot(document.getElementById("root")!);
  let requests = 0;
  const oldFetch = globalThis.fetch;
  let finish!: (response: Response) => void;
  globalThis.fetch = (async (_url, init) => {
    requests++;
    assert.deepEqual(JSON.parse(String(init?.body)), { domain: props.domain, attemptId: props.attemptId, questionId: props.questionId });
    return new Promise<Response>(resolve => { finish = resolve; });
  }) as typeof fetch;
  try {
    await act(async () => root.render(<ObjectiveExplanation {...props} />));
    assert.equal(requests, 0);
    await act(async () => { document.querySelector<HTMLButtonElement>("button")!.click(); document.querySelector<HTMLButtonElement>("button")!.click(); });
    assert.equal(requests, 1);
    await act(async () => finish(Response.json(result)));
    assert.ok(document.body.textContent?.includes(result.explanation));
    assert.equal(document.querySelector("script"), null);
  } finally { await act(async () => root.unmount()); globalThis.fetch = oldFetch; }
});

test("late response after unmount is aborted and a server exam denial shows no answer", async () => {
  const root = createRoot(document.getElementById("root")!);
  const oldFetch = globalThis.fetch;
  let signal: AbortSignal | undefined;
  let finish!: (response: Response) => void;
  globalThis.fetch = (async (_url, init) => { signal = init?.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); }) as typeof fetch;
  try {
    await act(async () => root.render(<ObjectiveExplanation {...props} />));
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => root.unmount());
    assert.equal(signal?.aborted, true);
    await act(async () => finish(Response.json(result)));
    assert.equal(document.body.textContent?.includes("six"), false);
  } finally { globalThis.fetch = oldFetch; }
  const denialRoot = createRoot(document.getElementById("root")!);
  globalThis.fetch = async () => Response.json({ error: "locked" }, { status: 403 });
  try {
    await act(async () => denialRoot.render(<ObjectiveExplanation {...props} />));
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    assert.ok(document.body.textContent?.includes(en.objectiveExplanation.locked));
    assert.equal(document.body.textContent?.includes("six"), false);
  } finally { await act(async () => denialRoot.unmount()); globalThis.fetch = oldFetch; }
});
