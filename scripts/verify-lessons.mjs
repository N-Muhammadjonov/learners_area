#!/usr/bin/env node
/**
 * Lesson shell — server-authoritative state, a recording, and private notes.
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
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/learners_area",
});
await db.connect();

const cookie = await login("new.student@learnersarea.uz", "Student12345!");
check("a fresh student can sign in", Boolean(cookie));

// Test-side setup: this student's lesson progress is cleared so the state
// machine can be walked from the start on every run. Nothing else is touched.
await db.query(
  "delete from lesson_progress where user_id = (select id from users where email = 'new.student@learnersarea.uz')"
);

const roadmap = await page("/courses/ielts", cookie);
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

const openPage = await page(`/courses/ielts/lessons/${openLesson.id}`, cookie);
check("the lesson shell renders", openPage.status === 200, `status ${openPage.status}`);
check("the state is rendered from the server value", openPage.text.includes(`data-lesson-state="${openLesson.default_state}"`));
check("the notes pad is present", openPage.text.includes("data-lesson-notes"));
check("the student can start the lesson", openPage.text.includes("data-lesson-start"));

if (recorded) {
  const recordedPage = await page(`/courses/ielts/lessons/${recorded.id}`, cookie);
  check("the recorded-lesson shell shows the recording", recordedPage.text.includes("data-lesson-recording"));
} else {
  check(
    "without a recording the shell shows the lesson instead of an empty player",
    !openPage.text.includes("data-lesson-recording") && openPage.text.includes("data-lesson-notes")
  );
}

const lockedPage = await page(`/courses/ielts/lessons/${lockedLesson.id}`, cookie);
check("a locked lesson says so", lockedPage.text.includes("data-lesson-closed"));
check("a locked lesson offers no controls", !lockedPage.text.includes("data-lesson-start"));

const lockedStart = await api(`/api/lessons/${lockedLesson.id}/state`, {
  method: "POST",
  cookie,
  body: { state: "completed" },
});
check("a locked lesson cannot be completed", lockedStart.status === 403, `status ${lockedStart.status}`);
const lockedNotes = await api(`/api/lessons/${lockedLesson.id}/notes`, {
  method: "POST",
  cookie,
  body: { notes: "should not be stored" },
});
check("notes cannot be written on a locked lesson", lockedNotes.status === 403, `status ${lockedNotes.status}`);

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
const stored = await db.query(
  "select notes from lesson_progress where lesson_id = $1 and user_id = (select id from users where email = 'new.student@learnersarea.uz')",
  [openLesson.id]
);
check("the notes are stored verbatim", stored.rows[0]?.notes === notesText);

const completed = await api(`/api/lessons/${openLesson.id}/state`, {
  method: "POST",
  cookie,
  body: { state: "completed" },
});
check("an open lesson can be completed", completed.status === 200 && completed.json?.state === "completed");
const twice = await api(`/api/lessons/${openLesson.id}/state`, { method: "POST", cookie, body: { state: "completed" } });
check("a lesson cannot be completed twice", twice.status === 409, `status ${twice.status}`);

const afterRow = await db.query(
  "select state, completed_at, notes from lesson_progress where lesson_id = $1 and user_id = (select id from users where email = 'new.student@learnersarea.uz')",
  [openLesson.id]
);
check("completion records a real timestamp", afterRow.rows[0]?.state === "completed" && Boolean(afterRow.rows[0]?.completed_at));
check("notes survive a state change", afterRow.rows[0]?.notes === notesText);

check("an anonymous caller cannot set state", (await api(`/api/lessons/${openLesson.id}/state`, { method: "POST", body: { state: "completed" } })).status === 401);
const missing = await api("/api/lessons/00000000-0000-0000-0000-000000000000/state", {
  method: "POST",
  cookie,
  body: { state: "completed" },
});
check("an unknown lesson is a 404", missing.status === 404, `status ${missing.status}`);

const other = await login("demo.student@learnersarea.uz", "Student12345!");
const otherPage = await page(`/courses/ielts/lessons/${openLesson.id}`, other);
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
process.exit(failures.length ? 1 : 0);
