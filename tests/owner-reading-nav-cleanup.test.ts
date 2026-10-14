import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Regression for 2026-10-14 owner screenshots. Source checks are release
 * safeguards; actual click latency still needs timed production-browser QA. */
function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("section navigation uses bounded hover/focus intent prefetch, never direct history mutation", () => {
  const nav = read("src/components/navigation/ModuleSectionNav.tsx");
  const link = read("src/components/interaction/InstantLink.tsx");
  assert.match(nav, /<InstantLink/);
  assert.match(nav, /intentPrefetch/);
  assert.doesNotMatch(nav, /prefetch=\{false\}/);
  assert.match(link, /IntentPrefetchBudget/);
  assert.match(link, /saveData/);
  assert.match(link, /router\.prefetch\(target\)/);
  assert.doesNotMatch(nav, /window\.history\.pushState/);
});

test("route pending message stays in the main workspace instead of a floating right-side toast", () => {
  const outlet = read("src/components/interaction/InstantWorkspaceOutlet.tsx");
  assert.doesNotMatch(outlet, /workspace-transition__notice/);
  assert.match(outlet, /data-workspace-loading data-navigation-pending/);
  assert.match(outlet, /data-workspace-content inert=\{pending \|\| undefined\}/);
});

test("104 published academic passages are listed alongside real formal sets without changing set membership", () => {
  const academic = read("src/app/app/(shell)/reading/academic/page.tsx");
  const general = read("src/app/app/(shell)/reading/general/page.tsx");
  const library = read("src/components/reading/ReadingLearningLibrary.tsx");
  assert.match(academic, /<ReadingLearningLibrary userId=\{user\.id\}/);
  assert.match(academic, /baseHref="\/app\/reading\/academic"/);
  assert.match(academic, /<AcademicSetsRegion/);
  assert.match(general, /<ReadingLearningLibrary userId=\{user\.id\}/);
  assert.ok(general.indexOf("<ReadingLearningLibrary") < general.indexOf("<SetsRegion"), "library renders before optional sets");
  assert.match(general, /if \(sets\.length === 0\) return null/);
  assert.match(library, /\$\{baseHref\}\?\$\{search\.toString\(\)\}/);
  assert.doesNotMatch(academic, /\{dict\.generalReading\.empty\}/, "no misleading General-empty message in Academic");
});

test("owner-requested text cleanup keeps accessibility heading and real navigation", () => {
  const listening = read("src/app/app/(shell)/listening/lessons/page.tsx");
  const reading = read("src/app/app/(shell)/reading/lessons/page.tsx");
  const retention = read("src/app/app/(shell)/reading/retention/page.tsx");
  const shell = read("src/components/shell/ModuleContextHeading.tsx");
  const breadcrumbs = read("src/components/shell/Breadcrumbs.tsx");
  const writing = read("src/app/app/(shell)/writing/page.tsx");
  const en = read("src/lib/i18n/en.ts");
  assert.match(listening, /<h1 className="sr-only">\{t\.title\}<\/h1>/);
  assert.doesNotMatch(reading, /data-reading-history-entry|\/app\/reading\/lessons\/author/);
  assert.doesNotMatch(retention, /<Link href="\/app\/reading"/);
  assert.doesNotMatch(en, /checked on the server, no AI guesswork/);
  assert.match(shell, /activeModule\.key === "writing"/);
  assert.match(breadcrumbs, /pathname === "\/app\/writing"/);
  assert.match(writing, /<h1 className="font-display text-2xl text-ink-900"/);
});
