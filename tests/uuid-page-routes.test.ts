import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * A mistyped or stale link must answer 404, not "200 OK" with 404 content.
 *
 * `src/app/app/(shell)/loading.tsx` puts a Suspense boundary above every shell page,
 * so the shell is flushed with a 200 before the page body runs; a later notFound()
 * can then only swap the body. The shape of a `[id]` parameter is therefore checked in
 * middleware, in front of that boundary.
 *
 * The danger with any such table is drift: a new `[id]` route silently inherits the
 * old behaviour. So this walks the REAL route tree and fails if anything is
 * unclassified, rather than trusting the list to be kept up to date by hand.
 */
const mod = () => import("../src/lib/nav/uuid-page-routes.mjs" as string);

const APP_ROOT = new URL("../src/app/app", import.meta.url).pathname;

/** Every dynamic page route under /app, as Next resolves it (route groups removed). */
function discoverDynamicPageRoutes(dir: string, segments: string[] = []): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    // `(shell)` / `(focus)` are route GROUPS: they organise files, not URLs.
    const isGroup = entry.startsWith("(") && entry.endsWith(")");
    const next = isGroup ? segments : [...segments, entry];
    if (existsSync(join(full, "page.tsx")) && next.some((s) => s.startsWith("["))) {
      out.push(`/app/${next.join("/")}`);
    }
    out.push(...discoverDynamicPageRoutes(full, next));
  }
  return out;
}

/** Every STATIC page route under /app (route groups removed). */
function discoverStaticPageRoutes(dir: string, segments: string[] = []): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    const isGroup = entry.startsWith("(") && entry.endsWith(")");
    const next = isGroup ? segments : [...segments, entry];
    if (existsSync(join(full, "page.tsx")) && !next.some((s) => s.startsWith("["))) {
      out.push(`/app/${next.join("/")}`);
    }
    out.push(...discoverStaticPageRoutes(full, next));
  }
  return out;
}

/**
 * REGRESSION. The shape check 404'd five REAL pages — both lesson authoring desks and
 * three admin pages — because middleware matched `/app/listening/lessons/author`
 * against `[lessonId]` and judged "author" to be a malformed uuid. Next resolves a
 * literal segment BEFORE a dynamic one, so those are static routes, not bad ids.
 *
 * The original guard was a hand-written word list ("new", "preview"), which is exactly
 * the kind of thing that drifts. This test recomputes the set from the real tree, so
 * adding a new static sibling next to an `[id]` route can never silently 404 it.
 */
test("a static page that a dynamic route would also match is never treated as a bad id", async () => {
  const { STATIC_PAGE_ROUTES_OVERRIDING_DYNAMIC, DYNAMIC_PAGE_ROUTES, isMalformedIdPath } = await mod();

  const toRegExp = (route: string) =>
    new RegExp(
      `^${route
        .split("/")
        .filter(Boolean)
        .map((segment) => (segment.startsWith("[") ? "([^/]+)" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .map((part) => `/${part}`)
        .join("")}$`,
    );

  const dynamic = (DYNAMIC_PAGE_ROUTES as string[]).map(toRegExp);
  const shadowed = discoverStaticPageRoutes(APP_ROOT)
    .filter((route) => dynamic.some((pattern) => pattern.test(route)))
    .sort();

  assert.ok(shadowed.length > 0, "route discovery found no shadowed static routes; the walker is broken");
  assert.deepEqual(
    [...(STATIC_PAGE_ROUTES_OVERRIDING_DYNAMIC as string[])].sort(),
    shadowed,
    "a static page is shadowed by a dynamic route pattern and is not exempted from the shape check",
  );

  // The five pages themselves must be reachable.
  for (const route of shadowed) {
    assert.equal(isMalformedIdPath(route), false, `${route} is a real page and must not be 404'd by shape`);
  }
  assert.ok(shadowed.includes("/app/listening/lessons/author"), "the lesson authoring desk must be among them");
});

