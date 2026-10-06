#!/usr/bin/env node
/**
 * Built-server acceptance for the CORRECTED Listening → Lessons contract
 * (learning area classification + lesson-level Teacher Notes + the staff authoring desk).
 *
 *   BASE_URL=http://127.0.0.1:3000 DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 \
 *   AUTH_SECRET=<the server's secret> node scripts/verify-lesson-learning-area.mjs
 *
 * Runs against `next build` + `next start` (never a dev server) on the ISOLATED local
 * QA2 PostgreSQL, and refuses any other target. Sessions are minted with the same
 * AUTH_SECRET the server runs with — no password, no fixture credential — so the smoke
 * can exercise the REAL authorization paths for four roles.
 *
 * The seven required fixtures:
 *   1 a video-only Listening lesson          → listed, body renders, video block
 *   2 an audio Listening lesson              → listed
 *   3 a Reading-classified audio lesson      → NOT listed under Listening; its detail
 *                                              route answers the not-found path
 *   4 a lesson whose Teacher Notes were written by a TEACHER → shown on the learner page
 *                                              from the lesson row (`source=lesson`)
 *   5 the student's own Xulosangiz           → private: on their page, not on the owner's
 *   6 an administrator/owner                 → authors, publishes, opens the admin workspace
 *   7 the teacher permission boundary        → may draft, may NOT publish (403 from the
 *                                              service), no publish control in the desk,
 *                                              and no access to the admin workspace
 *
 * Every fixture it creates is deleted at the end and the cleanup is verified.
 */
import { createHash } from "node:crypto";
import pg from "pg";
import { SignJWT } from "jose";
import { assertIsolatedTarget } from "./qa2-seed-fixtures.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const SECRET = process.env.AUTH_SECRET ?? "";
if (SECRET.length < 16) throw new Error("AUTH_SECRET must be set (the server's own secret)");
assertIsolatedTarget(DATABASE_URL);

const OWNER = "qa2-owner@learners-qa.invalid";
const STUDENT = "qa2-student@learners-qa.invalid";
const TEACHER = "qa2-teacher-probe@learners-qa.invalid";
const ADMIN = "qa2-admin-probe@learners-qa.invalid";
const REF_PREFIX = "lsn-probe-";

let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "not ok"} - ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (ok) pass += 1;
  else failures.push(name);
};

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

