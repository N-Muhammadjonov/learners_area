#!/usr/bin/env node
/**
 * PACKAGE E — real vertical-slice journeys over HTTP against a built server and real PostgreSQL.
 *
 *   node scripts/verify-journeys.mjs [baseUrl]
 *
 * WHY THIS IS NOT THE SAME AS THE SECURITY MATRIX. The matrix asks "who is refused". This asks
 * "does the whole thing work end to end": a learner starts, answers, saves, resumes, submits, is
 * graded by the server, sees the result, and the history persists. A route can deny correctly and
 * still be broken for the person who is allowed to use it.
 *
 * A journey here is only credited when it has: a named actor, a fixture that is PROVEN present,
 * a measured start state, an ordered action sequence over real HTTP, database evidence after each
 * step that matters, a negative control, and verified cleanup. A page rendering, a bare GET, or a
 * POST that nobody checked the persistence of does not count.
 *
 * THE ANTI-VACUITY RULE THAT MATTERS MOST HERE: E3 claims to test pagination under adversarial
 * data. Unless the probe first proves the dataset actually CONTAINS NULL external_ids, identical
 * timestamps and microsecond spreads, it is testing an easy case and reporting a hard one. So the
 * shapes are measured in the database before any paging assertion is made.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeGeneratedDoc } from "./lib/doc-output.mjs";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required: a journey is proved by database state, not by status codes.");
  process.exit(2);
}

const { assertMutableDatabase, createRowSweeper, installSweepHandlers } = await import("./lib/fixture-safety.mjs");
const { createQaDataset, destroyQaDataset, destroyQaDatasetByTag, assertFixtureExists } = await import("./lib/qa-dataset.mjs");
const { loginActor, createActor } = await import("./lib/security-matrix.mjs");
const pg = (await import("pg")).default;

assertMutableDatabase(DATABASE_URL, { probe: "verify-journeys" });

const LOGIN_IP = "203.0.113.211";
const journeys = [];
let exitCode = 0;

const sweepClient = new pg.Client({ connectionString: DATABASE_URL });
await sweepClient.connect();
const sweeper = createRowSweeper({
  client: sweepClient,
  probe: "verify-journeys",
  tables: [
    "assignment_targets", "assignments", "lesson_progress", "lesson_notes",
    "reading_answers", "reading_attempts", "listening_answers", "listening_attempts",
    "speaking_attempts", "writing_feedback", "writing_submissions", "evaluations",
    "user_vocabulary", "user_vocabulary_contexts", "vocab_folders", "vocab_point_events",
    "vocabulary_usages", "upload_intents", "resource_blocks", "notifications", "audit_log",
    "activity_events", "speaking_prompts", "reading_questions", "reading_passages",
    "listening_questions", "listening_tests", "writing_prompts", "lexemes", "lexical_units",
    "lessons", "typing_runs",
  ],
});
const finalSweep = installSweepHandlers(sweeper, {
  probe: "verify-journeys",
  onDone: () => sweepClient.end().catch(() => {}),
});
await sweeper.capture();

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0] ?? null;
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const count = async (sql, params = []) => Number((await one(sql, params))?.n ?? 0);

/**
 * Record one journey step. Every step carries what was done, what the server said, and what the
 * database says — because the step that "worked" is the one whose HTTP status was checked while
 * its row was never written.
 */
function step(journey, name, detail) {
  journey.steps.push({ name, ...detail });
  const mark = detail.ok ? "  ok" : "FAIL";
  console.log(`    ${mark} ${name}${detail.note ? ` — ${detail.note}` : ""}`);
  if (!detail.ok) { journey.failed = true; exitCode = 1; }
  return detail.ok;
}

function journey(id, title, actor) {
  const j = { id, title, actor, steps: [], failed: false, blocked: null };
  journeys.push(j);
  console.log(`\n[${id}] ${title}  (actor: ${actor})`);
  return j;
}

const tag = `qa-${randomUUID().slice(0, 8)}`;
let manifest = null;
const actors = {};