test("every dynamic page route is classified, so none silently inherits 200-for-missing", async () => {
  const { DYNAMIC_PAGE_ROUTES, UUID_PARAM_NAMES, NON_UUID_PARAM_NAMES } = await mod();

  const discovered = discoverDynamicPageRoutes(APP_ROOT).sort();
  assert.ok(discovered.length > 20, `route discovery found only ${discovered.length} routes; the walker is broken`);

  const listed = [...(DYNAMIC_PAGE_ROUTES as string[])].sort();
  assert.deepEqual(
    discovered,
    listed,
    "the dynamic page route table has drifted from the real route tree",
  );

  // Every parameter name must be classified as uuid or explicitly not-uuid.
  const known = new Set([...(UUID_PARAM_NAMES as string[]), ...Object.keys(NON_UUID_PARAM_NAMES as object)]);
  const unclassified = new Set<string>();
  for (const route of discovered) {
    for (const segment of route.split("/")) {
      if (segment.startsWith("[")) {
        const name = segment.slice(1, -1);
        if (!known.has(name)) unclassified.add(name);
      }
    }
  }
  assert.deepEqual([...unclassified], [], "unclassified route parameters");
});

test("a malformed id is detected, and a well-formed one is left alone", async () => {
  const { isMalformedIdPath } = await mod();
  const uuid = "123e4567-e89b-12d3-a456-426614174000";

  // Malformed.
  assert.equal(isMalformedIdPath("/app/reading/attempts/zzz"), true);
  assert.equal(isMalformedIdPath("/app/writing/submissions/zzz"), true);
  assert.equal(isMalformedIdPath("/app/grammar/not-a-uuid"), true);
  assert.equal(isMalformedIdPath("/app/listening/tests/zzz/mcq"), true);
  assert.equal(isMalformedIdPath("/app/admin/materials/reading/zzz"), true);
  assert.equal(isMalformedIdPath("/app/reading/attempts/" + uuid.slice(0, -1)), true);

  // Well formed, or legitimately not a uuid at all.
  assert.equal(isMalformedIdPath(`/app/reading/attempts/${uuid}`), false);
  assert.equal(isMalformedIdPath(`/app/listening/tests/${uuid}/mcq`), false);
  assert.equal(isMalformedIdPath(`/app/listening/tests/${uuid}/3`), false, "[activity] is an ordinal");
  assert.equal(isMalformedIdPath(`/app/admin/materials/reading/${uuid}`), false, "[type] is an enum");
  assert.equal(isMalformedIdPath(`/app/admin/writing/task2/${uuid}`), false, "[kind] is an enum");
  assert.equal(isMalformedIdPath("/app/admin/writing/task2/new"), false, "literal 'new' is a real route");
  assert.equal(isMalformedIdPath("/app/vocabulary/games/translation"), false, "[gameId] is a slug");
  assert.equal(isMalformedIdPath("/app/listening/mcq/day/3"), false, "[day] is an ordinal");
  assert.equal(isMalformedIdPath("/app/admin/materials/reading"), false, "[type] alone is an enum");

  // Not a dynamic route at all: never interfere.
  assert.equal(isMalformedIdPath("/app/progress"), false);
  assert.equal(isMalformedIdPath("/app/speaking/lessons"), false);
  assert.equal(isMalformedIdPath("/api/reading/attempts/zzz"), false, "APIs answer for themselves");
});


test("Grammar Lessons literal destinations stay reachable while malformed lesson ids are rejected before streaming", async () => {
  const { isMalformedIdPath } = await mod();
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(isMalformedIdPath("/app/grammar/lessons"), false);
  assert.equal(isMalformedIdPath("/app/grammar/lessons/author"), false);
  assert.equal(isMalformedIdPath(`/app/grammar/lessons/${uuid}`), false);
  assert.equal(isMalformedIdPath("/app/grammar/lessons/not-a-uuid"), true);
  assert.equal(isMalformedIdPath("/app/grammar/lessons/%ZZ"), true);
  assert.equal(isMalformedIdPath("/app/grammar/not-a-uuid"), true, "the existing topic guard remains enforced");
});
