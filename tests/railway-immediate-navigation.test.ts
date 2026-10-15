import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("all authenticated shell routes show a private, localized destination frame immediately", () => {
  const layout = read("src/app/app/(shell)/layout.tsx");
  const outlet = read("src/components/interaction/InstantWorkspaceOutlet.tsx");
  assert.match(layout, /<InstantWorkspaceOutlet>\{children\}<\/InstantWorkspaceOutlet>/);
  assert.match(outlet, /hidden=\{pending \|\| undefined\} data-outgoing-workspace/,
    "the old page becomes hidden on the first navigation render, not after a timeout");
  assert.match(outlet, /data-workspace-content inert=\{pending \|\| undefined\}>\{children\}/,
    "the outgoing workspace remains mounted but is not interactive");
  assert.match(outlet, /<SectionEntryFrame routeKey=\{navigation\.routeKey\} frame=\{frame\} privateBoundary \/>/,
    "a data-free route skeleton renders without awaiting any DB result");
  assert.doesNotMatch(outlet, /setTimeout|setVisibleId|localStorage|sessionStorage/,
    "navigation acknowledgement must not wait 120 ms or cache private page data");
  assert.match(outlet, /stalled && \(/,
    "a genuinely stalled destination still offers a retry");
});

test("the production session and privileged access gates are not relaxed for speed", () => {
  const auth = read("src/lib/auth/current-user.ts");
  const app = read("src/app/app/layout.tsx");
  const middleware = read("src/middleware.ts");
  assert.match(app, /hasPrivateAccess\(user\.accountStatus\)/);
  assert.match(auth, /db\.query\.users\.findFirst/);
  assert.match(auth, /requireAdministrator/);
  assert.match(auth, /requireOwner/);
  assert.match(middleware, /jwtVerify\(/);
});

test("reading, listening, grammar and vocabulary defer catalogue DB reads behind scoped streaming regions", () => {
  for (const [path, method, boundary] of [
    ["src/app/app/(shell)/listening/academic/page.tsx", "academicListeningCards", "listening-academic-catalogue"],
    ["src/app/app/(shell)/listening/general/page.tsx", "generalListeningCards", "listening-general-catalogue"],
    ["src/app/app/(shell)/reading/academic/page.tsx", "listGeneralSets", "reading-academic-sets"],
    ["src/app/app/(shell)/grammar/lessons/page.tsx", "listLessonLibrary", "grammar-lessons-library"],
    ["src/app/app/(shell)/vocabulary/page.tsx", "listTopicPacksForLearner", "vocabulary-topic-packs"],
  ] as const) {
    const source = read(path);
    assert.match(source, /<Suspense fallback=/, path);
    assert.match(source, new RegExp(`data-async-loading="${boundary}"`), path);
    assert.match(source, new RegExp(`const [a-zA-Z]+Promise = ${method}\\(`), path);
    assert.match(source, /const \[user, locale, (?:query|params)\] = await Promise\.all\(\[requireActiveUser\(\), getLocale\(\), searchParams\]\)/,
      `${path} must still authenticate against the database before streaming private data`);
  }
});

test("the global shell does not query the avatar schema and users table before the picture flag", () => {
  const source = read("src/lib/profile/photo.ts");
  assert.match(source, /\.from\(userProfilePhotos\)/);
  assert.match(source, /\.where\(eq\(userProfilePhotos\.userId, userId\)\)/);
  assert.doesNotMatch(source, /to_regclass|innerJoin\(users/);
  assert.match(read("src/app/app/(shell)/layout.tsx"), /await hasProfilePhoto\(user\.id\)/);
});

test("all staff dashboards stream expensive data only AFTER database role authorization", () => {
  for (const [path, guard, boundary] of [
    ["src/app/app/(shell)/admin/people/page.tsx", "requireAdministrator", "management-people"],
    ["src/app/app/(shell)/admin/admissions/page.tsx", "requireAdministrator", "management-admissions"],
    ["src/app/app/(shell)/teacher/students/page.tsx", "requireStaff", "management-students"],
    ["src/app/app/(shell)/teacher/support/page.tsx", "requireStaff", "management-support"],
    ["src/app/app/(shell)/owner/page.tsx", "requireOwner", "management-owner"],
  ] as const) {
    const source = read(path);
    assert.match(source, new RegExp(`await ${guard}\\(\\)`), path);
    assert.match(source, /<Suspense fallback=/, path);
    assert.match(source, new RegExp(`data-async-loading="${boundary}"`), path);
    assert.match(source, /if \(!(?:actor|staff|user|owner)\) redirect\("\/app"\)/,
      `${path} must refuse demoted users before reading the restricted catalogue`);
  }
});

test("content management inventory starts parallel counts behind administrator gate", () => {
  const page = read("src/app/app/(shell)/admin/content/page.tsx");
  assert.match(page, /const administrator = await requireAdministrator\(\)/);
  assert.match(page, /if \(!administrator\) redirect\("\/app"\)/);
  assert.match(page, /<ContentLibraryResults dict=\{dict\} \/>/);
  assert.match(page, /data-async-loading="management-content-library"/);
  assert.match(page, /const writingOtherPromise = writingContentTotals\(\)\.catch/);
  assert.match(page, /const writingOther = await writingOtherPromise/);
});
