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
  ["/dashboard", "dashboard"],
  ["/live-classes", "live-classes"],
  ["/assignments", "assignments"],
  ["/listening", "listening"],
  ["/video-lessons", "video-lessons"],
  ["/reading", "reading"],
  ["/writing", "writing"],
  ["/speaking", "speaking"],
  ["/grammar", "grammar"],
  ["/vocabulary", "vocabulary"],
  ["/progress", "progress"],
  ["/mocks", "mocks"],
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
  assert.equal(english.reading?.tabs?.length, 5);
  assert.equal(english.vocabulary?.tabs?.length, 5);
  assert.equal(workspaceKey("/reading/attempts/private-id"), "reading");
  assert.equal(workspaceKey("/vocabulary/games/translation"), "vocabulary");
  assert.equal(workspaceKey("/admin/users/private-id"), "management");
});

test("the private loading fallback is synchronous, route-aware, and performs no data/auth query", () => {
  const loading = read("src/app/(app)/loading.tsx");
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
  const layout = read("src/app/(app)/layout.tsx");
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
  assert.match(layout, /Promise\.all\(\[getCurrentUser\(\), getLocale\(\)\]\)/);
  assert.match(layout, /hasPrivateAccess\(user\.accountStatus\)/);
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
