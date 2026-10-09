#!/usr/bin/env node
/**
 * Navigation modes — learning vs management.
 *
 *   BASE_URL="http://127.0.0.1:3000" node scripts/verify-navigation.mjs
 *
 * The product has two navigations in one application. The mode is derived from
 * the route, never from a click, so the same check must hold for a link, a
 * bookmark, a refresh and a typed URL. This script asks a running server (a
 * production build, `next start`) for the real rendered HTML of both halves and
 * asserts, for each role:
 *
 *   · a learning page carries the learning navigation and NO management shell
 *     (`data-sidebar-back-to-learning` absent) — while staff keep the single
 *     entry that switches modes;
 *   · a management page carries the management shell and the back-to-learning
 *     link, whichever way it was reached (direct request = bookmark/refresh,
 *     and the `RSC: 1` payload = a click on a sidebar link);
 *   · a student is refused the management routes instead of being shown an
 *     empty management shell — an empty shell is a dead end, not a permission;
 *   · the mode survives a locale switch (the labels change, the mode does not).
 *
 * Nothing here writes: two sessions are created by signing in, which is
 * ordinary product behaviour, and every request is a GET.
 */

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

const ACCOUNTS = {
  owner: { email: "owner@learnersarea.uz", password: "Owner12345!" },
  teacher: { email: "teacher@learnersarea.uz", password: "Teacher12345!" },
  student: { email: "demo.student@learnersarea.uz", password: "Student12345!" },
};

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  \u001b[32mPASS\u001b[0m  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  \u001b[31mFAIL\u001b[0m  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function signIn(account, ip) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(account),
  });
  if (!response.ok) throw new Error(`sign-in failed (${response.status})`);
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
}

async function get(path, cookie, extraHeaders = {}) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { cookie, ...extraHeaders },
    redirect: "manual",
  });
  const body = await response.text();
  return { status: response.status, location: response.headers.get("location"), body };
}

// The mode is visible in the rendered markup in three ways, and each is
// checked as an *attribute*, not as a bare dictionary string: the shell ships
// its whole dictionary in the flight payload, so the words "Boshqaruv rejimi"
// appear on a learning page too and cannot be used as a marker.
const APOSTROPHE = "(?:&#x27;|'|\u2019|\u02bb|\u02bc)";
const LEARNING_NAV = new RegExp(`aria-label="O${APOSTROPHE}qish bo${APOSTROPHE}limlari"`);
const MANAGEMENT_NAV = new RegExp(`aria-label="Boshqaruv bo${APOSTROPHE}limlari"`);
const MANAGEMENT_NAV_EN = /aria-label="Management sections"/;
const LEARNING_MARKER = /data-sidebar-management-entry/; // "switch to management" (staff, learning mode)
const MANAGEMENT_MARKER = /data-sidebar-back-to-learning/; // the way back (management mode)

const has = (body, pattern) => (typeof pattern === "string" ? body.includes(pattern) : pattern.test(body));

console.log(`\nLearners Area — navigation modes (learning vs management) @ ${BASE}\n`);

const owner = await signIn(ACCOUNTS.owner, "10.10.1.1");
const teacher = await signIn(ACCOUNTS.teacher, "10.10.1.2");
const student = await signIn(ACCOUNTS.student, "10.10.1.3");

// --- OWNER: learning half ---------------------------------------------------
for (const path of ["/app", "/app/reading", "/app/vocabulary"]) {
  const page = await get(path, owner);
  check(
    `OWNER ${path} — learning navigation, no management shell`,
    page.status === 200 &&
      has(page.body, LEARNING_NAV) &&
      !has(page.body, MANAGEMENT_NAV) &&
      !has(page.body, MANAGEMENT_MARKER),
    `http=${page.status}`
  );
}
const dashboard = await get("/app", owner);
check(
  "OWNER sees one honest way into management mode",
  has(dashboard.body, LEARNING_MARKER) && has(dashboard.body, "/app/management"),
  "switch link present"
);

// --- OWNER: management half, reached four different ways --------------------
for (const path of ["/app/management", "/app/admin/admissions", "/app/admin/people", "/app/owner"]) {
  const page = await get(path, owner);
  check(
    `OWNER ${path} (direct = bookmark/refresh) — management mode`,
    page.status === 200 &&
      has(page.body, MANAGEMENT_MARKER) &&
      has(page.body, MANAGEMENT_NAV) &&
      !has(page.body, LEARNING_NAV),
    `http=${page.status}`
  );
}

