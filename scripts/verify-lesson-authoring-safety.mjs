#!/usr/bin/env node
/**
 * Built-server acceptance for the LESSON AUTHORING SAFETY CORRECTION (§36 HUMAN SCENARIO).
 *
 *   LD_LIBRARY_PATH=/tmp/qa2-pg/package/native/lib \
 *   BASE_URL=http://127.0.0.1:3000 DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 \
 *   AUTH_SECRET=<the server's secret> node scripts/verify-lesson-authoring-safety.mjs
 *
 * This is the scenario a human editor performs years later, executed against
 * `next build` + `next start` on the ISOLATED local QA2 database (it refuses any other
 * target), with sessions minted from the server's own AUTH_SECRET so every request goes
 * through the REAL authorization path for four roles:
 *
 *   open an existing lesson → see EXACTLY what is inside it → change ONE thing → save →
 *   be confident unrelated content was not erased.
 *
 * What each group proves:
 *   H  hydration: the staff edit projection carries every authored field and block, in
 *      order, with media metadata and the quiz key; the list page does NOT embed the body
 *      (detail is a second request);
 *   V  the live revision: a published lesson shows `Published v1`, no draft, and students
 *      are reading v1;
 *   R  revisioning: starting a revision copies v1 into a draft, is idempotent, and never
 *      rewrites the published revision or the live row;
 *   S  single-field save: changing only Teacher Notes keeps title, slug, reference, unit,
 *      area, description, minutes and every block byte-identical — and repeated saves keep
 *      ONE editable draft instead of piling up v3, v4, v5;
 *   P  publication: a teacher cannot publish (403 `publish_forbidden`); the owner can; the
 *      learner then reads the new revision while the old one stays readable;
 *   X  Xulosangiz: the learner's private note survives v1 → v2 untouched;
 *   C  capability: a teacher may author a lesson and may NOT author other registered
 *      content types through the generic route; the capabilities endpoint says so;
 *   E  errors: a refused save answers with plain sentences attached to the offending
 *      field, never a stack trace or an internal code.
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
const TEACHER = "qa2-authoring-teacher@learners-qa.invalid";
const ADMIN = "qa2-authoring-admin@learners-qa.invalid";
const REF = "qa2-authoring-probe";

let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "not ok"} - ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (ok) pass += 1;
  else failures.push(name);
};

// This probe writes fixtures. Refuse any database that is not disposable QA.

const { assertMutableDatabase: __assertMutableDb } = await import("./lib/fixture-safety.mjs");

__assertMutableDb(DATABASE_URL);

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

const json = (response) => {
  try {
    return JSON.parse(response.text);
  } catch {
    return null;
  }
};
const has = (body, needle) => body.includes(needle);

async function users() {
  const staff = [];
  for (const [email, role, name] of [
    [TEACHER, "teacher", "QA2 authoring teacher"],
    [ADMIN, "admin", "QA2 authoring admin"],
  ]) {
    const [row] = await q(
      `insert into users (name, email, role, account_status, onboarding_completed_at)
       values ($1, $2, $3, 'active', now())
       on conflict (email) do update set role = excluded.role, account_status = 'active', onboarding_completed_at = now()
       returning id, role, name, email`,
      [name, email, role],
    );
    staff.push(row);
  }
  const [owner] = await q(`select id, role, name, email from users where email = $1`, [OWNER]);
  const [student] = await q(`select id, role, name, email from users where email = $1`, [STUDENT]);
  if (!owner || !student) throw new Error("QA2 fixtures are missing the owner/student users");
  return { teacher: staff[0], admin: staff[1], owner, student };
}

async function unitId() {
  const [existing] = await q(`select u.id from units u join course_modules m on m.id = u.module_id join courses c on c.id = m.course_id limit 1`);
  if (existing) return existing.id;
  const [course] = await q(`insert into courses (slug, title) values ('qa2-authoring', 'QA2 authoring') returning id`);
  const [module] = await q(`insert into course_modules (course_id, slug, title, "order") values ($1, 'probe', 'Probe', 1) returning id`, [course.id]);
  const [unit] = await q(`insert into units (module_id, slug, title, "order") values ($1, 'probe', 'Probe', 1) returning id`, [module.id]);
  return unit.id;
}

const AUTHORED = {
  title: "Probe Connected speech",
  slug: "qa2-probe-connected-speech",
  summary: "Linking, elision and assimilation, with a worked example.",
  teacherNotes: "Centre notes: play the clip twice, then mark the schwa. Ask for three examples.",
  estimatedMinutes: 20,
  learningArea: "listening",
  blocks: [
    { type: "text", text: "Listen to the clip and write the linking sounds you hear." },
    {
      type: "quiz",
      quiz: {
        questionType: "mcq_single",
        prompt: "Which sound links 'an apple'?",
        options: ["/n/", "/j/", "/w/"],
        answer: "/n/",
        explanation: "The consonant carries across the vowel.",
      },
    },
    { type: "audio", objectKey: "private/audio/qa2-probe-connected-speech.mp3", originalName: "connected-speech.mp3", mimeType: "audio/mpeg", size: 4096 },
  ],
};

const editedNotes = "Centre notes (edited): play once, then ask the class to mark the schwa themselves.";

const { teacher, admin, owner, student } = await users();
const [ownerCookie, studentCookie, teacherCookie, adminCookie] = await Promise.all([
  cookieFor(owner),
  cookieFor(student),
  cookieFor(teacher),
  cookieFor(admin),
]);
const unit = await unitId();

const createLesson = async (cookie, payload) => {
  const response = await call("/api/admin/content/drafts", {
    method: "POST",
    cookie,
    body: { module: "lesson", contentType: "lesson", sourceRef: REF, title: payload.title, payload: { unitId: unit, ...payload } },
  });
  if (response.status !== 201 && response.status !== 200) throw new Error(`authoring failed (${response.status}): ${response.text.slice(0, 300)}`);
  return json(response);
};
const publish = (cookie, versionId) => call(`/api/admin/content/versions/${versionId}/publication`, { method: "POST", cookie, body: { to: "published" } });

try {
  /* ------------------------------------------------------------------ the live lesson */
  // A TEACHER authors it (that is what teachers do here); the OWNER publishes it.
  const authored = await createLesson(teacherCookie, AUTHORED);
  const teacherPublish = await publish(teacherCookie, authored.versionId);
  check(
    "C a teacher authors a lesson through the generic route but may NOT publish it",
    teacherPublish.status === 403 && has(teacherPublish.text, "publish_forbidden"),
    `status ${teacherPublish.status} ${teacherPublish.text.slice(0, 160)}`,
  );
  const ownerPublish = await publish(ownerCookie, authored.versionId);
  check("V the owner publishes v1, so students have something real to read", ownerPublish.status === 200, `status ${ownerPublish.status} ${ownerPublish.text.slice(0, 200)}`);

  const [lesson] = await q(`select id, publication_state, summary, teacher_notes from lessons where source_ref = $1`, [REF]);
  check("V the lesson row is live", lesson && ["published", "scheduled"].includes(lesson.publication_state), lesson?.publication_state);
  const lessonId = lesson.id;

  const v1Snapshot = (await q(`select content_snapshot::text as snapshot, content_hash from content_versions where id = $1`, [authored.versionId]))[0];
  check("V the published revision recorded its canonical content", Boolean(v1Snapshot?.snapshot));

  // The learner saves Xulosangiz while v1 is live — this is what must survive everything.
  const noteBody = "Probe Xulosangiz: the speaker links every consonant.";
  const noteSave = await call(`/api/lessons/${lessonId}/notes`, { method: "POST", cookie: studentCookie, body: { body: noteBody } });
  check("X the learner saves Xulosangiz on the live lesson", noteSave.status === 200, `status ${noteSave.status} ${noteSave.text.slice(0, 120)}`);

  /* ---------------------------------------------------------- H: THE HUMAN OPENS IT */
  const opened = await call(`/api/admin/content/lessons/${lessonId}/edit`, { cookie: teacherCookie });
  const model = json(opened)?.lesson;
  check("H the teacher opens the lesson and the staff projection answers 200", opened.status === 200 && Boolean(model), `status ${opened.status}`);
  if (!model) throw new Error(`the edit projection did not load: ${opened.text.slice(0, 300)}`);

  check(
    "H every authored field comes back exactly (title, slug, reference, area, description, minutes)",
    model.title === AUTHORED.title &&
      model.slug === AUTHORED.slug &&
      model.sourceRef === REF &&
      model.unitId === unit &&
      model.learningArea === AUTHORED.learningArea &&
      model.summary === AUTHORED.summary &&
      model.estimatedMinutes === AUTHORED.estimatedMinutes,
    JSON.stringify({ title: model.title, slug: model.slug, area: model.learningArea, summary: model.summary, minutes: model.estimatedMinutes }),
  );
  check("H the centre's Teacher Notes come back, not a blank", model.teacherNotes === AUTHORED.teacherNotes, String(model.teacherNotes).slice(0, 80));
  check(
    "H all three blocks come back in authored order",
    model.blocks.length === 3 && model.blocks[0].type === "text" && model.blocks[1].type === "quiz" && model.blocks[2].type === "audio",
    model.blocks.map((block) => block.type).join(","),
  );
  check(
    "H the quiz block carries its prompt, options, key and explanation (a staff surface)",
    model.blocks[1].quiz?.prompt === AUTHORED.blocks[1].quiz.prompt &&
      JSON.stringify(model.blocks[1].quiz.options) === JSON.stringify(AUTHORED.blocks[1].quiz.options) &&
      model.blocks[1].quiz.answer === AUTHORED.blocks[1].quiz.answer &&
      model.blocks[1].quiz.explanation === AUTHORED.blocks[1].quiz.explanation,
    JSON.stringify(model.blocks[1].quiz),
  );
  check(
    "H the audio block carries its file identity",
    model.blocks[2].objectKey === AUTHORED.blocks[2].objectKey &&
      model.blocks[2].originalName === AUTHORED.blocks[2].originalName &&
      model.blocks[2].mimeType === AUTHORED.blocks[2].mimeType &&
      model.blocks[2].size === AUTHORED.blocks[2].size,
    JSON.stringify(model.blocks[2]),
  );
  check("V the desk can say 'Published v1' truthfully", model.published?.versionNo === 1 && model.live === true, JSON.stringify({ published: model.published, live: model.live }));
  check("V nothing is being edited yet, and the desk knows it must offer 'Create revision'", model.draft === null);

  const desk = await call("/app/listening/lessons/author", { cookie: teacherCookie });
  check("H the desk page renders for the teacher with the lesson listed", has(desk.text, `data-lesson-authoring-item="${lessonId}"`));
  check("C the page states this role's boundary from the server, before a lesson is opened", has(desk.text, 'data-lesson-authoring-can-publish="false"') && has(desk.text, "data-lesson-authoring-no-publish"));
  const ownerDesk = await call("/app/listening/lessons/author", { cookie: ownerCookie });
  check("C the owner's desk is told it may publish", has(ownerDesk.text, 'data-lesson-authoring-can-publish="true"'));
  check(
    "H the list row states which revision students read (Published v1, no draft)",
    has(desk.text, "data-lesson-authoring-list") &&
      has(desk.text, `data-lesson-authoring-item-published="${1}"`) &&
      !has(desk.text, "data-lesson-authoring-item-draft"),
  );
  check(
    "H the list page does NOT embed the lesson body: detail is a separate request",
    !has(desk.text, AUTHORED.blocks[0].text) && !has(desk.text, "carries its prompt"),
  );
  // The editor is client-side, so the initial HTML cannot contain its controls: what a
  // browser receives is the page PLUS the client bundle. Check the bundle the desk serves.
  const chunks = [...desk.text.matchAll(/(\/_next\/static\/[^"]+\.js)/g)].map((match) => match[1]);
  let revisionControl = false;
  for (const chunk of [...new Set(chunks)].slice(0, 40)) {
    const served = await call(chunk);
    if (has(served.text, "data-lesson-authoring-start-revision")) {
      revisionControl = true;
      break;
    }
  }
  check("H the bundle the desk serves carries the explicit revision action (Save is not offered on a live lesson)", revisionControl, `${chunks.length} chunks searched`);

  /* ------------------------------------------------- R: CREATE A REVISION, TWICE OVER */
  const revision = await call(`/api/admin/content/lessons/${lessonId}/revision`, { method: "POST", cookie: teacherCookie });
  const revisionBody = json(revision);
  check("R creating a revision answers 201 with a new editable draft", revision.status === 201 && revisionBody?.created === true, `status ${revision.status} ${revision.text.slice(0, 200)}`);
  check("R the draft is v2 beside Published v1", revisionBody?.lesson?.draft?.versionNo === 2 && revisionBody?.lesson?.published?.versionNo === 1, JSON.stringify({ draft: revisionBody?.lesson?.draft, published: revisionBody?.lesson?.published }));
  const draftVersionId = revisionBody?.lesson?.draft?.versionId;

  const revisionAgain = await call(`/api/admin/content/lessons/${lessonId}/revision`, { method: "POST", cookie: teacherCookie });
  const againBody = json(revisionAgain);
  check(
    "R asking again opens the revision already in progress instead of piling up v3",
    revisionAgain.status === 200 && againBody?.created === false && againBody?.lesson?.draft?.versionId === draftVersionId,
    `status ${revisionAgain.status} ${revisionAgain.text.slice(0, 200)}`,
  );

  const copied = (await q(`select content_snapshot::text as snapshot from content_versions where id = $1`, [draftVersionId]))[0];
  const v1Now = (await q(`select content_snapshot::text as snapshot, content_hash, status, publication_state from content_versions where id = $1`, [authored.versionId]))[0];
  check("R the draft copied the published content", copied?.snapshot === v1Snapshot.snapshot);
  check("R the published revision is byte-for-byte unchanged and still the live one", v1Now.snapshot === v1Snapshot.snapshot && v1Now.content_hash === v1Snapshot.content_hash && v1Now.publication_state === "published", JSON.stringify(v1Now.status));
  const [rowWhileEditing] = await q(`select publication_state, summary, teacher_notes, slug, unit_id from lessons where id = $1`, [lessonId]);
  check(
    "R the live row has not moved while the draft is being edited",
    rowWhileEditing.publication_state === lesson.publication_state &&
      rowWhileEditing.summary === AUTHORED.summary &&
      rowWhileEditing.teacher_notes === AUTHORED.teacherNotes &&
      rowWhileEditing.slug === AUTHORED.slug &&
      rowWhileEditing.unit_id === unit,
    JSON.stringify(rowWhileEditing),
  );
  check("R one logical lesson still exists (no copy, no second source ref)", (await q(`select count(*)::int n from lessons where source_ref = $1`, [REF]))[0].n === 1);

  /* ------------------------------------------ S: CHANGE ONE FIELD, SAVE, AND CHECK */
  const beforeEdit = json(await call(`/api/admin/content/lessons/${lessonId}/edit`, { cookie: teacherCookie })).lesson;
  const singleChange = {
    unitId: beforeEdit.unitId,
    slug: beforeEdit.slug,
    learningArea: beforeEdit.learningArea,
    summary: beforeEdit.summary,
    teacherNotes: editedNotes,
    estimatedMinutes: beforeEdit.estimatedMinutes,
    blocks: beforeEdit.blocks.map((block) => {
      const base = { type: block.type };
      if (block.text !== null) base.text = block.text;
      if (block.url !== null) base.url = block.url;
      if (block.objectKey !== null) {
        base.objectKey = block.objectKey;
        base.originalName = block.originalName;
        base.mimeType = block.mimeType;
        base.size = block.size;
      }
      if (block.quiz) base.quiz = block.quiz;
      return base;
    }),
  };
  const saved = await call("/api/admin/content/drafts", {
    method: "POST",
    cookie: teacherCookie,
    body: { module: "lesson", contentType: "lesson", sourceRef: REF, title: beforeEdit.title, versionId: draftVersionId, payload: singleChange },
  });
  check("S saving one changed field is accepted", saved.status === 200, `status ${saved.status} ${saved.text.slice(0, 200)}`);

  const afterEdit = json(await call(`/api/admin/content/lessons/${lessonId}/edit`, { cookie: teacherCookie })).lesson;
  check("S the field that was changed is the field that changed", afterEdit.teacherNotes === editedNotes, String(afterEdit.teacherNotes).slice(0, 60));
  check(
    "S NOTHING ELSE was erased: title, slug, reference, unit, area, description, minutes",
    afterEdit.title === beforeEdit.title &&
      afterEdit.slug === beforeEdit.slug &&
      afterEdit.sourceRef === beforeEdit.sourceRef &&
      afterEdit.unitId === beforeEdit.unitId &&
      afterEdit.learningArea === beforeEdit.learningArea &&
      afterEdit.summary === beforeEdit.summary &&
      afterEdit.estimatedMinutes === beforeEdit.estimatedMinutes,
    JSON.stringify({ title: afterEdit.title, slug: afterEdit.slug, unitId: afterEdit.unitId, summary: afterEdit.summary }),
  );
  check(
    "S …and every block survived, in order, with its payload and media metadata",
    JSON.stringify(afterEdit.blocks) === JSON.stringify(beforeEdit.blocks),
    JSON.stringify(afterEdit.blocks).slice(0, 300),
  );
  check("S the draft is still v2 — saving continues the revision, it does not chase v3", afterEdit.draft?.versionNo === 2, JSON.stringify(afterEdit.draft));

  // Save twice more: an author who saves after every sentence must still have ONE draft.
  for (const suffix of [" Second save.", " Third save."]) {
    const repeat = await call("/api/admin/content/drafts", {
      method: "POST",
      cookie: teacherCookie,
      body: { module: "lesson", contentType: "lesson", sourceRef: REF, title: afterEdit.title, versionId: draftVersionId, payload: { ...singleChange, teacherNotes: editedNotes + suffix } },
    });
    check(`S repeated save ${suffix.trim()} is accepted`, repeat.status === 200, `status ${repeat.status}`);
  }
  const versions = await q(`select version_no, status, publication_state from content_versions where source_ref = $1 order by version_no`, [REF]);
  check(
    "S three saves produced exactly two revisions: Published v1 and one editable Draft v2",
    versions.length === 2 && versions[0].version_no === 1 && versions[0].publication_state === "published" && versions[1].version_no === 2,
    JSON.stringify(versions),
  );
  const [rowDuringEdit] = await q(`select summary, teacher_notes, publication_state from lessons where id = $1`, [lessonId]);
  check(
    "S the live row still serves the published revision (students read v1)",
    rowDuringEdit.teacher_notes === AUTHORED.teacherNotes && rowDuringEdit.summary === AUTHORED.summary && rowDuringEdit.publication_state === "published",
    JSON.stringify(rowDuringEdit),
  );
  const learnerDuringEdit = await call(`/app/listening/lessons/${lessonId}?tab=teacher-notes`, { cookie: studentCookie });
  check("S the learner still reads the OLD notes", has(learnerDuringEdit.text, "play the clip twice") && !has(learnerDuringEdit.text, editedNotes));
  const xulosangizDuringEdit = await call(`/app/listening/lessons/${lessonId}?tab=xulosangiz`, { cookie: studentCookie });
  check("S and the learner's Xulosangiz is untouched while the draft is edited", has(xulosangizDuringEdit.text, noteBody));

  /* ------------------------------------------------ P: PUBLICATION AND THE OLD READ */
  const refused = await publish(teacherCookie, draftVersionId);
  check("P a teacher's publish is refused with publish_forbidden", refused.status === 403 && has(refused.text, "publish_forbidden"), `status ${refused.status} ${refused.text.slice(0, 160)}`);
  const [rowAfterRefusal] = await q(`select teacher_notes from lessons where id = $1`, [lessonId]);
  check("P the refusal changed nothing", rowAfterRefusal.teacher_notes === AUTHORED.teacherNotes);

  const published2 = await publish(ownerCookie, draftVersionId);
  check("P the owner publishes Draft v2", published2.status === 200, `status ${published2.status} ${published2.text.slice(0, 200)}`);
  const [rowAfterPublish] = await q(`select teacher_notes, summary, slug, unit_id, publication_state from lessons where id = $1`, [lessonId]);
  check(
    "P publication materialized the revision onto the live row",
    rowAfterPublish.teacher_notes === `${editedNotes} Third save.` && rowAfterPublish.slug === AUTHORED.slug && rowAfterPublish.unit_id === unit,
    JSON.stringify(rowAfterPublish),
  );
  const afterPublishModel = json(await call(`/api/admin/content/lessons/${lessonId}/edit`, { cookie: ownerCookie })).lesson;
  check("P staff now see Published v2 and no open draft", afterPublishModel.published?.versionNo === 2 && afterPublishModel.draft === null, JSON.stringify({ published: afterPublishModel.published, draft: afterPublishModel.draft }));
  const learnerAfterPublish = await call(`/app/listening/lessons/${lessonId}?tab=teacher-notes`, { cookie: studentCookie });
  check("P the learner now reads the new revision", has(learnerAfterPublish.text, editedNotes));
  const [oldVersion] = await q(`select status, content_snapshot is not null as readable from content_versions where id = $1`, [authored.versionId]);
  check("P v1 is superseded but still readable for historical bindings", oldVersion.status === "superseded" && oldVersion.readable === true, JSON.stringify(oldVersion));

  const noteAfter = await call(`/api/lessons/${lessonId}/notes`, { cookie: studentCookie });
  check("X Xulosangiz survived the revision and the publication", noteAfter.status === 200 && has(noteAfter.text, noteBody), `status ${noteAfter.status} ${noteAfter.text.slice(0, 120)}`);
  const learnerXulosangiz = await call(`/app/listening/lessons/${lessonId}?tab=xulosangiz`, { cookie: studentCookie });
  check("X and it is still private to the learner on their page", has(learnerXulosangiz.text, noteBody));
  const ownerXulosangiz = await call(`/app/listening/lessons/${lessonId}?tab=xulosangiz`, { cookie: ownerCookie });
  check("X the owner does not see it", !has(ownerXulosangiz.text, noteBody));

  /* ------------------------------------------------------- C: THE AUTHORING BOUNDARY */
  const teacherMock = await call("/api/admin/content/drafts", {
    method: "POST",
    cookie: teacherCookie,
    body: { module: "mock", contentType: "full_mock", sourceRef: "qa2-forbidden-mock", title: "Forbidden mock", payload: {} },
  });
  check("C a teacher cannot author a mock through the generic route (403)", teacherMock.status === 403, `status ${teacherMock.status} ${teacherMock.text.slice(0, 120)}`);
  const teacherPrompt = await call("/api/admin/content/drafts", {
    method: "POST",
    cookie: teacherCookie,
    body: { module: "writing", contentType: "prompt", sourceRef: "qa2-forbidden-prompt", title: "Forbidden prompt", payload: {} },
  });
  check("C nor a writing prompt", teacherPrompt.status === 403, `status ${teacherPrompt.status}`);

  const teacherCaps = json(await call("/api/admin/content/authoring-capabilities", { cookie: teacherCookie }));
  const adminCaps = json(await call("/api/admin/content/authoring-capabilities", { cookie: adminCookie }));
  check(
    "C the capabilities endpoint says a teacher authors a lesson and not a mock",
    Array.isArray(teacherCaps?.authorableKeys) && teacherCaps.authorableKeys.includes("lesson:lesson") && !teacherCaps.authorableKeys.includes("mock:full_mock"),
    JSON.stringify(teacherCaps?.authorableKeys ?? null),
  );
  check("C and that an administrator authors more than a teacher", Array.isArray(adminCaps?.authorableKeys) && adminCaps.authorableKeys.length > teacherCaps.authorableKeys.length);
  check("C publication authority is reported separately and truthfully", teacherCaps?.mayPublish === false && adminCaps?.mayPublish === true, JSON.stringify({ teacher: teacherCaps?.mayPublish, admin: adminCaps?.mayPublish }));
  const studentCaps = await call("/api/admin/content/authoring-capabilities", { cookie: studentCookie });
  check("C a learner gets no authoring capability surface at all", studentCaps.status === 403, `status ${studentCaps.status}`);

  /* --------------------------------------------------------------- E: HONEST ERRORS */
  const tooLong = await call("/api/admin/content/drafts", {
    method: "POST",
    cookie: teacherCookie,
    body: {
      module: "lesson",
      contentType: "lesson",
      sourceRef: REF,
      title: AUTHORED.title,
      versionId: null,
      payload: { ...singleChange, teacherNotes: "x".repeat(9000) },
    },
  });
  const tooLongBody = json(tooLong);
  const notes = Array.isArray(tooLongBody?.issues) ? tooLongBody.issues : [];
  check(
    "E a refused save answers 422 with an issue attached to the offending field",
    tooLong.status === 422 && notes.some((issue) => issue.field === "teacherNotes"),
    `status ${tooLong.status} ${tooLong.text.slice(0, 200)}`,
  );
  check(
    "E the issue is the sentence about Teacher Notes, not the schema's own wording",
    notes.some((issue) => /teacher notes/i.test(issue.message)),
    notes.map((issue) => issue.message).join(" | ").slice(0, 200),
  );
  const messages = notes.map((issue) => issue.message).join(" | ");
  check(
    "E the message is a sentence, with no stack trace, SQL or file name",
    messages.length > 0 && !/[<>`]|node_modules|\.ts:\d|SELECT |INSERT |at Object\./i.test(messages),
    messages.slice(0, 200),
  );
  const [rowAfterRefusal2] = await q(`select count(*)::int n from content_versions where source_ref = $1`, [REF]);
  check("E the refused save wrote nothing", rowAfterRefusal2.n === 2, String(rowAfterRefusal2.n));
} finally {
  const cleanup = async () => {
    await q(`delete from lesson_notes where lesson_id in (select id from lessons where source_ref = $1)`, [REF]);
    await q(`delete from lesson_block_responses where lesson_id in (select id from lessons where source_ref = $1)`, [REF]);
    await q(`delete from lesson_progress where lesson_id in (select id from lessons where source_ref = $1)`, [REF]);
    await q(`delete from lesson_blocks where lesson_id in (select id from lessons where source_ref = $1)`, [REF]);
    await q(`delete from video_lessons where lesson_id in (select id from lessons where source_ref = $1)`, [REF]);
    await q(`delete from content_versions where source_ref = $1 or target_id in (select id from lessons where source_ref = $1)`, [REF]);
    await q(`delete from lessons where source_ref = $1`, [REF]);
    await q(`delete from content_versions where source_ref = 'qa2-forbidden-mock' or source_ref = 'qa2-forbidden-prompt'`);
    await q(`delete from users where email = any($1)`, [[TEACHER, ADMIN]]);
  };
  await cleanup();

  const leftoverLessons = (await q(`select count(*)::int n from lessons where source_ref like $1`, [`${REF}%`]))[0].n;
  const leftoverVersions = (await q(`select count(*)::int n from content_versions where source_ref like $1`, [`${REF}%`]))[0].n;
  const leftoverUsers = (await q(`select count(*)::int n from users where email = any($1)`, [[TEACHER, ADMIN]]))[0].n;
  const leftoverNotes = (await q(`select count(*)::int n from lesson_notes where body like 'Probe Xulosangiz%'`))[0].n;
  const fixturesStill = (await q(`select count(*)::int n from users where email = any($1)`, [[OWNER, STUDENT]]))[0].n;
  check("cleanup: no probe lesson remains", leftoverLessons === 0, String(leftoverLessons));
  check("cleanup: no probe revision remains", leftoverVersions === 0, String(leftoverVersions));
  check("cleanup: no probe user remains", leftoverUsers === 0, String(leftoverUsers));
  check("cleanup: no probe Xulosangiz remains", leftoverNotes === 0, String(leftoverNotes));
  check("cleanup: the QA2 owner/student fixtures are untouched", fixturesStill === 2, String(fixturesStill));
  await db.end();
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((name) => `not ok - ${name}`).join("\n"));
  process.exitCode = 1;
}
console.log(JSON.stringify({ digest: createHash("sha256").update(String(pass)).digest("hex").slice(0, 12) }));
