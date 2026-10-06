import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

test("Dashboard summary widgets isolate query failures and the deep roadmap is a separate streamed region", () => {
  const data = read("src/lib/data/dashboard.ts");
  const page = read("src/app/app/(shell)/dashboard/page.tsx");
  const summary = data.slice(data.indexOf("export async function getDashboardData"), data.indexOf("export async function getDashboardOpenLessons"));
  assert.match(summary, /Promise\.allSettled/);
  assert.match(summary, /unavailable: \{/);
  assert.match(summary, /targetBand: onboardingProfiles\.targetBand/);
  assert.match(summary, /weaknesses: evaluations\.weaknesses/);
  assert.match(summary, /id: assignments\.id,[\s\S]*dueAt: assignments\.dueAt/);
  assert.match(summary, /openAssignments:[\s\S]*: null/);
  assert.doesNotMatch(summary, /getCourseRoadmap/);
  assert.match(page, /<Suspense fallback=\{<DashboardOpenLessonsSkeleton \/>\}>/);
  assert.match(page, /const openLessonsPromise = getDashboardOpenLessons\(user\.id\)/);
  assert.match(page, /DashboardOpenLessons openLessonsPromise=\{openLessonsPromise\}/);
  assert.match(page, /await openLessonsPromise/);
  assert.match(page, /RegionFailureNotice[\s\S]*dashboard-open-lessons/);
  assert.match(page, /data-tasks-unavailable/);
});

test("Grammar keeps the topic catalogue usable when learner mastery history fails", () => {
  const data = read("src/lib/data/grammar.ts");
  const page = read("src/app/app/(shell)/grammar/page.tsx");
  const detail = read("src/app/app/(shell)/grammar/[topicId]/page.tsx");
  assert.match(data, /Promise\.allSettled\(\[[\s\S]*grammar\.topics[\s\S]*grammar\.exercises[\s\S]*grammar\.attempts/);
  assert.match(data, /if \(topicsResult\.status === "rejected"\) throw/);
  assert.match(data, /if \(exercisesResult\.status === "rejected"\) throw/);
  assert.match(data, /masteryUnavailable: attemptsResult\.status === "rejected"/);
  assert.match(page, /RegionFailureNotice[\s\S]*grammar-mastery/);
  assert.match(page, /data-topic-mastery-unavailable/);
  assert.match(page, /data-async-loading="grammar-topics"/);
  assert.match(detail, /<Suspense fallback=\{<GrammarMaterialsSkeleton \/>\}>/);
  assert.ok(detail.indexOf("const blocksPromise = listResourceBlocks") < detail.indexOf("const [detail, topicMastery]"), "optional material query starts before detail/mastery resolves");
  assert.match(detail, /GrammarMaterials blocksPromise=\{blocksPromise\}/);
  assert.match(detail, /RegionFailureNotice[\s\S]*grammar-topic-mastery/);
  assert.doesNotMatch(detail, /OwnerMaterialBlocks/);
  assert.match(detail, /inArray\(writingSubmissions\.id, sourceIds\)/);
});

test("Assignments keep assignment rows core and batch learner responses instead of N per-card reads", () => {
  const page = read("src/app/app/(shell)/assignments/page.tsx");
  const data = read("src/lib/data/coach-artifacts.ts");
  const board = read("src/components/coach/AssignmentBoard.tsx");
  assert.match(page, /assignments\.entry\.core/);
  assert.match(page, /Promise\.allSettled\(\[[\s\S]*assignments\.entry\.evaluations[\s\S]*assignments\.entry\.responses[\s\S]*assignments\.entry\.materials/);
  assert.match(page, /RegionFailureNotice[\s\S]*assignment-evaluations/);
  assert.match(page, /RegionFailureNotice[\s\S]*assignment-responses/);
  assert.match(page, /RegionFailureNotice[\s\S]*assignment-materials/);
  assert.match(page, /metadataUnavailable=\{evaluationsUnavailable \|\| responsesUnavailable\}/);
  assert.match(board, /metadataUnavailable \? \([\s\S]*data-assignment-metadata-unavailable[\s\S]*\) : assignment\.evaluation \?/);
  assert.match(page, /id: assignments\.id,[\s\S]*title: assignments\.title,[\s\S]*dueAt: assignmentTargets\.dueAt/);
  // A learner's tasks come from the TARGETS table: reading `assignments.target_user_id`
  // would hide the task from every student except the first one it was set for.
  assert.match(page, /innerJoin\(assignments, eq\(assignments\.id, assignmentTargets\.assignmentId\)\)/);
  assert.match(page, /eq\(assignmentTargets\.studentUserId, user\.id\)/);
  assert.match(page, /listAssignmentResponses\(ids, user\.id\)/);
  assert.doesNotMatch(page, /rows\.map\(async[\s\S]*getAssignmentResponse/);
  const batch = data.slice(data.indexOf("export function listAssignmentResponses"), data.indexOf("\n}", data.indexOf("export function listAssignmentResponses")));
  assert.match(batch, /if \(assignmentIds\.length === 0\)/);
  assert.match(batch, /inArray\(assignmentResponses\.assignmentId, assignmentIds\)/);
  assert.match(batch, /eq\(assignmentResponses\.userId, userId\)/);
  assert.match(batch, /findMany/);
});

test("Live Classes exposes core classes while optional teacher and resource queries fail locally", () => {
  const page = read("src/app/app/(shell)/live-classes/page.tsx");
  assert.match(page, /const \[ielts, upcomingRows, pastRows\] = await Promise\.all\(/);
  assert.match(page, /courses\.slug, "ielts"\)[\s\S]*inArray\(liveClasses\.status, \["upcoming", "live"\]\)/);
  assert.match(page, /courses\.slug, "ielts"\)[\s\S]*inArray\(liveClasses\.status, \["completed", "recorded", "cancelled"\]\)[\s\S]*\.limit\(10\)/);
  assert.match(page, /Promise\.allSettled\(\[[\s\S]*liveClasses\.entry\.attendance[\s\S]*liveClasses\.entry\.teachers[\s\S]*liveClasses\.entry\.materials/);
  assert.match(page, /teachersResult\.status === "fulfilled"/);
  assert.match(page, /materialsResult\.status === "fulfilled"/);
  assert.match(page, /RegionFailureNotice[\s\S]*live-class-metadata/);
  assert.match(page, /data-route-usable="live-classes"/);
  assert.match(page, /data-async-loading="live-classes"/);
  for (const field of ["id", "teacherUserId", "title", "topic", "scheduledAt", "durationMinutes", "meetingUrl", "recordingUrl", "status"]) {
    assert.match(page, new RegExp(`liveClasses\\.${field}`), `upcoming and past lists explicitly select ${field}`);
  }
  assert.doesNotMatch(page, /select\(\{ liveClass: liveClasses \}/);
});

test("Reading streams counts, facets, and selected library independently with local failure notices", () => {
  const page = read("src/app/app/(shell)/reading/page.tsx");
  assert.match(page, /const countsPromise = captureRegion\(readingHubCounts\(userId\)\)/);
  // The accepted base already reads facets with the learning-library flag and streams
  // the learning library itself; the invariant under test is that EACH region is its
  // own captured promise, so the assertions name the calls the page really makes.
  assert.match(page, /tab === "general-reading" \|\| tab === "types"[\s\S]*captureRegion\(listLibraryFacets\(true\)\)/);
  assert.match(page, /tab === "general-reading"[\s\S]*captureRegion\(listLearningLibrary\(userId, filter\)\)/);
  assert.match(page, /<Suspense fallback=\{<ReadingCountsSkeleton dict=\{dict\} \/>\}>[\s\S]*ReadingCountsRegion countsPromise=\{countsPromise\}/);
  assert.match(page, /<Suspense fallback=\{<ReadingFiltersSkeleton dict=\{dict\} \/>\}>[\s\S]*ReadingFiltersRegion[\s\S]*facetsPromise=\{facetsPromise\}/);
  assert.match(page, /<Suspense fallback=\{<ReadingLibrarySkeleton \/>\}>[\s\S]*ReadingLibraryRegion[\s\S]*libraryPromise=\{libraryPromise\}/);
  assert.match(page, /RegionFailureNotice[\s\S]*reading-hub-counts/);
  assert.match(page, /RegionFailureNotice[\s\S]*reading-library-facets/);
  assert.match(page, /RegionFailureNotice[\s\S]*reading-library/);
  assert.doesNotMatch(page, /Promise\.allSettled/);
});

test("Writing prompt entry does not wait for typing stats; the typing region catches and retries locally", () => {
  const page = read("src/app/app/(shell)/writing/page.tsx");
  const writingData = read("src/lib/data/writing.ts");
  const activities = page.slice(page.indexOf("async function WritingActivities"), page.indexOf("function WritingActivitiesSkeleton"));
  // The trainer prepares its own target through the authenticated API, so the entry must
  // NOT read Band 8–9 model texts on the server any more: that was the older typing
  // target, replaced by the dedicated B1/B2 corpus (learners-area-next). What this test
  // is about — the region never blocks the prompt entry and fails locally — is unchanged.
  assert.doesNotMatch(activities, /timed\("writing\.modelTexts"/, "the typing target is no longer a model-text read");
  assert.match(page, /<TypingTrainer/, "the trainer is rendered by the typing region");
  assert.match(activities, /<Suspense fallback=\{<TypingRegionSkeleton \/>\}>/);
  assert.match(activities, /const typingPromise = timed\("writing\.typingSummary"/);
  assert.ok(activities.indexOf("const typingPromise") < activities.indexOf("<WritingTypingRegion"), "the summary starts before the region renders");
  assert.match(activities, /WritingTypingRegion typingPromise=\{typingPromise\}/);
  assert.doesNotMatch(activities, /Promise\.all\([\s\S]*typingSummary/);
  assert.match(page, /async function WritingTypingRegion[\s\S]*await typingPromise[\s\S]*if \(!result\.ok\)[\s\S]*RegionFailureNotice/);
  assert.match(page, /data-region-retry="writing-typing-summary"|region="writing-typing-summary"/);
  const activePromptQuery = writingData.slice(writingData.indexOf("export async function listActivePromptsWithResources"), writingData.indexOf("export async function getSubmissionDetail"));
  assert.match(activePromptQuery, /id: writingPrompts\.id,[\s\S]*category: writingPrompts\.category,[\s\S]*taskType: writingPrompts\.taskType,[\s\S]*targetWordCount: writingPrompts\.targetWordCount/);
  assert.doesNotMatch(activePromptQuery, /prompt: writingPrompts[, }]/);
});

test("Speaking loads only blocks attached to the current materials and surfaces block-query failure", () => {
  const data = read("src/lib/data/speaking.ts");
  const page = read("src/app/app/(shell)/speaking/lessons/page.tsx"); // catalogue moved off the hub (§26–28)
  assert.match(data, /where: inArray\(materialBlocks\.materialId, ids\)/);
  assert.doesNotMatch(data, /materialBlocks\.findMany\(\{\s*orderBy/);
  assert.match(data, /blocksUnavailable: true/);
  assert.match(data, /listActiveMaterialsForEntry[\s\S]*blocksPromise: withBlocks\(rows\)/);
  assert.match(page, /listActiveMaterialsForEntry\(\)/);
  assert.match(page, /SpeakingBlocksStatus[\s\S]*await blocksPromise/);
  assert.match(page, /SpeakingMaterialBlocks[\s\S]*blocksPromise/);
  assert.match(page, /<Suspense fallback=\{<SpeakingBlocksSkeleton \/>\}>[\s\S]*SpeakingBlocksStatus/);
  assert.match(page, /RegionFailureNotice[\s\S]*speaking-material-blocks/);
});

test("Progress no longer waits for the whole Dashboard and aggregates historical attempt rows in SQL", () => {
  const page = read("src/app/app/(shell)/progress/page.tsx");
  const data = read("src/lib/data/progress.ts");
  assert.match(page, /getProgressData\(userId\)/);
  assert.match(page, /getActivityStreak\(userId\)/);
  assert.doesNotMatch(page, /getDashboardData/);
  assert.match(page, /Promise\.allSettled/);
  assert.match(data, /Promise\.allSettled\(\[/);
  assert.match(data, /unavailableRegions/);
  assert.match(page, /data\.unavailableRegions\.map/);
  assert.match(data, /count\(\*\) filter \(where \$\{readingAttempts\.status\} = 'completed'\)/);
  assert.match(data, /count\(\*\) filter \(where \$\{speakingAttempts\.transcriptProvider\} is not null\)/);
  assert.doesNotMatch(data, /readingRows\.length|listeningRows\.length|speakingRows\.filter/);
});

test("Roadmap queries units and lessons for the selected course tree, not every course's rows", () => {
  const roadmap = read("src/lib/data/roadmap.ts");
  assert.match(roadmap, /inArray\(units\.moduleId, moduleIds\)/);
  assert.match(roadmap, /inArray\(lessons\.unitId, unitIds\)/);
  assert.match(roadmap, /innerJoin\(lessons, eq\(lessonProgress\.lessonId, lessons\.id\)\)/);
  assert.match(roadmap, /where\(and\(eq\(lessonProgress\.userId, userId\), inArray\(lessons\.unitId, unitIds\)\)\)/);
  assert.match(roadmap, /Promise\.all\(\[[\s\S]*relevantLessons[\s\S]*lessonProgress/);
  assert.doesNotMatch(roadmap, /const allUnits|const allLessons/);
});

test("Mocks catalogue, attempts, and title metadata fail in separate regions", () => {
  const page = read("src/app/app/(shell)/mocks/page.tsx");
  const data = read("src/lib/data/mocks.ts");
  assert.match(page, /data\.catalogueUnavailable/);
  assert.match(page, /data\.attemptsUnavailable/);
  assert.match(page, /data\.attemptTitlesUnavailable/);
  assert.match(page, /data-async-loading="mocks"/);
  assert.match(data, /Promise\.allSettled\(\[[\s\S]*mocks\.entry\.course[\s\S]*mocks\.entry\.attempts/);
  assert.match(data, /mocks\.entry\.catalogue/);
  assert.match(data, /mocks\.entry\.attemptTitles/);
  assert.match(data, /attemptTestIds/);
  assert.match(data, /id: mockAttempts\.id,[\s\S]*mockTestId: mockAttempts\.mockTestId,[\s\S]*estimatedBand: mockAttempts\.estimatedBand/);
  assert.match(data, /select\(\{ id: mockTests\.id, title: mockTests\.title, skill: mockTests\.skill \}\)/);
});

test("Listening and Video entry reads are server-authorized, published, and limited to list-card fields", () => {
  const listeningPage = read("src/app/app/(shell)/listening/page.tsx");
  const listeningData = read("src/lib/data/listening.ts");
  const videoPage = read("src/app/app/(shell)/video-lessons/page.tsx");
  const videoData = read("src/lib/data/video-lessons.ts");
  assert.match(listeningPage, /requireActiveUser\(\)/);
  assert.match(listeningPage, /data-route-usable="listening"/);
  assert.match(listeningPage, /<Suspense fallback=\{<ListeningTestsSkeleton \/>\}>/);
  assert.match(listeningData, /id: listeningTests\.id,[\s\S]*title: listeningTests\.title,[\s\S]*difficultyLevel: listeningTests\.difficultyLevel/);
  assert.match(listeningData, /liveWhere\(/);
  assert.match(videoPage, /requireActiveUser\(\)/);
  assert.match(videoPage, /data-route-usable="video-lessons"/);
  assert.match(videoPage, /<Suspense fallback=\{<VideoLessonsSkeleton \/>\}>/);
  const studentVideoQuery = videoData.slice(videoData.indexOf("export async function listVideoLessonsForStudent"), videoData.indexOf("export async function createVideoLesson"));
  assert.match(studentVideoQuery, /videoLesson: \{[\s\S]*title: videoLessons\.title,[\s\S]*beforeYouWatch: videoLessons\.beforeYouWatch/);
  assert.match(studentVideoQuery, /progressState: lessonProgress\.state/);
  assert.doesNotMatch(studentVideoQuery, /videoLesson: videoLessons,\s*lesson: lessons/);
  assert.match(studentVideoQuery, /eq\(lessonProgress\.userId, userId\)/);
});

test("secondary region retry uses App Router refresh; core route errors remain inside the authenticated shell", () => {
  const retry = read("src/components/interaction/RegionRetryButton.tsx");
  const failure = read("src/app/app/(shell)/error.tsx");
  const layout = read("src/app/app/(shell)/layout.tsx");
  assert.match(retry, /router\.refresh\(\)/);
  assert.doesNotMatch(retry, /location\.reload|window\.location/);
  assert.match(retry, /data-region-retry=\{region\}/);
  assert.match(failure, /data-app-error/);
  assert.match(failure, /reset\(\)/);
  assert.match(layout, /<Sidebar/);
  assert.match(layout, /<Topbar/);
  assert.match(layout, /<InstantWorkspaceOutlet>/);
});
