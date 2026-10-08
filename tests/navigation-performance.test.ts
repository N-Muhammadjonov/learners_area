import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the private shell keeps the DB-backed account gate and does not await unread-count chrome", () => {
  // The gate is the parent of both /app groups; the shell layout below it owns chrome only.
  const gate = read("src/app/app/layout.tsx");
  const layout = read("src/app/app/(shell)/layout.tsx");
  assert.match(gate, /Promise\.all\(\[getCurrentUser\(\), getLocale\(\)\]\)/);
  assert.match(gate, /hasPrivateAccess\(user\.accountStatus\)/);
  assert.doesNotMatch(gate, /countUnread/);
  assert.doesNotMatch(layout, /countUnread/);
  assert.doesNotMatch(gate, /dynamic = "force-dynamic"/);
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
  const page = read("src/app/app/(shell)/grammar/page.tsx");
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
  assert.match(read("src/app/app/(shell)/grammar/[topicId]/page.tsx"), /Promise\.all\(\[\s*getTopicWithExercises\(topicId, user\.id\)/);
});

test("Dashboard streams its authenticated destination heading before account summary reads", () => {
  const page = read("src/app/app/(shell)/page.tsx");
  assert.match(page, /Promise\.all\(\[requireActiveUser\(\), getLocale\(\)\]\)/);
  assert.match(page, /data-route-usable="dashboard"/);
  assert.match(page, /data-async-loading="dashboard"/);
  assert.match(page, /<DashboardContent user=\{user\}/);
});

test("Progress streams the module destination before learner-owned summary queries finish", () => {
  const page = read("src/app/app/(shell)/progress/page.tsx");
  assert.match(page, /data-route-usable="progress"/);
  assert.match(page, /data-async-loading="progress"/);
  assert.match(page, /getProgressData\(userId\)/);
  assert.match(page, /getActivityStreak\(userId\)/);
  assert.doesNotMatch(page, /getDashboardData/);
  assert.match(page, /<ProgressContent userId=\{user\.id\}/);
});

test("Reading doorway needs no catalogue reads; General library keeps independent loading/failure regions", () => {
  const root=read("src/app/app/(shell)/reading/page.tsx");
  assert.match(root,/data-route-usable="reading"/);
  assert.doesNotMatch(root,/readingHubCounts|listLibrary|listLearningLibrary|listLibraryFacets/);
  const page=read("src/components/reading/ReadingLearningLibrary.tsx");
  assert.match(page,/const facetsPromise = captureRegion\(listLibraryFacets\(true\)\)/);
  assert.match(page,/const libraryPromise = captureRegion\(listLearningLibrary\(userId,\s*filter\)\)/);
  assert.match(page,/<Suspense fallback=\{<ReadingFiltersSkeleton dict=\{dict\} \/>\}>[\s\S]*ReadingFiltersRegion[\s\S]*facetsPromise=\{facetsPromise\}/);
  assert.match(page,/<Suspense fallback=\{<ReadingLibrarySkeleton \/>\}>[\s\S]*ReadingLibraryRegion[\s\S]*libraryPromise=\{libraryPromise\}/);
  assert.match(page,/RegionFailureNotice[\s\S]*reading-library-facets/);
  assert.match(page,/RegionFailureNotice[\s\S]*reading-library/);
  assert.match(page,/data-async-loading="reading-library-facets"/);
  assert.match(page,/data-async-loading="reading-library"/);
  assert.doesNotMatch(page,/Promise\.allSettled/);
});

test("Vocabulary streams its destination frame before authenticated, selected-view panel data resolves", () => {
  const page = read("src/app/app/(shell)/vocabulary/page.tsx");
  const studio = read("src/components/vocabulary/VocabStudio.tsx");
  assert.match(page, /data-route-usable="vocabulary"/);
  assert.match(page, /<VocabStudio/);
  assert.match(studio, /RegionSkeleton name="vocabulary-library"/);
  assert.match(studio, /readPrivateJson<[\s\S]*`\/api\/vocabulary\?limit=\$\{LIBRARY_PAGE_SIZE\}&offset=0`/);
  assert.match(page, /requireActiveUser\(\), getLocale\(\), searchParams/);
  assert.match(page, /if \(value === "games"\) redirect/);
});

test("Writing streams the entry header before its learner-summary reads", () => {
  const page = read("src/app/app/(shell)/writing/page.tsx");
  assert.match(page, /Promise\.all\(\[requireActiveUser\(\), getLocale\(\)\]\)/);
  assert.match(page, /data-route-usable="writing"/);
  assert.match(page, /data-async-loading="writing"/);
  // Typing now prepares its dedicated B1/B2 target through the authenticated API.
  assert.doesNotMatch(page, /timed\("writing\.modelTexts"/);
  assert.match(page, /timed\("writing\.typingSummary"/);
  assert.match(page, /<TypingTrainer/);
});

test("Listening doorway has no catalogue read; Speaking streams its material catalogue", () => {
  const listening = read("src/app/app/(shell)/listening/page.tsx");
  assert.match(listening, /Promise\.all\(\[requireActiveUser\(\), getLocale\(\), searchParams\]\)/);
  assert.match(listening, /data-route-usable="listening"/);
  assert.match(listening, /data-listening-destinations/);
  assert.doesNotMatch(listening, /from ["']@\/lib\/data\//, "doorway must not wait on a content catalogue");
  const speaking = read("src/app/app/(shell)/speaking/lessons/page.tsx");
  assert.match(speaking, /Promise\.all\(\[requireActiveUser\(\), getLocale\(\)\]\)/);
  assert.match(speaking, /data-route-usable=/);
  assert.match(speaking, /<Suspense fallback=/);
  assert.match(speaking, /<SpeakingMaterials/);
});

test("locale lookup is request-memoized", () => {
  const i18n = read("src/lib/i18n/index.ts");
  assert.match(i18n, /getLocale = cache\(async/);
});
