import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPrivateResourceCache,
  fetchPrivateJson,
  PrivateReadError,
  setPrivateResourceDiagnostics,
} from "../src/lib/client/private-resource";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ---------------------------------------------------------------- cache isolation

test("private cache keys include the user scope: user B never sees user A data", async () => {
  const cache = createPrivateResourceCache();
  cache.setScope("user-a");
  await cache.read("vocabulary:library", async () => ({ owner: "a" }), { maxAgeMs: 60_000 });
  assert.deepEqual(cache.peek("vocabulary:library")?.data, { owner: "a" });
  cache.setScope("user-b");
  assert.equal(cache.peek("vocabulary:library"), null);
  let loads = 0;
  const data = await cache.read("vocabulary:library", async () => { loads += 1; return { owner: "b" }; }, { maxAgeMs: 60_000 });
  assert.deepEqual(data, { owner: "b" });
  assert.equal(loads, 1);
});

test("logout (scope null) clears every private entry", async () => {
  const cache = createPrivateResourceCache();
  cache.setScope("user-a");
  cache.set("vocabulary:summary", { due: 3 });
  cache.set("vocabulary:folders", []);
  cache.setScope(null);
  assert.equal(cache.size(), 0);
  assert.equal(cache.peek("vocabulary:summary"), null);
});

test("without a scope nothing is stored", async () => {
  const cache = createPrivateResourceCache();
  await cache.read("vocabulary:library", async () => 1, { maxAgeMs: 60_000 });
  cache.set("x", 1);
  assert.equal(cache.size(), 0);
});

test("an in-flight read started for user A is discarded after an account switch", async () => {
  const cache = createPrivateResourceCache();
  cache.setScope("user-a");
  let release!: (value: string) => void;
  const pending = cache.read("vocabulary:library", () => new Promise<string>((resolve) => { release = resolve; }));
  cache.setScope("user-b");
  release("a-data");
  await pending;
  assert.equal(cache.peek("vocabulary:library"), null);
  assert.equal(cache.size(), 0);
});

test("fresh entries are reused, stale entries reload, force bypasses", async () => {
  let clock = 0;
  const cache = createPrivateResourceCache(() => clock);
  cache.setScope("u");
  let loads = 0;
  const loader = async () => ++loads;
  await cache.read("r", loader, { maxAgeMs: 100 });
  clock = 50;
  assert.equal(await cache.read("r", loader, { maxAgeMs: 100 }), 1);
  clock = 200;
  assert.equal(await cache.read("r", loader, { maxAgeMs: 100 }), 2);
  assert.equal(await cache.read("r", loader, { maxAgeMs: 100, force: true }), 3);
});

test("identical concurrent reads share one request (in-flight dedupe)", async () => {
  const cache = createPrivateResourceCache();
  cache.setScope("u");
  let loads = 0;
  const loader = () => new Promise<number>((resolve) => { loads += 1; setTimeout(() => resolve(7), 5); });
  const [a, b, c] = await Promise.all([cache.read("r", loader), cache.read("r", loader), cache.read("r", loader)]);
  assert.deepEqual([a, b, c], [7, 7, 7]);
  assert.equal(loads, 1);
});

test("different params are different keys (no over-dedupe)", async () => {
  const cache = createPrivateResourceCache();
  cache.setScope("u");
  let loads = 0;
  await Promise.all([cache.read("r?limit=50", async () => ++loads), cache.read("r?limit=100", async () => ++loads)]);
  assert.equal(loads, 2);
});

test("invalidation is narrow: only the matching resource prefix is dropped", () => {
  const cache = createPrivateResourceCache();
  cache.setScope("u");
  cache.set("vocabulary:library", 1);
  cache.set("vocabulary:summary", 2);
  cache.set("grammar:mastery", 3);
  cache.invalidate("vocabulary:");
  assert.equal(cache.peek("vocabulary:library"), null);
  assert.equal(cache.peek("vocabulary:summary"), null);
  assert.equal(cache.peek("grammar:mastery")?.data, 3);
});

test("a failed read is not cached and does not poison the key", async () => {
  const cache = createPrivateResourceCache();
  cache.setScope("u");
  await assert.rejects(cache.read("r", async () => { throw new Error("boom"); }));
  assert.equal(cache.peek("r"), null);
  assert.equal(await cache.read("r", async () => 5), 5);
});

// ---------------------------------------------------------------- bounded reads

test("a hung request reaches a terminal timeout state (never pending forever)", async () => {
  const hang: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  await withFetch(hang, async () => {
    await assert.rejects(fetchPrivateJson("/api/vocabulary", { timeoutMs: 20, retries: 0 }), (error: unknown) =>
      error instanceof PrivateReadError && error.kind === "timeout");
  });
});

