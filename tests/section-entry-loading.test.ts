import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";
import { workspaceKey } from "../src/lib/interaction/navigation";
import { sectionEntryFrames } from "../src/lib/interaction/section-entry";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const destinations: [string, string][] = [
  ["/app", "dashboard"],
  ["/app/live-classes", "live-classes"],
  ["/app/assignments", "assignments"],
  ["/app/listening", "listening"],
  ["/app/video-lessons", "video-lessons"],
  ["/app/reading", "reading"],
  ["/app/writing", "writing"],
  ["/app/speaking", "speaking"],
  ["/app/grammar", "grammar"],
  ["/app/vocabulary", "vocabulary"],
  ["/app/progress", "progress"],
  ["/app/mocks", "mocks"],
];

test("all required destinations have localized, route-shaped entry frames", () => {
  const english = sectionEntryFrames(en);
  const uzbek = sectionEntryFrames(uz);
  for (const [path, key] of destinations) {
    assert.equal(workspaceKey(path), key, `${path} resolves to its frame key`);
    assert.ok(english[key]?.title, `${key} has an English title`);
    assert.ok(uzbek[key]?.title, `${key} has an Uzbek title`);
    assert.ok(english[key]?.shape, `${key} has a route-specific skeleton shape`);
  }
  // PART 1 FINAL RETENTION ARCHITECTURE OVERRIDE V2 moves TED / PODCAST out of
  // the Reading hub into its own standalone section, so the Reading entry frame
  // has four tabs (academic, general, types, retention) — not five. The identity
  // of the removed tab is asserted too, so a silent re-add cannot pass.
  // Academic, General Reading (practice), IELTS General, Question types, Retention.
  assert.equal(english.reading?.tabs?.length, 5);
  assert.equal(uzbek.reading?.tabs?.length, 5);
  assert.ok(!english.reading?.tabs?.some((tab) => /TED|PODCAST/i.test(tab)));
  assert.ok(!uzbek.reading?.tabs?.some((tab) => /TED|PODCAST/i.test(tab)));
  assert.equal(english.vocabulary?.tabs?.length, 5);
  assert.equal(workspaceKey("/app/reading/attempts/private-id"), "reading");
  assert.equal(workspaceKey("/app/vocabulary/games/translation"), "vocabulary");
  assert.equal(workspaceKey("/app/courses/ielts/lessons/private-id"), "course-roadmap");
  assert.equal(workspaceKey("/app/coach"), "coach");
  assert.equal(workspaceKey("/app/notifications"), "notifications");
  assert.ok(english["course-roadmap"]?.title);
  assert.ok(english.coach?.title);
  assert.ok(english.notifications?.title);
  assert.ok(uzbek["course-roadmap"]?.title);
  assert.ok(uzbek.coach?.title);
  assert.ok(uzbek.notifications?.title);
  assert.equal(workspaceKey("/app/admin/users/private-id"), "management");
});

test("the private loading fallback is synchronous, route-aware, and performs no data/auth query", () => {
  const loading = read("src/app/app/(shell)/loading.tsx");
  const routeFallback = read("src/components/interaction/RouteEntryLoading.tsx");
  assert.match(loading, /export default function Loading\(\)/);
  assert.doesNotMatch(loading, /async function Loading|await |fetch\(|db\.|getCurrentUser/);
  assert.match(loading, /<RouteEntryLoading \/>/);
  assert.match(routeFallback, /usePathname\(\)/);
  assert.match(routeFallback, /workspaceKey\(pathname\)/);
  assert.match(routeFallback, /privateBoundary/);
  assert.doesNotMatch(routeFallback, /fetch\(|db\.|getCurrentUser/);
});

test("section frames expose destination identity and a local async region without replacing the product shell", () => {
  const frame = read("src/components/interaction/SectionEntryFrame.tsx");
  const outlet = read("src/components/interaction/InstantWorkspaceOutlet.tsx");
  const gate = read("src/app/app/layout.tsx"); // the /app namespace gate
  const layout = read("src/app/app/(shell)/layout.tsx"); // the ordinary shell chrome
  assert.match(frame, /data-entry-frame/);
  assert.match(frame, /data-section-entry-frame=\{routeKey\}/);
  assert.match(frame, /role="status"/);
  assert.match(frame, /aria-live="polite"/);
  assert.match(frame, /aria-busy="true"/);
  assert.match(frame, /data-async-loading=\{`entry-\$\{shape\}`\}/);
  assert.match(frame, /data-private-loading-boundary=\{privateBoundary \? "true"/);
  assert.match(outlet, /currentLocation === navigation\.from/);
  assert.match(outlet, /entryFrames\[navigation\.routeKey\]/);
  assert.match(outlet, /retryNavigation/);
  assert.match(gate, /Promise\.all\(\[getCurrentUser\(\), getLocale\(\)\]\)/);
  assert.match(gate, /hasPrivateAccess\(user\.accountStatus\)/);
  assert.match(layout, /<Sidebar/);
  assert.match(layout, /<Topbar/);
  assert.match(layout, /<InstantWorkspaceOutlet>\{children\}<\/InstantWorkspaceOutlet>/);
  assert.match(layout, /entryFrames=\{entryFrames\}/);
});

test("the entry fallback keeps server authorization authoritative while the client route intent remains instant", () => {
  const provider = read("src/components/interaction/InstantInteractionProvider.tsx");
  const diagnostics = read("src/components/diagnostics/PerformanceDiagnostics.tsx");
  const fallback = read("src/components/interaction/RouteEntryLoading.tsx");
  assert.match(provider, /router\.push\(href\)/);
  assert.doesNotMatch(provider, /history\.(pushState|replaceState)/);
  assert.match(provider, /setNavigation\(intent\)/);
  assert.match(fallback, /SectionEntryFrame[\s\S]*privateBoundary/);
  assert.match(diagnostics, /\[data-entry-frame\]/);
  assert.match(diagnostics, /\[data-async-loading\]/);
});
