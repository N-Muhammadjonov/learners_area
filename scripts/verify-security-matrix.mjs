#!/usr/bin/env node
/**
 * PACKAGE D — six-actor security and concurrency matrix, over real HTTP against a built server
 * and a real PostgreSQL.
 *
 *   node scripts/verify-security-matrix.mjs [baseUrl]
 *
 * Actors: ANONYMOUS · STUDENT_A · STUDENT_B · TEACHER · ADMINISTRATOR · OWNER
 * (plus PENDING and TEACHER2 where a boundary needs a second holder of the same role).
 *
 * THE FOUR RULES THIS PROBE IS BUILT AROUND
 *
 *  1. A denial is only a denial if there was something to deny. Every row names the fixture it
 *     depends on, and that fixture is asserted to exist BEFORE any denial is asserted. Run
 *     against an empty database a matrix like this reports 100% PASS and proves nothing.
 *
 *  2. A status code is not a privacy proof. Each fixture carries a unique unguessable secret
 *     marker in its private columns, and a denial is judged on two axes recorded SEPARATELY:
 *     LEAK/PRIVACY_OK (did the marker reach the body?) and statusCorrect (did the status say
 *     denied?). PRIVACY_OK with a wrong status is reported as STATUS_DEFECT — not as an IDOR,
 *     and not as a PASS.
 *
 *  3. A probe defect is not a product finding. 405 (wrong verb) and 400 invalid_input (schema
 *     validation, which runs BEFORE the ownership check in this codebase) both mean the request
 *     never reached the boundary. Those rows are reported as PROBE_DEFECT and fail the run. The
 *     first draft of this matrix used GET against POST-only routes and reported six green rows
 *     that had tested a method-not-allowed table.
 *
 *  4. The contract asserted must be the contract the route actually implements. POST
 *     /api/assignments/:id/evaluate is the AI evaluation trigger that a TARGET STUDENT is
 *     allowed to call on their own work — not a teacher-only grading endpoint. Asserting the
 *     second against the first reports a correctly behaving route as a breach.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeGeneratedDoc } from "./lib/doc-output.mjs";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required: this probe proves database effects, not just statuses.");
  process.exit(2);
}

const { assertMutableDatabase, createRowSweeper, installSweepHandlers } = await import("./lib/fixture-safety.mjs");
const { createQaDataset, destroyQaDataset, destroyQaDatasetByTag, assertFixtureExists } = await import("./lib/qa-dataset.mjs");
const { createMatrix, judgeDenial, loginActor, createActor } = await import("./lib/security-matrix.mjs");
const pg = (await import("pg")).default;

assertMutableDatabase(DATABASE_URL, { probe: "verify-security-matrix" });

const LOGIN_IP = "203.0.113.77";
const ACCOUNTS = {
  STUDENT_A: ["demo.student@learnersarea.uz", "Student12345!"],
  STUDENT_B: ["new.student@learnersarea.uz", "Student12345!"],
  TEACHER: ["teacher@learnersarea.uz", "Teacher12345!"],
  TEACHER2: ["teacher2@learnersarea.uz", "Teacher12345!"],
  ADMIN: ["admin@learnersarea.uz", "Admin12345!"],
  OWNER: ["owner@learnersarea.uz", "Owner12345!"],
  PENDING: ["pending.student@learnersarea.uz", "Student12345!"],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const preparedWordsOf = (prep) => (Array.isArray(prep?.json?.text?.words) ? prep.json.text.words : []);

/**
 * A typing run that finish() will actually accept, and how long the probe must wait for it.
 *
 * finishPreparedTypingRun enforces a human-plausibility floor derived from the submitted
 * character count: `plausibleMs = ceil((chars / 5 / MAX_HUMAN_WPM) * 60000)` with MAX_HUMAN_WPM
 * 250 and a 1500 ms grace, plus 3000 ms for an untimed run and 60% of the preset for an
 * incomplete timed one. Firing finish immediately answers 409 too_early — correct product
 * behaviour, which the first draft of this matrix recorded as a failure. An UNTIMED run
 * (preset 0) with a short typed prefix is the cheapest shape that is still a genuine run: it
 * exercises the same verification, persistence and replay path without a 36-second wait.
 */
function typingPlan(words) {
  const typed = [...words.slice(0, 12), ""];
  const chars = typed.reduce((sum, w) => sum + String(w).length + 1, 0);
  const plausibleMs = Math.ceil(((chars / 5) / 250) * 60_000);
  return { typed, waitMs: Math.max(3_400, plausibleMs - 1_400) };
}

const matrix = createMatrix("Six-actor security and concurrency matrix (Package D)");
const statusDefects = [];
const probeDefects = [];
const ownerAssets = [];
const uploadedObjectKeys = [];

const sweepClient = new pg.Client({ connectionString: DATABASE_URL });
await sweepClient.connect();
const sweeper = createRowSweeper({
  client: sweepClient,
  probe: "verify-security-matrix",
  // Child → parent. Foreign keys are RESTRICT/NO ACTION in places, so this order is load-bearing.
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
  probe: "verify-security-matrix",
  onDone: () => sweepClient.end().catch(() => {}),
});
await sweeper.capture();

const tag = `qa-${randomUUID().slice(0, 8)}`;
let manifest = null;
const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0] ?? null;
const count = async (sql, params = []) => Number((await one(sql, params))?.n ?? 0);

const actors = {};
const secretScanResponses = [];
let exitCode = 0;

function denialRow(section, id, route, action, unauthorized, positiveControl, res, judgement, extra = {}) {
  if (judgement.probeDefect) {
    matrix.row({
      section, id, route, action,
      authorized: extra.authorized ?? "resource owner", unauthorized, positiveControl,
      negativeControl: "NOT REACHED — the request never got to the authorisation check",
      actual: `HTTP ${res.status} — ${judgement.probeDefect}`,
      dbEffect: extra.dbEffect ?? "unknown",
      verdict: "PROBE_DEFECT",
    });
    probeDefects.push(`${section}/${id} ${route} — ${judgement.probeDefect}`);
    exitCode = 1;
    return "PROBE_DEFECT";
  }
  const privacyOk = !judgement.leaked;
  const verdict = privacyOk && judgement.statusCorrect ? "PASS" : privacyOk ? "STATUS_DEFECT" : "FAIL";
  matrix.row({
    section, id, route, action,
    authorized: extra.authorized ?? "resource owner", unauthorized, positiveControl,
    negativeControl: `${unauthorized} denied, marker absent`,
    actual: `HTTP ${res.status}${judgement.redirectedToLogin ? " →/login" : ""}; ` +
      `privacy=${privacyOk ? "OK" : `LEAK ${judgement.leakedMarkers.join(",")}`}; ` +
      `status=${judgement.statusCorrect ? "correct" : "WRONG"}`,
    dbEffect: extra.dbEffect ?? "none asserted",
    verdict,
  });
  if (verdict === "FAIL") exitCode = 1;
  if (verdict === "STATUS_DEFECT") statusDefects.push(`${section}/${id} ${route} → HTTP ${res.status} (privacy held)`);
  return verdict;
}

/** Record a row and fail the run if it is not PASS. */
function plainRow(row) {
  matrix.row(row);
  if (row.verdict === "STATUS_DEFECT") statusDefects.push(`${row.section}/${row.id} ${row.route} (privacy held)`);
  if (row.verdict === "PROBE_DEFECT") probeDefects.push(`${row.section}/${row.id} ${row.route} — never reached the boundary`);
  if (row.verdict !== "PASS" && row.verdict !== "PASS_NO_SURFACE") exitCode = 1;
  return matrix.rows.at(-1);
}

