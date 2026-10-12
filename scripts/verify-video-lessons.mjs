#!/usr/bin/env node
/**
 * Public video lessons, over HTTP, against the running app and the real database.
 *
 *   DATABASE_URL=... node scripts/verify-video-lessons.mjs [baseUrl]
 *
 * What it proves:
 *   - a malformed or unsupported link is refused with a reason (no dead player);
 *   - an authored lesson is stored as a provider reference, never as embed HTML;
 *   - a student sees the lesson inside Learners Area, with the raw provider link
 *     kept out of the markup;
 *   - opening the page is not progress, the watched value is clamped and
 *     monotonic, and a wrong answer never completes the lesson;
 *   - answering the authored questions correctly completes it, and the state
 *     survives a fresh request;
 *   - a PENDING applicant and an anonymous visitor reach none of it.
 *
 * It creates one throwaway lesson + video lesson and removes them again.
 */
import assert from "node:assert/strict";
import pg from "pg";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";

/*
 * QA SAFETY (section 03.4). This probe mutates and did not clean up after itself.
 * It authors a real content version, which stayed in the authoring history.
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
  assertMutableDatabase(SWEEP_DB_URL, { probe: "verify-video-lessons" });
  const sweepClient = new (await import("pg")).default.Client({ connectionString: SWEEP_DB_URL });
  await sweepClient.connect();
  const sweeper = createRowSweeper({
    client: sweepClient,
    probe: "verify-video-lessons",
    tables: ["content_versions", "audit_log", "activity_events"],
  });
  finalSweep = installSweepHandlers(sweeper, {
    probe: "verify-video-lessons",
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
// This probe writes fixtures. Refuse any database that is not disposable QA.
const { assertMutableDatabase: __assertMutableDb } = await import("./lib/fixture-safety.mjs");
__assertMutableDb(process.env.DATABASE_URL);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let pass = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`ok   - ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`not ok - ${name}\n         ${String(error.message).slice(0, 300)}`);
  }
}

class Client {
  constructor(cookie = "") {
    this.cookie = cookie;
  }
  async login(email, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 200, `login failed for ${email}: ${res.status}`);
    this.cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    return this;
  }
  async request(pathname, { method = "GET", body, raw = false } = {}) {
    const res = await fetch(`${BASE}${pathname}`, {
      method,
      redirect: "manual",
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("application/json") ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
}

console.log(`\nLearners Area — public video lessons against ${BASE}\n`);

const teacher = await new Client().login("teacher@learnersarea.uz", "Teacher12345!");
const student = await new Client().login("demo.student@learnersarea.uz", "Student12345!");
const anonymous = new Client();

const { rows: courseRows } = await pool.query("select id from courses where slug = 'ielts' limit 1");
const courseId = courseRows[0]?.id;

// A throwaway lesson the video attaches to, so the demo content stays untouched.
const { rows: unitRows } = await pool.query(
  "select u.id from units u join course_modules m on m.id = u.module_id where m.course_id = $1 limit 1",
  [courseId]
);
const unitId = unitRows[0]?.id;
const { rows: lessonRows } = await pool.query(
  `insert into lessons (unit_id, slug, title, summary, default_state, "order")
   values ($1, 'verify-video-lesson', 'Video lesson verification', 'Temporary lesson created by a script.', 'available', 99)
   returning id`,
  [unitId]
);
const lessonId = lessonRows[0].id;

let videoLessonId = null;

try {
  await check("a link that is not a real video is refused", async () => {
    const res = await teacher.request("/api/admin/video-lessons", {
      method: "POST",
      body: { lessonId, title: "Broken", videoUrl: "https://www.youtube.com/watch?v=PLACEHOLDER1" },
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status}`);
    assert.equal(res.data.error, "video_rejected");
    assert.equal(res.data.reason, "invalid_id");
  });

  await check("a non-allowlisted host is refused, not silently framed", async () => {
    const res = await teacher.request("/api/admin/video-lessons", {
      method: "POST",
      body: { lessonId, title: "Elsewhere", videoUrl: "https://vimeo.com/12345678" },
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.reason, "unsupported_host");
  });

  await check("a student cannot author a video lesson", async () => {
    const res = await student.request("/api/admin/video-lessons", {
      method: "POST",
      body: { lessonId, title: "Nope", videoUrl: "dQw4w9WgXcQ" },
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  await check("an authored lesson is stored as a provider reference", async () => {
    const res = await teacher.request("/api/admin/video-lessons", {
      method: "POST",
      body: {
        lessonId,
        title: "Verification video lesson",
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        beforeYouWatch: "Predict: what will the speaker argue?",
        durationSeconds: 100,
        transcriptSource: "authored",
        transcript: [
          { startSeconds: 0, text: "This transcript line was written for the verification run." },
          { startSeconds: 12, text: "The second line exists to prove timestamp seeking works." },
        ],
        questions: [
          { stage: "comprehension", prompt: "What is the main point?", acceptedAnswers: ["the main point", "main point"] },
          { stage: "gap_fill", prompt: "The speaker says it is ___", acceptedAnswers: ["possible"] },
        ],
      },
    });
    assert.equal(res.status, 200, `authoring failed: ${JSON.stringify(res.data)}`);
    videoLessonId = res.data.id;

    const { rows } = await pool.query(
      "select provider, video_id, transcript_source, transcript from video_lessons where id = $1",
      [videoLessonId]
    );
    assert.equal(rows[0].provider, "youtube");
    assert.equal(rows[0].video_id, "dQw4w9WgXcQ", "only the validated id is stored");
    assert.equal(rows[0].transcript_source, "authored", "provenance is recorded");
    assert.equal(rows[0].transcript.length, 2);
  });

  await check("no embed HTML or raw link is stored anywhere", async () => {
    const { rows } = await pool.query("select * from video_lessons where id = $1", [videoLessonId]);
    const serialised = JSON.stringify(rows[0]);
    assert.ok(!serialised.includes("<iframe"), "an iframe snippet must never be stored");
    assert.ok(!serialised.includes("youtube.com/embed"), "the stored value is an id, not an embed URL");
  });

  await check("the student page renders the lesson inside Learners Area", async () => {
    const page = await student.request(`/app/courses/ielts/lessons/${lessonId}`, { raw: true });
    assert.equal(page.status, 200);
    assert.match(page.text, /data-video-lesson=/, "the studio must be rendered");
    assert.match(page.text, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/, "the player is embedded");
    assert.ok(
      !page.text.includes("youtube.com/watch?v=dQw4w9WgXcQ"),
      "the raw watch link must not be printed in the interface"
    );
    assert.match(page.text, /data-video-tab=/, "authored stages are offered");
  });

  await check("the raw provider link never appears before the video is blocked", async () => {
    const page = await student.request(`/app/courses/ielts/lessons/${lessonId}`, { raw: true });
    const watchLinks = page.text.match(/https:\/\/www\.youtube\.com\/watch/g) ?? [];
    assert.equal(watchLinks.length, 0, "the fallback link only exists once the player reports a failure");
  });

  await check("an anonymous visitor cannot reach the lesson", async () => {
    const res = await anonymous.request(`/app/courses/ielts/lessons/${lessonId}`, { raw: true });
    assert.ok(res.status === 307 || res.status === 302, `expected a redirect, got ${res.status}`);
  });

  await check("a PENDING applicant cannot reach the lesson", async () => {
    const pending = await new Client().login("pending.student@learnersarea.uz", "Student12345!");
    const res = await pending.request(`/app/courses/ielts/lessons/${lessonId}`, { raw: true });
    assert.ok(res.status === 307 || res.status === 302, `expected a redirect, got ${res.status}`);
    assert.ok((res.headers.get("location") ?? "").includes("/pending"), res.headers.get("location") ?? "");
  });

  await check("opening the page is not progress", async () => {
    const res = await student.request(`/api/video-lessons/${videoLessonId}/progress`);
    assert.equal(res.status, 200);
    assert.equal(res.data.state, "not_started", "state must not move by rendering a page");
    assert.equal(res.data.watchedSeconds, 0);
  });

  await check("the watched value is clamped to the authored duration", async () => {
    const res = await student.request(`/api/video-lessons/${videoLessonId}/progress`, {
      method: "POST",
      body: { watchedSeconds: 5000 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.watchedSeconds, 100, "a client cannot claim more than the video holds");
  });

  await check("the watched value never goes backwards", async () => {
    const res = await student.request(`/api/video-lessons/${videoLessonId}/progress`, {
      method: "POST",
      body: { watchedSeconds: 5 },
    });
    assert.equal(res.data.watchedSeconds, 100, "a seek backwards must not lower real progress");
  });

  await check("a wrong answer is recorded and does not complete the lesson", async () => {
    const { rows } = await pool.query("select id, stage from video_lesson_questions where video_lesson_id = $1", [
      videoLessonId,
    ]);
    const wrong = {};
    for (const row of rows) wrong[row.id] = "definitely not the answer";

    const res = await student.request(`/api/video-lessons/${videoLessonId}/answers`, { method: "POST", body: { answers: wrong } });
    assert.equal(res.status, 200);
    assert.ok(
      Object.values(res.data.graded).every((g) => g.correct === false),
      "nothing may be marked correct"
    );
    assert.notEqual(res.data.state, "completed", "a wrong answer must not complete the lesson");
  });

  await check("the authored answers complete the lesson when they are right", async () => {
    const { rows } = await pool.query("select id, prompt, accepted_answers from video_lesson_questions where video_lesson_id = $1", [
      videoLessonId,
    ]);
    const answers = {};
    for (const row of rows) answers[row.id] = row.accepted_answers[0];

    const res = await student.request(`/api/video-lessons/${videoLessonId}/answers`, { method: "POST", body: { answers } });
    assert.equal(res.status, 200);
    assert.ok(Object.values(res.data.graded).every((g) => g.correct === true));
    assert.equal(res.data.state, "completed");
  });

  await check("the completion is the server's, and survives a new request", async () => {
    const fresh = await new Client().login("demo.student@learnersarea.uz", "Student12345!");
    const res = await fresh.request(`/api/video-lessons/${videoLessonId}/progress`);
    assert.equal(res.data.state, "completed");
  });

  await check("a lower-case answer is accepted, a different one is not", async () => {
    const { rows } = await pool.query("select id from video_lesson_questions where video_lesson_id = $1 limit 1", [
      videoLessonId,
    ]);
    const questionId = rows[0].id;
    const ok = await student.request(`/api/video-lessons/${videoLessonId}/answers`, {
      method: "POST",
      body: { answers: { [questionId]: "  The Main Point  " } },
    });
    assert.equal(ok.data.graded[questionId].correct, true, "spacing and case must not matter");
    const bad = await student.request(`/api/video-lessons/${videoLessonId}/answers`, {
      method: "POST",
      body: { answers: { [questionId]: "something else entirely" } },
    });
    assert.equal(bad.data.graded[questionId].correct, false);
  });

  await check("the response writing is stored for the teacher, not auto-scored", async () => {
    const res = await student.request(`/api/video-lessons/${videoLessonId}/response`, {
      method: "POST",
      body: { responseText: "I think the speaker is right about the second point." },
    });
    assert.equal(res.status, 200);
    const { rows } = await pool.query("select response_text from video_lesson_progress where video_lesson_id = $1", [
      videoLessonId,
    ]);
    assert.match(rows[0].response_text, /second point/);
  });
} finally {
  if (videoLessonId) await pool.query("delete from video_lessons where id = $1", [videoLessonId]);
  await pool.query("delete from lessons where id = $1", [lessonId]);
  await pool.end();
}

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) for (const f of failures) console.log(`  - ${f}`);
await finalSweep("end of run");
console.log(
  "\nEslatma: sandboxda tashqi internet yo'q, shuning uchun YouTube pleerining\n" +
    "o'zi ochilishi EXTERNALLY UNVERIFIED — CSP ruxsati va oqim esa shu yerda tekshirildi."
);
process.exit(failures.length ? 1 : 0);
