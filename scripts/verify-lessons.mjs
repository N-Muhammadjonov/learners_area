#!/usr/bin/env node
/**
 * Lesson shell — server-authoritative state, a recording, and private notes.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

/*
 * QA SAFETY (section 03.4). This probe mutates and, until now, never cleaned up.
 * It writes real lesson notes and progress for the demo student, which then show up
 * in that student's lesson surfaces on every later run and measurement.
 *
 * Measured, not assumed: scripts/audit-probe-residue.mjs counts every row in every
 * table before and after a run. Cleanup is differential — snapshot the owned tables
 * before the first mutation, delete exactly the ids that appeared, then re-query to
 * prove they are gone. A pre-existing row is never touched.
 */
const SWEEP_DB_URL = process.env.DATABASE_URL;
let sweepClient = null;
let progressBorrower = null;
const { assertMutableDatabase, createRowBorrower, createRowSweeper, installSweepHandlers } =
  await import("./lib/fixture-safety.mjs");
let finalSweep = async () => {};
if (SWEEP_DB_URL) {
  assertMutableDatabase(SWEEP_DB_URL, { probe: "verify-lessons" });
  sweepClient = new (await import("pg")).default.Client({ connectionString: SWEEP_DB_URL });
  await sweepClient.connect();
  const sweeper = createRowSweeper({
    client: sweepClient,
    probe: "verify-lessons",
    tables: ["lesson_notes", "lesson_progress", "activity_events"],
  });
  finalSweep = installSweepHandlers(sweeper, {
    probe: "verify-lessons",
    // Restoring borrowed rows is part of cleanup, so it runs on every exit path the
    // sweep runs on — including a throw.
    onDone: async () => {
      await progressBorrower.restore();
      await sweepClient.end().catch(() => {});
    },
  });
  progressBorrower = createRowBorrower({
    client: sweepClient,
    table: "lesson_progress",
    probe: "verify-lessons",
  });
  await sweeper.capture();
}