try {
  /* ------------------------------------------------------------- identity */
  for (const [name, [email, password]] of Object.entries(ACCOUNTS)) {
    const { actor, identity } = await loginActor(name, BASE, email, password, { ip: LOGIN_IP, client: db, sink: secretScanResponses });
    actors[name] = actor;
    actors[`${name}_ID`] = identity.userId;
    console.log(`  actor ${name} = ${email} sub=${identity.userId} role=${identity.role} status=${identity.accountStatus}`);
  }
  actors.ANONYMOUS = createActor("ANONYMOUS", "", BASE, { ip: LOGIN_IP, sink: secretScanResponses });

  const ids = ["STUDENT_A", "STUDENT_B", "TEACHER", "TEACHER2", "ADMIN", "OWNER", "PENDING"].map((n) => actors[`${n}_ID`]);
  assert.equal(new Set(ids).size, ids.length, "the actors must be distinct accounts");

  /* -------------------------------------------------------------- dataset */
  console.log(`\n  building tagged dataset ${tag} …`);
  manifest = await createQaDataset({
    client: db,
    tag,
    actors: {
      studentA: actors.STUDENT_A_ID, studentB: actors.STUDENT_B_ID,
      teacher: actors.TEACHER_ID, admin: actors.ADMIN_ID, owner: actors.OWNER_ID,
    },
    sizes: { livePartnerPrompts: 620, speakingAttempts: 100, vocabularyA: 6, vocabularyB: 4 },
  });
  const M = manifest.markers;
  const F = manifest.ids;
  console.log(`  dataset ready: ${Object.values(manifest.created).flat().length} rows\n`);

  /* ---------------------------------------------------- positive controls */
  await assertFixtureExists(db, "student A has speaking attempts", "select count(*)::int n from speaking_attempts where user_id=$1", [actors.STUDENT_A_ID]);
  await assertFixtureExists(db, "student B has a speaking attempt", "select count(*)::int n from speaking_attempts where id=$1", [F.bAttempt]);
  await assertFixtureExists(db, "student A has a writing submission", "select count(*)::int n from writing_submissions where id=$1", [F.subA]);
  await assertFixtureExists(db, "student B has a writing submission", "select count(*)::int n from writing_submissions where id=$1", [F.subB]);
  await assertFixtureExists(db, "a draft reading passage exists", "select count(*)::int n from reading_passages where id=$1", [F.passageDraft]);
  await assertFixtureExists(db, "a draft listening test exists", "select count(*)::int n from listening_tests where id=$1", [F.listeningDraft]);
  await assertFixtureExists(db, "620+ tagged live partner prompts exist", "select count(*)::int n from speaking_prompts where prompt_text like $1", [`%[${tag}]%`]);
  await assertFixtureExists(db, "student A owns vocabulary", "select count(*)::int n from user_vocabulary where user_id=$1", [actors.STUDENT_A_ID]);
  await assertFixtureExists(db, "an assignment targets student A", "select count(*)::int n from assignment_targets where student_user_id=$1", [actors.STUDENT_A_ID]);
  console.log("  positive controls: every fixture the matrix depends on is present\n");

  /* ============================== D1 — READING / LISTENING ================ */
  const S1 = "D1";
  const readingQuestions = (await db.query(
    'select id, correct_answer from reading_questions where passage_id=$1 order by "order"', [F.passageAcademic],
  )).rows;
  const answers = readingQuestions.map((row) => ({ questionId: row.id, answer: row.correct_answer }));
  const listeningQuestions = (await db.query(
    "select id, correct_answer from listening_questions where test_id=$1", [F.listeningPublished],
  )).rows;

  const startReading = await actors.STUDENT_A.post("/api/reading/attempts", { passageId: F.passageAcademic });
  const readingAttemptId = startReading.json?.id;
  plainRow({
    section: S1, id: "R01", route: "POST /api/reading/attempts",
    action: "student A starts a published academic passage",
    authorized: "STUDENT_A", unauthorized: "—",
    positiveControl: `published passage ${F.passageAcademic.slice(0, 8)} with ${readingQuestions.length} questions`,
    negativeControl: "—",
    actual: `HTTP ${startReading.status} id=${String(readingAttemptId).slice(0, 8)}`,
    dbEffect: `reading_attempts row ${String(readingAttemptId).slice(0, 8)}`,
    verdict: startReading.status === 200 && readingAttemptId ? "PASS" : "FAIL",
  });

  // Anonymous: GET-supporting private feeds only (see rule 3 in the header).
  for (const [id, route] of [["R02", "/api/speaking/attempts"], ["R03", "/api/vocabulary/due"], ["R04", "/api/history"], ["R05", "/api/vocabulary/summary"], ["R06", "/api/assignments"], ["R07", "/api/notifications"]]) {
    const res = await actors.ANONYMOUS.get(route);
    denialRow(S1, id, `GET ${route}`, "an anonymous visitor reads a private feed", "ANONYMOUS",
      "the same route answers STUDENT_A (R08)", res, judgeDenial(res, [M.studentA, M.studentB, M.teacher, M.owner]));
  }
  const anonPositive = await actors.STUDENT_A.get("/api/history");
  plainRow({
    section: S1, id: "R08", route: "GET /api/history",
    action: "student A reads their own history (positive twin of R04)",
    authorized: "STUDENT_A", unauthorized: "ANONYMOUS",
    positiveControl: "—", negativeControl: "R04",
    actual: `HTTP ${anonPositive.status}, ${anonPositive.json?.entries?.length ?? 0} entries`,
    dbEffect: "read-only",
    verdict: anonPositive.status === 200 ? "PASS" : "FAIL",
  });

  // Cross-user write: PATCH is the only verb, and the body must be VALID so schema
  // validation is not the reason the request fails.
  const draftBody = { answers: readingQuestions.slice(0, 1).map((row) => ({ questionId: row.id, answer: "Two hundred" })) };
  const bPatchesA = await actors.STUDENT_B.request("PATCH", `/api/reading/attempts/${readingAttemptId}`, { body: draftBody });
  const answersAfterB = await count("select count(*)::int n from reading_answers where attempt_id=$1", [readingAttemptId]);
  denialRow(S1, "R09", "PATCH /api/reading/attempts/{id}",
    "student B autosaves answers into student A's attempt", "STUDENT_B",
    `attempt ${String(readingAttemptId).slice(0, 8)} exists and belongs to A (R01)`,
    bPatchesA, judgeDenial(bPatchesA, [M.studentA]),
    { authorized: "STUDENT_A", dbEffect: `reading_answers=${answersAfterB}` });
  if (answersAfterB !== 0) { matrix.rows.at(-1).verdict = "FAIL"; matrix.rows.at(-1).dbEffect += " — WRITE BY A NON-OWNER"; exitCode = 1; }

  // The read path a learner actually uses is the PAGE. This is where the documented
  // "200 with a 404 body" residual lives, so privacy and status are reported apart.
  const bPage = await actors.STUDENT_B.get(`/app/reading/attempts/${readingAttemptId}`);
  const bPageJ = judgeDenial(bPage, [M.studentA]);
  plainRow({
    section: S1, id: "R09b", route: "GET /app/reading/attempts/{id}",
    action: "student B opens student A's attempt PAGE",
    authorized: "STUDENT_A", unauthorized: "STUDENT_B",
    positiveControl: "the attempt exists, belongs to A, and A can open it (R01/R13)",
    negativeControl: "A's secret marker must not appear anywhere in the rendered HTML",
    actual: `HTTP ${bPage.status}${bPageJ.redirectedToLogin ? " →/login" : ""}; privacy=${bPageJ.leaked ? "LEAK " + bPageJ.leakedMarkers : "OK"}; status=${bPageJ.statusCorrect ? "correct" : "WRONG (routing residual, not an IDOR)"}`,
    dbEffect: "read-only",
    verdict: bPageJ.leaked ? "FAIL" : bPageJ.statusCorrect ? "PASS" : "STATUS_DEFECT",
  });

  const forged = randomUUID();
  const bForged = await actors.STUDENT_B.request("PATCH", `/api/reading/attempts/${forged}`, { body: draftBody });
  denialRow(S1, "R10", "PATCH /api/reading/attempts/{forged}",
    "student B autosaves into an attempt id that exists nowhere", "STUDENT_B",
    `uuid ${forged.slice(0, 8)} is absent from reading_attempts`, bForged, judgeDenial(bForged, [M.studentA, M.studentB]));

  const malformed = await actors.STUDENT_B.request("PATCH", "/api/reading/attempts/not-a-uuid", { body: draftBody });
  denialRow(S1, "R11", "PATCH /api/reading/attempts/not-a-uuid",
    "a malformed id never reaches the database", "STUDENT_B",
    "the string is not a uuid", malformed, judgeDenial(malformed, [M.studentA, M.studentB]));

  const beforeSubmit = await count("select count(*)::int n from reading_answers where attempt_id=$1", [readingAttemptId]);
  const bSubmitsA = await actors.STUDENT_B.post(`/api/reading/attempts/${readingAttemptId}/submit`, { answers });
  const afterBSubmit = await count("select count(*)::int n from reading_answers where attempt_id=$1", [readingAttemptId]);
  denialRow(S1, "R12", "POST /api/reading/attempts/{id}/submit",
    "student B submits answers into student A's attempt", "STUDENT_B",
    `the attempt has ${readingQuestions.length} answerable questions`, bSubmitsA, judgeDenial(bSubmitsA, [M.studentA]),
    { authorized: "STUDENT_A", dbEffect: `reading_answers ${beforeSubmit} → ${afterBSubmit}` });
  if (afterBSubmit !== beforeSubmit) { matrix.rows.at(-1).verdict = "FAIL"; matrix.rows.at(-1).dbEffect += " — WRITE BY A NON-OWNER"; exitCode = 1; }

  const aSubmits = await actors.STUDENT_A.post(`/api/reading/attempts/${readingAttemptId}/submit`, { answers });
  const stored = await one("select score, total_questions, submitted_at from reading_attempts where id=$1", [readingAttemptId]);
  const answersAfterA = await count("select count(*)::int n from reading_answers where attempt_id=$1", [readingAttemptId]);
  plainRow({
    section: S1, id: "R13", route: "POST /api/reading/attempts/{id}/submit",
    action: "student A submits their own attempt and is graded server-side",
    authorized: "STUDENT_A", unauthorized: "STUDENT_B (R12)",
    positiveControl: `${readingQuestions.length} questions exist for the passage`,
    negativeControl: "R12 proved a non-owner cannot write here",
    actual: `HTTP ${aSubmits.status} score=${aSubmits.json?.score}/${aSubmits.json?.totalQuestions}`,
    dbEffect: `reading_answers=${answersAfterA}; score=${stored?.score}; submitted_at set=${Boolean(stored?.submitted_at)}`,
    verdict: aSubmits.status === 200 && Number(aSubmits.json?.score) === readingQuestions.length && stored?.submitted_at && answersAfterA === readingQuestions.length ? "PASS" : "FAIL",
  });

  const aAgain = await actors.STUDENT_A.post(`/api/reading/attempts/${readingAttemptId}/submit`, { answers });
  const afterDup = await count("select count(*)::int n from reading_answers where attempt_id=$1", [readingAttemptId]);
  const scoreAfterDup = await one("select score from reading_attempts where id=$1", [readingAttemptId]);
  plainRow({
    section: S1, id: "R14", route: "POST /api/reading/attempts/{id}/submit",
    action: "the same attempt submitted a second time",
    authorized: "STUDENT_A", unauthorized: "—",
    positiveControl: "the first submit succeeded and wrote its answers (R13)",
    negativeControl: "a second submit must not add answers, change the score, or answer 200",
    actual: `HTTP ${aAgain.status} ${aAgain.json?.error ?? ""}; answers ${answersAfterA} → ${afterDup}; score ${stored?.score} → ${scoreAfterDup?.score}`,
    dbEffect: `reading_answers=${afterDup} (must stay ${answersAfterA})`,
    verdict: afterDup === answersAfterA && aAgain.status !== 200 ? "PASS" : "FAIL",
  });

  const draftStart = await actors.STUDENT_A.post("/api/reading/attempts", { passageId: F.passageDraft });
  const draftListed = await actors.STUDENT_A.request("POST", "/api/reading/academic", { body: {} });
  const draftLeak = (draftListed.body || "").includes(`[${tag}] DRAFT reading`);
  plainRow({
    section: S1, id: "R15", route: "POST /api/reading/attempts {draft}",
    action: "a learner tries to start an unpublished passage",
    authorized: "staff only", unauthorized: "STUDENT_A",
    positiveControl: `draft passage ${F.passageDraft.slice(0, 8)} exists with publication_state=draft`,
    negativeControl: "the attempt must not be created and the draft must not be listed",
    actual: `start HTTP ${draftStart.status}; library HTTP ${draftListed.status}; draft listed=${draftLeak}`,
    dbEffect: "no reading_attempts row for the draft",
    verdict: draftStart.status !== 200 && !draftLeak ? "PASS" : "FAIL",
  });

  // ---- Listening
  const lStart = await actors.STUDENT_A.post("/api/listening/attempts", { testId: F.listeningPublished });
  const listeningAttemptId = lStart.json?.id;
  const lDraft = await actors.STUDENT_A.post("/api/listening/attempts", { testId: F.listeningDraft });
  plainRow({
    section: S1, id: "L01", route: "POST /api/listening/attempts",
    action: "a learner starts a published test but is refused a draft one",
    authorized: "STUDENT_A (published)", unauthorized: "STUDENT_A on the draft",
    positiveControl: `both tests exist: ${F.listeningPublished.slice(0, 8)} published, ${F.listeningDraft.slice(0, 8)} draft`,
    negativeControl: "the draft start must be refused",
    actual: `published HTTP ${lStart.status} id=${String(listeningAttemptId).slice(0, 8)}; draft HTTP ${lDraft.status}`,
    dbEffect: "listening_attempts created for the published test only",
    verdict: lStart.status === 200 && listeningAttemptId && lDraft.status !== 200 ? "PASS" : "FAIL",
  });

  if (listeningAttemptId) {
    // PUT is the verb, and the body must satisfy the schema (answers keyed by questionId,
    // plus audioPosition) or validation refuses it before ownership is ever checked.
    const draftPayload = { answers: { [listeningQuestions[0].id]: "Nine" }, audioPosition: 12 };
    const bListeningDraft = await actors.STUDENT_B.request("PUT", `/api/listening/attempts/${listeningAttemptId}/draft`, { body: draftPayload });
    denialRow(S1, "L02", "PUT /api/listening/attempts/{id}/draft",
      "student B writes into student A's listening draft", "STUDENT_B",
      "the attempt exists and belongs to A (L01)", bListeningDraft, judgeDenial(bListeningDraft, [M.studentA]),
      { authorized: "STUDENT_A" });

    const submitPayload = { answers: listeningQuestions.map((row) => ({ questionId: row.id, answer: row.correct_answer })) };
    const beforeLA = await count("select count(*)::int n from listening_answers where attempt_id=$1", [listeningAttemptId]);
    const bListeningSubmit = await actors.STUDENT_B.post(`/api/listening/attempts/${listeningAttemptId}/submit`, submitPayload);
    const afterLA = await count("select count(*)::int n from listening_answers where attempt_id=$1", [listeningAttemptId]);
    denialRow(S1, "L03", "POST /api/listening/attempts/{id}/submit",
      "student B submits into student A's listening attempt", "STUDENT_B",
      `${listeningQuestions.length} questions exist and the attempt belongs to A`,
      bListeningSubmit, judgeDenial(bListeningSubmit, [M.studentA]),
      { authorized: "STUDENT_A", dbEffect: `listening_answers ${beforeLA} → ${afterLA}` });
    if (afterLA !== beforeLA) { matrix.rows.at(-1).verdict = "FAIL"; matrix.rows.at(-1).dbEffect += " — WRITE BY A NON-OWNER"; exitCode = 1; }

    // ANSWER-KEY EXPOSURE. Before the learner submits, no surface may carry the stored answer.
    // Each of these uses the verb the route actually implements.
    //
    // These routes are all backed by `listening_packages`, whose payload holds the authored
    // runtime. That table is EMPTY in this environment (measured below), so every one of them
    // answers 404 not_found for any test id — seeded or synthetic. A 404 exposes no answer key,
    // but it also tests nothing, so these rows are recorded as OWNER_ASSET_REQUIRED with the
    // measurement that proves it rather than as a pass.
    const packageRows = await count("select count(*)::int n from listening_packages");
    for (const [id, method, route, body] of [
      ["L04", "POST", `/api/listening/full/${F.listeningPublished}/practice`, {}],
      ["L05", "POST", `/api/listening/full/${F.listeningPublished}/study`, {}],
      ["L06", "GET", `/api/listening/full/${F.listeningPublished}/sandbox`, null],
      ["L07", "GET", `/api/listening/mcq/${F.listeningPublished}`, null],
      ["L08", "GET", `/api/listening/full/${F.listeningPublished}/authored`, null],
    ]) {
      const res = body === null ? await actors.STUDENT_A.get(route) : await actors.STUDENT_A.post(route, body);
      const exposed = listeningQuestions.filter((q) => q.correct_answer && res.body.includes(q.correct_answer));
      const defect = judgeDenial(res, []).probeDefect;
      plainRow({
        section: S1, id, route: `${method} ${route}`,
        action: "a pre-submission surface must not carry the answer key",
        authorized: "STUDENT_A", unauthorized: "—",
        positiveControl: `${listeningQuestions.length} questions have a stored correct_answer`,
        negativeControl: "none of those answers may appear in the response body",
        actual: defect ? `HTTP ${res.status} — ${defect}`
        : `HTTP ${res.status}${res.json?.error ? " " + res.json.error : ""}; listening_packages=${packageRows} rows; exposed=${exposed.map((e) => e.correct_answer).join(",") || "none"}`,
        dbEffect: "read-only",
        // A surface that does not exist trivially exposes nothing. That is recorded as
        // OWNER_ASSET_REQUIRED, never as a win, so the count of surfaces actually tested stays
        // honest and the missing dependency is named instead of hidden behind a green row.
        verdict: defect ? "PROBE_DEFECT" : exposed.length ? "FAIL"
          : res.status === 200 ? "PASS"
          : packageRows === 0 ? "OWNER_ASSET_REQUIRED" : "PASS_NO_SURFACE",
      });
      if (defect) probeDefects.push(`${S1}/${id} ${method} ${route} — ${defect}`);
      if (!defect && res.status !== 200 && packageRows === 0) {
        ownerAssets.push(`${S1}/${id} ${method} ${route} — listening_packages is empty (0 rows), so the authored surface does not exist; needs the owner's Listening package import`);
      }
    }
  }

  /* ============================== D2 — WRITING / SPEAKING ================= */
  const S2 = "D2";

  // The read path for a submission is the PAGE: /api/writing/submissions/{id} implements PATCH
  // only, so a GET there answers 405 and proves nothing. The page is also the surface a learner
  // actually reaches, which is the one that matters.
  const aOwnPage = await actors.STUDENT_A.get(`/app/writing/submissions/${F.draftA}`);
  const aSeesOwn = aOwnPage.body.includes(M.studentA);
  plainRow({
    section: S2, id: "W01", route: "GET /app/writing/submissions/{id}",
    action: "student A opens their OWN submission page (positive twin for W02/W05/W06)",
    authorized: "STUDENT_A", unauthorized: "—",
    positiveControl: `draft ${F.draftA.slice(0, 8)} carries A's marker and the page really renders it`,
    negativeControl: "—",
    actual: `HTTP ${aOwnPage.status}; own marker rendered=${aSeesOwn}`,
    dbEffect: "read-only",
    verdict: aOwnPage.status === 200 && aSeesOwn ? "PASS" : "FAIL",
  });

  const bReadsPage = await actors.STUDENT_B.get(`/app/writing/submissions/${F.draftA}`);
  const bReadsJ = judgeDenial(bReadsPage, [M.studentA]);
  plainRow({
    section: S2, id: "W02", route: "GET /app/writing/submissions/{id}",
    action: "student B opens student A's submission page",
    authorized: "STUDENT_A", unauthorized: "STUDENT_B",
    positiveControl: "W01 proved the content is really there and really A's",
    negativeControl: "A's marker must not appear in B's rendered HTML",
    actual: `HTTP ${bReadsPage.status}${bReadsJ.redirectedToLogin ? " →/login" : ""}; privacy=${bReadsJ.leaked ? "LEAK" : "OK"}; status=${bReadsJ.statusCorrect ? "correct" : "WRONG (routing residual, not an IDOR)"}`,
    dbEffect: "read-only",
    verdict: bReadsJ.leaked ? "FAIL" : bReadsJ.statusCorrect ? "PASS" : "STATUS_DEFECT",
  });
  if (bReadsJ.leaked) exitCode = 1;

  // Cross-user WRITE: PATCH with a valid body, so validation is not the reason it fails.
  const bPatchesSubmission = await actors.STUDENT_B.request("PATCH", `/api/writing/submissions/${F.subA}`, {
    body: { content: `[${tag}] overwritten by student B` },
  });
  const contentAfter = await one("select content from writing_submissions where id=$1", [F.subA]);
  plainRow({
    section: S2, id: "W03", route: "PATCH /api/writing/submissions/{id}",
    action: "student B overwrites student A's submission body",
    authorized: "STUDENT_A", unauthorized: "STUDENT_B",
    positiveControl: `A's submission holds A's marker`,
    negativeControl: "the stored content must be unchanged and must not gain B's text",
    actual: `HTTP ${bPatchesSubmission.status} ${bPatchesSubmission.json?.error ?? ""}; stored still A's=${String(contentAfter?.content ?? "").includes(M.studentA)}; gained B's text=${String(contentAfter?.content ?? "").includes("overwritten by student B")}`,
    dbEffect: "writing_submissions.content unchanged",
    verdict: bPatchesSubmission.status >= 400 && String(contentAfter?.content ?? "").includes(M.studentA) && !String(contentAfter?.content ?? "").includes("overwritten by student B") ? "PASS" : "FAIL",
  });

  const bSubmitsWriting = await actors.STUDENT_B.post(`/api/writing/submissions/${F.subA}/submit`, {});
  denialRow(S2, "W04", "POST /api/writing/submissions/{id}/submit",
    "student B submits student A's draft", "STUDENT_B",
    "A's submission exists and is submitted-state", bSubmitsWriting, judgeDenial(bSubmitsWriting, [M.studentA]),
    { authorized: "STUDENT_A" });

  const bGrades = await actors.STUDENT_B.post(`/api/writing/grade/${F.subA}`, {});
  denialRow(S2, "W05", "POST /api/writing/grade/{id}",
    "student B triggers grading of student A's submission", "STUDENT_B",
    "A's submission exists", bGrades, judgeDenial(bGrades, [M.studentA]),
    { authorized: "STUDENT_A" });

  const bOwnPage = await actors.STUDENT_B.get(`/app/writing/submissions/${F.draftB}`);
  plainRow({
    section: S2, id: "W06", route: "GET /app/writing/submissions/{id}",
    action: "student B opens their OWN submission page (the boundary is per-owner, not global)",
    authorized: "STUDENT_B", unauthorized: "STUDENT_A",
    positiveControl: `draft ${F.draftB.slice(0, 8)} carries B's marker and the page really renders it`,
    negativeControl: "W07",
    actual: `HTTP ${bOwnPage.status}; own marker rendered=${bOwnPage.body.includes(M.studentB)}`,
    dbEffect: "read-only",
    verdict: bOwnPage.status === 200 && bOwnPage.body.includes(M.studentB) ? "PASS" : "FAIL",
  });

  const aReadsB = await actors.STUDENT_A.get(`/app/writing/submissions/${F.draftB}`);
  const aReadsBJ = judgeDenial(aReadsB, [M.studentB]);
  plainRow({
    section: S2, id: "W07", route: "GET /app/writing/submissions/{id}",
    action: "student A opens student B's submission page (the reverse direction)",
    authorized: "STUDENT_B", unauthorized: "STUDENT_A",
    positiveControl: "W06 proved B's content is really there",
    negativeControl: "B's marker must not appear in A's rendered HTML",
    actual: `HTTP ${aReadsB.status}; privacy=${aReadsBJ.leaked ? "LEAK" : "OK"}; status=${aReadsBJ.statusCorrect ? "correct" : "WRONG"}`,
    dbEffect: "read-only",
    verdict: aReadsBJ.leaked ? "FAIL" : aReadsBJ.statusCorrect ? "PASS" : "STATUS_DEFECT",
  });

  // ---- Typing run-token replay across users, over real HTTP (B1's runtime twin)
  const prep = await actors.STUDENT_A.post("/api/writing/typing/prepare", { preset: 0 });
  const preparedWords = preparedWordsOf(prep);
  const started = prep.json?.token ? await actors.STUDENT_A.post("/api/writing/typing/start", { token: prep.json.token }) : null;
  const runToken = started?.json?.runToken;
  if (runToken) {
    const plan = typingPlan(preparedWords);
    await sleep(plan.waitMs);
    const typed = plan.typed;
    const asB = await actors.STUDENT_B.post("/api/writing/typing/finish", { runToken, typedWords: typed, samples: [2, 4] });
    const bRuns = await count("select count(*)::int n from typing_runs where user_id=$1", [actors.STUDENT_B_ID]);
    plainRow({
      section: S2, id: "T01", route: "POST /api/writing/typing/finish",
      action: "student B replays student A's run token",
      authorized: "STUDENT_A", unauthorized: "STUDENT_B",
      positiveControl: `A prepared and started a real run (HTTP ${prep.status}/${started.status})`,
      negativeControl: "B must be refused and must end up with no typing_runs row",
      actual: `HTTP ${asB.status} ${JSON.stringify(asB.json ?? {}).slice(0, 80)}; B's typing_runs=${bRuns}`,
      dbEffect: `typing_runs for B = ${bRuns}`,
      verdict: asB.status >= 400 && bRuns === 0 ? "PASS" : "FAIL",
    });

    // A's own finish must still work, and a replay of it must return the SAME numbers (B1).
    const aFinish = await actors.STUDENT_A.post("/api/writing/typing/finish", { runToken, typedWords: typed, samples: [2, 4] });
    const aReplay = await actors.STUDENT_A.post("/api/writing/typing/finish", { runToken, typedWords: typed, samples: [2, 4] });
    plainRow({
      section: S2, id: "T02", route: "POST /api/writing/typing/finish",
      action: "the owner's own finish, then an identical replay of it (B1 at runtime)",
      authorized: "STUDENT_A", unauthorized: "—",
      positiveControl: `first finish HTTP ${aFinish.status}`,
      negativeControl: "the replay must return the same runId and the same score",
      actual: `finish HTTP ${aFinish.status} runId=${String(aFinish.json?.run?.runId ?? "").slice(0, 8)} wpm=${aFinish.json?.run?.wpm}; replay HTTP ${aReplay.status} runId=${String(aReplay.json?.run?.runId ?? "").slice(0, 8)} wpm=${aReplay.json?.run?.wpm}`,
      dbEffect: "exactly one typing_runs row for this token",
      verdict: aFinish.status === 200 && aReplay.status === 200 &&
        aFinish.json?.run?.runId === aReplay.json?.run?.runId &&
        aFinish.json?.run?.wpm === aReplay.json?.run?.wpm ? "PASS" : "FAIL",
    });
  } else {
    plainRow({
      section: S2, id: "T01", route: "POST /api/writing/typing/prepare",
      action: "prepare a run token for the cross-user replay test",
      authorized: "STUDENT_A", unauthorized: "—", positiveControl: "—", negativeControl: "—",
      actual: `HTTP ${prep.status} ${prep.body.slice(0, 140)}`, dbEffect: "none", verdict: "ENVIRONMENT_BLOCKED",
    });
  }

  // ---- Speaking
  const bSpeaking = await actors.STUDENT_B.get(`/api/speaking/attempts/${F.attemptIds[0]}`);
  denialRow(S2, "SP01", "GET /api/speaking/attempts/{id}",
    "student B reads student A's speaking attempt and transcript", "STUDENT_B",
    `A has ${F.attemptIds.length} attempts, each transcript carrying A's marker`,
    bSpeaking, judgeDenial(bSpeaking, [M.studentA]), { authorized: "STUDENT_A" });

  const aSpeaking = await actors.STUDENT_A.get(`/api/speaking/attempts/${F.attemptIds[0]}`);
  plainRow({
    section: S2, id: "SP02", route: "GET /api/speaking/attempts/{id}",
    action: "student A reads their OWN speaking attempt (positive twin of SP01)",
    authorized: "STUDENT_A", unauthorized: "STUDENT_B",
    positiveControl: "the attempt row exists",
    negativeControl: "SP01",
    actual: `HTTP ${aSpeaking.status}; own marker present=${aSpeaking.body.includes(M.studentA)}`,
    dbEffect: "read-only",
    verdict: aSpeaking.status === 200 && aSpeaking.body.includes(M.studentA) ? "PASS" : "FAIL",
  });

  const bLists = await actors.STUDENT_B.get("/api/speaking/attempts");
  plainRow({
    section: S2, id: "SP03", route: "GET /api/speaking/attempts",
    action: "student B's attempt list must not contain student A's attempts",
    authorized: "each learner", unauthorized: "each other",
    positiveControl: `A owns ${F.attemptIds.length} attempts`,
    negativeControl: "none of A's attempt ids may appear in B's list",
    actual: `HTTP ${bLists.status}; contains A's ids=${F.attemptIds.some((id) => bLists.body.includes(id))}; leaks A marker=${bLists.body.includes(M.studentA)}`,
    dbEffect: "read-only",
    verdict: !F.attemptIds.some((id) => bLists.body.includes(id)) && !bLists.body.includes(M.studentA) ? "PASS" : "FAIL",
  });

  const recKey = `private/${tag}/speaking/a-attempt-0.webm`;
  const bRecording = await actors.STUDENT_B.get(`/api/resources/${recKey}`);
  denialRow(S2, "SP04", "GET /api/resources/{key}",
    "student B fetches student A's private recording by object key", "STUDENT_B",
    `object key ${recKey} is recorded on A's attempt`, bRecording, judgeDenial(bRecording, [M.studentA]),
    { authorized: "STUDENT_A" });

  const traversal = await actors.STUDENT_B.get(`/api/resources/${tag}/../../../etc/passwd`);
  denialRow(S2, "SP05", "GET /api/resources/{traversal}",
    "a traversal-shaped object key must not escape the storage root", "STUDENT_B",
    "the key is not a real object", traversal, judgeDenial(traversal, ["root:", "/bin/", "daemon:"]));

  /* ============================== D3 — VOCABULARY ========================= */
  const S3 = "D3";
  const aSummary = await actors.STUDENT_A.get("/api/vocabulary/summary");
  const bSummary = await actors.STUDENT_B.get("/api/vocabulary/summary");
  const aVocab = await count("select count(*)::int n from user_vocabulary where user_id=$1", [actors.STUDENT_A_ID]);
  const bVocab = await count("select count(*)::int n from user_vocabulary where user_id=$1", [actors.STUDENT_B_ID]);
  plainRow({
    section: S3, id: "V01", route: "GET /api/vocabulary/summary",
    action: "each learner's summary reflects only their own library",
    authorized: "STUDENT_A / STUDENT_B", unauthorized: "each other",
    positiveControl: `A owns ${aVocab} entries, B owns ${bVocab}`,
    negativeControl: "neither summary may report the other's total",
    actual: `A total=${aSummary.json?.summary?.total} (db ${aVocab}); B total=${bSummary.json?.summary?.total} (db ${bVocab})`,
    dbEffect: "read-only",
    verdict: Number(aSummary.json?.summary?.total) === aVocab && Number(bSummary.json?.summary?.total) === bVocab ? "PASS" : "FAIL",
  });

  // GET /api/vocabulary/folders is PER-USER, so 200 for student B is the CORRECT answer — the
  // boundary is that B's list contains B's folders and none of A's. Judging the status here
  // would have reported a healthy route as a defect.
  const bFolders = await actors.STUDENT_B.get("/api/vocabulary/folders");
  const aFolderNames = [`[${tag}] A folder one`, `[${tag}] A folder two`];
  const leakedFolders = aFolderNames.filter((name) => bFolders.body.includes(name));
  plainRow({
    section: S3, id: "V02", route: "GET /api/vocabulary/folders",
    action: "student B's folder list contains none of student A's folders",
    authorized: "each learner sees their own", unauthorized: "each other",
    positiveControl: `A has 2 tagged folders, B has 1`,
    negativeControl: "neither of A's folder names may appear in B's response",
    actual: `HTTP ${bFolders.status}; leaked=${leakedFolders.length ? leakedFolders.join(", ") : "none"}; B sees own=${bFolders.body.includes(`[${tag}] B folder`)}`,
    dbEffect: "read-only",
    verdict: bFolders.status === 200 && leakedFolders.length === 0 && bFolders.body.includes(`[${tag}] B folder`) ? "PASS" : "FAIL",
  });

  const aDue = await actors.STUDENT_A.get("/api/vocabulary/due");
  const bDue = await actors.STUDENT_B.get("/api/vocabulary/due");
  plainRow({
    section: S3, id: "V03", route: "GET /api/vocabulary/due",
    action: "the SRS queue is per-learner in both directions",
    authorized: "each learner", unauthorized: "each other",
    positiveControl: `A has ${aVocab} entries with srs_stage set, B has ${bVocab}`,
    negativeControl: "neither queue may carry the other's sense key",
    actual: `A HTTP ${aDue.status} leaksB=${bDue.body.includes(M.studentB) ? "?" : aDue.body.includes(M.studentB)}; B HTTP ${bDue.status} leaksA=${bDue.body.includes(M.studentA)}`,
    dbEffect: "read-only",
    verdict: !aDue.body.includes(M.studentB) && !bDue.body.includes(M.studentA) ? "PASS" : "FAIL",
  });

  // Cross-user mutation of SRS state: B tries to review A's vocabulary item.
  const aVocabId = (await one("select id from user_vocabulary where user_id=$1 limit 1", [actors.STUDENT_A_ID]))?.id;
  const beforeStage = await one("select srs_stage, correct_count from user_vocabulary where id=$1", [aVocabId]);
  const bReviews = await actors.STUDENT_B.post(`/api/vocabulary/${aVocabId}/review`, { result: "correct" });
  const afterStage = await one("select srs_stage, correct_count from user_vocabulary where id=$1", [aVocabId]);
  plainRow({
    section: S3, id: "V04", route: "POST /api/vocabulary/{id}/review",
    action: "student B advances student A's SRS state",
    authorized: "STUDENT_A", unauthorized: "STUDENT_B",
    positiveControl: `A's item ${String(aVocabId).slice(0, 8)} is at stage ${beforeStage?.srs_stage}, correct_count ${beforeStage?.correct_count}`,
    negativeControl: "the stored stage and counter must not move",
    actual: `HTTP ${bReviews.status} ${bReviews.json?.error ?? ""}; stage ${beforeStage?.srs_stage} → ${afterStage?.srs_stage}; correct ${beforeStage?.correct_count} → ${afterStage?.correct_count}`,
    dbEffect: `user_vocabulary row unchanged=${beforeStage?.srs_stage === afterStage?.srs_stage && beforeStage?.correct_count === afterStage?.correct_count}`,
    verdict: bReviews.status >= 400 && beforeStage?.srs_stage === afterStage?.srs_stage && beforeStage?.correct_count === afterStage?.correct_count ? "PASS" : "FAIL",
  });

  const beforeEvents = await count("select count(*)::int n from activity_events where user_id=$1 and type like '%VOCAB%'", [actors.STUDENT_B_ID]);
  const forgedGame = await actors.STUDENT_B.post("/api/vocabulary/games", { gameId: randomUUID(), score: 99999, points: 99999, correct: 9999 });
  const afterEvents = await count("select count(*)::int n from activity_events where user_id=$1 and type like '%VOCAB%'", [actors.STUDENT_B_ID]);
  plainRow({
    section: S3, id: "V05", route: "POST /api/vocabulary/games",
    action: "a forged game result carrying an invented score",
    authorized: "server-authoritative scoring only", unauthorized: "STUDENT_B inventing points",
    positiveControl: `B's vocab event count was ${beforeEvents}`,
    negativeControl: "an invented score must not be accepted as-is",
    actual: `HTTP ${forgedGame.status} ${JSON.stringify(forgedGame.json ?? {}).slice(0, 110)}; events ${beforeEvents} → ${afterEvents}`,
    dbEffect: `activity_events ${beforeEvents} → ${afterEvents}`,
    verdict: forgedGame.status >= 400 || Number(forgedGame.json?.points ?? 0) < 99999 ? "PASS" : "FAIL",
  });

  const board = await actors.STUDENT_B.get("/api/vocabulary/leaderboard");
  plainRow({
    section: S3, id: "V06", route: "GET /api/vocabulary/leaderboard",
    action: "the leaderboard discloses scores, not private library content",
    authorized: "any learner", unauthorized: "—",
    positiveControl: `A owns ${aVocab} tagged entries and 2 tagged folders`,
    negativeControl: "no A sense key and no A folder name may appear",
    actual: `HTTP ${board.status}; leaksA=${board.body.includes(M.studentA)}; leaksFolder=${board.body.includes(`[${tag}] A folder`)}`,
    dbEffect: "read-only",
    verdict: !board.body.includes(M.studentA) && !board.body.includes(`[${tag}] A folder`) ? "PASS" : "FAIL",
  });

  /* ====================== D4 — LESSONS / ASSIGNMENTS ====================== */
  const S4 = "D4";
  const beforeAssignments = await count("select count(*)::int n from assignments");
  const studentAssigns = await actors.STUDENT_A.post("/api/assignments", {
    title: `[${tag}] student self-assign`, targetUserId: actors.STUDENT_B_ID, relatedWritingPromptId: F.writingPublished,
  });
  const afterAssignments = await count("select count(*)::int n from assignments");
  plainRow({
    section: S4, id: "A01", route: "POST /api/assignments",
    action: "a student tries to assign work to another student",
    authorized: "TEACHER / ADMIN", unauthorized: "STUDENT_A",
    positiveControl: `the assignments table held ${beforeAssignments} rows`,
    negativeControl: "the request must be refused and must create nothing",
    actual: `HTTP ${studentAssigns.status}; assignments ${beforeAssignments} → ${afterAssignments}`,
    dbEffect: `assignments ${beforeAssignments} → ${afterAssignments}`,
    verdict: studentAssigns.status === 403 && afterAssignments === beforeAssignments ? "PASS" : "FAIL",
  });

  const teacherAssigns = await actors.TEACHER.post("/api/assignments", {
    title: `[${tag}] teacher assignment to A`, description: `[${tag}] desc`,
    instructions: `[${tag}] instructions ${M.teacher}`, targetUserId: actors.STUDENT_A_ID,
    relatedWritingPromptId: F.writingPublished,
  });
  const newAssignmentId = teacherAssigns.json?.assignment?.id;
  const targetRows = newAssignmentId ? await count("select count(*)::int n from assignment_targets where assignment_id=$1", [newAssignmentId]) : 0;
  const eventRows = newAssignmentId
    ? await count("select count(*)::int n from activity_events where type='ASSIGNMENT_CREATED' and payload->>'assignmentId'=$1::text", [newAssignmentId])
    : 0;
  plainRow({
    section: S4, id: "A02", route: "POST /api/assignments",
    action: "a teacher assigns work to a roster student (legacy writing-prompt path)",
    authorized: "TEACHER", unauthorized: "STUDENT_A (A01)",
    positiveControl: "student A is on teacher's roster via teacher_student_links",
    negativeControl: "A01",
    actual: `HTTP ${teacherAssigns.status} id=${String(newAssignmentId).slice(0, 8)}; targets=${targetRows}; events=${eventRows}`,
    // B3's invariant at runtime: assignment + target + event land as one unit or not at all.
    dbEffect: `assignments+1, assignment_targets=${targetRows}, ASSIGNMENT_CREATED events=${eventRows}`,
    verdict: teacherAssigns.status === 200 && newAssignmentId && targetRows === 1 && eventRows === 1 ? "PASS" : "FAIL",
  });

  if (newAssignmentId) {
    const aList = await actors.STUDENT_A.get("/api/assignments");
    const bList = await actors.STUDENT_B.get("/api/assignments");
    const aHas = JSON.stringify(aList.json?.assignments ?? []).includes(newAssignmentId);
    const bHas = JSON.stringify(bList.json?.assignments ?? []).includes(newAssignmentId);
    plainRow({
      section: S4, id: "A03", route: "GET /api/assignments",
      action: "the assignment reaches its target and only its target",
      authorized: "STUDENT_A", unauthorized: "STUDENT_B",
      positiveControl: `A's list contains ${newAssignmentId.slice(0, 8)}: ${aHas}`,
      negativeControl: `B's list must not contain it: ${bHas}`,
      actual: `A HTTP ${aList.status} has=${aHas}; B HTTP ${bList.status} has=${bHas}`,
      dbEffect: "read-only",
      verdict: aHas && !bHas ? "PASS" : "FAIL",
    });

    // The instruction text carries the teacher's marker; a non-target learner must not see it.
    const bReadsAssignment = await actors.STUDENT_B.get(`/api/assignments`);
    plainRow({
      section: S4, id: "A03b", route: "GET /api/assignments",
      action: "student B's list must not carry the instructions written for student A",
      authorized: "STUDENT_A", unauthorized: "STUDENT_B",
      positiveControl: `A's assignment instructions contain ${M.teacher}`,
      negativeControl: "B's response must not contain that marker",
      actual: `HTTP ${bReadsAssignment.status}; leaks teacher marker=${bReadsAssignment.body.includes(M.teacher)}`,
      dbEffect: "read-only",
      verdict: !bReadsAssignment.body.includes(M.teacher) ? "PASS" : "FAIL",
    });

    // POST /api/assignments/{id}/evaluate is the AI EVALUATION trigger. Its real contract:
    // the TARGET STUDENT may evaluate their own work, an administrator may, the creating
    // teacher may, and nobody else may. Asserting "only a teacher" would have reported a
    // correctly behaving route as a breach.
    const bEvaluates = await actors.STUDENT_B.post(`/api/assignments/${newAssignmentId}/evaluate`, { response: `[${tag}] ${"x".repeat(40)}` });
    const t2Evaluates = await actors.TEACHER2.post(`/api/assignments/${newAssignmentId}/evaluate`, { response: `[${tag}] ${"y".repeat(40)}` });
    plainRow({
      section: S4, id: "A04", route: "POST /api/assignments/{id}/evaluate",
      action: "a non-target student and an off-roster teacher may not evaluate this assignment",
      authorized: "STUDENT_A (target), TEACHER (creator), ADMIN", unauthorized: "STUDENT_B, TEACHER2",
      positiveControl: "the assignment exists and targets A (A02/A03)",
      negativeControl: "both non-holders must be refused",
      actual: `studentB=${bEvaluates.status} ${bEvaluates.json?.error ?? ""}; teacher2=${t2Evaluates.status} ${t2Evaluates.json?.error ?? ""}`,
      dbEffect: "no evaluation recorded for a non-holder",
      verdict: bEvaluates.status === 403 && t2Evaluates.status === 403 ? "PASS" : "FAIL",
    });
  }

  const lessonId = F.lessonIds[0];
  const aNote = await actors.STUDENT_A.post(`/api/lessons/${lessonId}/notes`, { body: `[${tag}] A's private note ${M.studentA}` });
  const bNotes = await actors.STUDENT_B.get(`/api/lessons/${lessonId}/notes`);
  const aNotes = await actors.STUDENT_A.get(`/api/lessons/${lessonId}/notes`);
  plainRow({
    section: S4, id: "A05", route: "GET /api/lessons/{id}/notes",
    action: "learner notes are private to their author",
    authorized: "STUDENT_A", unauthorized: "STUDENT_B",
    positiveControl: `A wrote a note (HTTP ${aNote.status}) and can read it back (marker present=${aNotes.body.includes(M.studentA)})`,
    negativeControl: "B's read must not contain A's marker",
    actual: `write HTTP ${aNote.status}; A read marker=${aNotes.body.includes(M.studentA)}; B read HTTP ${bNotes.status} leaks=${bNotes.body.includes(M.studentA)}`,
    dbEffect: "one lesson_notes row owned by A",
    verdict: aNotes.body.includes(M.studentA) && !bNotes.body.includes(M.studentA) ? "PASS" : "FAIL",
  });

  // Staff-only surfaces that actually implement GET.
  for (const [id, route] of [["A06", "/api/admin/content/bank"], ["A07", "/api/admin/content/items"], ["A08", "/api/admin/content/previews"], ["A09", "/api/admin/retention/texts"], ["A10", "/api/admin/video-lessons"]]) {
    const res = await actors.STUDENT_A.get(route);
    const staff = await actors.ADMIN.get(route);
    denialRow(S4, id, `GET ${route}`, "a learner reaches a staff-only authoring surface", "STUDENT_A",
      `ADMIN reaches it: HTTP ${staff.status}`, res, judgeDenial(res, [M.teacher, M.owner]), { authorized: `ADMIN (HTTP ${staff.status})` });
  }

  /* ========================= D5 — OWNER / ADMIN / STORAGE ================= */
  const S5 = "D5";
  for (const [id, method, route] of [
    ["O01", "GET", "/api/owner/ai-control"],
    ["O02", "GET", "/api/owner/student-export"],
    ["O03", "POST", "/api/owner/retention"],
    ["O04", "POST", "/api/admin/uploads/cleanup"],
    ["O05", "POST", `/api/admin/users/${actors.STUDENT_A_ID}/status`],
    ["O06", "POST", "/api/admin/roster"],
  ]) {
    const call = (actor) => method === "GET" ? actor.get(route) : actor.post(route, {});
    const asStudent = await call(actors.STUDENT_A);
    const asTeacher = await call(actors.TEACHER);
    const asAdmin = await call(actors.ADMIN);
    const asOwner = await call(actors.OWNER);
    const j = judgeDenial(asStudent, [M.studentA, M.studentB, M.teacher, M.owner]);
    const reachableByPrivileged = asOwner.status < 400 || asAdmin.status < 400;
    if (j.probeDefect) {
      denialRow(S5, id, `${method} ${route}`, "an owner/admin-only surface refuses a learner", "STUDENT_A",
        `OWNER HTTP ${asOwner.status} / ADMIN HTTP ${asAdmin.status}`, asStudent, j, { authorized: `OWNER (HTTP ${asOwner.status})` });
      continue;
    }
    plainRow({
      section: S5, id, route: `${method} ${route}`,
      action: "an owner/admin-only surface refuses a learner and a teacher",
      authorized: `OWNER HTTP ${asOwner.status} / ADMIN HTTP ${asAdmin.status}`,
      unauthorized: "STUDENT_A, TEACHER",
      positiveControl: reachableByPrivileged ? "OWNER or ADMIN reaches it — see authorized column" : `neither privilege level reaches it with an empty body (owner ${asOwner.status}, admin ${asAdmin.status})`,
      negativeControl: `learner HTTP ${asStudent.status}, marker absent=${!j.leaked}`,
      actual: `student=${asStudent.status} teacher=${asTeacher.status} admin=${asAdmin.status} owner=${asOwner.status}; privacy=${j.leaked ? "LEAK" : "OK"}; status=${j.statusCorrect ? "correct" : "WRONG"}`,
      dbEffect: "no privileged mutation from the learner",
      verdict: j.leaked ? "FAIL" : (asStudent.status >= 400 || j.redirectedToLogin) && (asTeacher.status >= 400 || j.redirectedToLogin) ? "PASS" : "STATUS_DEFECT",
    });
  }

  const demote = await actors.ADMIN.request("PATCH", `/api/admin/users/${actors.OWNER_ID}/role`, { body: { role: "student" } });
  const ownerRole = await one("select role from users where id=$1", [actors.OWNER_ID]);
  plainRow({
    section: S5, id: "O07", route: "PATCH /api/admin/users/{ownerId}/role",
    action: "an administrator tries to demote the owner",
    authorized: "no role below OWNER", unauthorized: "ADMIN",
    positiveControl: "the owner account exists and is active",
    negativeControl: "the stored role must still be owner",
    actual: `HTTP ${demote.status} ${JSON.stringify(demote.json ?? {}).slice(0, 90)}; users.role=${ownerRole?.role}`,
    dbEffect: `users.role=${ownerRole?.role} (must be owner)`,
    verdict: demote.status >= 400 && ownerRole?.role === "owner" ? "PASS" : "FAIL",
  });

  const selfPromote = await actors.STUDENT_A.request("PATCH", `/api/admin/users/${actors.STUDENT_A_ID}/role`, { body: { role: "owner" } });
  const studentRole = await one("select role from users where id=$1", [actors.STUDENT_A_ID]);
  plainRow({
    section: S5, id: "O08", route: "PATCH /api/admin/users/{selfId}/role",
    action: "a student tries to promote themselves to owner",
    authorized: "OWNER only", unauthorized: "STUDENT_A",
    positiveControl: "the student account exists and is active",
    negativeControl: "the stored role must still be student",
    actual: `HTTP ${selfPromote.status}; users.role=${studentRole?.role}`,
    dbEffect: `users.role=${studentRole?.role} (must be student)`,
    verdict: selfPromote.status >= 400 && studentRole?.role === "student" ? "PASS" : "FAIL",
  });

  const pendingProbe = await actors.PENDING.get("/api/vocabulary/summary");
  denialRow(S5, "O09", "GET /api/vocabulary/summary",
    "a PENDING account holding a valid cookie reaches a private API", "PENDING",
    "the same cookie authenticated (login returned 200)", pendingProbe,
    judgeDenial(pendingProbe, [M.studentA, M.studentB]), { authorized: "ACTIVE accounts only" });

  const secretNeedles = [process.env.AUTH_SECRET, "postgres://", "BEGIN PRIVATE KEY", "password_hash", "passwordHash"].filter(Boolean);
  const secretHits = [];
  for (const res of secretScanResponses) {
    for (const needle of secretNeedles) {
      if (needle.length >= 8 && res.body.includes(needle)) secretHits.push(`${res.route} contains ${needle.slice(0, 12)}…`);
    }
  }
  plainRow({
    section: S5, id: "O10", route: "(every response captured by this run)",
    action: "no response body leaks a credential or a connection string",
    authorized: "—", unauthorized: "—",
    positiveControl: `${secretScanResponses.length} real responses scanned`,
    negativeControl: `${secretNeedles.length} needles, none may appear`,
    actual: secretHits.length ? secretHits.join("; ") : "no secret material in any response",
    dbEffect: "read-only",
    verdict: secretHits.length === 0 ? "PASS" : "FAIL",
  });

  /* ============================== D6 — CONCURRENCY ======================== */
  const S6 = "D6";
  const raceBody = { title: `[${tag}] race assignment`, description: `[${tag}] race`, targetUserId: actors.STUDENT_A_ID, relatedWritingPromptId: F.writingPublished };
  const beforeRace = await count("select count(*)::int n from assignments where title like $1", [`%[${tag}] race%`]);
  const [r1, r2, r3] = await Promise.all([
    actors.TEACHER.post("/api/assignments", raceBody),
    actors.TEACHER.post("/api/assignments", raceBody),
    actors.TEACHER.post("/api/assignments", raceBody),
  ]);
  const raceIds = [r1, r2, r3].map((r) => r.json?.assignment?.id).filter(Boolean);
  const afterRace = await count("select count(*)::int n from assignments where title like $1", [`%[${tag}] race%`]);
  plainRow({
    section: S6, id: "C01", route: "POST /api/assignments ×3 concurrently",
    action: "three identical assignment requests in flight at once",
    authorized: "TEACHER", unauthorized: "—",
    positiveControl: `all three answered (${r1.status}/${r2.status}/${r3.status})`,
    negativeControl: "no request may 5xx",
    // HONEST RECORDING: assignments carry no client idempotency key, so three concurrent
    // identical POSTs creating three rows is the DESIGNED behaviour, not a defect. What must
    // never happen is a row without its target or without its event — that is C02.
    actual: `statuses ${r1.status}/${r2.status}/${r3.status}; rows ${beforeRace} → ${afterRace}`,
    dbEffect: `assignments +${afterRace - beforeRace}`,
    verdict: [r1, r2, r3].every((r) => r.status < 500) ? "PASS" : "FAIL",
  });

  const raceTargets = raceIds.length ? await count("select count(*)::int n from assignment_targets where assignment_id = any($1::uuid[])", [raceIds]) : 0;
  const raceEvents = raceIds.length
    ? await count("select count(*)::int n from activity_events where type='ASSIGNMENT_CREATED' and (payload->>'assignmentId')::text = any($1::text[])", [raceIds])
    : 0;
  plainRow({
    section: S6, id: "C02", route: "POST /api/assignments ×3 concurrently",
    action: "every concurrently created assignment still has exactly one target and one event",
    authorized: "TEACHER", unauthorized: "—",
    positiveControl: `${raceIds.length} assignment rows created`,
    negativeControl: "a row without a target reaches nobody; a row without an event never appears in the feed",
    actual: `assignments=${raceIds.length} targets=${raceTargets} events=${raceEvents}`,
    dbEffect: "1:1:1 across assignment / target / event",
    verdict: raceIds.length > 0 && raceTargets === raceIds.length && raceEvents === raceIds.length ? "PASS" : "FAIL",
  });

  const prep2 = await actors.STUDENT_A.post("/api/writing/typing/prepare", { preset: 0 });
  const started2 = prep2.json?.token ? await actors.STUDENT_A.post("/api/writing/typing/start", { token: prep2.json.token }) : null;
  const runToken2 = started2?.json?.runToken;
  if (runToken2) {
    const plan2 = typingPlan(preparedWordsOf(prep2));
    await sleep(plan2.waitMs);
    const typed2 = plan2.typed;
    const before = await count("select count(*)::int n from typing_runs where user_id=$1", [actors.STUDENT_A_ID]);
    const [f1, f2] = await Promise.all([
      actors.STUDENT_A.post("/api/writing/typing/finish", { runToken: runToken2, typedWords: typed2, samples: [2, 4] }),
      actors.STUDENT_A.post("/api/writing/typing/finish", { runToken: runToken2, typedWords: typed2, samples: [2, 4] }),
    ]);
    const after = await count("select count(*)::int n from typing_runs where user_id=$1", [actors.STUDENT_A_ID]);
    plainRow({
      section: S6, id: "C03", route: "POST /api/writing/typing/finish ×2 concurrently",
      action: "one run token finished twice at the same instant",
      authorized: "STUDENT_A", unauthorized: "—",
      positiveControl: "a real prepared + started run token",
      negativeControl: "exactly one typing_runs row may exist afterwards, and both callers must agree",
      actual: `HTTP ${f1.status}/${f2.status}; runIds ${String(f1.json?.run?.runId ?? "").slice(0, 8)}/${String(f2.json?.run?.runId ?? "").slice(0, 8)}; typing_runs ${before} → ${after}`,
      dbEffect: `typing_runs +${after - before} (must be exactly 1)`,
      verdict: after - before === 1 && f1.json?.run?.runId === f2.json?.run?.runId ? "PASS" : "FAIL",
    });
  }

  const raceReading = await actors.STUDENT_B.post("/api/reading/attempts", { passageId: F.passageGeneral });
  if (raceReading.json?.id) {
    const rid = raceReading.json.id;
    const rq = (await db.query("select id, correct_answer from reading_questions where passage_id=$1", [F.passageGeneral])).rows;
    const ra = rq.map((row) => ({ questionId: row.id, answer: row.correct_answer }));
    const [s1, s2] = await Promise.all([
      actors.STUDENT_B.post(`/api/reading/attempts/${rid}/submit`, { answers: ra }),
      actors.STUDENT_B.post(`/api/reading/attempts/${rid}/submit`, { answers: ra }),
    ]);
    const ansRows = await count("select count(*)::int n from reading_answers where attempt_id=$1", [rid]);
    const successes = [s1, s2].filter((r) => r.status === 200).length;
    plainRow({
      section: S6, id: "C04", route: "POST /api/reading/attempts/{id}/submit ×2 concurrently",
      action: "the same reading attempt submitted twice at once",
      authorized: "STUDENT_B", unauthorized: "—",
      positiveControl: `${rq.length} questions, attempt ${rid.slice(0, 8)} created`,
      negativeControl: "answers must not be doubled and at most one submit may answer 200",
      actual: `HTTP ${s1.status}/${s2.status}; reading_answers=${ansRows} (expected ${rq.length}); successes=${successes}`,
      dbEffect: `reading_answers=${ansRows}`,
      verdict: ansRows === rq.length && successes <= 1 ? "PASS" : "FAIL",
    });
  }

  const lRace = await actors.STUDENT_B.post("/api/listening/attempts", { testId: F.listeningPublished });
  if (lRace.json?.id) {
    const lid = lRace.json.id;
    const payload = { answers: listeningQuestions.map((row) => ({ questionId: row.id, answer: row.correct_answer })) };
    const [l1, l2] = await Promise.all([
      actors.STUDENT_B.post(`/api/listening/attempts/${lid}/submit`, payload),
      actors.STUDENT_B.post(`/api/listening/attempts/${lid}/submit`, payload),
    ]);
    const laRows = await count("select count(*)::int n from listening_answers where attempt_id=$1", [lid]);
    plainRow({
      section: S6, id: "C05", route: "POST /api/listening/attempts/{id}/submit ×2 concurrently",
      action: "the same listening attempt submitted twice at once",
      authorized: "STUDENT_B", unauthorized: "—",
      positiveControl: `attempt ${lid.slice(0, 8)} for a published test with ${listeningQuestions.length} questions`,
      negativeControl: "answers must not be doubled",
      actual: `HTTP ${l1.status}/${l2.status}; listening_answers=${laRows} (expected ≤${listeningQuestions.length})`,
      dbEffect: `listening_answers=${laRows}`,
      verdict: laRows <= listeningQuestions.length ? "PASS" : "FAIL",
    });
  }

  // `/api/vocabulary/{id}/use` takes the USER_VOCABULARY id, scopes by the caller, and requires
  // a `{sentence}` body. Passing a lexeme id with an empty body answers 404/400 eight times over
  // — which the first draft of this matrix recorded as a PASS because "no 5xx and the counter did
  // not go backwards" is trivially true of eight rejections. The assertion below therefore
  // requires the accepted calls to have produced their rows.
  //
  // The invariant chosen is deliberately provider-independent: the route stores the sentence in
  // `vocabulary_usages` FIRST and only then calls the evaluator, so a missing AI provider must
  // not lose the learner's work. Eight concurrent calls must produce exactly one stored usage
  // each, with no lost write and no duplicate.
  const aVocabRow = await one(
    "select id, lexeme_id from user_vocabulary where user_id=$1 order by created_at limit 1",
    [actors.STUDENT_A_ID],
  );
  const aLexeme = await one("select term from lexemes where id=$1", [aVocabRow.lexeme_id]);
  const beforeUses = await count("select count(*)::int n from vocabulary_usages where user_vocabulary_id=$1", [aVocabRow.id]);
  const sentence = `[${tag}] The ${aLexeme?.term ?? "word"} helped the city reopen its central library.`;
  const uses = await Promise.all(Array.from({ length: 8 }, () => actors.STUDENT_A.post(`/api/vocabulary/${aVocabRow.id}/use`, { sentence })));
  const afterUses = await count("select count(*)::int n from vocabulary_usages where user_vocabulary_id=$1", [aVocabRow.id]);
  const useOk = uses.filter((u) => u.status === 200).length;
  plainRow({
    section: S6, id: "C06", route: "POST /api/vocabulary/{userVocabularyId}/use ×8 concurrently",
    action: "eight concurrent sentence uses of the same vocabulary item",
    authorized: "STUDENT_A", unauthorized: "—",
    positiveControl: `${useOk} of 8 accepted (HTTP ${uses.map((u) => u.status).join(",")})`,
    negativeControl: "no 5xx, and every accepted call must have stored exactly one usage row",
    actual: `vocabulary_usages ${beforeUses} → ${afterUses} (+${afterUses - beforeUses}) for ${useOk} accepted`,
    dbEffect: `vocabulary_usages +${afterUses - beforeUses}`,
    verdict: uses.every((u) => u.status < 500) && useOk > 0 && afterUses - beforeUses === useOk ? "PASS" : "FAIL",
  });

  // The same route from a non-owner: user_vocabulary ids are the reachable handle for another
  // learner's library item, so this is the IDOR shape that matters for Vocabulary.
  const beforeCross = await count("select count(*)::int n from vocabulary_usages where user_vocabulary_id=$1", [aVocabRow.id]);
  const bUses = await actors.STUDENT_B.post(`/api/vocabulary/${aVocabRow.id}/use`, { sentence: `[${tag}] written by student B` });
  const afterCross = await count("select count(*)::int n from vocabulary_usages where user_vocabulary_id=$1", [aVocabRow.id]);
  plainRow({
    section: S6, id: "C06b", route: "POST /api/vocabulary/{id}/use",
    action: "student B records a use against student A's library item",
    authorized: "STUDENT_A", unauthorized: "STUDENT_B",
    positiveControl: `C06 proved A can use this very item (${useOk} accepted, ${afterUses - beforeUses} usage rows stored)`,
    negativeControl: "B must be refused and must not add a usage row to A's item",
    actual: `HTTP ${bUses.status} ${bUses.json?.error ?? ""}; A's vocabulary_usages ${beforeCross} → ${afterCross}`,
    dbEffect: `usage rows unchanged=${beforeCross === afterCross}`,
    verdict: bUses.status === 404 && beforeCross === afterCross ? "PASS" : "FAIL",
  });

  const lp = await Promise.all(Array.from({ length: 6 }, (_, i) => actors.STUDENT_A.post("/api/live-partner", { action: "heartbeat", seq: i })));
  plainRow({
    section: S6, id: "C07", route: "POST /api/live-partner ×6 concurrently",
    action: "six concurrent Live Partner actions from one learner",
    authorized: "STUDENT_A", unauthorized: "—",
    positiveControl: "the Live Partner room is reachable (Package E proves the read path)",
    negativeControl: "no 5xx; a 429 is the limiter working correctly, not a failure",
    actual: `statuses ${lp.map((r) => r.status).join(",")}`,
    dbEffect: "session state only",
    verdict: lp.every((r) => r.status < 500) ? "PASS" : "FAIL",
  });

  // Field names come from the real intent contract (scripts/verify-uploads.mjs already exercises
  // this pipeline end to end). The first draft sent mimeType/sizeBytes and was answered 400
  // invalid_input — a probe defect that looked like a blocked environment.
  const intent = await actors.TEACHER.post("/api/uploads/intent", {
    purpose: "material_primary", filename: `${tag}-race.wav`, contentType: "audio/wav", size: 44,
  });
  const uploadId = intent.json?.uploadId;
  if (uploadId) {
    // Real bytes first. Finalizing an intent that was never given a file answers 409 for both
    // callers, which is correct but tests nothing: there was no object to race for.
    const form = new FormData();
    form.append("uploadId", uploadId);
    form.append("file", new Blob([Buffer.from("RIFF....WAVEfmt " + "x".repeat(28))], { type: "audio/wav" }), `${tag}-race.wav`);
    const put = await actors.TEACHER.request("POST", "/api/uploads", { form });
    const [u1, u2] = await Promise.all([
      actors.TEACHER.post("/api/uploads/finalize", { uploadId }),
      actors.TEACHER.post("/api/uploads/finalize", { uploadId }),
    ]);
    const successes = [u1, u2].filter((r) => r.status === 200).length;
    const objectKeys = [u1.json?.objectKey, u2.json?.objectKey].filter(Boolean);
    uploadedObjectKeys.push(...objectKeys);
    plainRow({
      section: S6, id: "C08", route: "POST /api/uploads/finalize ×2 concurrently",
      action: "the same uploaded object finalized twice at once",
      authorized: "TEACHER", unauthorized: "—",
      positiveControl: `intent ${String(uploadId).slice(0, 8)} created (HTTP ${intent.status}) and ${put.status === 200 ? "bytes uploaded" : `upload answered ${put.status}`}`,
      negativeControl: "no 5xx, and the two callers must not both mint a different usable object",
      actual: `upload HTTP ${put.status}; finalize HTTP ${u1.status}/${u2.status}; successes=${successes}; keys=${objectKeys.length ? [...new Set(objectKeys)].length + " distinct" : "none"}`,
      dbEffect: `upload_intents row ${String(uploadId).slice(0, 8)}`,
      verdict: put.status === 200 && u1.status < 500 && u2.status < 500 && new Set(objectKeys).size <= 1 ? "PASS" : "FAIL",
    });
  } else {
    plainRow({
      section: S6, id: "C08", route: "POST /api/uploads/intent",
      action: "upload finalization race", authorized: "TEACHER", unauthorized: "—",
      positiveControl: "—", negativeControl: "—",
      actual: `no upload id returned (HTTP ${intent.status} ${intent.body.slice(0, 160)})`,
      dbEffect: "none", verdict: "ENVIRONMENT_BLOCKED",
    });
  }
} catch (error) {
  console.error("\nMATRIX ABORTED:", error?.message ?? error);
  if (error?.stack) console.error(error.stack.split("\n").slice(0, 6).join("\n"));
  exitCode = 1;
} finally {
  // The sweeper runs FIRST: rows this probe created over HTTP (attempts, answers, evaluations)
  // are children of the dataset's rows, and the foreign keys are RESTRICT, so destroying the
  // dataset before them throws and leaves both behind.
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
      console.log("  dataset destroyed:", JSON.stringify(res.deleted));
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
  // The row sweeper only reaches the database. C08 uploads real bytes, so the object it leaves
  // behind on local storage has to be removed too — otherwise a "no residue" claim is only true
  // of one of the two places this probe writes.
  try {
    const dir = process.env.STORAGE_LOCAL_DIR;
    if (dir && uploadedObjectKeys.length) {
      const { rmSync } = await import("node:fs");
      for (const key of uploadedObjectKeys) {
        rmSync(`${dir}/${key}`, { force: true });
        console.log(`  removed uploaded object ${key}`);
      }
    }
  } catch (error) {
    console.error("  storage cleanup failed:", error.message);
    exitCode = 1;
  }
  await db.end().catch(() => {});
  await finalSweep("end of run");

  const report = matrix.report();
  writeGeneratedDoc("docs/SECURITY-MATRIX.md", [
    "# Six-actor security and concurrency matrix (Package D)",
    "",
    `Run against \`${BASE}\` and a real PostgreSQL. Actors: ANONYMOUS, STUDENT_A, STUDENT_B,`,
    "TEACHER, TEACHER2, ADMIN, OWNER, PENDING — each verified by decoding its own signed session",
    "cookie and comparing the `sub` claim with the database row for that email.",
    "",
    report,
    statusDefects.length
      ? `## Status-code defects, recorded separately from privacy\n\nEvery row below proved that NO protected content leaked — the secret marker never appeared in the\nresponse body. They answered a status that does not say "denied". These are routing/status\ncorrectness findings and are deliberately **not** classified as IDOR.\n\n${statusDefects.map((s) => `- ${s}`).join("\n")}\n`
      : "## Status-code defects\n\nNone: every denial answered a status that says denied, and no protected marker appeared in any denied response.\n",
    probeDefects.length
      ? `## Probe defects (rows that proved NOTHING)\n\nThese requests never reached an authorisation check — a wrong verb, or a body refused by schema\nvalidation before ownership was tested. They are reported as failures, not passes, because a\nmatrix with silently untested rows is worse than a smaller honest one.\n\n${probeDefects.map((s) => `- ${s}`).join("\n")}\n`
      : "## Probe defects\n\nNone: every row reached the boundary it claims to test.\n",
    ownerAssets.length
      ? `## Owner-asset blockers\n\nThese rows could not be tested because a dependency the OWNER supplies is absent from the\nenvironment. Each is measured, not assumed.\n\n${ownerAssets.map((s) => `- ${s}`).join("\n")}\n`
      : "## Owner-asset blockers\n\nNone.\n",
  ].join("\n"));
  console.log(`\n${report}`);
  console.log(`PASS ${matrix.pass} / FAIL ${matrix.fail} / rows ${matrix.rows.length}`);
  if (statusDefects.length) console.log(`STATUS DEFECTS (privacy held): ${statusDefects.length}`);
  if (probeDefects.length) console.log(`PROBE DEFECTS (proved nothing): ${probeDefects.length}`);
  if (ownerAssets.length) console.log(`OWNER-ASSET BLOCKED rows: ${ownerAssets.length}`);
}

process.exit(exitCode || process.exitCode === 1 ? 1 : 0);
