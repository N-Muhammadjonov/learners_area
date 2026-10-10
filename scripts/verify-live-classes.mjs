#!/usr/bin/env node
/**
 * Live classes — the join window, the attendance record, and the staff roster.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

/*
 * QA SAFETY (section 03.4). This probe mutates and did not clean up after itself.
 * It joins a real class, which records activity against the student.
 *
 * Measured by scripts/audit-probe-residue.mjs, which counts every row in every table
 * around a run. Cleanup is differential: snapshot the owned tables before the first
 * mutation, delete exactly the ids that appeared, then re-query to prove they are
 * gone. A row that existed before the run is never touched.
 */
const SWEEP_DB_URL = process.env.DATABASE_URL;
const { assertMutableDatabase, createRowSweeper, installSweepHandlers } =
  await import("./lib/fixture-safety.mjs");
let finalSweep = async () => {};
if (SWEEP_DB_URL) {
  assertMutableDatabase(SWEEP_DB_URL, { probe: "verify-live-classes" });
  const sweepClient = new (await import("pg")).default.Client({ connectionString: SWEEP_DB_URL });
  await sweepClient.connect();
  const sweeper = createRowSweeper({
    client: sweepClient,
    probe: "verify-live-classes",
    tables: ["activity_events", "audit_log"],
  });
  finalSweep = installSweepHandlers(sweeper, {
    probe: "verify-live-classes",
    onDone: () => sweepClient.end().catch(() => {}),
  });
  await sweeper.capture();
} else {
  /*
   * FAIL CLOSED. This probe mutates through HTTP, and the sweep above is the only thing that removes
   * what it creates. Warning and continuing meant the mutations still happened against a database
   * that was never verified as disposable — and several of these probes then connected through a
   * hardcoded fallback (postgres://postgres@127.0.0.1:5433/learners_area) that no guard had ever
   * seen, so the run could write fixtures into an unverified database and clean up nothing. Without
   * a verified cleanup connection there is no safe run, so there is no run. Exit 2, not 1: this is a
   * misconfigured invocation, not a product failure.
   */
  console.error("  !! DATABASE_URL is not set — refusing to mutate: fixtures could neither be cleaned up nor verified as disposable");
  process.exit(2);
}

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

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}
async function page(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: res.status, text: await res.text() };
}
async function post(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", headers: cookie ? { cookie } : {} });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}

console.log(`\nLearners Area — Live classes against ${BASE}\n`);

const { default: pg } = await import("pg");
// This probe writes fixtures. Refuse any database that is not disposable QA.
const { assertMutableDatabase: __assertMutableDb } = await import("./lib/fixture-safety.mjs");
__assertMutableDb(process.env.DATABASE_URL);
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});
await db.connect();

const cookie = await login("demo.student@learnersarea.uz", "Student12345!");
const userId = (await db.query("select id from users where email = 'demo.student@learnersarea.uz'")).rows[0].id;

// Test-side setup: pick one class and move it into the future so the join window
// is exercised from its "too early" side, then restore it at the end.
const target = await db.query(
  "select id, scheduled_at, status from live_classes where status in ('upcoming','live') order by scheduled_at limit 1"
);
check("the seed has an upcoming class", target.rows.length > 0);
const liveClassId = target.rows[0].id;
await db.query("update live_classes set scheduled_at = now() + interval '3 days' where id = $1", [liveClassId]);
await db.query("delete from live_class_attendance where live_class_id = $1 and user_id = $2", [liveClassId, userId]);

const list = await page("/app/live-classes", cookie);
check("the student list renders", list.status === 200, `status ${list.status}`);
check("each class carries its join state", list.text.includes("data-live-state="));
check("a class scheduled in three days says when the room opens", list.text.includes("data-live-opens-at"));
check("it shows who is teaching the class", list.text.includes("data-live-class="));

const early = await post(`/api/live-classes/${liveClassId}/join`, cookie);
check("joining days early is refused", early.status === 409, `status ${early.status}`);
check("the refusal names the reason", early.json?.error === "too_early", JSON.stringify(early.json));
const noRow = await db.query(
  "select count(*)::int n from live_class_attendance where live_class_id = $1 and user_id = $2",
  [liveClassId, userId]
);
check("a refused join leaves no attendance record", Number(noRow.rows[0].n) === 0);