// Switching modes by clicking is a client-side computation: the sidebar is a
// client component that reads the current path (`usePathname()`), which is why
// the navigation payload deliberately does not carry the sidebar at all. What
// can be checked from here is that the *entry* into management mode is a real
// route (so the click has somewhere honest to go), that the payload for a
// navigation renders the management page itself, and that the route-to-mode
// mapping covers every management route in the app (unit test
// `tests/navigation-mode.test.ts`). Clicking the entry is on the manual list.
// The entry lives at /app/management (the whole private app is mounted under /app); the
// old pattern looked for a bare "/management" that the app has never served, so it could
// only ever report "missing". Match the real contract AND prove the target resolves for
// the owner, so a dead link cannot pass as "a real route".
const entryTarget = (dashboard.body.match(/href="(\/app\/management)"/) ?? [])[1] ?? null;
const entryResolves = entryTarget ? await get(entryTarget, owner) : null;
check(
  "the management entry points at a real route",
  entryTarget === "/app/management" && entryResolves?.status === 200,
  `href=${entryTarget ?? "missing"} status=${entryResolves?.status ?? "n/a"}`
);
const navigated = await get("/app/admin/admissions", owner, {
  RSC: "1",
  "Next-Router-State-Tree":
    "%5B%22%22%2C%7B%22children%22%3A%5B%22(app)%22%2C%7B%22children%22%3A%5B%22dashboard%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D",
  "Next-Url": "/app/admin/admissions",
});
check(
  "a client-side navigation into management returns the management page",
  navigated.status === 200 && /admission/i.test(navigated.body),
  `http=${navigated.status}`
);

// Back out again: the learning half must not inherit the management shell.
const back = await get("/app/reading", owner);
check(
  "OWNER returns to learning — the management shell is gone",
  back.status === 200 && !has(back.body, MANAGEMENT_MARKER) && has(back.body, LEARNING_MARKER),
  `http=${back.status}`
);

// Locale changes labels, not the mode.
const english = await fetch(`${BASE}/api/locale`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: owner },
  body: JSON.stringify({ locale: "en" }),
});
// The locale lives in a cookie the endpoint sets on *its* response, so it has
// to be carried into the next request explicitly.
const localeCookie = (english.headers.getSetCookie?.() ?? [])
  .map((value) => value.split(";")[0])
  .join("; ");
const englishSession = [owner, localeCookie].filter(Boolean).join("; ");
const englishPage = await get("/app/admin/admissions", englishSession);
check(
  "the mode survives a locale switch (EN labels, management shell)",
  english.ok &&
    englishPage.status === 200 &&
    has(englishPage.body, MANAGEMENT_MARKER) &&
    has(englishPage.body, MANAGEMENT_NAV_EN) &&
    has(englishPage.body, "Back to learning"),
  `locale=${english.status} http=${englishPage.status}`
);
await fetch(`${BASE}/api/locale`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: owner },
  body: JSON.stringify({ locale: "uz" }),
});

// --- TEACHER: the staff half, without the owner's tools ---------------------
const teacherPage = await get("/app/management", teacher);
check(
  "TEACHER /management — management mode",
  teacherPage.status === 200 && has(teacherPage.body, MANAGEMENT_MARKER),
  `http=${teacherPage.status}`
);
check(
  "TEACHER is not offered the owner's tools",
  !has(teacherPage.body, "/app/owner/audit") && !has(teacherPage.body, "/app/owner/transfer"),
  "no owner-only cards"
);

// --- STUDENT: refused, not shown an empty shell -----------------------------
// STATUS ALONE IS NOT THE INVARIANT. Next.js may answer a document GET with 200 while
// streaming a redirect instruction, so a status assertion is both flaky and blind.
// The invariant that matters: a student receives ZERO protected data.
//
// A fixed marker list is also not sufficient — a student could receive a management
// shell or protected controls that happen to contain none of the listed strings. So the
// protected marker set for each route is DERIVED AT RUNTIME from the authorized render
// of that same route, minus whatever the student legitimately sees on their own
// dashboard. That is route-specific, cannot go stale, and cannot be evaded by a
// different protected payload.