test("transient failures retry a bounded number of times, then fail", async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; return json(503, { ok: false }); }, async () => {
    await assert.rejects(fetchPrivateJson("/api/vocabulary", { retries: 5, retryDelayMs: 1 }));
  });
  assert.equal(calls, 3, "retries are capped at MAX_RETRIES (2)");
});

test("a transient failure followed by success resolves", async () => {
  let calls = 0;
  const events: string[] = [];
  setPrivateResourceDiagnostics((entry) => events.push(entry.event));
  await withFetch(async () => (++calls === 1 ? json(502, {}) : json(200, { ok: true, n: 1 })), async () => {
    const payload = await fetchPrivateJson<{ n: number }>("/api/vocabulary", { retries: 1, retryDelayMs: 1 });
    assert.equal(payload.n, 1);
  });
  setPrivateResourceDiagnostics(null);
  assert.equal(calls, 2);
  assert.ok(events.includes("retry"));
});

for (const status of [400, 401, 403, 404, 409, 422, 500]) {
  test(`permanent status ${status} is never retried`, async () => {
    let calls = 0;
    let authCallbacks = 0;
    await withFetch(async () => { calls += 1; return json(status, { ok: false }); }, async () => {
      await assert.rejects(fetchPrivateJson("/api/vocabulary", { retries: 2, retryDelayMs: 1, onAuthFailure: () => { authCallbacks += 1; } }));
    });
    assert.equal(calls, 1);
    assert.equal(authCallbacks, status === 401 ? 1 : 0);
  });
}

test("Retention endpoints are refused by the private read cache", async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; return json(200, { ok: true }); }, async () => {
    await assert.rejects(fetchPrivateJson("/api/retention/attempts/abc"));
    await assert.rejects(fetchPrivateJson("/api/owner/retention/x"));
  });
  assert.equal(calls, 0);
});

// ---------------------------------------------------------------- source contracts

test("the cache is memory-only (no browser storage) and not used by Retention UI", () => {
  const source = read("src/lib/client/private-resource.ts");
  assert.doesNotMatch(source, /localStorage\.|sessionStorage\.|indexedDB|caches\.open/);
  for (const file of ["src/components/reading/RetentionSession.tsx", "src/components/reading/RetentionHistory.tsx"]) {
    assert.doesNotMatch(read(file), /private-resource/);
  }
});

test("authenticated layout binds the cache to the DB-verified user and logout clears it", () => {
  const gate = read("src/app/app/layout.tsx");
  assert.match(gate, /<PrivateResourceScope scope=\{user\.id\} \/>/);
  assert.ok(gate.indexOf("hasPrivateAccess(user.accountStatus)") < gate.indexOf("<PrivateResourceScope"));
  for (const file of ["src/components/shell/LogoutButton.tsx", "src/components/shell/ProfileMenu.tsx"]) {
    assert.match(read(file), /privateResources\.setScope\(null\)/);
  }
  assert.match(read("src/components/interaction/PrivateResourceScope.tsx"), /setScope\(null\)/);
});

test("Vocabulary views stay view-specific and bounded; revision queue is never cached", () => {
  const studio = read("src/components/vocabulary/VocabStudio.tsx");
  assert.match(studio, /LIBRARY_PAGE_SIZE = 50/);
  assert.match(studio, /offset=\$\{library\.words\.length\}/);
  assert.doesNotMatch(studio, /DUE_KEY|"vocabulary:due"/);
  assert.doesNotMatch(studio, /leaderboard/);
  assert.doesNotMatch(studio, /fetch\(url/);
  assert.match(studio, /privateResources\.invalidate\("vocabulary:"\)/);
});

test("vocabulary mutations invalidate only vocabulary resources, never a global refresh", () => {
  for (const file of [
    "src/components/vocabulary/ClickableText.tsx",
    "src/components/writing/AddVocabQuick.tsx",
    "src/components/vocabulary/VocabGamesPanel.tsx",
    "src/components/vocabulary/VocabUsePanel.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /privateResources\.invalidate\("vocabulary:"\)/, file);
    assert.doesNotMatch(source, /privateResources\.clear\(/, file);
  }
});

test("Retention links never prefetch and the hub reads run concurrently without allocation", () => {
  assert.match(read("src/app/app/(shell)/reading/page.tsx"), /href="\/app\/reading\/retention" prefetch=\{false\}/);
  assert.match(read("src/app/app/(shell)/dashboard/page.tsx"), /href="\/app\/reading\/retention" prefetch=\{false\}/);
  const page = read("src/app/app/(shell)/reading/retention/page.tsx");
  assert.match(page, /Promise\.all\(\[/);
  assert.doesNotMatch(page, /startRetentionAttempt|allocateAttempt|createAttempt|method: "POST"/);
  assert.match(page, /buildAttemptPayload\(live, new Date\(\), db\)/);
});
