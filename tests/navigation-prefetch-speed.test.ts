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

test("only canonical learning section INDEX routes can warm on hover, focus or touch", () => {
  for (const path of [
    "/app/listening/lessons", "/app/listening/academic", "/app/listening/general",
    "/app/listening/mcq",
    "/app/reading/lessons", "/app/reading/academic", "/app/reading/general",
    "/app/reading/question-types",
    "/app/vocabulary", "/app/vocabulary/games",
    "/app/grammar/lessons", "/app/writing", "/app/speaking",
    "/app/speaking/lessons", "/app/speaking/practice",
  ]) {
    assert.equal(eligibleIntentTarget(path, origin, origin + "/app/listening/lessons"), path === "/app/listening/lessons" ? null : path, path);
  }
  // No automatic fetches for dynamic question banks, private answers or
  // query-driven learner state (including controlled Writing/Grammar tabs).
  for (const path of [
    "/app/listening/academic/123",
    "/app/listening/mcq/day/8",
    "/app/listening/general/123",
    "/app/reading/academic/123",
    "/app/reading/question-types/123",
    "/app/reading/retention", "/app/reading/retention/start",
    "/app/grammar/lessons/123",
    "/app/vocabulary/games/123",
    "/app/writing?tab=grade",
    "/app/grammar?tab=writing",
    "/app/vocabulary?tab=dictionary",
    "/app/reading/general?status=completed",
    "/app/speaking/ai", "/app/speaking/live-partner",
    "/app/owner", "/app/admin/reading/retention",
    "/api/reading/attempts/123",
  ]) assert.equal(eligibleIntentTarget(path, origin, current), null, path);
});

test("section tabs use the same bounded native-link intent prefetch as the sidebar", () => {
  const nav = read("src/components/navigation/ModuleSectionNav.tsx");
  assert.match(nav, /<InstantLink key=\{link\.key\} href=\{href\} scroll=\{false\} intentPrefetch/);
  assert.match(nav, /aria-current=\{selected \? "page"/);
  assert.match(nav, /nextTabIndex\(index, event\.key, links\.length\)/);
  assert.doesNotMatch(nav, /prefetch=\{true\}/, "no eager prefetch of every visible tab");
  const speaking = read("src/app/app/(shell)/speaking/page.tsx");
  assert.match(speaking, /<InstantLink href=\{href\} intentPrefetch/, "Speaking hub also shares fast navigation links");
  const writing = read("src/components/writing/workspace/WritingNav.tsx");
  assert.match(writing, /useOptionalInstantInteraction/);
  assert.match(writing, /interaction\?\.beginNavigation\(href\)/);
  assert.match(writing, /router\.push\(href, \{ scroll: false \}\)/, "preserve Writing tab scroll semantics");
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