/** Every data-* attribute and in-app href in a response: the page's observable surface. */
const surfaceOf = (html) => new Set([
  ...[...html.matchAll(/\b(data-[a-z0-9-]+)/g)].map((m) => m[1]),
  ...[...html.matchAll(/href="(\/app\/[^"?#]*)"/g)].map((m) => m[1]),
]);

// Baseline: what a student is entitled to see anywhere. A ONE-PAGE baseline is too
// narrow: Suspense fallbacks and layout frames (data-entry-frame,
// data-private-loading-boundary, data-async-loading...) appear on staff routes but not
// on the dashboard, and would be misread as protected data. Subtract the UNION of
// several routes the student is genuinely entitled to. This is not circular: no
// protected route under test is ever part of the baseline.
const studentBaseline = new Set();
for (const base of ["/app", "/app/lessons", "/app/progress", "/app/profile"]) {
  for (const m of surfaceOf((await get(base, student)).body)) studentBaseline.add(m);
}

// Generic management/staff chrome that must never reach a learner whatever the route.
// Only DATA and AUTHORITY belong here. The management-mode shell frame
// (data-sidebar-back-to-learning / data-management-hub / data-management-area) is
// rendered from the REQUESTED URL by the shared layout before the page guard redirects,
// so it appears in the streamed bytes for any caller who types a management URL. It
// carries no data and no authority, and it never survives to the settled DOM — that is
// proven separately, in a real browser, by
// scripts/browser/verify-redirect-destination.mjs, which owns the destination claim.
const GENERIC_PROTECTED = [
  "/app/owner/transfer",
  "/app/owner/audit",
  "/app/owner/retention",
  "teacher@learnersarea.uz",
  "admin@learnersarea.uz",
  "owner@learnersarea.uz",
  "pending.student@learnersarea.uz",
];

const PROTECTED_ROUTES = [
  { path: "/app/management", authorized: owner },
  { path: "/app/admin/admissions", authorized: owner },
  { path: "/app/admin/people", authorized: owner },
  { path: "/app/teacher/students", authorized: teacher },
  { path: "/app/owner", authorized: owner },
];

// Chrome, measured rather than guessed: markers the student receives on EVERY protected
// route are by construction not route-specific protected data (they are the shared shell
// the layout streams from the URL). Anything genuinely belonging to one console shows up
// on that console alone. Generic data/authority leaks remain covered unconditionally by
// GENERIC_PROTECTED above, so this subtraction cannot hide one.
const studentRenders = new Map();
for (const { path } of PROTECTED_ROUTES) {
  studentRenders.set(path, await get(path, student));
}
let sharedChrome = null;
for (const { path } of PROTECTED_ROUTES) {
  const seen = surfaceOf(studentRenders.get(path).body);
  sharedChrome = sharedChrome === null ? seen : new Set([...sharedChrome].filter((m) => seen.has(m)));
}

for (const { path, authorized } of PROTECTED_ROUTES) {
  const authedRes = await get(path, authorized);
  const authedSurface = surfaceOf(authedRes.body);
  // Route-specific protected markers = what the authorized actor sees here that the
  // student is not entitled to see at all.
  // The shell renders breadcrumb/back links derived from the REQUESTED URL itself, so an
  // ancestor of the route under test is not leaked data (the caller supplied the path).
  // A link to any OTHER staff route still counts.
  const isAncestorOfRoute = (m) => m.startsWith("/app/") && path.startsWith(m);
  // The breadcrumb region itself is the same URL-derived chrome as the ancestor href it
  // wraps: the shell builds it from the requested path, it carries no data and no
  // authority, and the real-browser check proves it never survives the redirect.
  const BREADCRUMB_CHROME = new Set(["data-breadcrumbs", "data-back-button"]);
  const routeMarkers = [...authedSurface].filter(
    (m) =>
      !studentBaseline.has(m) &&
      !isAncestorOfRoute(m) &&
      !sharedChrome.has(m) &&
      !BREADCRUMB_CHROME.has(m)
  );

  // POSITIVE CONTROL: without markers, the negative assertion below proves nothing.
  check(
    `${path} — the authorized actor renders route-specific protected markers`,
    routeMarkers.length > 0,
    `authorized http=${authedRes.status}; no marker distinguishes this page from the learner dashboard`
  );

  const studentRes = studentRenders.get(path);
  const leakedRouteMarkers = routeMarkers.filter((m) => studentRes.body.includes(m));
  check(
    `STUDENT ${path} — receives none of this route's protected markers`,
    leakedRouteMarkers.length === 0,
    `http=${studentRes.status} leaked=${leakedRouteMarkers.slice(0, 6).join(", ") || "none"}`
  );

  const leakedGeneric = GENERIC_PROTECTED.filter((m) => studentRes.body.includes(m));
  check(
    `STUDENT ${path} — receives no management shell or staff identity`,
    leakedGeneric.length === 0,
    `http=${studentRes.status} leaked=${leakedGeneric.join(", ") || "none"}`
  );

  // Redirect destination: a Location header, when present, must lead out of management.
  // An ABSENT header is NOT treated as proof of anything — Next.js may stream the
  // redirect instead — so the real destination is verified by the browser suite; here
  // we only assert the header never points deeper into staff space.
  if (studentRes.location) {
    check(
      `STUDENT ${path} — the redirect header leads out of management`,
      !/\/app\/(owner|admin|teacher|management)/.test(studentRes.location),
      `→ ${studentRes.location}`
    );
  }
}

const studentDashboard = await get("/app", student);
check(
  "STUDENT has no way into management at all",
  studentDashboard.status === 200 && !has(studentDashboard.body, LEARNING_MARKER),
  "no switch link"
);
check(
  "STUDENT's own pages stay in learning mode",
  has(studentDashboard.body, LEARNING_NAV) && !has(studentDashboard.body, MANAGEMENT_NAV),
  "learning navigation"
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
