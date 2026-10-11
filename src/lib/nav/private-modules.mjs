/**
 * The private application modules — ONE source of truth.
 *
 * Three places must agree on this list and they must never drift apart:
 *
 *   1. `next.config.mjs` — builds the historical-URL redirect table
 *      (`/listening/history` → `/app/listening/history`);
 *   2. `src/middleware.ts` — the coarse "is anybody signed in?" session check
 *      that runs before a page is even routed;
 *   3. the tests — which assert the parity rather than restating it.
 *
 * So the list lives here, in dependency-light plain ESM: no Node APIs, no
 * framework imports, nothing that an Edge bundle or a config loader cannot take.
 * `src/lib/nav/private-modules.d.mts` types it for TypeScript.
 *
 * `destination` is the module's canonical home under `/app`. Every module maps to
 * `/app/<segment>` except the **dashboard**, which owns the namespace root
 * (`/app`) — that is the owner-approved application entry, and `/app/dashboard`
 * is kept only as a redirect onto it.
 */
export const PRIVATE_MODULES = [
  { segment: "dashboard", destination: "/app" },
  { segment: "courses", destination: "/app/courses" },
  { segment: "writing", destination: "/app/writing" },
  { segment: "vocabulary", destination: "/app/vocabulary" },
  { segment: "listening", destination: "/app/listening" },
  { segment: "reading", destination: "/app/reading" },
  { segment: "speaking", destination: "/app/speaking" },
  { segment: "grammar", destination: "/app/grammar" },
  { segment: "mocks", destination: "/app/mocks" },
  { segment: "coach", destination: "/app/coach" },
  { segment: "assignments", destination: "/app/assignments" },
  { segment: "progress", destination: "/app/progress" },
  { segment: "live-classes", destination: "/app/live-classes" },
  { segment: "video-lessons", destination: "/app/video-lessons" },
  { segment: "teacher", destination: "/app/teacher" },
  { segment: "admin", destination: "/app/admin" },
  { segment: "owner", destination: "/app/owner" },
  { segment: "profile", destination: "/app/profile" },
  { segment: "notifications", destination: "/app/notifications" },
  { segment: "reports", destination: "/app/reports" },
  { segment: "support", destination: "/app/support" },
  { segment: "management", destination: "/app/management" },
];

/**
 * The canonical application entry. The dashboard owns the namespace root, so the
 * approved Home URL is `/app` — not `/app/dashboard`.
 */
export const APP_HOME = "/app";

/**
 * URLs that used to point at a dashboard of their own. They are aliases now: they
 * must resolve to the single canonical Home instead of rendering a second one.
 */
export const APP_HOME_ALIASES = ["/app/dashboard"];

/** Just the historical top-level segments: `/dashboard`, `/listening`, … */
export const PRIVATE_MODULE_SEGMENTS = PRIVATE_MODULES.map((m) => m.segment);

/**
 * Paths that are NOT application modules but still require an account.
 * They stay outside `/app` on purpose (`/login` and `/register` are public).
 */
export const ACCOUNT_GATED_PATHS = ["/onboarding", "/pending"];

/**
 * Legacy aliases INSIDE `/app`: a path that used to be its own page and is now a view of another.
 *
 * Declared here rather than left to a page-level `redirect()` for a measured reason. A page inside the
 * `(shell)` layout answers 200, renders and streams the shell, and only THEN navigates client-side —
 * so the shell mounts twice. On `/app/vocabulary/review` that was observable: the notification bell
 * polled `/api/notifications?count=1` twice and both brand marks revalidated twice, on a route whose
 * entire job is to send the learner somewhere else. At the config layer the browser follows the 307
 * before any document is rendered, so the shell mounts once and the bell polls once.
 *
 * This is not a dead-bookmark concern: the path is linked from product UI (the Coach page, Writing's
 * Topic Vocabulary "Practice" button, coach categories and the breadcrumb table), so a hard navigation
 * to it is an ordinary learner action.
 *
 * Temporary (307) for the same reason as the module aliases above — a 308 would be cached by browsers
 * for good, and the shape of `/app` is still settling. The page-level `redirect()` is deliberately
 * KEPT as a fallback so the path still resolves if this table is ever bypassed.
 */
export const APP_LEGACY_ALIASES = [
  { source: "/app/vocabulary/review", destination: "/app/vocabulary?tab=revision" },
];

/** Alias → canonical Home, so no second dashboard can exist. */
export function canonicalHomeRedirects() {
  return APP_HOME_ALIASES.map((source) => ({ source, destination: APP_HOME, permanent: false }));
}

/**
 * The redirect rules, built here so the config, the middleware and the tests read
 * the same table. Two rules per module: the module root and every deeper path.
 * Nothing here can match `/api/*` — the segments are page modules only.
 */
export function appLegacyAliasRedirects() {
  return APP_LEGACY_ALIASES.map(({ source, destination }) => ({ source, destination, permanent: false }));
}

export function legacyModuleRedirects() {
  return PRIVATE_MODULES.flatMap(({ segment, destination }) => [
    { source: `/${segment}`, destination, permanent: false },
    { source: `/${segment}/:path*`, destination: `${destination}/:path*`, permanent: false },
  ]);
}
