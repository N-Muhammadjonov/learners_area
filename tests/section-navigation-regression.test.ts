import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { internalNavigationTarget, routeLocation, workspaceKey } from "../src/lib/interaction/navigation";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

test("required section and nested-route clicks retain stable, privacy-safe destination keys", () => {
  const targets = [
    ["/dashboard", "dashboard"],
    ["/live-classes", "live-classes"],
    ["/assignments", "assignments"],
    ["/listening/history", "listening"],
    ["/video-lessons", "video-lessons"],
    ["/reading/attempts/attempt-private?mode=review", "reading"],
    ["/writing/history", "writing"],
    ["/speaking/practice", "speaking"],
    ["/grammar/topic-private", "grammar"],
    ["/vocabulary/games/translation", "vocabulary"],
    ["/progress", "progress"],
    ["/mocks", "mocks"],
  ] as const;
  for (const [href, key] of targets) {
    const intent = internalNavigationTarget(href, "https://learners.example", "/support");
    assert.equal(intent?.routeKey, key, href);
    assert.equal(workspaceKey(new URL(href, "https://learners.example").pathname), key, href);
  }
  const reading = internalNavigationTarget("/reading/attempts/attempt-private?mode=review", "https://learners.example", "/dashboard");
  assert.equal(reading?.href, "/reading/attempts/attempt-private?mode=review");
  assert.equal(reading?.routeKey, "reading", "private attempt ids never become metric/frame keys");
});

test("route intent preserves native external/new-tab/hash semantics and Next owns browser history", () => {
  assert.equal(internalNavigationTarget("https://external.example", "https://learners.example", "/dashboard"), null);
  assert.equal(internalNavigationTarget("/dashboard#top", "https://learners.example", "/dashboard"), null);
  assert.equal(routeLocation("/reading", "?page=2"), "/reading?page=2");
  const provider = read("src/components/interaction/InstantInteractionProvider.tsx");
  assert.match(provider, /router\.push\(href\)/);
  assert.doesNotMatch(provider, /history\.(pushState|replaceState)/);
  assert.match(provider, /window\.addEventListener\("popstate"/);
  assert.match(provider, /restoreScroll: true/);
});

test("destination frame appears on the click path, then yields to route content without unmounting shell chrome", () => {
  const provider = read("src/components/interaction/InstantInteractionProvider.tsx");
  const outlet = read("src/components/interaction/InstantWorkspaceOutlet.tsx");
  const frame = read("src/components/interaction/SectionEntryFrame.tsx");
  const layout = read("src/app/(app)/layout.tsx");
  assert.match(provider, /setNavigation\(intent\)/);
  assert.match(outlet, /currentLocation === navigation\.from/);
  assert.match(outlet, /if \(!pending \|\| !navigation\) return children/);
  assert.match(outlet, /entryFrames\[navigation\.routeKey\]/);
  assert.match(frame, /data-section-entry-frame=\{routeKey\}/);
  assert.match(layout, /<Sidebar/);
  assert.match(layout, /<Topbar/);
  assert.match(layout, /id="main-content"/);
});

test("back/forward scroll restoration, pending active nav, and fast click acknowledgement remain intact", () => {
  const provider = read("src/components/interaction/InstantInteractionProvider.tsx");
  const sidebar = read("src/components/shell/SidebarNav.tsx");
  const pending = read("src/components/shell/LinkPending.tsx");
  assert.match(provider, /saveMainScroll\(currentLocation\)/);
  assert.match(provider, /scrollPositions\.current\.get\(currentLocation\)/);
  assert.match(provider, /else if \(main\) main\.scrollTop = 0/);
  assert.match(sidebar, /activePath = pendingPath \?\? pathname/);
  assert.match(sidebar, /aria-current=\{active \? "page"/);
  assert.match(pending, /NAVIGATION_FEEDBACK_DELAY_MS/);
});