if (!SWEEP_DB_URL) {
  // Honest about the gap rather than silently skipping it: without a connection this
  // run WILL leave rows behind, and the operator should know before it starts.
  console.warn("  !! DATABASE_URL is not set — fixtures created by this run cannot be cleaned up");
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

async function api(path, { method = "GET", cookie, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json };
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

console.log(`\nLearners Area — Lesson shell against ${BASE}\n`);

const { default: pg } = await import("pg");
const db = new pg.Client({
  connectionString: (process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5433/learners_area"),
});
await db.connect();

const cookie = await login("new.student@learnersarea.uz", "Student12345!");
check("a fresh student can sign in", Boolean(cookie));

// Test-side setup: this student's lesson progress is cleared so the state machine can
// be walked from the start on every run. The rows are SAVED first and put back during
// cleanup — they are seed data, and a probe that consumes them leaves the database
// poorer than it found it.
if (progressBorrower) {
  await progressBorrower.borrow(
    "user_id = (select id from users where email = $1)",
    ["new.student@learnersarea.uz"],
  );
}
await db.query(
  "delete from lesson_progress where user_id = (select id from users where email = 'new.student@learnersarea.uz')"
);

const roadmap = await page("/app/courses/ielts", cookie);
check("the roadmap renders", roadmap.status === 200, `status ${roadmap.status}`);
check("lessons are addressable", roadmap.text.includes("data-lesson="));
check("an open lesson offers a link", roadmap.text.includes("data-lesson-open="));

const rows = await db.query(
  "select id, title, default_state, recording_url from lessons order by \"order\" limit 20"
);
const openLesson = rows.rows.find((r) => r.default_state !== "locked");
const lockedLesson = rows.rows.find((r) => r.default_state === "locked");
const recorded = rows.rows.find((r) => r.recording_url);
check("the seed has an open lesson", Boolean(openLesson));
check("the seed has a locked lesson", Boolean(lockedLesson));
// A recording is optional by design: the seed ships none, because a demo file we
// did not record would be fake content. The check is that the page behaves
// honestly in both states.
check("the seed carries no recording (a real state, not an error)", !recorded);

const openPage = await page(`/app/courses/ielts/lessons/${openLesson.id}`, cookie);
check("the lesson shell renders", openPage.status === 200, `status ${openPage.status}`);
check("the state is rendered from the server value", openPage.text.includes(`data-lesson-state="${openLesson.default_state}"`));
check("the notes pad is present", openPage.text.includes("data-lesson-notes"));
check("the student can start the lesson", openPage.text.includes("data-lesson-start"));

if (recorded) {
  const recordedPage = await page(`/app/courses/ielts/lessons/${recorded.id}`, cookie);
  check("the recorded-lesson shell shows the recording", recordedPage.text.includes("data-lesson-recording"));
} else {
  check(
    "without a recording the shell shows the lesson instead of an empty player",
    !openPage.text.includes("data-lesson-recording") && openPage.text.includes("data-lesson-notes")
  );
}

const lockedPage = await page(`/app/courses/ielts/lessons/${lockedLesson.id}`, cookie);
check("a locked lesson says so", lockedPage.text.includes("data-lesson-closed"));
check("a locked lesson offers no controls", !lockedPage.text.includes("data-lesson-start"));

const lockedStart = await api(`/api/lessons/${lockedLesson.id}/state`, {
  method: "POST",
  cookie,
  body: { state: "completed" },
});
check("a locked lesson cannot be completed", lockedStart.status === 403, `status ${lockedStart.status}`);
// Notes are a PRIVATE SCRATCHPAD gated on publication, not on the unlock ladder: a
// learner may annotate any published lesson, including one the centre still shows as
// locked (tests/lesson-authoring-revision.test.ts R5 asserts exactly that, and the note
// is keyed to the learner so nothing leaks). The real negative control is an
// UNPUBLISHED lesson, which must never accept a note.
const lockedNotes = await api(`/api/lessons/${lockedLesson.id}/notes`, {
  method: "POST",
  cookie,
  body: { notes: "allowed on a published lesson" },
});
check(
  "a published lesson accepts the learner's private note even while locked",
  lockedNotes.status === 200,
  `status ${lockedNotes.status}`
);

const draftRow = await db.query(
  "select id from lessons where publication_state <> 'published' order by \"order\" limit 1"
);
const draftLessonId = draftRow.rows[0]?.id;
if (draftLessonId) {
  const draftNotes = await api(`/api/lessons/${draftLessonId}/notes`, {
    method: "POST",
    cookie,
    body: { notes: "must never be stored" },
  });
  check(
    "an unpublished lesson refuses notes",
    draftNotes.status === 403 || draftNotes.status === 404,
    `status ${draftNotes.status}`
  );
  const leaked = await db.query("select count(*)::int as n from lesson_notes where lesson_id = $1", [draftLessonId]);
  check("no note was persisted against an unpublished lesson", leaked.rows[0]?.n === 0, `rows ${leaked.rows[0]?.n}`);
}
const missingNotes = await api(`/api/lessons/00000000-0000-4000-8000-000000000000/notes`, {
  method: "POST",
  cookie,
  body: { notes: "nowhere" },
});
check("a note for a nonexistent lesson is refused", missingNotes.status === 404, `status ${missingNotes.status}`);

const started = await api(`/api/lessons/${openLesson.id}/state`, { method: "POST", cookie, body: { state: "in_progress" } });
check("an open lesson can be started", started.status === 200 && started.json?.state === "in_progress");
// Starting an already-started lesson changes nothing, so it is idempotent
// rather than an error; completing twice is the move that must be refused.
const again = await api(`/api/lessons/${openLesson.id}/state`, { method: "POST", cookie, body: { state: "in_progress" } });
check(
  "restarting an in-progress lesson is idempotent",
  again.status === 200 && again.json?.state === "in_progress",
  `status ${again.status}`
);

const notesText = `verification notes ${Date.now()}`;
const notes = await api(`/api/lessons/${openLesson.id}/notes`, { method: "POST", cookie, body: { notes: notesText } });
check("notes can be saved on an open lesson", notes.status === 200);
// Private notes live in their own `lesson_notes` table, keyed by (user, lesson) — not
// in the legacy lesson_progress.notes column the old probe read, which is why this
// looked broken while production was correct.
const stored = await db.query(
  "select body from lesson_notes where lesson_id = $1 and user_id = (select id from users where email = 'new.student@learnersarea.uz')",
  [openLesson.id]
);
check("the notes are stored verbatim", stored.rows[0]?.body === notesText, `stored ${JSON.stringify(stored.rows[0])}`);
const foreign = await db.query(
  "select count(*)::int as n from lesson_notes where lesson_id = $1 and user_id <> (select id from users where email = 'new.student@learnersarea.uz')",
  [openLesson.id]
);
check("a note belongs to exactly one learner", foreign.rows[0]?.n === 0, `foreign rows ${foreign.rows[0]?.n}`);

const completed = await api(`/api/lessons/${openLesson.id}/state`, {
  method: "POST",
  cookie,
  body: { state: "completed" },
});
check("an open lesson can be completed", completed.status === 200 && completed.json?.state === "completed");
const twice = await api(`/api/lessons/${openLesson.id}/state`, { method: "POST", cookie, body: { state: "completed" } });
check("a lesson cannot be completed twice", twice.status === 409, `status ${twice.status}`);

const afterRow = await db.query(
  "select state, completed_at from lesson_progress where lesson_id = $1 and user_id = (select id from users where email = 'new.student@learnersarea.uz')",
  [openLesson.id]
);
check("completion records a real timestamp", afterRow.rows[0]?.state === "completed" && Boolean(afterRow.rows[0]?.completed_at));
const afterNote = await db.query(
  "select body from lesson_notes where lesson_id = $1 and user_id = (select id from users where email = 'new.student@learnersarea.uz')",
  [openLesson.id]
);
check("notes survive a state change", afterNote.rows[0]?.body === notesText, `after ${JSON.stringify(afterNote.rows[0])}`);

check("an anonymous caller cannot set state", (await api(`/api/lessons/${openLesson.id}/state`, { method: "POST", body: { state: "completed" } })).status === 401);
const missing = await api("/api/lessons/00000000-0000-0000-0000-000000000000/state", {
  method: "POST",
  cookie,
  body: { state: "completed" },
});
check("an unknown lesson is a 404", missing.status === 404, `status ${missing.status}`);

const other = await login("demo.student@learnersarea.uz", "Student12345!");
const otherPage = await page(`/app/courses/ielts/lessons/${openLesson.id}`, other);
check(
  "another student's notes are not visible",
  otherPage.status === 200 && !otherPage.text.includes(notesText),
  "notes leaked across students"
);

await db.end();

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}

// process.exit() skips beforeExit, so the sweep is awaited here on the normal path.
await finalSweep("end of run");
process.exit(failures.length || process.exitCode === 1 ? 1 : 0);
