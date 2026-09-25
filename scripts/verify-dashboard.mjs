#!/usr/bin/env node
/**
 * Dashboard — continue where you left off, My Tasks, next class.
 *
 * Every figure on this page has to be traceable to a row the student owns, so
 * the checks compare the page against the database rather than trusting it.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`ok   - ${name}`);
  } else {
    failures.push(name);
    console.log(`not ok - ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function page(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: res.status, text: await res.text() };
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

console.log(`\nLearners Area — Dashboard continuity against ${BASE}\n`);

const { default: pg } = await import("pg");
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/learners_area",
});
await db.connect();

const cookie = await login("demo.student@learnersarea.uz", "Student12345!");
const userRow = await db.query("select id from users where email = 'demo.student@learnersarea.uz'");
const userId = userRow.rows[0].id;

const dashboard = await page("/dashboard", cookie);
check("the dashboard renders for an approved student", dashboard.status === 200, `status ${dashboard.status}`);
check("it offers to continue where the student stopped", dashboard.text.includes("data-continue"));
check("the continue card names the module", dashboard.text.includes("data-last-module="));
check("it carries the student's tasks", dashboard.text.includes("data-my-tasks"));
check("it shows the next live class when one exists", dashboard.text.includes("data-next-live-class"));

// The continue card must point at the newest row the student actually owns.
const newest = await db.query(
  `select 'writing' as module, id::text, updated_at as at from writing_submissions where user_id = $1
   union all select 'reading', id::text, started_at from reading_attempts where user_id = $1
   union all select 'listening', id::text, started_at from listening_attempts where user_id = $1
   union all select 'speaking', id::text, created_at from speaking_attempts where user_id = $1
   union all select 'vocabulary', id::text, created_at from user_vocabulary where user_id = $1
   order by at desc limit 1`,
  [userId]
);
const expected = newest.rows[0]?.module;
const shown = (dashboard.text.match(/data-last-module="([a-z]+)"/) ?? [])[1];
check("the continue card points at the newest real row", shown === expected, `page ${shown} vs db ${expected}`);

const link = (dashboard.text.match(/data-continue-link="([^"]+)"/) ?? [])[1] ?? null;
check("the continue card carries a destination", Boolean(link));
if (link) {
  const target = await page(link, cookie);
  check("the continue link opens a real page", target.status === 200, `${link} → ${target.status}`);
}

// "What's open now" must list exactly the lessons the roadmap says are open.
const openLessons = await db.query(
  `select id::text from lessons where id in (
     select lesson_id from lesson_progress where user_id = $1 and state in ('available','assigned','in_progress')
   ) or (default_state in ('available','assigned','in_progress')
     and id not in (select lesson_id from lesson_progress where user_id = $1))`,
  [userId]
);
const shownOpen = [...dashboard.text.matchAll(/data-open-lesson="([0-9a-f-]+)"/g)].map((m) => m[1]);
check(
  `the open lessons match the roadmap (${openLessons.rows.length} open in db)`,
  openLessons.rows.length === 0
    ? dashboard.text.includes("data-open-lessons-empty")
    : shownOpen.length > 0 && shownOpen.every((id) => openLessons.rows.some((r) => r.id === id)),
  `shown ${shownOpen.length}`
);
check(
  "a locked lesson is never offered as open",
  !shownOpen.some((id) => !openLessons.rows.some((r) => r.id === id))
);

const openTasks = await db.query(
  "select id::text from assignments where target_user_id = $1 and status <> 'completed' order by due_at",
  [userId]
);
check(
  "the task list matches the student's open assignments",
  openTasks.rows.length === 0
    ? dashboard.text.includes("data-tasks-empty")
    : openTasks.rows.every((row) => dashboard.text.includes(row.id)),
  `${openTasks.rows.length} open in db`
);

const liveRow = await db.query(
  "select id::text from live_classes where status = 'upcoming' order by scheduled_at limit 1"
);
check(
  "the next class matches the database",
  liveRow.rows.length === 0 ? !dashboard.text.includes("data-next-live-class") : dashboard.text.includes(liveRow.rows[0].id)
);

// Skill counts are real counts, not decoration.
for (const [skill, table, column] of [
  ["reading", "reading_attempts", "started_at"],
  ["listening", "listening_attempts", "started_at"],
  ["speaking", "speaking_attempts", "created_at"],
]) {
  const count = await db.query(`select count(*)::int n from ${table} where user_id = $1`, [userId]);
  const expectedCount = count.rows[0].n;
  const onPage = dashboard.text.includes(`data-skill-count="${expectedCount}"`);
  check(
    `the ${skill} count on the dashboard is the real count`,
    expectedCount === 0 || onPage,
    `db ${expectedCount}`
  );
}

// A fresh account must see honest empty states, never placeholder numbers.
const freshCookie = await login("new.student@learnersarea.uz", "Student12345!");
const fresh = await page("/dashboard", freshCookie);
check("a fresh student sees an empty continue card", fresh.text.includes("data-continue-empty"));
check("a fresh student sees an empty task list", fresh.text.includes("data-tasks-empty"));
check(
  "a fresh student is not shown invented attempt counts",
  !/data-skill-count="[1-9]/.test(fresh.text),
  "a non-zero count appeared for an account with no attempts"
);

check("an anonymous visitor is sent to the login page", (await page("/dashboard")).status !== 200);

await db.end();

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