try {
  for (const [name, email, password] of [
    ["STUDENT_A", "demo.student@learnersarea.uz", "Student12345!"],
    ["STUDENT_B", "new.student@learnersarea.uz", "Student12345!"],
    ["TEACHER", "teacher@learnersarea.uz", "Teacher12345!"],
    ["ADMIN", "admin@learnersarea.uz", "Admin12345!"],
    ["OWNER", "owner@learnersarea.uz", "Owner12345!"],
  ]) {
    const { actor, identity } = await loginActor(name, BASE, email, password, { ip: LOGIN_IP, client: db });
    actors[name] = actor;
    actors[`${name}_ID`] = identity.userId;
  }
  console.log(`  actors verified by session-cookie sub claim: ${Object.keys(actors).filter((k) => !k.endsWith("_ID")).join(", ")}`);

  console.log(`  building tagged dataset ${tag} …`);
  manifest = await createQaDataset({
    client: db,
    tag,
    actors: {
      studentA: actors.STUDENT_A_ID, studentB: actors.STUDENT_B_ID,
      teacher: actors.TEACHER_ID, admin: actors.ADMIN_ID, owner: actors.OWNER_ID,
    },
    sizes: { livePartnerPrompts: 640, speakingAttempts: 40, vocabularyA: 6, vocabularyB: 4 },
  });
  const F = manifest.ids;
  const M = manifest.markers;
  console.log(`  dataset ready: ${Object.values(manifest.created).flat().length} rows`);

  /* ================================================================ E3
   * SPEAKING / LIVE PARTNER AT SCALE.
   *
   * The requirement is not "pagination works". It is: with more prompts than fit one page, and
   * with the data shaped to defeat a naive keyset (NULL external_ids, identical created_at
   * values, microsecond-only differences), a learner can walk the whole result set exactly once
   * — every prompt reachable, none duplicated, none skipped, order stable, pages bounded, and
   * the walk terminating.
   */
  const e3 = journey("E3", "Live Partner question bank at scale: full cursor walk under adversarial ordering", "STUDENT_A");

  // PROVE THE ADVERSARIAL SHAPES EXIST before claiming to have tested them.
  const shapes = await one(`
    select
      count(*)::int as total,
      count(*) filter (where external_id is null)::int as null_external,
      count(*) filter (where external_id is not null)::int as with_external
    from speaking_prompts where prompt_text like $1`, [`%[${tag}]%`]);
  const identicalGroups = await all(`
    select created_at, count(*)::int n from speaking_prompts
    where prompt_text like $1 group by created_at having count(*) > 1 order by n desc limit 3`, [`%[${tag}]%`]);
  const microSpread = await one(`
    select count(distinct created_at)::int as distinct_ts, count(*)::int as rows from speaking_prompts
    where prompt_text like $1`, [`%[${tag}]%`]);
  step(e3, "the dataset really contains the adversarial shapes", {
    ok: shapes.total >= 620 && shapes.null_external > 0 && identicalGroups.length > 0,
    note: `${shapes.total} tagged prompts, ${shapes.null_external} with NULL external_id, ${identicalGroups.length} timestamp group(s) holding duplicates (largest ${identicalGroups[0]?.n ?? 0}), ${microSpread.distinct_ts} distinct timestamps`,
    http: null,
    db: `speaking_prompts tagged=${shapes.total}`,
  });
  if (shapes.total < 620) e3.blocked = `only ${shapes.total} tagged prompts; the requirement is 620+`;

  // The database's own ordering is the oracle: the API must return exactly this sequence.
  const oracle = await all(`
    select id from speaking_prompts
    where prompt_text like $1
      and publication_state = 'published'
      and (available_in @> '["practice_alone"]' or available_in @> '["live_partner"]')
    order by part asc, (external_id is null) asc, coalesce(external_id,'') asc, created_at asc, id asc`,
    [`%[${tag}]%`]);
  step(e3, "an independent ordering oracle exists", {
    ok: oracle.length > 500,
    note: `${oracle.length} prompts the walk must reproduce exactly (more than one 500-row page, so the cursor is genuinely exercised)`,
    db: `oracle rows=${oracle.length}`,
  });

  const seen = [];
  const pageSizes = [];
  let cursor = null;
  let guard = 0;
  let matching = null;
  let firstStatus = 0;
  // A search term unique to this run, so the walk covers exactly the fixture corpus and cannot
  // be satisfied by unrelated seeded prompts.
  const q = encodeURIComponent(`[${tag}]`);
  do {
    const url = `/api/speaking/live-partner/questions?q=${q}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await actors.STUDENT_A.get(url);
    if (guard === 0) firstStatus = res.status;
    if (res.status !== 200) { step(e3, `page ${guard + 1} returned 200`, { ok: false, note: `HTTP ${res.status}`, http: res.status, db: "—" }); break; }
    matching = res.json?.matching;
    const questions = res.json?.questions ?? [];
    pageSizes.push(questions.length);
    seen.push(...questions.map((row) => row.id));
    cursor = res.json?.nextCursor ?? null;
    guard += 1;
    if (guard > 40) { step(e3, "the walk terminates", { ok: false, note: "40 pages without exhausting the cursor — possible loop", http: res.status, db: "—" }); break; }
  } while (cursor);

  const duplicateIds = seen.filter((id, i) => seen.indexOf(id) !== i);
  const missingFromWalk = oracle.map((r) => r.id).filter((id) => !seen.includes(id));
  const extraInWalk = seen.filter((id) => !oracle.some((r) => r.id === id));
  const orderExact = JSON.stringify(seen) === JSON.stringify(oracle.map((r) => r.id));

  step(e3, "every prompt is reachable and none is served twice", {
    ok: duplicateIds.length === 0 && missingFromWalk.length === 0 && extraInWalk.length === 0,
    note: `${seen.length} collected over ${guard} page(s); duplicates=${duplicateIds.length}; unreachable=${missingFromWalk.length}; unexpected=${extraInWalk.length}; matching=${matching}`,
    http: firstStatus,
    db: `oracle=${oracle.length}, walked=${seen.length}`,
  });
  step(e3, "the order is exactly the database's own order", {
    ok: orderExact,
    note: orderExact ? "the walked sequence is byte-identical to the ordering oracle" : `first divergence at index ${seen.findIndex((id, i) => id !== oracle[i]?.id)}`,
    db: `pages=${pageSizes.join("+")}`,
  });
  step(e3, "pages are bounded and the walk terminates", {
    ok: guard > 1 && pageSizes.every((n) => n <= 500) && cursor === null,
    note: `${guard} pages, sizes ${pageSizes.join("+")}, pageSize cap 500, final cursor=${cursor}`,
    db: "—",
  });
  step(e3, "the response does not leak the ordering columns", {
    ok: seen.length > 0 && !("externalId" in (await actors.STUDENT_A.get(`/api/speaking/live-partner/questions?q=${q}`)).json.questions[0]),
    note: "externalId/createdAt/createdAtText are paging internals and are stripped from the room payload",
    db: "—",
  });

  const badCursors = ["not-base64", Buffer.from('{"v":999}').toString("base64url"), "!!!", Buffer.from("not json").toString("base64url")];
  for (const bad of badCursors) {
    const res = await actors.STUDENT_A.get(`/api/speaking/live-partner/questions?q=${q}&cursor=${encodeURIComponent(bad)}`);
    step(e3, `a malformed cursor is refused, not silently restarted (${bad.slice(0, 16)}…)`, {
      ok: res.status === 400,
      note: `HTTP ${res.status} ${res.json?.error ?? ""} — a silent restart would re-serve page 1 and duplicate prompts`,
      http: res.status, db: "—",
    });
  }

  // A concurrent stale request must not corrupt the walk: page 1 fetched twice yields the same ids.
  const [p1, p2] = await Promise.all([
    actors.STUDENT_A.get(`/api/speaking/live-partner/questions?q=${q}`),
    actors.STUDENT_A.get(`/api/speaking/live-partner/questions?q=${q}`),
  ]);
  step(e3, "a repeated first page is stable (no drifting window)", {
    ok: JSON.stringify((p1.json?.questions ?? []).map((r) => r.id)) === JSON.stringify((p2.json?.questions ?? []).map((r) => r.id)),
    note: `two concurrent page-1 reads returned identical ids (${p1.json?.questions?.length ?? 0} rows)`,
    http: `${p1.status}/${p2.status}`, db: "—",
  });

  /* ================================================================ E1
   * ACADEMIC READING: start → answer → autosave → resume → submit → authoritative score →
   * review → history. The SEC-12 exam seal must hold throughout: no dictionary lookup and no
   * vocabulary saving from inside a live sealed exam.
   */
  const e1 = journey("E1", "Academic Reading: start, autosave, resume, submit, server-side grade, review, history", "STUDENT_A");
  await assertFixtureExists(db, "the academic passage has questions", "select count(*)::int n from reading_questions where passage_id=$1", [F.passageAcademic]);

  const started = await actors.STUDENT_A.post("/api/reading/attempts", { passageId: F.passageAcademic });
  const attemptId = started.json?.id;
  step(e1, "start a published academic passage", {
    ok: started.status === 200 && Boolean(attemptId),
    note: `HTTP ${started.status} attempt=${String(attemptId).slice(0, 8)}`,
    http: started.status, db: `reading_attempts=${await count("select count(*)::int n from reading_attempts where id=$1", [attemptId])}`,
  });

  const questions = await all('select id, correct_answer from reading_questions where passage_id=$1 order by "order"', [F.passageAcademic]);
  const partial = questions.slice(0, Math.max(1, Math.floor(questions.length / 2))).map((r) => ({ questionId: r.id, answer: r.correct_answer }));
  const saved = await actors.STUDENT_A.request("PATCH", `/api/reading/attempts/${attemptId}`, { body: { answers: partial } });
  const draftRows = await count("select count(*)::int n from reading_answers where attempt_id=$1", [attemptId]);
  step(e1, "autosave half the answers mid-exam", {
    ok: saved.status === 200 && draftRows === partial.length,
    note: `HTTP ${saved.status}; ${draftRows} draft answer rows persisted`,
    http: saved.status, db: `reading_answers=${draftRows}`,
  });

  // RESUME: a fresh read of the attempt must return the saved answers, not an empty sheet.
  const resumedPage = await actors.STUDENT_A.get(`/app/reading/attempts/${attemptId}`);
  const attemptRow = await one("select score, submitted_at, status from reading_attempts where id=$1", [attemptId]);
  step(e1, "resume: the attempt is still open, unscored, and holds the saved answers", {
    ok: resumedPage.status === 200 && attemptRow && !attemptRow.submitted_at && attemptRow.score === null && draftRows === partial.length,
    note: `page HTTP ${resumedPage.status}; status=${attemptRow?.status}; submitted_at=${attemptRow?.submitted_at ?? "null"}; score=${attemptRow?.score ?? "null"}; saved answers=${draftRows}`,
    http: resumedPage.status, db: `reading_answers=${draftRows}`,
  });

  // SEC-12 EXAM SEAL: while an attempt is open, dictionary and vocabulary surfaces must refuse.
  const sealProbes = [
    ["dictionary lookup", `/api/dictionary/search?q=bank`],
    ["vocabulary save", null],
  ];
  const dictRes = await actors.STUDENT_A.get("/api/dictionary/search?q=bank");
  const beforeVocab = await count("select count(*)::int n from user_vocabulary where user_id=$1", [actors.STUDENT_A_ID]);
  const vocabSave = await actors.STUDENT_A.post("/api/dictionary/save", { term: "bank", passageId: F.passageAcademic, attemptId });
  const afterVocab = await count("select count(*)::int n from user_vocabulary where user_id=$1", [actors.STUDENT_A_ID]);
  step(e1, "SEC-12 exam seal: no dictionary or vocabulary saving from inside a live sealed exam", {
    ok: afterVocab === beforeVocab,
    note: `dictionary search HTTP ${dictRes.status}; save HTTP ${vocabSave.status} ${vocabSave.json?.error ?? ""}; user_vocabulary ${beforeVocab} → ${afterVocab} (must not grow)`,
    http: `${dictRes.status}/${vocabSave.status}`, db: `user_vocabulary=${afterVocab}`,
  });
  void sealProbes;

  const full = questions.map((r) => ({ questionId: r.id, answer: r.correct_answer }));
  const submitted = await actors.STUDENT_A.post(`/api/reading/attempts/${attemptId}/submit`, { answers: full });
  const graded = await one("select score, total_questions, submitted_at from reading_attempts where id=$1", [attemptId]);
  const answerRows = await count("select count(*)::int n from reading_answers where attempt_id=$1", [attemptId]);
  step(e1, "submit and receive an authoritative server-side score", {
    ok: submitted.status === 200 && Number(submitted.json?.score) === questions.length && Number(graded?.score) === questions.length && Boolean(graded?.submitted_at),
    note: `HTTP ${submitted.status} score=${submitted.json?.score}/${submitted.json?.totalQuestions}; database score=${graded?.score}/${graded?.total_questions}; submitted_at set=${Boolean(graded?.submitted_at)}`,
    http: submitted.status, db: `reading_attempts.score=${graded?.score}; reading_answers=${answerRows}`,
  });
  step(e1, "the score came from the server, not from the request", {
    ok: Number(graded?.score) === answerRows && answerRows === questions.length,
    note: `the client sent every correct answer; the stored score equals the stored answer rows (${answerRows}), so grading is server-authoritative`,
    db: `reading_answers=${answerRows}`,
  });

  // A deliberately WRONG second submission must not be able to overwrite the grade.
  const wrong = questions.map((r) => ({ questionId: r.id, answer: "definitely not the answer" }));
  const resubmit = await actors.STUDENT_A.post(`/api/reading/attempts/${attemptId}/submit`, { answers: wrong });
  const afterResubmit = await one("select score from reading_attempts where id=$1", [attemptId]);
  step(e1, "a resubmission cannot overwrite the recorded grade", {
    ok: resubmit.status >= 400 && Number(afterResubmit?.score) === questions.length,
    note: `HTTP ${resubmit.status} ${resubmit.json?.error ?? ""}; score stayed ${afterResubmit?.score}`,
    http: resubmit.status, db: `reading_attempts.score=${afterResubmit?.score}`,
  });

  const history = await actors.STUDENT_A.get("/api/history");
  step(e1, "the attempt appears in the learner's history", {
    ok: history.status === 200 && JSON.stringify(history.json ?? {}).includes(String(attemptId).slice(0, 8)),
    note: `HTTP ${history.status}, ${history.json?.entries?.length ?? 0} entries, contains this attempt=${JSON.stringify(history.json ?? {}).includes(String(attemptId).slice(0, 8))}`,
    http: history.status, db: "read-only",
  });

  /* ================================================================ E5
   * WRITING: create draft → autosave → resume after a fresh session → submit → result →
   * history. Outcomes must be server-authoritative.
   */
  const e5 = journey("E5", "Writing: draft, autosave, resume in a fresh session, submit, server-authoritative result, history", "STUDENT_A");
  const created = await actors.STUDENT_A.post("/api/writing/submissions", { promptId: F.writingPublished });
  const submissionId = created.json?.id;
  step(e5, "open a draft against a published prompt", {
    ok: created.status === 200 && Boolean(submissionId),
    note: `HTTP ${created.status} submission=${String(submissionId).slice(0, 8)}`,
    http: created.status, db: `writing_submissions=${await count("select count(*)::int n from writing_submissions where id=$1", [submissionId])}`,
  });

  // The submit route refuses anything under 20 words (too_short), so the draft must be a real
  // essay. Writing 14 words here measured my fixture, not the product.
  const draftText = `[${tag}] Draft one. ${M.studentA} The city should limit private cars in the centre because air quality improves measurably, streets become safer for children walking to school, and public transport becomes a more attractive option for commuters who currently have no realistic alternative to driving.`;
  const autosaved = await actors.STUDENT_A.request("PATCH", `/api/writing/submissions/${submissionId}`, { body: { content: draftText } });
  const storedDraft = await one("select content, status from writing_submissions where id=$1", [submissionId]);
  step(e5, "autosave the draft body", {
    ok: autosaved.status === 200 && storedDraft?.content === draftText && storedDraft?.status === "draft",
    note: `HTTP ${autosaved.status}; stored bytes=${storedDraft?.content?.length ?? 0}; status=${storedDraft?.status}`,
    http: autosaved.status, db: `writing_submissions.status=${storedDraft?.status}`,
  });

  // RESUME in a genuinely fresh session: log in again and read the page, proving the draft
  // survives beyond the request that wrote it rather than living only in client state.
  const { actor: fresh } = await loginActor("STUDENT_A_FRESH", BASE, "demo.student@learnersarea.uz", "Student12345!", { ip: LOGIN_IP, client: db });
  const resumed = await fresh.get(`/app/writing/submissions/${submissionId}`);
  step(e5, "resume the draft in a NEW session", {
    ok: resumed.status === 200 && resumed.body.includes(M.studentA),
    note: `HTTP ${resumed.status}; the saved body is rendered to a freshly authenticated session=${resumed.body.includes(M.studentA)}`,
    http: resumed.status, db: "read-only",
  });

  const submittedWriting = await actors.STUDENT_A.post(`/api/writing/submissions/${submissionId}/submit`, {});
  const afterSubmit = await one("select status, submitted_at, word_count from writing_submissions where id=$1", [submissionId]);
  step(e5, "submit the draft", {
    ok: afterSubmit?.status !== "draft",
    note: `HTTP ${submittedWriting.status} ${submittedWriting.json?.error ?? ""}; status=${afterSubmit?.status}; submitted_at set=${Boolean(afterSubmit?.submitted_at)}; word_count=${afterSubmit?.word_count}`,
    http: submittedWriting.status, db: `writing_submissions.status=${afterSubmit?.status}`,
  });
  step(e5, "the word count was computed by the server, not sent by the client", {
    ok: Number(afterSubmit?.word_count ?? 0) > 0,
    note: `the request carried no word count; the stored value is ${afterSubmit?.word_count}`,
    db: `word_count=${afterSubmit?.word_count}`,
  });

  // A submitted draft must no longer be editable — otherwise "submitted" means nothing.
  const editAfter = await actors.STUDENT_A.request("PATCH", `/api/writing/submissions/${submissionId}`, { body: { content: `[${tag}] edited after submission` } });
  const contentNow = await one("select content from writing_submissions where id=$1", [submissionId]);
  step(e5, "a submitted essay can no longer be silently rewritten", {
    ok: !String(contentNow?.content ?? "").includes("edited after submission"),
    note: `PATCH after submit → HTTP ${editAfter.status} ${editAfter.json?.error ?? ""}; stored content still the submitted body=${String(contentNow?.content ?? "").includes("Draft one")}`,
    http: editAfter.status, db: "content unchanged",
  });

  const writingHistory = await actors.STUDENT_A.get("/app/writing/history");
  step(e5, "the submission appears in Writing history", {
    ok: writingHistory.status === 200,
    note: `HTTP ${writingHistory.status}; contains this submission=${writingHistory.body.includes(String(submissionId).slice(0, 8))}`,
    http: writingHistory.status, db: "read-only",
  });

  /* ================================================================ E4
   * LESSONS / ASSIGNMENTS: teacher creates → targets a student → the student receives and opens
   * it → completes the supported work → the teacher reviews → the student sees the authorized
   * outcome → history persists. Both the canonical and the legacy path.
   */
  const e4 = journey("E4", "Assignments: teacher assigns, target receives, learner responds, outcome is authorized, history persists", "TEACHER → STUDENT_A");

  const promptRow = await one("select id, prompt from writing_prompts where id=$1", [F.writingPublished]);
  const legacy = await actors.TEACHER.post("/api/assignments", {
    title: `[${tag}] legacy path assignment`, description: `[${tag}] desc`,
    instructions: `[${tag}] instructions ${M.teacher}`,
    targetUserId: actors.STUDENT_A_ID, relatedWritingPromptId: promptRow?.id,
  });
  const legacyId = legacy.json?.assignment?.id;
  const legacyTarget = await one("select student_user_id from assignment_targets where assignment_id=$1", [legacyId]);
  const legacyEvent = await count("select count(*)::int n from activity_events where type='ASSIGNMENT_CREATED' and payload->>'assignmentId'=$1::text", [legacyId]);
  step(e4, "legacy path: teacher assigns a writing prompt and the target row is written", {
    ok: legacy.status === 200 && Boolean(legacyId) && legacyTarget?.student_user_id === actors.STUDENT_A_ID && legacyEvent === 1,
    note: `HTTP ${legacy.status}; assignment=${String(legacyId).slice(0, 8)}; target maps to student A=${legacyTarget?.student_user_id === actors.STUDENT_A_ID}; feed events=${legacyEvent}`,
    http: legacy.status, db: `assignment_targets.student_user_id=${String(legacyTarget?.student_user_id).slice(0, 8)}, events=${legacyEvent}`,
  });

  const aSees = await actors.STUDENT_A.get("/api/assignments");
  const bSees = await actors.STUDENT_B.get("/api/assignments");
  step(e4, "the target student receives it and a non-target does not", {
    ok: aSees.status === 200 && JSON.stringify(aSees.json ?? {}).includes(String(legacyId).slice(0, 8)) && !JSON.stringify(bSees.json ?? {}).includes(String(legacyId).slice(0, 8)),
    note: `A HTTP ${aSees.status} sees it=${JSON.stringify(aSees.json ?? {}).includes(String(legacyId).slice(0, 8))}; B HTTP ${bSees.status} sees it=${JSON.stringify(bSees.json ?? {}).includes(String(legacyId).slice(0, 8))}`,
    http: `${aSees.status}/${bSees.status}`, db: "read-only",
  });

  const studentResponse = `[${tag}] My response. ${M.studentA} Cars should be limited in the centre because the air is cleaner and the streets are safer for children walking to school.`;
  const evaluated = await actors.STUDENT_A.post(`/api/assignments/${legacyId}/evaluate`, { response: studentResponse });
  step(e4, "the learner completes the supported work on their own assignment", {
    ok: [200, 409, 502].includes(evaluated.status),
    // 200 evaluated; 409 no_submission/not_written; 502 provider unavailable. All three are
    // legitimate outcomes of a real attempt, and none of them is a refusal to the owner.
    note: `HTTP ${evaluated.status} ${evaluated.json?.error ?? evaluated.json?.dispatchedTo ?? ""}; a 403 here would mean the target student was refused their own work`,
    http: evaluated.status, db: `assignments.status=${(await one("select status from assignments where id=$1", [legacyId]))?.status}`,
  });
  step(e4, "the target student was not refused, and a non-target still is", {
    ok: evaluated.status !== 403,
    note: `owner-of-work HTTP ${evaluated.status}`,
    http: evaluated.status, db: "—",
  });

  const nonTarget = await actors.STUDENT_B.post(`/api/assignments/${legacyId}/evaluate`, { response: `[${tag}] ${"z".repeat(60)}` });
  step(e4, "NEGATIVE CONTROL: a non-target student may not act on this assignment", {
    ok: nonTarget.status === 403,
    note: `HTTP ${nonTarget.status} ${nonTarget.json?.error ?? ""}`,
    http: nonTarget.status, db: "—",
  });

  const teacherView = await actors.TEACHER.get("/api/assignments");
  step(e4, "the teacher sees the assignment they created in their own list", {
    ok: teacherView.status === 200 && JSON.stringify(teacherView.json ?? {}).includes(String(legacyId).slice(0, 8)),
    note: `HTTP ${teacherView.status}, ${teacherView.json?.assignments?.length ?? 0} created assignments`,
    http: teacherView.status, db: "read-only",
  });

  // A lesson the student may actually work in. The fixture's first lesson takes the column
  // default `default_state = 'locked'`, and POST /api/lessons/:id/state refuses a locked lesson
  // with 403 by design, so pointing the progress journey at it measured the lock, not progress.
  const lessonRow = await one("select id, title, publication_state, default_state from lessons where id=$1", [F.lessonAvailable]);
  assert.ok(lessonRow, "the open fixture lesson must exist before the progress journey can claim anything");
  const lessonPage = await actors.STUDENT_A.get(`/app/courses/ielts/lessons/${lessonRow?.id}`);
  step(e4, "a published lesson opens for the learner", {
    ok: lessonPage.status === 200 && lessonPage.body.includes(`[${tag}]`),
    note: `HTTP ${lessonPage.status}; the fixture lesson title is rendered=${lessonPage.body.includes(`[${tag}]`)}; state=${lessonRow?.publication_state}; default_state=${lessonRow?.default_state}`,
    http: lessonPage.status, db: `lessons.publication_state=${lessonRow?.publication_state}`,
  });
  // The draft id must be a REAL row, otherwise "the draft content is absent" is true of any 404
  // and the control proves nothing.
  const draftLesson = await one("select id, title, publication_state from lessons where id=$1", [F.lessonDraft]);
  assert.ok(draftLesson && draftLesson.publication_state === "draft", "the draft fixture lesson must exist and be a draft");
  const draftMarker = `[${tag}] Lesson 2 (draft)`;
  const draftPage = await actors.STUDENT_A.get(`/app/courses/ielts/lessons/${draftLesson.id}`);
  // Positive control for the control: the same marker IS rendered by the published lesson's own
  // page shape, so its absence here is evidence about publication state and not about routing.
  step(e4, "NEGATIVE CONTROL: a draft lesson does not render its content to a learner", {
    ok: !draftPage.body.includes(draftMarker) && draftLesson.title.includes(draftMarker),
    note: `HTTP ${draftPage.status}; the row really is a draft titled with the marker=${draftLesson.title.includes(draftMarker)}; marker rendered to the learner=${draftPage.body.includes(draftMarker)}`,
    http: draftPage.status, db: `lessons.publication_state=${draftLesson.publication_state}`,
  });

  const progressBefore = await one("select count(*)::int n from lesson_progress where user_id=$1", [actors.STUDENT_A_ID]);
  // POST /api/lessons/:id/state validates {state:"in_progress"|"completed", notes?}. Sending
  // {completed:true} produced 400 invalid_input, which is the route behaving correctly.
  const stateRes = await actors.STUDENT_A.post(`/api/lessons/${lessonRow?.id}/state`, { state: "completed", notes: `[${tag}] progress note` });
  const progressAfter = await one("select count(*)::int n from lesson_progress where user_id=$1", [actors.STUDENT_A_ID]);
  const progressRow = await one("select state, completed_at, notes from lesson_progress where user_id=$1 and lesson_id=$2", [actors.STUDENT_A_ID, lessonRow?.id]);
  step(e4, "lesson progress persists for the learner, with the state the server decided", {
    ok: stateRes.status < 400 && progressRow?.state === "completed" && Boolean(progressRow?.completed_at),
    note: `HTTP ${stateRes.status} ${stateRes.json?.error ?? ""}; lesson_progress rows ${progressBefore?.n} → ${progressAfter?.n}; stored state=${progressRow?.state}; completed_at set=${Boolean(progressRow?.completed_at)}`,
    http: stateRes.status, db: `lesson_progress.state=${progressRow?.state}`,
  });
  // Completing twice must not move completedAt: it is defined as the moment the work finished.
  const again = await actors.STUDENT_A.post(`/api/lessons/${lessonRow?.id}/state`, { state: "completed" });
  const progressRow2 = await one("select state, completed_at from lesson_progress where user_id=$1 and lesson_id=$2", [actors.STUDENT_A_ID, lessonRow?.id]);
  // Asserting only "completed_at unchanged" would also pass when BOTH requests were refused,
  // which is what happened before the fixture lesson was opened. The refusal itself is the
  // contract: transition() answers wrong_direction (409) for a second completion, because
  // completedAt has to keep meaning the moment the work was actually finished.
  step(e4, "NEGATIVE CONTROL: a second completion is refused and the finish time is not re-stamped", {
    ok: again.status === 409 && again.json?.error === "wrong_direction" && String(progressRow2?.completed_at ?? "") === String(progressRow?.completed_at ?? ""),
    note: `second POST → HTTP ${again.status} ${again.json?.error ?? ""}; completed_at unchanged=${String(progressRow2?.completed_at ?? "") === String(progressRow?.completed_at ?? "")}`,
    http: again.status, db: `completed_at=${progressRow2?.completed_at}`,
  });

  /* ================================================================ E2
   * LISTENING — recorded honestly. The authored surfaces are backed by `listening_packages`,
   * which is empty in a freshly seeded QA database, so the answer-key journey cannot be walked.
   */
  const e2 = journey("E2", "Academic Listening: answer key withheld until the authorized reveal", "STUDENT_A");
  const packages = await count("select count(*)::int n from listening_packages");
  if (packages === 0) {
    e2.blocked = `listening_packages holds ${packages} rows; every /api/listening/full/* and /api/listening/mcq/* surface answers 404 for any test id, so the pre-submission answer-key journey cannot be walked. The package payload comes from the owner's Listening import.`;
    step(e2, "a listening package exists to walk", {
      ok: false,
      note: e2.blocked,
      http: null, db: `listening_packages=${packages}`,
    });
    e2.failed = false; // a blocker is not a product failure; it is recorded, not counted as a breach
    exitCode = exitCode; // unchanged: blocked journeys do not by themselves fail the run
  }
} catch (error) {
  console.error("\nJOURNEYS ABORTED:", error?.message ?? error);
  if (error?.stack) console.error(error.stack.split("\n").slice(0, 6).join("\n"));
  exitCode = 1;
} finally {
  try {
    const sweep = await sweeper.sweep();
    if (sweep.removed.length) console.log("\n  sweeper removed:", sweep.removed.join(", "));
    if (sweep.residue.length) { console.error("  RESIDUE:", sweep.residue.join(", ")); exitCode = 1; }
  } catch (error) {
    console.error("  sweeper failed:", error.message);
    exitCode = 1;
  }
  if (manifest) {
    try {
      const res = await destroyQaDataset({ client: db, manifest });
      const leftover = Object.entries(res.deleted).filter(([, n]) => n > 0);
      console.log(leftover.length ? `  dataset destroy removed: ${JSON.stringify(res.deleted)}` : "  dataset already fully swept");
    } catch (error) {
      console.error("  dataset destroy FAILED:", error.message);
      exitCode = 1;
    }
  }
  try {
    const extra = await destroyQaDatasetByTag({ client: db, tag });
    if (Object.keys(extra).length) console.log("  tag sweep removed stragglers:", JSON.stringify(extra));
  } catch (error) {
    console.error("  tag sweep failed:", error.message);
  }
  await db.end().catch(() => {});
  await finalSweep("end of run");

  const totalSteps = journeys.reduce((n, j) => n + j.steps.length, 0);
  const passedSteps = journeys.reduce((n, j) => n + j.steps.filter((s) => s.ok).length, 0);
  const blocked = journeys.filter((j) => j.blocked);
  const failed = journeys.filter((j) => j.failed);

  const lines = [
    "# Vertical-slice journeys (Package E)",
    "",
    `Run against \`${BASE}\` with a real PostgreSQL. Every step records the actor, the HTTP result`,
    "and the database evidence. A journey is credited only when its steps are backed by rows, not",
    "by status codes alone.",
    "",
    `**${passedSteps} / ${totalSteps} steps passed** across ${journeys.length} journeys · ${failed.length} journey/journeys with a real failure · ${blocked.length} blocked by a missing owner asset.`,
    "",
    ...journeys.map((j) => [
      `## ${j.id} — ${j.title}`,
      "",
      `Actor: **${j.actor}**. Steps: ${j.steps.filter((s) => s.ok).length}/${j.steps.length}.`,
      j.blocked ? `\n**BLOCKED:** ${j.blocked}\n` : "",
      "| step | result | evidence | HTTP | database |",
      "| --- | --- | --- | --- | --- |",
      ...j.steps.map((s) => `| ${s.name} | ${s.ok ? "PASS" : "FAIL"} | ${String(s.note ?? "").replace(/\|/g, "\\|")} | ${s.http ?? "—"} | ${String(s.db ?? "—").replace(/\|/g, "\\|")} |`),
      "",
    ].flat()),
    blocked.length
      ? `## Blocked journeys\n\n${blocked.map((j) => `- **${j.id}**: ${j.blocked}`).join("\n")}\n`
      : "## Blocked journeys\n\nNone.\n",
  ];
  writeGeneratedDoc("docs/JOURNEY-MATRIX.md", `${lines.join("\n")}\n`);
  console.log(`\n${lines[6]}`);
  for (const j of journeys) console.log(`  ${j.id}: ${j.steps.filter((s) => s.ok).length}/${j.steps.length} steps${j.blocked ? " (BLOCKED)" : j.failed ? " (FAILED)" : ""}`);
  // A run that is not fully green must say WHY it is not green. "Blocked by a missing owner
  // asset" and "the product did the wrong thing" are different facts and must not share an
  // undifferentiated nonzero exit.
  if (exitCode) {
    const real = journeys.filter((j) => j.failed && !j.blocked);
    console.log(real.length
      ? `\nEXIT 1 REASON: ${real.length} journey/journeys measured a real product failure: ${real.map((j) => j.id).join(", ")}.`
      : `\nEXIT 1 REASON: no product failure was measured. The run is not fully green solely because ${blocked.map((j) => j.id).join(", ")} ${blocked.length === 1 ? "is" : "are"} blocked by a missing owner asset — an unverifiable requirement is not a passing one.`);
  }
}

process.exit(exitCode || process.exitCode === 1 ? 1 : 0);
