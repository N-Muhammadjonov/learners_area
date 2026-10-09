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

/** Literal values a uuid slot also owns, which must not be rejected by shape. */
export const RESERVED_ID_WORDS = ["new", "preview"];

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

const COMPILED = DYNAMIC_PAGE_ROUTES
  .map(compile)
  // Longest first: `/app/listening/tests/[id]/mcq` must win over
  // `/app/listening/tests/[id]/[activity]`, which would otherwise swallow it.
  .sort((a, b) => b.route.split("/").length - a.route.split("/").length || b.route.length - a.route.length);

/**
 * True when `pathname` matches a dynamic page route and a parameter that must be a
 * uuid is not one. Shape only — "valid uuid, no such row" still needs a database read.
 */
export function isMalformedIdPath(pathname) {
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
      if (RESERVED_ID_WORDS.includes(id)) continue;
      if (!UUID_RE.test(id)) return true;
    }
    return false;
  }
  return false;
}
