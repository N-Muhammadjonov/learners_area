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

/** Alias → canonical Home, so no second dashboard can exist. */
export function canonicalHomeRedirects() {
  return APP_HOME_ALIASES.map((source) => ({ source, destination: APP_HOME, permanent: false }));
}

/**
 * The redirect rules, built here so the config, the middleware and the tests read
 * the same table. Two rules per module: the module root and every deeper path.
 * Nothing here can match `/api/*` — the segments are page modules only.
 */
export function legacyModuleRedirects() {
  return PRIVATE_MODULES.flatMap(({ segment, destination }) => [
    { source: `/${segment}`, destination, permanent: false },
    { source: `/${segment}/:path*`, destination: `${destination}/:path*`, permanent: false },
  ]);
}
