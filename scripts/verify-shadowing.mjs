#!/usr/bin/env node
/**
 * SHADOWING IS A RETIRED FEATURE — this suite proves it is GONE, and that removing it
 * did not damage the Speaking module.
 *
 * HISTORY, recorded so the reversal is not mistaken for drift: this file used to
 * assert that Shadowing was reachable, and commit 5f18ba0 mounted ShadowingStudio on
 * the Speaking Lessons page to satisfy it. That was the wrong product decision. The
 * owner's requirement is that Shadowing does not exist in the Learners Area at all,
 * so a passing "Shadowing works" suite is not an acceptance target — it is the defect.
 *
 * THE POSITIVE CONTROL MATTERS HERE. "Shadowing is absent" passes vacuously if no
 * shadowing data exists at all. The seed deliberately keeps ONE legacy material row in
 * the historical `shadowing` category (src/db/seed.ts), because a real centre's
 * database can still hold such rows after the retirement. This suite asserts that the
 * row EXISTS in the database and still never reaches a learner surface — that is the
 * difference between "we deleted the data" and "the product no longer offers the
 * feature", and only the second is what was asked for.
 */
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const STUDENT = { email: "demo.student@learnersarea.uz", password: "Student12345!" };
const TEACHER = { email: "teacher@learnersarea.uz", password: "Teacher12345!" };

let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

async function login(user) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(user),
    redirect: "manual",
  });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error(`login failed for ${user.email}: ${res.status}`);
  return cookie;
}

const get = async (cookie, path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), text: await res.text() };
};

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

try {
  // ---- POSITIVE CONTROL: legacy shadowing data really is present --------------
  const { rows: legacy } = await db.query(
    "select id, title from speaking_materials where category = 'shadowing'",
  );
  check(
    "POSITIVE CONTROL: legacy shadowing material still exists in the database",
    legacy.length > 0,
    `${legacy.length} rows — without one, every absence assertion below is vacuous`,
  );
  const legacyTitle = legacy[0]?.title ?? null;

  const student = await login(STUDENT);

  // ---- the feature is absent from every learner surface ----------------------
  const hub = await get(student, "/app/speaking");
  check("the Speaking hub does not link to the retired shadowing route",
    !hub.text.includes("/app/speaking/shadowing"));
  check("the Speaking hub does not name Shadowing", !/shadowing/i.test(hub.text));

  const lessons = await get(student, "/app/speaking/lessons");
  check("Speaking Lessons mounts no shadowing section", !lessons.text.includes("data-shadowing-section"));
  check("Speaking Lessons mounts no shadowing studio", !lessons.text.includes("data-shadowing-studio"));
  check("Speaking Lessons offers no recorder for shadowing", !lessons.text.includes("data-shadowing-start"));
  check("Speaking Lessons does not name Shadowing anywhere", !/shadowing/i.test(lessons.text));
  // The real test of the filter: the legacy row's own title must not be rendered.
  check(
    "the legacy shadowing material is not surfaced to the learner",
    legacyTitle ? !lessons.text.includes(legacyTitle) : false,
    legacyTitle ? `leaked: ${legacyTitle}` : "no legacy row to check against",
  );

  // ---- the retired URL offers no activity ------------------------------------
  const retired = await get(student, "/app/speaking/shadowing");
  check("the retired shadowing URL does not serve an activity", retired.status !== 200,
    `status ${retired.status}`);
  if (retired.status >= 300 && retired.status < 400) {
    check("it redirects to a supported Speaking surface", retired.location === "/app/speaking/lessons",
      String(retired.location));
    const landing = await get(student, retired.location ?? "/app/speaking/lessons");
    check("and the page it lands on carries no shadowing activity",
      !landing.text.includes("data-shadowing-studio") && !/shadowing/i.test(landing.text));
  }

  // ---- staff cannot author NEW shadowing material ----------------------------
  const teacher = await login(TEACHER);
  const authored = await fetch(`${BASE}/api/speaking/materials`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: teacher },
    body: JSON.stringify({ category: "shadowing", title: "QA attempt to author shadowing", primaryType: "audio" }),
  });
  check("staff cannot publish a NEW shadowing material", authored.status >= 400,
    `status ${authored.status}`);
  const { rows: after } = await db.query(
    "select count(*)::int n from speaking_materials where category = 'shadowing'",
  );
  check("the refused authoring attempt wrote nothing", after[0].n === legacy.length,
    `${legacy.length} before, ${after[0].n} after`);

  // ---- NEGATIVE CONTROL: the rest of Speaking still works --------------------
  // Removing a feature must not quietly remove its neighbours, so each supported
  // surface is asserted to answer AND to carry its own content.
  for (const [path, marker, label] of [
    ["/app/speaking", "/app/speaking/practice", "the Speaking hub offers Practice"],
    ["/app/speaking/practice", "data-practice-part", "Speaking Practice renders its parts"],
    ["/app/speaking/lessons", "data-speaking-materials", "Speaking Lessons renders its materials"],
    ["/app/speaking/history", "", "Speaking History is reachable"],
    ["/app/speaking/live-partner", "", "Speaking Live Partner is reachable"],
  ]) {
    const page = await get(student, path);
    const ok = page.status === 200 && (marker === "" || page.text.includes(marker));
    check(`REGRESSION: ${label}`, ok, `status ${page.status}`);
  }

  // ---- historical data is preserved, not deleted -----------------------------
  const { rows: preserved } = await db.query(
    "select count(*)::int n from speaking_materials where category = 'shadowing'",
  );
  check("historical shadowing rows are preserved, not destroyed", preserved[0].n === legacy.length,
    `${preserved[0].n} rows`);
} finally {
  await db.end();
}

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(failures.length ? 1 : 0);
