import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the private shell keeps the DB-backed account gate and does not await unread-count chrome", () => {
  const layout = read("src/app/(app)/layout.tsx");
  assert.match(layout, /Promise\.all\(\[getCurrentUser\(\), getLocale\(\)\]\)/);
  assert.match(layout, /hasPrivateAccess\(user\.accountStatus\)/);
  assert.doesNotMatch(layout, /countUnread/);
  assert.doesNotMatch(layout, /dynamic = "force-dynamic"/);

  const bell = read("src/components/shell/NotificationBell.tsx");
  assert.match(bell, /void refresh\(\)/);
  assert.match(bell, /\/api\/notifications\?count=1/);
});

test("navigation acknowledges the destination immediately without replacing Next history", () => {
  const provider = read("src/components/interaction/InstantInteractionProvider.tsx");
  const nav = read("src/components/shell/SidebarNav.tsx");
  const outlet = read("src/components/interaction/InstantWorkspaceOutlet.tsx");
  const link = read("src/components/interaction/InstantLink.tsx");

  assert.match(provider, /setNavigation\(intent\)/);
  assert.match(provider, /firstResponsePaintOpportunity/);
  assert.match(provider, /destinationRouteCommit/);
  assert.match(provider, /window\.addEventListener\("popstate"/);
  assert.doesNotMatch(provider, /history\.(pushState|replaceState)/);
  assert.match(nav, /activePath = pendingPath \?\? pathname/);
  assert.match(nav, /aria-current=\{active \? "page"/);
  assert.match(outlet, /data-workspace-content inert=\{pending \|\| undefined\}>\{children\}/);
  assert.match(outlet, /role="status" aria-live="polite"/);
  assert.match(outlet, /onClick=\{retryNavigation\}/);
  assert.match(outlet, /navigation\.routeKey/);
  assert.match(link, /prefetch=\{prefetch \?\? false\}/);
});

test("back and forward restore main scroll while ordinary links start at the top", () => {
  const provider = read("src/components/interaction/InstantInteractionProvider.tsx");
  assert.match(provider, /scrollPositions = useRef\(new Map<string, number>\(\)\)/);
  assert.match(provider, /saveMainScroll\(currentLocation\)/);
  assert.match(provider, /restoreScroll: true/);
  assert.match(provider, /scrollPositions\.current\.size > 100/);
  assert.match(provider, /main\.scrollTop = scrollPositions\.current\.get\(currentLocation\) \?\? 0/);
  assert.match(provider, /else if \(main\) main\.scrollTop = 0/);
});

test("route feedback is distinct from a usable view; browser diagnostics wait for loading regions", () => {
  const provider = read("src/components/interaction/InstantInteractionProvider.tsx");
  const diagnostics = read("src/components/diagnostics/PerformanceDiagnostics.tsx");
  const loading = read("src/components/interaction/SectionEntryFrame.tsx");
  assert.match(provider, /destinationRouteCommit/);
  assert.doesNotMatch(provider, /metric\("viewUsable"/);
  assert.match(diagnostics, /\[data-route-loading\]/);
  assert.match(diagnostics, /\[data-workspace-loading\]/);
  assert.match(diagnostics, /clickToUsableViewMs/);
  assert.match(diagnostics, /asyncDataCompletion/);
  assert.match(diagnostics, /clickToDataCompletionMs/);
  assert.match(diagnostics, /data-async-loading/);
  assert.match(diagnostics, /total_interaction_ms/);
  assert.match(loading, /data-private-loading-boundary/);
});

test("Grammar streams its destination heading before its authorized mastery data", () => {
  const page = read("src/app/(app)/grammar/page.tsx");
  const data = read("src/lib/data/grammar.ts");
  assert.match(page, /requireActiveUser\(\), getLocale\(\)/);
  assert.match(page, /data-route-usable="grammar"/);
  assert.match(page, /<Suspense fallback=\{<GrammarTopicsSkeleton \/>\}>/);
  assert.match(page, /<GrammarTopics userId=\{user\.id\}/);
  assert.match(data, /Promise\.allSettled\(\[\s*timed\("grammar\.topics"/);
  assert.match(data, /timed\("grammar\.exercises"/);
  assert.match(data, /timed\("grammar\.attempts"/);
  assert.match(data, /innerJoin\(grammarExercises/);
  assert.match(data, /eq\(grammarAttempts\.userId, userId\), grammarVisibleTo\(userId\)/);
  assert.match(data, /eq\(grammarExercises\.topicId, topicId\),\s*grammarVisibleTo\(userId\)/);
  assert.match(read("src/app/(app)/grammar/[topicId]/page.tsx"), /Promise\.all\(\[\s*getTopicWithExercises\(topicId, user\.id\)/);
});

test("Dashboard streams its authenticated destination heading before account summary reads", () => {
  const page = read("src/app/(app)/dashboard/page.tsx");
  assert.match(page, /Promise\.all\(\[requireActiveUser\(\), getLocale\(\)\]\)/);
  assert.match(page, /data-route-usable="dashboard"/);
  assert.match(page, /data-async-loading="dashboard"/);
  assert.match(page, /<DashboardContent user=\{user\}/);
});

test("Progress streams the module destination before learner-owned summary queries finish", () => {
  const page = read("src/app/(app)/progress/page.tsx");
  assert.match(page, /data-route-usable="progress"/);
  assert.match(page, /data-async-loading="progress"/);
  assert.match(page, /getProgressData\(userId\)/);
  assert.match(page, /getActivityStreak\(userId\)/);
  assert.doesNotMatch(page, /getDashboardData/);
  assert.match(page, /<ProgressContent userId=\{user\.id\}/);
});

test("Reading streams counts, facets, and the selected library through independent loading regions", () => {
  const page = read("src/app/(app)/reading/page.tsx");
  assert.match(page, /data-route-usable="reading"/);
  assert.match(page, /<ReadingWorkspace userId=\{user\.id\}/);
  assert.match(page, /const countsPromise = captureRegion\(readingHubCounts\(userId\)\)/);
  assert.match(page, /captureRegion\(listLibraryFacets\(true\)\)/);
  assert.match(page, /captureRegion\(listLearningLibrary\(userId, filter\)\)/);
  assert.match(page, /data-async-loading="reading-hub-counts"/);
  assert.match(page, /data-async-loading="reading-library-facets"/);
  assert.match(page, /data-async-loading="reading-library"/);
  assert.doesNotMatch(page, /Promise\.allSettled/);
});

test("Vocabulary streams its destination frame before authenticated, selected-view panel data resolves", () => {
  const page = read("src/app/(app)/vocabulary/page.tsx");
  const studio = read("src/components/vocabulary/VocabStudio.tsx");
  assert.match(page, /data-route-usable="vocabulary"/);
  assert.match(page, /<VocabStudio/);
  assert.match(studio, /RegionSkeleton name="vocabulary-library"/);
  assert.match(studio, /readPrivateJson<[\s\S]*`\/api\/vocabulary\?limit=\$\{LIBRARY_PAGE_SIZE\}&offset=0`/);
  assert.match(page, /requireActiveUser\(\), getLocale\(\), searchParams/);
  assert.match(page, /if \(value === "games"\) redirect/);
});

test("Writing streams the entry header before its independent prompt and learner-summary reads", () => {
  const page = read("src/app/(app)/writing/page.tsx");
  assert.match(page, /Promise\.all\(\[requireActiveUser\(\), getLocale\(\)\]\)/);
  assert.match(page, /data-route-usable="writing"/);
  assert.match(page, /data-async-loading="writing"/);
  // Typing reads Band 8–9 model texts, not prompts (owner spec §41).
  assert.match(page, /timed\("writing\.modelTexts"/);
  assert.match(page, /timed\("writing\.typingSummary"/);
});

test("Listening and Speaking stream useful module headers before catalogue reads", () => {
  const listening = read("src/app/(app)/listening/page.tsx");
  // The Speaking material catalogue moved from the hub to Speaking lessons
  // (owner spec §26–28); the streaming invariant follows the catalogue.
  const speaking = read("src/app/(app)/speaking/lessons/page.tsx");
  for (const page of [listening, speaking]) {
    assert.match(page, /Promise\.all\(\[requireActiveUser\(\), getLocale\(\)\]\)/);
    assert.match(page, /data-route-usable=/);
    assert.match(page, /<Suspense fallback=/);
  }
  assert.match(listening, /<ActiveListeningTests/);
  assert.match(speaking, /<SpeakingMaterials/);
});

test("locale lookup is request-memoized", () => {
  const i18n = read("src/lib/i18n/index.ts");
  assert.match(i18n, /getLocale = cache\(async/);
});
