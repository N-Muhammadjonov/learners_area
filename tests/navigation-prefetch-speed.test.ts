import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  eligibleIntentTarget,
  IDLE_SHELL_PREFETCH_ROUTES,
  IntentPrefetchBudget,
} from "../src/lib/interaction/intent-prefetch";

const origin = "https://learnersarea.uz";
const current = origin + "/app";
const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("canonical sidebar module landing routes prefetch without an extra redirect", () => {
  for (const target of [
    "/app/reading/lessons", "/app/listening/lessons",
    "/app/grammar/lessons", "/app/vocabulary", "/app/writing",
    "/app/speaking", "/app/video-lessons", "/app/progress",
  ]) {
    assert.equal(eligibleIntentTarget(target, origin, current), target, target);
  }
  assert.equal(eligibleIntentTarget("/app/reading", origin, current), null, "do not prefetch redirect doorway");
  assert.equal(eligibleIntentTarget("/app/listening", origin, current), null, "do not prefetch redirect doorway");
  assert.equal(eligibleIntentTarget("/app/grammar", origin, current), null, "do not prefetch redirect doorway");
  assert.equal(eligibleIntentTarget("/app", origin, current), null, "never prefetch current route");
});

test("prefetch never warms private attempts, answers, admin, external or parameterized routes", () => {
  for (const url of [
    "/app/reading/attempts/00000000-0000-0000-0000-000000000001",
    "/app/listening/tests/00000000-0000-0000-0000-000000000001",
    "/app/listening/attempts/00000000-0000-0000-0000-000000000001",
    "/app/reading/academic/00000000-0000-0000-0000-000000000001",
    "/app/admin", "/app/admin/content",
    "/api/auth/me", "/api/listening/attempts",
    "/app/reading/lessons?page=2",
    "/app/reading/lessons#evidence",
    "https://other.example/app/reading/lessons",
  ]) {
    assert.equal(eligibleIntentTarget(url, origin, current), null, url);
  }
  assert.deepEqual(IDLE_SHELL_PREFETCH_ROUTES, [
    "/app/reading/lessons", "/app/listening/lessons",
  ], "idle warmup remains small and contains no authored/attempt resources");
});

test("prefetch budget limits duplicate fetches, rate and count, expiring in one minute", () => {
  const budget = new IntentPrefetchBudget();
  assert.equal(budget.take("/app/listening/lessons", 1000), true);
  assert.equal(budget.take("/app/listening/lessons", 3000), false, "repeat suppressed");
  assert.equal(budget.take("/app/reading/lessons", 1500), false, "rate limit 750ms");
  assert.equal(budget.take("/app/reading/lessons", 1900), true);
  for (let i = 0; i < 4; i++) assert.equal(budget.take("/app/other-" + i, 3000 + i * 900), true);
  assert.equal(budget.take("/app/seventh", 8000), false, "max six per minute");
  assert.equal(budget.take("/app/listening/lessons", 61001), true, "budget expires");
});

test("mobile tap primes only whitelisted routes, shell idle warmup is DB gated", () => {
  const link = read("src/components/interaction/InstantLink.tsx");
  assert.match(link, /onTouchStart=\{\(event\)/, "mobile Safari touch uses intent prefetch");
  assert.match(link, /onPointerDown=\{\(event\)/);
  assert.match(link, /eligibleIntentTarget\(props\.href/);
  assert.match(link, /sharedIntentPrefetchBudget\.take/);
  assert.match(link, /prefetch=\{prefetch \?\? false\}/, "no global viewport prefetch flood");
  const warmup = read("src/components/interaction/IdleShellPrefetch.tsx");
  assert.match(warmup, /navigator\.onLine/);
  assert.match(warmup, /connection\?\.saveData/);
  assert.match(warmup, /document\.visibilityState/);
  assert.match(warmup, /setTimeout\(warmNext, 2500\)/);
  assert.match(warmup, /sharedIntentPrefetchBudget\.take/);
  assert.doesNotMatch(warmup, /localStorage|sessionStorage|indexedDB/);
  const shell = read("src/app/app/(shell)/layout.tsx");
  assert.match(shell, /<IdleShellPrefetch \/>/);
  const gate = read("src/app/app/layout.tsx");
  assert.match(gate, /getCurrentUser\(\)/);
  assert.match(gate, /hasPrivateAccess\(user\.accountStatus\)/);
  assert.match(shell, /<InstantWorkspaceOutlet>\{children\}<\/InstantWorkspaceOutlet>/);
});
