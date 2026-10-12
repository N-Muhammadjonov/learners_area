/**
 * Which `[param]` page segments hold a database uuid.
 *
 * WHY THIS EXISTS. `src/app/app/(shell)/loading.tsx` puts a Suspense boundary above
 * every shell page, so Next flushes the shell with HTTP 200 before a page body runs.
 * A later notFound() can then only replace the BODY — the status stays 200, and a
 * mistyped or stale link answers "200 OK" with 404 content. Proven by experiment:
 * removing that loading.tsx makes the same routes answer 404, but it would also cost
 * the route-entry skeleton on the 81 shell pages that have no Suspense of their own.
 *
 * So the SHAPE check moves in front of the boundary, into middleware, where it costs
 * nothing and cannot reach the database.
 *
 * CLASSIFIED BY PARAM NAME, not by route, because several routes mix the two kinds:
 * `/app/admin/materials/[type]/[id]` is an enum AND a uuid, and rejecting the whole
 * path when any segment fails would 404 perfectly valid URLs.
 *
 * DERIVED, NOT RESTATED. tests/uuid-page-routes.test.ts walks the real route tree and
 * fails if a dynamic page segment uses a parameter name in neither table — otherwise a
 * new `[id]` route would silently inherit the 200-for-missing behaviour.
 */

/** Parameter names that always hold a database uuid. */
export const UUID_PARAM_NAMES = [
  "id",
  "lessonId",
  "topicId",
  "testId",
  "sectionId",
  "setId",
  "attemptId",
];

/**
 * Parameter names that are deliberately NOT uuids. Each states what it really is, so
 * "not a uuid" is a recorded decision rather than an oversight.
 */
export const NON_UUID_PARAM_NAMES = {
  type: "content type enum (reading, listening, …)",
  kind: "writing kind enum (task1, task2, …)",
  day: "day ordinal, an integer",
  gameId: "game slug validated by isGameId (cards, choice, …)",
  activity: "activity ordinal, an integer",
};

/**
 * STATIC page routes that a dynamic route pattern would ALSO match.
 *
 * Next resolves a literal segment before a dynamic one, so `/app/listening/lessons/author`
 * is the authoring desk, NOT `[lessonId]` with the id "author". Middleware runs before
 * that resolution and therefore has to know the same thing: without this list the shape
 * check 404s five real pages — both lesson authoring desks and three admin pages.
 *
 * A hand-kept word list was the original mistake here. "new" and "preview" were listed
 * as magic ids, which happened to save `/app/admin/writing/[kind]/new` while saying
 * nothing about the five routes below. This list is DERIVED from the real route tree
 * and tests/uuid-page-routes.test.ts recomputes it, so a new static sibling cannot
 * silently become a 404. ("preview" needed no entry: it is an id literal only on
 * /api/listening/full/[id]/sandbox, and API routes answer their own status codes.)
 */
export const STATIC_PAGE_ROUTES_OVERRIDING_DYNAMIC = [
  "/app/admin/listening/import",
  "/app/admin/reading/import",
  "/app/admin/reading/retention",
  "/app/grammar/lessons",
  "/app/grammar/lessons/author",
  "/app/listening/lessons/author",
  "/app/reading/lessons/author",
];

/**
 * Every dynamic PAGE route under /app, as Next resolves it.
 *
 * Only pages: an API route answers its own 404/401 in the Node runtime and must keep
 * doing so, because its status conventions are asserted by the access-control tests.
 */
export const DYNAMIC_PAGE_ROUTES = [
  "/app/admin/grammar/[id]",
  "/app/admin/listening/[id]",
  "/app/admin/materials/[type]",
  "/app/admin/materials/[type]/[id]",
  "/app/admin/people/[id]",
  "/app/admin/reading/[id]",
  "/app/admin/writing/[kind]/[id]",
  "/app/admin/writing/[kind]/new",
  "/app/courses/ielts/lessons/[lessonId]",
  "/app/grammar/[topicId]",
  "/app/grammar/lessons/[lessonId]",
  "/app/listening/academic/[testId]",
  "/app/listening/attempts/[id]",
  "/app/listening/attempts/[id]/revision",
  "/app/listening/general/[sectionId]",
  "/app/listening/lessons/[lessonId]",
  "/app/listening/mcq/day/[day]",
  "/app/listening/tests/[id]",
  "/app/listening/tests/[id]/mcq",
  "/app/listening/tests/[id]/study",
  "/app/listening/tests/[id]/[activity]",
  "/app/reading/academic/[setId]",
  "/app/reading/attempts/[id]",
  "/app/reading/general/[setId]",
  "/app/reading/lessons/[lessonId]",
  "/app/reading/retention/results/[attemptId]",
  "/app/teacher/live-classes/[id]",
  "/app/teacher/students/[id]",
  "/app/video-lessons/[id]",
  "/app/vocabulary/games/[gameId]",
  "/app/writing/exam/[id]",
  "/app/writing/grade/[id]",
  "/app/writing/language-stealing/[id]",
  "/app/writing/lessons/[id]",
  "/app/writing/submissions/[id]",
  "/app/writing/translation/[id]",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build a matcher that remembers which capture belongs to which parameter name. */
function compile(route) {
  const names = [];
  const source = route
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (!segment.startsWith("[")) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(segment.slice(1, -1));
      return "([^/]+)";
    })
    .join("/");
  return { route, names, regex: new RegExp(`^/${source}$`) };
}

/** How many literal (non-parameter) segments a route has — Next's specificity. */
function literalWeight(route) {
  return route.split("/").filter(Boolean).filter((segment) => !segment.startsWith("[")).length;
}

const COMPILED = DYNAMIC_PAGE_ROUTES
  .map(compile)
  // Next prefers a LITERAL segment over a parameter, so `/app/listening/tests/[id]/mcq`
  // and `/app/admin/writing/[kind]/new` must win over the `[activity]` / `[id]` routes
  // that would otherwise swallow them. Sorting by string length happened to get `mcq`
  // right and `new` wrong, which is why "new" had to be special-cased as a magic word.
  .sort(
    (a, b) =>
      b.route.split("/").length - a.route.split("/").length ||
      literalWeight(b.route) - literalWeight(a.route) ||
      b.route.length - a.route.length,
  );

/**
 * True when `pathname` matches a dynamic page route and a parameter that must be a
 * uuid is not one. Shape only — "valid uuid, no such row" still needs a database read.
 */
export function isMalformedIdPath(pathname) {
  // A real static page wins outright: it is not a dynamic route at all.
  if (STATIC_PAGE_ROUTES_OVERRIDING_DYNAMIC.includes(pathname)) return false;
  for (const { names, regex } of COMPILED) {
    const match = regex.exec(pathname);
    if (!match) continue;
    for (let i = 0; i < names.length; i += 1) {
      if (!UUID_PARAM_NAMES.includes(names[i])) continue;
      let id;
      try {
        id = decodeURIComponent(match[i + 1] ?? "");
      } catch {
        return true; // undecodable is certainly not a uuid
      }
      if (!UUID_RE.test(id)) return true;
    }
    return false;
  }
  return false;
}
