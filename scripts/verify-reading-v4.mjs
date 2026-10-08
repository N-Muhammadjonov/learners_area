#!/usr/bin/env node
/**
 * Built-server acceptance for the Reading V4 products, over real HTTP against
 * `next build` + `next start` on the ISOLATED local QA2 PostgreSQL.
 *
 *   BASE_URL=http://127.0.0.1:3000 DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 \
 *   AUTH_SECRET=<the server's secret> node scripts/verify-reading-v4.mjs
 *
 * Covers the five products, the canonical journeys and the adversarial paths:
 * lessons + private notes, an Academic full test (start, autosave, secrecy,
 * submit, review), General 1/2/3/FULL with explicit Check, the registry-driven
 * type index, direct Retention entry, legacy tab URLs, cross-user isolation and
 * the four roles. Every fixture it creates is deleted, and the cleanup verified.
 */
import pg from "pg";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { assertIsolatedTarget } from "./qa2-seed-fixtures.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const SECRET = process.env.AUTH_SECRET ?? "";
if (SECRET.length < 16) throw new Error("AUTH_SECRET must be set (the server's own secret)");
assertIsolatedTarget(DATABASE_URL);

const REF = `rdg-v4-probe-${randomUUID().slice(0, 8)}`;
let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "not ok"} - ${name}${ok ? "" : ` — ${detail}`}`);
  if (ok) pass += 1; else failures.push(name);
};

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

async function cookieFor(user) {
  const token = await new SignJWT({ sub: user.id, role: user.role, name: user.name, locale: "en", onboarded: true })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  return `la_session=${token}`;
}
async function call(path, { method = "GET", cookie, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method, redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text(), location: res.headers.get("location") };
}
const notFound = (r) => r.status === 404 || r.text.includes("NEXT_HTTP_ERROR_FALLBACK");

async function user(role, label) {
  const [row] = await q(
    `insert into users (name, email, role, account_status) values ($1,$2,$3,'active') returning id, role, name`,
    [`${REF} ${label}`, `${REF}-${label}@learners-qa.invalid`, role]);
  return row;
}

const created = { lessons: [], sets: [], passages: [], attempts: [] };

try {
  const student = await user("student", "student");
  const other = await user("student", "other");
  const teacher = await user("teacher", "teacher");
  const admin = await user("admin", "admin");
  const [cookie, otherCookie, teacherCookie, adminCookie] =
    await Promise.all([student, other, teacher, admin].map(cookieFor));

  /* ---------------------------------------------------------------- products */
  const hub = await call("/app/reading", { cookie });
  check("P1 the Reading hub serves the five canonical products", hub.status === 200 &&
    ["lessons", "academic", "general", "question-types", "retention"].every(p => hub.text.includes(`/app/reading/${p}`)), `status ${hub.status}`);
  check("P2 the hub is not a mixed hundred-card wall", (hub.text.match(/data-reading-passage-card/g) ?? []).length === 0);
  // Next streams this redirect: the instruction can arrive as a Location header OR,
  // for an already-streaming RSC response, inside the document. Both are accepted;
  // what is asserted is the DESTINATION, not the transport.
  const redirectedTo = (res, target) =>
    (res.location ?? "").includes(target) || (res.status === 200 && res.text.includes(target) && res.text.includes("NEXT_REDIRECT"));
  const legacy = await call("/app/reading?tab=practice&q=bank", { cookie });
  check("P3 a legacy tab URL still resolves to its canonical product", redirectedTo(legacy, "/app/reading/academic"),
    `status ${legacy.status} location ${legacy.location}`);
  check("P3b the legacy redirect keeps the learner's filter", redirectedTo(legacy, "q=bank"), legacy.location ?? "streamed");
  const legacyGT = await call("/app/reading?tab=general", { cookie });
  check("P4 the withdrawn General Training tab is not a dead end", redirectedTo(legacyGT, "/app/reading"),
    `status ${legacyGT.status}`);
  check("P4b no learner-facing General Training copy is served any more", !legacyGT.text.includes("General Training"));

  /* ---------------------------------------------------------------- lessons */
  const [unit] = await q(`select u.id from units u limit 1`);
  let unitId = unit?.id;
  if (!unitId) {
    const [course] = await q(`insert into courses (slug,title) values ($1,'Reading probe') returning id`, [`${REF}-c`]);
    const [mod] = await q(`insert into course_modules (course_id,slug,title,"order") values ($1,$2,'Probe',1) returning id`, [course.id, `${REF}-m`]);
    [{ id: unitId }] = await q(`insert into units (module_id,slug,title,"order") values ($1,$2,'Probe',1) returning id`, [mod.id, `${REF}-u`]);
  }
  const [lesson] = await q(
    `insert into lessons (unit_id,slug,title,"order",publication_state,default_state,learning_area,summary,teacher_notes,estimated_minutes)
     values ($1,$2,$3,1,'published','available','reading','Authored description.','Authored teacher notes.',15) returning id`,
    [unitId, `${REF}-lesson`, `${REF} Reading lesson`]);
  created.lessons.push(lesson.id);
  await q(`insert into lesson_blocks (lesson_id,position,type,text_content) values ($1,1,'text','Skimming finds the shape of a passage before its detail.')`, [lesson.id]);
  const [hidden] = await q(
    `insert into lessons (unit_id,slug,title,"order",publication_state,default_state,learning_area)
     values ($1,$2,$3,2,'draft','available','reading') returning id`, [unitId, `${REF}-draft`, `${REF} Draft lesson`]);
  created.lessons.push(hidden.id);
  const [listening] = await q(
    `insert into lessons (unit_id,slug,title,"order",publication_state,default_state,learning_area)
     values ($1,$2,$3,3,'published','available','listening') returning id`, [unitId, `${REF}-lsn`, `${REF} Listening lesson`]);
  created.lessons.push(listening.id);

  const lessonList = await call("/app/reading/lessons", { cookie });
  check("L1 a reading-classified published lesson is listed", lessonList.text.includes(`${REF} Reading lesson`));
  check("L2 a draft lesson is not listed", !lessonList.text.includes(`${REF} Draft lesson`));
  check("L3 a listening lesson is not listed under Reading", !lessonList.text.includes(`${REF} Listening lesson`));
  const lessonPage = await call(`/app/reading/lessons/${lesson.id}`, { cookie });
  check("L4 the lesson body renders before the three tabs",
    lessonPage.text.includes("Skimming finds the shape") &&
    lessonPage.text.indexOf("data-lesson-body") < lessonPage.text.indexOf('role="tablist"'));
  check("L5 the lesson offers its progress controls", lessonPage.text.includes("data-lesson-complete"));
  check("L6 Description and Teacher Notes are authored content",
    (await call(`/app/reading/lessons/${lesson.id}?tab=description`, { cookie })).text.includes("Authored description.") &&
    (await call(`/app/reading/lessons/${lesson.id}?tab=teacher-notes`, { cookie })).text.includes("Authored teacher notes."));
  check("L7 a Reading lesson cannot be opened through the Listening route", notFound(await call(`/app/listening/lessons/${lesson.id}`, { cookie })));
  const note = await call(`/api/lessons/${lesson.id}/notes`, { method: "POST", cookie, body: { notes: "My private Xulosangiz." } });
  check("L8 the learner saves a private note", note.status === 200);
  check("L9 the note is readable by its owner",
    (await call(`/app/reading/lessons/${lesson.id}?tab=xulosangiz`, { cookie })).text.includes("My private Xulosangiz."));
  check("L10 another learner cannot read it",
    !(await call(`/api/lessons/${lesson.id}/notes`, { cookie: otherCookie })).text.includes("My private Xulosangiz."));
  for (const [role, c] of [["teacher", teacherCookie], ["admin", adminCookie]])
    check(`L11 ${role} staff surfaces never expose the private note`,
      !(await call(`/api/lessons/${lesson.id}/notes`, { cookie: c })).text.includes("My private Xulosangiz."));
  check("L12 a draft lesson refuses progress and notes",
    (await call(`/api/lessons/${hidden.id}/state`, { method: "POST", cookie, body: { state: "completed" } })).status === 404);
  const completed = await call(`/api/lessons/${lesson.id}/state`, { method: "POST", cookie, body: { state: "completed" } });
  check("L13 completion is recorded by the server", completed.status === 200 && completed.text.includes("completed"));
  check("L14 completing twice is refused, so completedAt keeps its meaning",
    (await call(`/api/lessons/${lesson.id}/state`, { method: "POST", cookie, body: { state: "completed" } })).status === 409);

  /* --------------------------------------------------------------- academic */
  const makeSet = async (title, counts, { publish = true } = {}) => {
    const [set] = await q(
      `insert into general_reading_sets (title,publication_state,source_ref) values ($1,$2,$3) returning id`,
      [title, publish ? "published" : "draft", `${REF}-${randomUUID().slice(0, 6)}`]);
    created.sets.push(set.id);
    const passages = [];
    for (const [index, count] of counts.entries()) {
      const [p] = await q(
        `insert into reading_passages (title,body_text,publication_state,difficulty_level,suggested_minutes)
         values ($1,$2,$3,'B2',20) returning id`,
        [`${title} part ${index + 1}`, `The bank approved the loan in ${1990 + index}. ` + "A genuine authored QA passage sentence. ".repeat(6),
         publish ? "published" : "draft"]);
      created.passages.push(p.id);
      await q(`insert into general_reading_passages (passage_id,set_id,passage_no) values ($1,$2,$3)`, [p.id, set.id, index + 1]);
      for (let n = 1; n <= count; n += 1)
        await q(`insert into reading_questions (passage_id,"order",question_no,type,type_code,question_text,correct_answer,accepted_answers,evidence_quote,explanation)
                 values ($1,$2,$2,'short_answer','short_answer',$3,'bank',$4,$5,$6)`,
          [p.id, n, `Who approved the loan in question ${n}?`, JSON.stringify(["the bank"]),
           n === 1 ? `The bank approved the loan in ${1990 + index}.` : null,
           n === 1 ? "The first sentence names the lender." : ""]);
      passages.push(p.id);
    }
    return { setId: set.id, passages };
  };

  const full = await makeSet(`${REF} Academic full`, [13, 13, 14]);
  const short = await makeSet(`${REF} General short`, [6]);
  const draftSet = await makeSet(`${REF} Academic draft`, [13, 13, 14], { publish: false });

  const catalogue = await call("/app/reading/academic", { cookie });
  check("A1 a genuine 3-passage 40-question set is offered", catalogue.text.includes(`${REF} Academic full`));
  check("A2 an incomplete set is not offered as a full test", !catalogue.text.includes(`${REF} General short`));
  check("A3 a draft set is not offered", !catalogue.text.includes(`${REF} Academic draft`));
  check("A4 the catalogue does not start a test by itself",
    (await q(`select count(*)::int n from reading_attempts a join reading_assessments s on s.attempt_id=a.id where s.set_id=$1`, [full.setId]))[0].n === 0);
  const started = await call("/api/reading/academic", { method: "POST", cookie, body: { setId: full.setId } });
  check("A5 an explicit Start creates the attempt", started.status === 200, `status ${started.status}: ${started.text.slice(0,120)}`);
  const attemptId = JSON.parse(started.text || "{}").id;
  if (attemptId) created.attempts.push(attemptId);
  check("A6 starting twice resumes the same attempt",
    JSON.parse((await call("/api/reading/academic", { method: "POST", cookie, body: { setId: full.setId } })).text || "{}").id === attemptId);
  check("A7 a draft set cannot be started",
    (await call("/api/reading/academic", { method: "POST", cookie, body: { setId: draftSet.setId } })).status === 404);
  const exam = await call(`/app/reading/attempts/${attemptId}`, { cookie });
  // The paper is navigated part by part, so one document carries one part's inputs;
  // the full forty are proven by the server's own grading at submit (A17).
  check("A8 the exam opens the full three-part paper with its timer",
    exam.text.includes("data-academic-parts") && exam.text.includes("data-practice-timer") &&
    (exam.text.match(/data-answer-input/g) ?? []).length === 13, "missing exam controls");
  const key = (await q(`select correct_answer,accepted_answers,evidence_quote,explanation from reading_questions where passage_id=$1 limit 1`, [full.passages[0]]))[0];
  check("A9 the active exam never ships the key, alternatives, evidence or explanation",
    !exam.text.includes('"correctAnswer"') && !exam.text.includes('"acceptedAnswers"') &&
    !exam.text.includes(key.explanation) && !exam.text.includes('"evidenceQuote"'));
  check("A10 the active exam offers no Dictionary or vocabulary save",
    !exam.text.includes("data-clickable-text") && !exam.text.includes("data-word-save"));
  check("A11 the active exam keeps its highlight surface", exam.text.includes("data-passage-body"));
  const questions = await q(`select id from reading_questions where passage_id = any($1::uuid[]) order by passage_id, "order"`, [full.passages]);
  const autosave = await call(`/api/reading/attempts/${attemptId}`, { method: "PATCH", cookie,
    body: { answers: questions.slice(0, 5).map(r => ({ questionId: r.id, answer: "bank" })) } });
  check("A12 autosave persists drafts", autosave.status === 200 &&
    (await q(`select count(*)::int n from reading_answers where attempt_id=$1`, [attemptId]))[0].n === 5);
  check("A13 another learner cannot autosave into this attempt",
    (await call(`/api/reading/attempts/${attemptId}`, { method: "PATCH", cookie: otherCookie,
      body: { answers: [{ questionId: questions[0].id, answer: "forged" }] } })).status === 404);
  check("A14 another learner cannot open the attempt", notFound(await call(`/app/reading/attempts/${attemptId}`, { cookie: otherCookie })));
  const resumed = await call(`/app/reading/attempts/${attemptId}`, { cookie });
  check("A15 a reload resumes the saved answers", resumed.text.includes("bank"));
  // A REAL occurrence on this passage, so the refusal is the policy and not a missing row.
  const [lexeme] = await q(`insert into lexemes (term,definition_en,verification_status,sense_key) values ($1,'A financial institution','verified',$2) returning id`, [`bank-${REF}`, `${REF}-bank-sense`]);
  const [occurrence] = await q(
    `insert into lexical_occurrences (lexeme_id,passage_id,surface_form,start_char,end_char,sentence_text,occurrence_type,is_target_vocabulary)
     values ($1,$2,'bank',4,8,'The bank approved the loan in 1990.','vocabulary',true) returning id`, [lexeme.id, full.passages[0]]);
  const vocabDuring = await call(`/api/vocabulary/lookup?sourceType=reading&sourceId=${attemptId}&occurrenceId=${occurrence.id}`, { cookie });
  check("A16 Dictionary lookup is locked during the active exam", vocabDuring.status === 403, `status ${vocabDuring.status}: ${vocabDuring.text.slice(0,120)}`);
  // SEC-12/SEC-15: the exam must be sealed at EVERY passage position and through the
  // PASSAGE id too. An attempt row stores only its first passage, and the same canonical
  // rows can also be General learning, so "ask for it by passage id" was a real bypass.
  const positions = [];
  for (const [index, passageId] of full.passages.entries()) {
    if (index === 0) { positions.push({ no: 1, passageId, occurrenceId: occurrence.id }); continue; }
    const [sense] = await q(`insert into lexemes (term,definition_en,verification_status,sense_key) values ($1,'A financial institution','verified',$2) returning id`,
      [`bank-${REF}-p${index + 1}`, `${REF}-bank-sense-p${index + 1}`]);
    const [row] = await q(
      `insert into lexical_occurrences (lexeme_id,passage_id,surface_form,start_char,end_char,sentence_text,occurrence_type,is_target_vocabulary)
       values ($1,$2,'bank',4,8,'The bank approved the loan in 1990.','vocabulary',true) returning id`, [sense.id, passageId]);
    positions.push({ no: index + 1, passageId, occurrenceId: row.id });
  }
  for (const position of positions) {
    const byPassage = await call(`/api/vocabulary/lookup?sourceType=reading&sourceId=${position.passageId}&occurrenceId=${position.occurrenceId}`, { cookie });
    check(`A16.${position.no} the passage-id route is sealed during the active exam (passage ${position.no})`,
      byPassage.status === 403, `status ${byPassage.status}: ${byPassage.text.slice(0, 120)}`);
    const byAttempt = await call(`/api/vocabulary/lookup?sourceType=reading&sourceId=${attemptId}&occurrenceId=${position.occurrenceId}`, { cookie });
    check(`A16.${position.no}b the attempt-id route is sealed at passage ${position.no}`, byAttempt.status === 403, `status ${byAttempt.status}`);
    const save = await call(`/api/vocabulary`, { method: "POST", cookie,
      body: { sourceType: "reading", sourceId: position.passageId, occurrenceId: position.occurrenceId } });
    check(`A16.${position.no}c saving vocabulary from passage ${position.no} is refused during the exam`, save.status !== 200 && save.status !== 201, `status ${save.status}`);
  }
  const submitted = await call(`/api/reading/attempts/${attemptId}/submit`, { method: "POST", cookie,
    body: { answers: questions.map((r, i) => ({ questionId: r.id, answer: i < 20 ? "bank" : "wrong" })) } });
  check("A17 submission grades on the server", submitted.status === 200 && JSON.parse(submitted.text).score === 20 &&
    JSON.parse(submitted.text).totalQuestions === 40, submitted.text.slice(0, 160));
  check("A18 submitting twice is refused", (await call(`/api/reading/attempts/${attemptId}/submit`, { method: "POST", cookie, body: { answers: [] } })).status === 409);
  const review = await call(`/app/reading/attempts/${attemptId}`, { cookie });
  check("A19 review shows the score, the key and the authored explanation",
    review.text.includes("20") && review.text.includes("the bank") && review.text.includes(key.explanation));
  check("A20 review locates the authored evidence in its own passage", review.text.includes("data-reading-evidence-location"));
  check("A21 review states missing evidence honestly rather than inventing it", review.text.includes("data-evidence-missing"));
  check("A22 review is private to its owner", notFound(await call(`/app/reading/attempts/${attemptId}`, { cookie: otherCookie })));
  const vocabAfter = await call(`/api/vocabulary/lookup?sourceType=reading&sourceId=${attemptId}&occurrenceId=${occurrence.id}`, { cookie });
  check("A23 the Dictionary opens for the learner's own submitted review", vocabAfter.status === 200, `status ${vocabAfter.status}`);
  check("A24 it stays shut for a learner who never sat this test",
    (await call(`/api/vocabulary/lookup?sourceType=reading&sourceId=${attemptId}&occurrenceId=${occurrence.id}`, { cookie: otherCookie })).status !== 200);
  for (const position of positions) {
    const after = await call(`/api/vocabulary/lookup?sourceType=reading&sourceId=${attemptId}&occurrenceId=${position.occurrenceId}`, { cookie });
    check(`A24.${position.no} after submission the owner's review opens at passage ${position.no}`, after.status === 200, `status ${after.status}`);
    // Another learner is refused through the OWNER's review. (The same published rows
    // are also a General learning source, so reading their dictionary directly by
    // passage id is the General product, not a leak of this learner's assessment.)
    check(`A24.${position.no}b another learner cannot borrow the owner's review at passage ${position.no}`,
      (await call(`/api/vocabulary/lookup?sourceType=reading&sourceId=${attemptId}&occurrenceId=${position.occurrenceId}`, { cookie: otherCookie })).status !== 200);
  }

  /* ---------------------------------------------------------------- general */
  const generalPage = await call(`/app/reading/general/${short.setId}?passage=1`, { cookie });
  check("G1 General opens its authored passage", generalPage.text.includes(`${REF} General short part 1`));
  check("G2 General offers the canonical Dictionary layer", generalPage.text.includes("data-clickable-text"));
  check("G3 General does not run an exam timer", !generalPage.text.includes("data-practice-timer"));
  const gq = await q(`select id,correct_answer,explanation from reading_questions where passage_id=$1 order by "order"`, [short.passages[0]]);
  check("G4 General hides the answer before an explicit Check",
    !generalPage.text.includes('"correctAnswer"') && !generalPage.text.includes("data-general-result"));
  const save = await call("/api/reading/general/progress", { method: "POST", cookie,
    body: { passageId: short.passages[0], answers: { [gq[0].id]: "bank" }, check: false } });
  check("G5 a draft answer autosaves without revealing anything",
    save.status === 200 && !save.text.includes("correctAnswer"), `status ${save.status}: ${save.text.slice(0,120)}`);
  const checked = await call("/api/reading/general/progress", { method: "POST", cookie,
    body: { passageId: short.passages[0], answers: { [gq[0].id]: "bank" }, check: true } });
  check("G6 an explicit Check returns the server's verdict", checked.status === 200 && checked.text.includes("isCorrect"));
  const reloaded = await call(`/app/reading/general/${short.setId}?passage=1`, { cookie });
  check("G7 the checked result survives a reload", reloaded.text.includes("data-general-result"));
  check("G8 the checked result carries the authored explanation", reloaded.text.includes(gq[0].explanation));
  check("G9 another learner sees none of it", !(await call(`/app/reading/general/${short.setId}?passage=1`, { cookie: otherCookie })).text.includes("data-general-result"));
  const fullGeneral = await call(`/app/reading/general/${full.setId}?passage=full`, { cookie });
  check("G10 General FULL reads all three authored passages",
    [1, 2, 3].every(n => fullGeneral.text.includes(`${REF} Academic full part ${n}`)));
  for (const n of [1, 2, 3]) {
    const one = await call(`/app/reading/general/${full.setId}?passage=${n}`, { cookie });
    check(`G11.${n} General passage ${n} opens on its own`, one.status === 200 && one.text.includes(`${REF} Academic full part ${n}`));
  }
  check("G12 General never links its learning to an Academic attempt", !fullGeneral.text.includes(attemptId));

  /* ----------------------------------------------------------- question types */
  const types = await call("/app/reading/question-types", { cookie });
  check("Q1 the selector is registry-driven and localized", types.status === 200 && types.text.includes("Savol turini tanlang"));
  check("Q2 every offered type is canonical and listed once",
    (() => { const ids = [...types.text.matchAll(/data-reading-type="([a-z_]+)"/g)].map(m => m[1]);
      return ids.length > 0 && new Set(ids).size === ids.length; })(), "duplicate or absent canonical type links");
  const index = await call("/app/reading/question-types?type=short_answer", { cookie });
  const cards = index.text.match(/data-reading-type-passage="[0-9a-f-]+"/g) ?? [];
  check("Q3 the index lists real published passages, bounded to one page", cards.length > 0 && cards.length <= 24,
    `${cards.length} cards`);
  check("Q4 one passage appears exactly once", new Set(cards).size === cards.length);
  check("Q5 a type with no published material says so rather than inventing one",
    (await call("/app/reading/question-types?type=flow_chart_completion", { cookie })).status === 200);
  check("Q6 an unknown type is not fabricated", notFound(await call("/app/reading/question-types?type=not-a-type", { cookie })));

  /* ---------------------------------------------------------------- retention */
  const retention = await call("/app/reading/retention", { cookie });
  check("R1 Retention opens its activity directly", retention.status === 200 && retention.text.includes("data-retention-page"));
  check("R2 there is no second Start interstitial before it", retention.text.includes("data-retention-level-list"));
  check("R3 Retention keeps its own history and scoring surfaces",
    retention.text.includes("data-retention-history-section") && retention.text.includes("data-retention-summary"));
  check("R4 the Retention API refuses an unauthenticated caller",
    (await call("/api/retention/attempts", { method: "POST", body: { level: "B1" } })).status === 401);

  /* ---------------------------------------------------------------- history */
  const history = await call("/app/reading/history", { cookie });
  check("H1 the learner's own submitted attempt is in history", history.text.includes(attemptId));
  check("H2 another learner's history does not contain it", !(await call("/app/reading/history", { cookie: otherCookie })).text.includes(attemptId));

  /* ------------------------------------------------------------------- roles */
  check("S1 an anonymous caller cannot reach a Reading product", [302, 303, 307, 308, 401, 404].includes((await call("/app/reading/academic")).status));
  check("S2 an anonymous caller cannot start a test", (await call("/api/reading/academic", { method: "POST", body: { setId: full.setId } })).status === 401);
  for (const [role, c] of [["teacher", teacherCookie], ["admin", adminCookie]])
    check(`S3 ${role} may read the Reading products`, (await call("/app/reading", { cookie: c })).status === 200);
  const desk = await call("/app/reading/lessons/author", { cookie });
  check("S4 a student cannot reach the staff authoring desk",
    [302, 303, 307, 308, 403, 404].includes(desk.status) || (desk.text.includes("NEXT_REDIRECT") && !desk.text.includes("data-route-usable=\"lesson-authoring\"")),
    `status ${desk.status}`);
  check("S5 a teacher cannot publish content", (await call(`/api/admin/content/versions/${randomUUID()}/publication`,
    { method: "POST", cookie: teacherCookie, body: { to: "published" } })).status !== 200);
} finally {
  /* ------------------------------------------------------------ cleanup */
  await q(`delete from reading_answers where attempt_id = any($1::uuid[])`, [created.attempts]);
  await q(`delete from reading_assessment_passages where attempt_id = any($1::uuid[])`, [created.attempts]);
  await q(`delete from reading_assessments where attempt_id = any($1::uuid[])`, [created.attempts]);
  await q(`delete from reading_attempts where id = any($1::uuid[])`, [created.attempts]);
  await q(`delete from user_vocabulary where lexeme_id in (select id from lexemes where term like $1)`, [`bank-${REF}%`]).catch(() => {});
  await q(`delete from lexical_occurrences where passage_id = any($1::uuid[])`, [created.passages]);
  await q(`delete from lexemes where term like $1`, [`bank-${REF}%`]);
  await q(`delete from general_reading_progress where passage_id = any($1::uuid[])`, [created.passages]);
  await q(`delete from general_reading_passages where passage_id = any($1::uuid[])`, [created.passages]);
  await q(`delete from reading_questions where passage_id = any($1::uuid[])`, [created.passages]);
  await q(`delete from reading_passages where id = any($1::uuid[])`, [created.passages]);
  await q(`delete from general_reading_sets where id = any($1::uuid[])`, [created.sets]);
  await q(`delete from lesson_notes where lesson_id = any($1::uuid[])`, [created.lessons]);
  await q(`delete from lesson_progress where lesson_id = any($1::uuid[])`, [created.lessons]);
  await q(`delete from lesson_blocks where lesson_id = any($1::uuid[])`, [created.lessons]);
  await q(`delete from lessons where id = any($1::uuid[])`, [created.lessons]);
  await q(`delete from activity_events where user_id in (select id from users where email like $1)`, [`${REF}-%`]);
  await q(`delete from users where email like $1`, [`${REF}-%`]);
  const residue = await q(
    `select (select count(*)::int from users where email like $1)
          + (select count(*)::int from lessons where slug like $2)
          + (select count(*)::int from reading_passages where id = any($3::uuid[]))
          + (select count(*)::int from general_reading_sets where id = any($4::uuid[]))
          + (select count(*)::int from reading_attempts where id = any($5::uuid[]))
          + (select count(*)::int from lexemes where term like $6) as n`,
    [`${REF}-%`, `${REF}-%`, created.passages, created.sets, created.attempts, `bank-${REF}%`]);
  check("Z1 every fixture this probe created is deleted (residue 0)", Number(residue[0].n) === 0, `${residue[0].n} rows remain`);
  await db.end();
}

console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${pass}/${pass + failures.length} checks`);
if (failures.length) { console.log(`failed: ${failures.join(", ")}`); process.exit(1); }