// Inside the window the class is joinable and the attendance is recorded.
await db.query("update live_classes set scheduled_at = now() + interval '5 minutes' where id = $1", [liveClassId]);
const open = await post(`/api/live-classes/${liveClassId}/join`, cookie);
check("joining inside the window succeeds", open.status === 200 && open.json?.joined === true, `status ${open.status}`);
const row = await db.query(
  "select joined_at from live_class_attendance where live_class_id = $1 and user_id = $2",
  [liveClassId, userId]
);
check("attendance is recorded with the moment it happened", Boolean(row.rows[0]?.joined_at));

const again = await post(`/api/live-classes/${liveClassId}/join`, cookie);
check("joining twice does not create a second row", again.status === 200);
const count = await db.query(
  "select count(*)::int n from live_class_attendance where live_class_id = $1 and user_id = $2",
  [liveClassId, userId]
);
check("the record still holds exactly one attendance", Number(count.rows[0].n) === 1);

check(
  "an unknown class cannot be joined",
  (await post("/api/live-classes/00000000-0000-0000-0000-000000000000/join", cookie)).status === 404
);
check("an anonymous caller cannot join", (await post(`/api/live-classes/${liveClassId}/join`)).status === 401);

// A cancelled class stays shut even inside its window.
await db.query("update live_classes set status = 'cancelled' where id = $1", [liveClassId]);
const cancelled = await post(`/api/live-classes/${liveClassId}/join`, cookie);
check("a cancelled class cannot be joined", cancelled.status === 409 && cancelled.json?.error === "cancelled", JSON.stringify(cancelled.json));

// Keep the database as it was found.
await db.query(
  "update live_classes set status = $2, scheduled_at = $3 where id = $1",
  [liveClassId, target.rows[0].status, target.rows[0].scheduled_at]
);
await db.query("delete from live_class_attendance where live_class_id = $1 and user_id = $2", [liveClassId, userId]);

// The staff roster is staff-only and shows the record.
const teacherCookie = await login("teacher@learnersarea.uz", "Teacher12345!");
const roster = await page(`/app/teacher/live-classes/${liveClassId}`, teacherCookie);
check("a teacher can open the class roster", roster.status === 200, `status ${roster.status}`);
check("the roster shows the attendance count", roster.text.includes("data-attendee-count="));
check("it reports whether a meeting link is set, never the link itself", roster.text.includes("data-class-has-link="));
check("it reports whether a recording exists", roster.text.includes("data-class-has-recording="));
check("it shows the join window's opening time", roster.text.includes("data-class-window="));

const studentRoster = await page(`/app/teacher/live-classes/${liveClassId}`, cookie);
check("a student cannot open the teacher roster", studentRoster.status !== 200 || !studentRoster.text.includes("data-class-roster"));
check("an anonymous visitor cannot open it", (await page(`/app/teacher/live-classes/${liveClassId}`)).status !== 200);

// Attendance is recorded for the roster, so a joined student appears by name.
await db.query(
  "insert into live_class_attendance (live_class_id, user_id) values ($1, $2)",
  [liveClassId, userId]
);
const rosterWithStudent = await page(`/app/teacher/live-classes/${liveClassId}`, teacherCookie);
check(
  "a student who joined appears in the roster by name",
  /data-attendee="demo\.student@learnersarea\.uz"/.test(rosterWithStudent.text)
);
check(
  "the roster records when they joined",
  /data-attendee="demo\.student@learnersarea\.uz"[\s\S]{0,300}data-attended-at/.test(rosterWithStudent.text)
);
await db.query("delete from live_class_attendance where live_class_id = $1 and user_id = $2", [liveClassId, userId]);

await db.end();

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}

// process.exit() skips beforeExit, so the sweep is awaited here on the normal path.
await finalSweep("end of run");
process.exit(failures.length || process.exitCode === 1 ? 1 : 0);
