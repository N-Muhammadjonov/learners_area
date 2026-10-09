#!/usr/bin/env node
/**
 * REAL-BROWSER verification of where an unauthorized learner actually LANDS.
 *
 * Why this script exists (owner correction, item 3):
 * the HTTP-level probes used to assert a redirect by reading a `Location` header, and
 * treated an EMPTY destination as a pass. That is a false-negative path: Next.js streams
 * most of these redirects inside a 200 RSC payload, so there is no `Location` header at
 * all and the assertion passed vacuously — it proved nothing about the destination.
 *
 * Rather than invent a fake "must return 307" requirement that the framework never
 * promised, this script tests the invariant a user actually experiences, in a real
 * Chromium, after the client router has settled:
 *
 *   1. the FINAL URL is outside management/admin/owner/teacher space;
 *   2. the settled DOM carries no management shell and no staff identity;
 *   3. the settled DOM carries none of the route-specific protected markers that the
 *      AUTHORIZED actor genuinely renders on that same page (positive control: if the
 *      authorized render yields no markers, the detector is inert and we fail).
 *
 * Requirements (deliberately NOT repo dependencies):
 *   npm i --no-save puppeteer-core @sparticuz/chromium
 *   a built server on BASE_URL (npm run build && next start)
 *   LD_LIBRARY_PATH=/tmp/chromium-libs/lib:/tmp   (NSS libs, see docs)
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

const USERS = {
  student: { email: "demo.student@learnersarea.uz", password: "Student12345!" },
  teacher: { email: "teacher@learnersarea.uz", password: "Teacher12345!" },
  owner: { email: "owner@learnersarea.uz", password: "Owner12345!" },
};

// Every route a learner must never reach, with the actor who legitimately may.
const PROTECTED_ROUTES = [
  { path: "/app/management", authorized: "owner" },
  { path: "/app/admin/admissions", authorized: "owner" },
  { path: "/app/admin/people", authorized: "owner" },
  { path: "/app/admin/reading", authorized: "owner" },
  { path: "/app/teacher/students", authorized: "teacher" },
  { path: "/app/owner", authorized: "owner" },
];

const STAFF_SPACE = /\/app\/(management|admin|owner|teacher)\b/;

// Management chrome + staff identity that must never survive in a learner's DOM.
const GENERIC_PROTECTED = [
  "data-management-hub",
  "data-management-area",
  "/app/owner/transfer",
  "/app/owner/audit",
  "/app/owner/retention",
  "teacher@learnersarea.uz",
  "admin@learnersarea.uz",
  "owner@learnersarea.uz",
];

let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const browser = await puppeteer.launch({
  // `--single-process` (shipped in chromium.args for Lambda) cannot host more than one
  // browser context, and we need one isolated context per actor.
  args: [...chromium.args.filter((a) => a !== "--single-process"), "--no-sandbox", "--disable-dev-shm-usage"],
  executablePath: await chromium.executablePath(),
  headless: true,
});

/**
 * Log in through the real form and return a page whose router is settled.
 *
 * Each actor gets an ISOLATED browser context. Pages in one Chromium share a cookie jar,
 * so signing in as a second user would silently overwrite the first session and every
 * later assertion would be measuring the wrong actor (this really happened: a teacher
 * login made the "student" page reach /app/teacher/students).
 */
async function signIn(who) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.type("#email", USERS[who].email);
  await page.type("#password", USERS[who].password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 60000 });
  return page;
}

/**
 * Markers a page genuinely renders. `data-*` attribute names plus in-app hrefs, read
 * from the SETTLED DOM rather than the streamed HTML, so RSC streaming cannot make the
 * comparison meaningless.
 */
const surfaceOf = (page) =>
  page.evaluate(() => {
    const out = new Set();
    for (const el of document.querySelectorAll("*")) {
      for (const a of el.attributes) if (a.name.startsWith("data-")) out.add(a.name);
    }
    for (const a of document.querySelectorAll('a[href^="/app/"]')) {
      out.add(new URL(a.getAttribute("href"), location.origin).pathname);
    }
    return [...out];
  });

try {
  const student = await signIn("student");
  // Baseline: the union of surfaces a learner is genuinely entitled to. A one-page
  // baseline is too narrow — shared shell chrome would be misread as protected data.
  const baseline = new Set();
  for (const base of ["/app", "/app/lessons", "/app/progress", "/app/profile"]) {
    await student.goto(`${BASE}${base}`, { waitUntil: "networkidle0", timeout: 60000 });
    for (const m of await surfaceOf(student)) baseline.add(m);
  }

  const authorizedPages = {};
  for (const who of new Set(PROTECTED_ROUTES.map((r) => r.authorized))) {
    authorizedPages[who] = await signIn(who);
  }

  for (const { path, authorized } of PROTECTED_ROUTES) {
    const authedPage = authorizedPages[authorized];
    await authedPage.goto(`${BASE}${path}`, { waitUntil: "networkidle0", timeout: 60000 });
    const landedAuthorized = new URL(authedPage.url()).pathname;
    check(
      `${authorized} genuinely reaches ${path}`,
      landedAuthorized === path,
      `landed on ${landedAuthorized}`
    );

    // Breadcrumb/back links are derived from the REQUESTED URL, so an ancestor of the
    // route under test is not leaked data. A link to any OTHER staff route still counts.
    const isAncestor = (m) => m.startsWith("/app/") && path.startsWith(m);
    const routeMarkers = (await surfaceOf(authedPage)).filter(
      (m) => !baseline.has(m) && !isAncestor(m)
    );

    // POSITIVE CONTROL: a negative check without a working detector proves nothing.
    check(
      `${path} yields route-specific protected markers for the authorized actor`,
      routeMarkers.length > 0,
      "no marker distinguishes this page from a learner's own pages"
    );

    await student.goto(`${BASE}${path}`, { waitUntil: "networkidle0", timeout: 60000 });
    // Let the client router finish any streamed redirect before judging the destination.
    await student
      .waitForFunction((p) => location.pathname !== p, { timeout: 10000 }, path)
      .catch(() => {});
    const landed = new URL(student.url()).pathname;

    check(
      `STUDENT ${path} — the browser lands outside staff space`,
      !STAFF_SPACE.test(landed),
      `landed on ${landed}`
    );

    const settled = await student.content();
    const leakedRoute = routeMarkers.filter((m) => settled.includes(m));
    check(
      `STUDENT ${path} — settled DOM carries none of this route's protected markers`,
      leakedRoute.length === 0,
      `leaked=${leakedRoute.slice(0, 6).join(", ")}`
    );

    const leakedGeneric = GENERIC_PROTECTED.filter((m) => settled.includes(m));
    check(
      `STUDENT ${path} — settled DOM carries no management shell or staff identity`,
      leakedGeneric.length === 0,
      `leaked=${leakedGeneric.join(", ")}`
    );
  }
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