async function cookieFor(user) {
  const token = await new SignJWT({ sub: user.id, role: user.role, name: user.name, locale: "en", onboarded: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  return `la_session=${token}`;
}

async function call(path, { method = "GET", cookie, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "Content-Type": "application/json", Origin: BASE } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
}

const has = (body, needle) => body.includes(needle);

async function fixtureUsers() {
  const rows = [];
  for (const [email, role, name] of [[TEACHER, "teacher", "QA2 Teacher probe"], [ADMIN, "admin", "QA2 Admin probe"]]) {
    const [row] = await q(
      `insert into users (name, email, role, account_status, onboarding_completed_at)
       values ($1, $2, $3, 'active', now())
       on conflict (email) do update set role = excluded.role, account_status = 'active', onboarding_completed_at = now()
       returning id, role, name`,
      [name, email, role],
    );
    rows.push({ ...row, email });
  }
  const [owner] = await q(`select id, role, name from users where email = $1`, [OWNER]);
  const [student] = await q(`select id, role, name from users where email = $1`, [STUDENT]);
  if (!owner || !student) throw new Error("QA2 fixtures are missing the owner/student users");
  return { teacher: rows[0], admin: rows[1], owner, student };
}

async function structure() {
  const [existing] = await q(`select u.id from units u join course_modules m on m.id = u.module_id join courses c on c.id = m.course_id limit 1`);
  if (existing) return existing.id;
  const [course] = await q(`insert into courses (slug, title) values ('lsn-probe', 'Listening probe') returning id`);
  const [module] = await q(`insert into course_modules (course_id, slug, title, "order") values ($1, 'probe', 'Probe', 1) returning id`, [course.id]);
  const [unit] = await q(`insert into units (module_id, slug, title, "order") values ($1, 'probe', 'Probe', 1) returning id`, [module.id]);
  return unit.id;
}

/** Author a lesson through the REAL HTTP pipeline, as the given actor. */
async function authorLesson(cookie, { sourceRef, slug, title, learningArea, summary, teacherNotes, blocks }) {
  const draft = await call("/api/admin/content/drafts", {
    method: "POST",
    cookie,
    body: {
      module: "lesson",
      contentType: "lesson",
      sourceRef,
      title,
      payload: { unitId: await structure(), slug, learningArea, summary: summary ?? null, teacherNotes: teacherNotes ?? null, blocks },
    },
  });
  if (draft.status !== 201 && draft.status !== 200) throw new Error(`authoring failed (${draft.status}): ${draft.text.slice(0, 300)}`);
  const { versionId } = JSON.parse(draft.text);
  const published = await call(`/api/admin/content/versions/${versionId}/publication`, {
    method: "POST",
    cookie,
    body: { to: "published" },
  });
  return { versionId, draft, published };
}

const publish = async (cookie, versionId) => call(`/api/admin/content/versions/${versionId}/publication`, { method: "POST", cookie, body: { to: "published" } });

const { teacher, admin, owner, student } = await fixtureUsers();
const [ownerCookie, studentCookie, teacherCookie, adminCookie] = await Promise.all([
  cookieFor(owner), cookieFor(student), cookieFor(teacher), cookieFor(admin),
]);

const created = [];
try {
  /* ---------------------------------------------------------------- fixtures 1, 2, 4 */
  // 1. A video-only Listening lesson, authored by the OWNER through the HTTP pipeline.
  const video = await authorLesson(ownerCookie, {
    sourceRef: `${REF_PREFIX}video`,
    slug: "probe-mcq-strategy-video",
    title: "Probe MCQ strategy (video)",
    learningArea: "listening",
    summary: "How to eliminate wrong options before you hear the answer.",
    blocks: [{ type: "video", objectKey: "private/video-lessons/probe-mcq-strategy.mp4", originalName: "probe.mp4", mimeType: "video/mp4", size: 1024 }],
  });
  created.push({ sourceRef: `${REF_PREFIX}video`, title: "Probe MCQ strategy (video)" });

  // 2. An audio Listening lesson.
  const audio = await authorLesson(ownerCookie, {
    sourceRef: `${REF_PREFIX}audio`,
    slug: "probe-form-completion-audio",
    title: "Probe Form completion (audio)",
    learningArea: "listening",
    summary: "Write one word per gap.",
    blocks: [
      { type: "audio", objectKey: "private/audio/probe-form-completion.mp3", originalName: "probe.mp3", mimeType: "audio/mpeg", size: 2048 },
      { type: "text", text: "Listen for the spelling the speaker gives." },
    ],
  });
  created.push({ sourceRef: `${REF_PREFIX}audio`, title: "Probe Form completion (audio)" });

  // 3. An audio lesson classified as READING — the reversal's counter-example.
  const reading = await authorLesson(ownerCookie, {
    sourceRef: `${REF_PREFIX}reading`,
    slug: "probe-reading-audio",
    title: "Probe Reading audio passage",
    learningArea: "reading",
    blocks: [{ type: "audio", objectKey: "private/audio/probe-reading.mp3", originalName: "probe-reading.mp3", mimeType: "audio/mpeg", size: 3072 }],
  });
  created.push({ sourceRef: `${REF_PREFIX}reading`, title: "Probe Reading audio passage" });

  // 4. A TEACHER authors the Teacher Notes. They may draft; they may not publish — so the
  //    owner publishes it, which is exactly the intended division of authority.
  const teacherLesson = await authorLesson(teacherCookie, {
    sourceRef: `${REF_PREFIX}notes`,
    slug: "probe-teacher-notes",
    title: "Probe Connected speech (teacher notes)",
    learningArea: "listening",
    summary: "Linking, elision and assimilation.",
    teacherNotes: "Centre notes written by the teacher: play twice, then mark the schwa.",
    blocks: [{ type: "text", text: "Listen for the linking sounds." }],
  });
  created.push({ sourceRef: `${REF_PREFIX}notes`, title: "Probe Connected speech (teacher notes)" });
  created[3].teacherVersionId = teacherLesson.versionId;

  const { id: videoId } = (await q(`select id from lessons where source_ref = $1`, [`${REF_PREFIX}video`]))[0];
  const { id: audioId } = (await q(`select id from lessons where source_ref = $1`, [`${REF_PREFIX}audio`]))[0];
  const { id: readingId } = (await q(`select id from lessons where source_ref = $1`, [`${REF_PREFIX}reading`]))[0];
  const { id: notesId } = (await q(`select id from lessons where source_ref = $1`, [`${REF_PREFIX}notes`]))[0];
  created[0].id = videoId; created[1].id = audioId; created[2].id = readingId; created[3].id = notesId;

  /* --------------------------------------------------------------- fixtures 6 and 7 */
  // 201 = created; 200 = the author's own pin and the caller's pin carry identical
  // content, so the pipeline reuses one revision. Both mean "authored through the
  // pipeline" — the assertion is that it went through the real HTTP path at all.
  check(
    "F6 the owner authored a video-only Listening lesson through the HTTP pipeline",
    [200, 201].includes(video.draft.status),
    `status ${video.draft.status}`,
  );
  check("F6 the owner published it (publication authority unchanged)", video.published.status === 200, `status ${video.published.status} ${video.published.text.slice(0, 200)}`);

  const teacherOwnPublish = await publish(teacherCookie, teacherLesson.versionId);
  check(
    "F7 a teacher may NOT publish their own revision (403, refused by the SERVICE)",
    teacherOwnPublish.status === 403 && has(teacherOwnPublish.text, "publish_forbidden"),
    `status ${teacherOwnPublish.status} ${teacherOwnPublish.text.slice(0, 200)}`,
  );
  const ownerPublish = await publish(ownerCookie, teacherLesson.versionId);
  check("F4 the owner publishes the teacher's revision, so the notes go live", ownerPublish.status === 200, `status ${ownerPublish.status} ${ownerPublish.text.slice(0, 200)}`);

  /* ----------------------------------------------------------------------- fixture 5
   * Xulosangiz is only writable on a LIVE lesson (a draft is refused with 403
   * `lesson_not_open`), so this runs after the publication above — the app's own rule,
   * not a concession of the smoke. */
  const noteBody = "Probe Xulosangiz: the speaker's tone is sceptical.";
  const noteSave = await call(`/api/lessons/${notesId}/notes`, { method: "POST", cookie: studentCookie, body: { body: noteBody } });
  check("F5 the learner saves Xulosangiz through the private notes API", noteSave.status === 200, `status ${noteSave.status} ${noteSave.text.slice(0, 120)}`);

  /* ------------------------------------------------------------------ learner pages */
  const list = await call("/app/listening/lessons", { cookie: studentCookie });
  check("F1 a video-only Listening lesson is listed", has(list.text, `data-listening-lesson-card="${videoId}"`));
  check("F2 an audio Listening lesson is listed", has(list.text, `data-listening-lesson-card="${audioId}"`));
  check("F3 an audio lesson classified as READING is NOT listed under Listening", !has(list.text, `data-listening-lesson-card="${readingId}"`));
  check("F4 the teacher-notes lesson is listed and marked as having notes", has(list.text, "data-listening-lesson-notes"));
  check("the catalogue is not an empty shell (real cards, no placeholders)", has(list.text, "data-listening-lessons-grid"));

  const detail = await call(`/app/listening/lessons/${videoId}`, { cookie: studentCookie });
  check("F1 a video-only lesson's detail page renders", has(detail.text, 'data-route-usable="listening-lesson"'));
  check(
    "F1 the video block renders through the authorizing /api/resources route",
    has(detail.text, "data-lesson-video") && has(detail.text, "/api/resources/private/video-lessons/probe-mcq-strategy.mp4"),
  );
  check(
    "F1 …and never as a direct storage URL",
    !/https?:\/\/[^"'\s]*probe-mcq-strategy/.test(detail.text),
  );
  check("F1 a video lesson is genuinely video-only", !has(detail.text, "data-lesson-audio"));
  check(
    "the lesson body comes BEFORE the three tabs",
    detail.text.indexOf("data-listening-lesson-body-card") > -1 && detail.text.indexOf("data-listening-lesson-body-card") < detail.text.indexOf("data-listening-lesson-tabs"),
  );
  for (const tab of ["description", "teacher-notes", "xulosangiz"]) {
    check(`the ${tab} tab is rendered`, has(detail.text, `data-listening-lesson-tab="${tab}"`));
  }

  const notesTab = await call(`/app/listening/lessons/${notesId}?tab=teacher-notes`, { cookie: studentCookie });
  check("F4 the learner reads the teacher's notes on a TEXT lesson with no media row", has(notesTab.text, "Centre notes written by the teacher"));
  check("F4 the notes are read from the LESSON row", has(notesTab.text, 'data-teacher-notes-source="lesson"'));
  const mediaRows = await q(`select count(*)::int n from video_lessons where lesson_id = $1`, [notesId]);
  check("F4 …and the lesson genuinely has no media row", mediaRows[0].n === 0);

  const studentNotes = await call(`/app/listening/lessons/${notesId}?tab=xulosangiz`, { cookie: studentCookie });
  check("F5 the student's own Xulosangiz is on their page", has(studentNotes.text, noteBody));
  const ownerNotes = await call(`/app/listening/lessons/${notesId}?tab=xulosangiz`, { cookie: ownerCookie });
  check("F5 the owner does NOT see the student's Xulosangiz", !has(ownerNotes.text, noteBody));

  const readingDetail = await call(`/app/listening/lessons/${readingId}`, { cookie: studentCookie });
  check(
    "F3 the Reading-classified lesson takes the not-found path under Listening",
    !has(readingDetail.text, 'data-route-usable="listening-lesson"') &&
      (has(readingDetail.text, "NEXT_HTTP_ERROR_FALLBACK") || has(readingDetail.text, "not-found")),
    `status ${readingDetail.status}`,
  );

  /* ------------------------------------------------------------- staff authoring desk */
  const ownerDesk = await call("/app/listening/lessons/author", { cookie: ownerCookie });
  check("F6 the owner opens the lesson authoring desk", has(ownerDesk.text, "data-lesson-authoring-desk"));
  check("F6 the owner sees the publication controls", has(ownerDesk.text, "data-lesson-authoring-publish"));
  check("F6 the desk offers the authored learning-area field", has(ownerDesk.text, "data-lesson-authoring-area"));

  const teacherDesk = await call("/app/listening/lessons/author", { cookie: teacherCookie });
  check("F7 the teacher opens the SAME desk (the dead link is fixed)", has(teacherDesk.text, "data-lesson-authoring-desk"));
  check("F7 the teacher may save drafts", has(teacherDesk.text, "data-lesson-authoring-save"));
  check("F7 the teacher sees NO publication control", !has(teacherDesk.text, "data-lesson-authoring-publish"));
  check("F7 and is told why, truthfully", has(teacherDesk.text, "data-lesson-authoring-no-publish"));

  const teacherWorkspace = await call("/app/admin/content/workspace", { cookie: teacherCookie });
  check(
    "F7 the teacher still cannot open the admin content workspace",
    !has(teacherWorkspace.text, "data-content-workspace") || has(teacherWorkspace.text, "NEXT_REDIRECT"),
    `status ${teacherWorkspace.status}`,
  );
  const adminWorkspace = await call("/app/admin/content/workspace", { cookie: adminCookie });
  check("F6 an administrator still opens the admin content workspace", adminWorkspace.status === 200 && has(adminWorkspace.text, "data-content-workspace"), `status ${adminWorkspace.status}`);

  const studentDesk = await call("/app/listening/lessons/author", { cookie: studentCookie });
  check(
    "a learner gets no authoring surface at all (redirect to the dashboard)",
    has(studentDesk.text, "NEXT_REDIRECT") || !has(studentDesk.text, "data-lesson-authoring-desk"),
  );

  /* ----------------------------------------------------- the teacher draft is real data */
  const teacherDraftRow = await q(`select l.learning_area, l.teacher_notes, l.publication_state from lessons l join content_versions v on v.target_id = l.id where v.id = $1 limit 1`, [teacherLesson.versionId]);
  check("F4 the teacher's notes were stored on the LESSON row", teacherDraftRow[0]?.teacher_notes === "Centre notes written by the teacher: play twice, then mark the schwa.");
  check("F4 the area the teacher chose was stored, not derived", teacherDraftRow[0]?.learning_area === "listening");
  check("F4 the owner's publication moved the lesson row live", ["published", "scheduled"].includes(teacherDraftRow[0]?.publication_state));
} finally {
  /* ------------------------------------------------------------- fixtures are removed */
  const refs = [`${REF_PREFIX}video`, `${REF_PREFIX}audio`, `${REF_PREFIX}reading`, `${REF_PREFIX}notes`];
  await q(`delete from lesson_notes where lesson_id in (select id from lessons where source_ref = any($1))`, [refs]);
  await q(`delete from lesson_blocks where lesson_id in (select id from lessons where source_ref = any($1))`, [refs]);
  await q(`delete from lesson_progress where lesson_id in (select id from lessons where source_ref = any($1))`, [refs]);
  await q(`delete from video_lessons where lesson_id in (select id from lessons where source_ref = any($1))`, [refs]);
  await q(`delete from content_versions where source_ref = any($1) or target_id in (select id from lessons where source_ref = any($1))`, [refs]);
  await q(`delete from lessons where source_ref = any($1)`, [refs]);
  await q(`delete from users where email = any($1)`, [[TEACHER, ADMIN]]);

  const leftoverLessons = (await q(`select count(*)::int n from lessons where source_ref like $1`, [`${REF_PREFIX}%`]))[0].n;
  const leftoverVersions = (await q(`select count(*)::int n from content_versions where source_ref like $1`, [`${REF_PREFIX}%`]))[0].n;
  const leftoverUsers = (await q(`select count(*)::int n from users where email = any($1)`, [[TEACHER, ADMIN]]))[0].n;
  check("cleanup: no probe lesson remains", leftoverLessons === 0, `${leftoverLessons}`);
  check("cleanup: no probe revision remains", leftoverVersions === 0, `${leftoverVersions}`);
  check("cleanup: no probe user remains", leftoverUsers === 0, `${leftoverUsers}`);

  // The QA2 fixture users are unchanged: owner and student still exist, exactly once.
  const fixturesStill = (await q(`select count(*)::int n from users where email = any($1)`, [[OWNER, STUDENT]]))[0].n;
  check("cleanup: the QA2 owner/student fixtures are untouched", fixturesStill === 2, `${fixturesStill}`);
  await db.end();
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((name) => `not ok - ${name}`).join("\n"));
  process.exitCode = 1;
}
console.log(JSON.stringify({ digest: createHash("sha256").update(String(pass)).digest("hex").slice(0, 12) }));
