#!/usr/bin/env node
/*
 * B3 — ASSIGNMENT CREATION: TRANSACTION, AUTHORIZATION AND CONCURRENCY CONTRACT.
 *
 * THE QUESTION THIS PROBE EXISTS TO ANSWER
 * ---------------------------------------
 * POST /api/assignments has TWO creation paths:
 *
 *   A. canonical   — module + contentType + sourceRef (+ contentVersionId), handled by
 *                    createAssignment() in src/lib/content/assignments.ts;
 *   B. legacy      — relatedWritingPromptId, handled inline in the route.
 *
 * Reading the route answers the transactional half: both wrap assignment + assignment_targets +
 * ASSIGNMENT_CREATED in ONE db.transaction, so neither can commit an assignment without its target
 * or its event. That part is equivalent, and it is asserted here rather than assumed.
 *
 * The AUTHORIZATION half is not equivalent, and that is the defect this probe reproduces. The
 * canonical path calls mayAssignTo() per student — the single authority rule for "may this actor set
 * work for this learner" (roster link, must be a student, must be staff) — and resolves the reference
 * against the version store, refusing content that is not published or not live. The legacy path does
 * neither: it checks only isStaff(role) and that relatedWritingPromptId is shaped like a UUID.
 *
 * So the same teacher, the same student and the same title are accepted or refused depending only on
 * which reference field the request happens to use. Every case below is therefore run through BOTH
 * paths with a payload that differs in nothing but the reference, which is what makes a difference in
 * outcome attributable to the path instead of to the actor or the fixture.
 *
 * THE CONTRACT THIS PROBE MUST NOT INVENT
 * ---------------------------------------
 * The route states that assigned work is NOT idempotent under a client-generated key. Two intentional
 * creation requests legitimately produce two assignments, and that is not a defect. What IS a defect
 * is a failed transaction leaving partial rows, or a response claiming success for a write that did
 * not land. So the concurrency assertion here is "a failure leaves nothing behind and a retry creates
 * exactly one", never "two requests produce one row".
 *
 * Genuine concurrent creation (peak in flight measured, 1:1:1 row parity, the unique
 * (assignment_id, student_user_id) pair arbitrating a real race, cross-student isolation) is already
 * covered by tests/assignment-concurrency-qa2.test.ts B3-05/B3-07 and is deliberately not duplicated.
 */
const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required — refusing to guess a database.");
  process.exit(2);
}

const { assertMutableDatabase, createRowSweeper, createRowBorrower, installSweepHandlers } =
  await import("./lib/fixture-safety.mjs");
assertMutableDatabase(DATABASE_URL, { probe: "verify-assignment-b3" });
const { loginActor, createActor } = await import("./lib/security-matrix.mjs");
const pg = (await import("pg")).default;

const SWEEP_TABLES = ["assignment_targets", "assignments", "activity_events", "content_versions", "writing_prompts"];
const PASSWORD = { teacher: "Teacher12345!", student: "Student12345!", admin: "Admin12345!", owner: "Owner12345!" };
const EMAIL = {
  TEACHER_A: `teacher@learnersarea.uz`, TEACHER_B: `teacher2@learnersarea.uz`,
  STUDENT_A: `demo.student@learnersarea.uz`, STUDENT_B: `new.student@learnersarea.uz`,
  ADMIN: `admin@learnersarea.uz`, OWNER: `owner@learnersarea.uz`,
};

const failures = [];
let pass = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
const step = (label) => console.log(`\n── ${label}`);
const brief = (res) => `${res.status}${res.json?.error ? ` ${res.json.error}` : res.json?.issues?.length ? ` ${res.json.issues.map((i) => i.code).join("+")}` : ""}`;

const admin = new pg.Client({ connectionString: DATABASE_URL });
await admin.connect();
const q = async (sql, params) => (await admin.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

const sweeper = createRowSweeper({ client: admin, tables: SWEEP_TABLES, probe: "assignment-b3" });
installSweepHandlers(sweeper, { probe: "assignment-b3" });
await sweeper.capture();

const RUN = `b3-${Date.now()}`;
let borrower = null;

/* Row counts attributable to this probe, so a denial can be checked against real database effects
 * rather than against the response alone. Titles are unique per case. */
const written = async (title) => one(
  `select (select count(*)::int from assignments where title = $1) as assignments,
          (select count(*)::int from assignment_targets t join assignments a on a.id = t.assignment_id where a.title = $1) as targets,
          (select count(*)::int from activity_events e join assignments a on a.id::text = (e.payload->>'assignmentId') where a.title = $1) as events`,
  [title],
);

try {
  /* ---------------------------------------------------------- 0. real fixtures, discovered */
  step("0 · fixtures discovered from PostgreSQL, never invented");
  const teacherA = await one("select id from users where email=$1", [EMAIL.TEACHER_A]);
  const teacherB = await one("select id from users where email=$1", [EMAIL.TEACHER_B]);
  const studentA = await one("select id, role from users where email=$1", [EMAIL.STUDENT_A]);
  const studentB = await one("select id from users where email=$1", [EMAIL.STUDENT_B]);
  const links = await q("select teacher_user_id, student_user_id from teacher_student_links");
  const onRoster = (t, s) => links.some((l) => l.teacher_user_id === t && l.student_user_id === s);
  check("TEACHER_A has STUDENT_A on their roster (the positive control is real)",
    onRoster(teacherA.id, studentA.id), `${links.length} link(s)`);
  check("TEACHER_B does NOT (so a refusal is attributable to the roster rule)",
    !onRoster(teacherB.id, studentA.id));

  const livePrompt = await one("select id, publication_state from writing_prompts where publication_state='published' limit 1");
  check("a published writing prompt exists for the legacy path", Boolean(livePrompt),
    livePrompt ? `${livePrompt.id.slice(0, 8)} state=${livePrompt.publication_state}` : "none — the legacy path cannot be exercised");
  /*
   * A prompt that is NOT live, for B3-V06. The seed ships none, and §4 forbids inventing IELTS
   * content, so one is BORROWED: every column snapshotted, flipped to draft only for the duration of
   * the check that needs it, then restored and verified column-by-column.
   *
   * This used to happen up front, in setup, and restore only in `finally`. That was wrong twice over:
   * it made every later positive control fail — correctly, because the fix refuses a draft prompt —
   * and it left the database in a state no single check described. A borrowed row is returned as soon
   * as the check that borrowed it is finished.
   */
  const naturalDraft = await one("select id from writing_prompts where publication_state <> 'published' limit 1");

  /* ------------------------------------------------- 1. actors, each in its own session */
  step("1 · seven actors, each authenticated in a separate context");
  const actors = {};
  for (const [name, [email, pw]] of Object.entries({
    TEACHER_A: [EMAIL.TEACHER_A, PASSWORD.teacher], TEACHER_B: [EMAIL.TEACHER_B, PASSWORD.teacher],
    STUDENT_A: [EMAIL.STUDENT_A, PASSWORD.student], STUDENT_B: [EMAIL.STUDENT_B, PASSWORD.student],
    ADMIN: [EMAIL.ADMIN, PASSWORD.admin], OWNER: [EMAIL.OWNER, PASSWORD.owner],
  })) {
    // loginActor returns {actor, identity} and has already thrown unless the session cookie's `sub`
    // claim equals the database id for that email and the roles match, so the actor really is who the
    // probe thinks it is rather than whoever happened to answer.
    const logged = await loginActor(name, BASE, email, pw, { client: admin });
    actors[name] = logged.actor;
    check(`${name} authenticated and the session really is that user`,
      logged.identity?.sub !== null, `sub=${logged.identity?.sub?.slice(0, 8) ?? "none"} role=${logged.identity?.role ?? "?"}`);
  }
  // Built with an empty cookie on purpose: createActor closes over the cookie it is given, so
  // passing a logged-in actor and stripping the header later would silently measure that actor.
  actors.ANONYMOUS = createActor("ANONYMOUS", "", BASE);

  /* ------------------------------- 2. POSITIVE CONTROLS: both paths work for the authorized teacher */
  step("2 · positive controls — a valid request through each path, verified in PostgreSQL");
  const legacyTitle = `${RUN}-legacy-ok`;
  const legacyOk = await actors.TEACHER_A.post("/api/assignments", {
    title: legacyTitle, description: null, targetUserId: studentA.id, relatedWritingPromptId: livePrompt.id,
  });
  const legacyRows = await written(legacyTitle);
  check("B3-L01 legacy path: the authorized teacher's request is accepted", legacyOk.status === 200 && legacyOk.json?.ok === true,
    brief(legacyOk));
  check("B3-L02 legacy path: assignment + target + event were written 1:1:1 in one transaction",
    legacyRows.assignments === 1 && legacyRows.targets === 1 && legacyRows.events === 1,
    `assignments=${legacyRows.assignments} targets=${legacyRows.targets} events=${legacyRows.events}`);
  const legacyRow = await one(
    `select a.id, a.title, a.created_by_user_id, a.target_user_id, a.related_writing_prompt_id, a.module, a.content_type, a.source_ref, a.content_version_id,
            t.student_user_id, t.status
       from assignments a join assignment_targets t on t.assignment_id = a.id where a.title = $1`, [legacyTitle]);
  check("B3-L03 legacy path: teacher identity, target identity and the prompt reference are all persisted",
    legacyRow?.created_by_user_id === teacherA.id && legacyRow?.target_user_id === studentA.id
    && legacyRow?.student_user_id === studentA.id && legacyRow?.related_writing_prompt_id === livePrompt.id,
    `created_by=${legacyRow?.created_by_user_id?.slice(0, 8)} target=${legacyRow?.target_user_id?.slice(0, 8)} targets.student=${legacyRow?.student_user_id?.slice(0, 8)} prompt=${legacyRow?.related_writing_prompt_id?.slice(0, 8)}`);
  check("B3-L04 legacy path: canonical reference fields are NULL, which is the shape the seed uses",
    legacyRow?.module === null && legacyRow?.content_type === null && legacyRow?.source_ref === null && legacyRow?.content_version_id === null,
    `module=${legacyRow?.module} content_type=${legacyRow?.content_type} version=${legacyRow?.content_version_id}`);

  // The canonical positive control needs published curriculum content, authored through the product's
  // own chain (owner drafts, publishes the REVISION, publishes the ROW) — discovered last round.
  const contentRef = `${RUN}-task2`;
  const authored = await actors.OWNER.post("/api/admin/content/drafts", {
    module: "writing", contentType: "task2", sourceRef: contentRef, title: `${RUN} essay`,
    payload: { taskType: "task2", category: "b3", prompt: `Discuss ${RUN} in your own words.`, targetWordCount: 250 },
  });
  const versionId = authored.json?.versionId;
  const targetId = authored.json?.targetId;
  const pubVersion = await actors.OWNER.post(`/api/admin/content/versions/${versionId}/publication`, { to: "published" });
  const pubRow = await actors.OWNER.post(`/api/admin/content/writing/${targetId}/publication`, { state: "published" });
  check("canonical fixture: owner authored and published curriculum content through the product",
    authored.status === 201 && pubVersion.status === 200 && pubRow.status === 200,
    `draft=${authored.status} version=${pubVersion.status} row=${pubRow.status}`);

  const canonicalTitle = `${RUN}-canonical-ok`;
  const canonicalOk = await actors.TEACHER_A.post("/api/assignments", {
    title: canonicalTitle, description: null, targetUserId: studentA.id,
    module: "writing", contentType: "task2", sourceRef: contentRef, contentVersionId: versionId,
  });
  const canonicalRows = await written(canonicalTitle);
  check("B3-C01 canonical path: the same teacher's request is accepted (201)",
    canonicalOk.status === 201 && canonicalOk.json?.ok === true, brief(canonicalOk));
  check("B3-C02 canonical path: assignment + target + event written 1:1:1",
    canonicalRows.assignments === 1 && canonicalRows.targets === 1 && canonicalRows.events === 1,
    `assignments=${canonicalRows.assignments} targets=${canonicalRows.targets} events=${canonicalRows.events}`);
  const canonicalRow = await one(
    `select a.created_by_user_id, a.target_user_id, a.content_version_id, a.module, a.content_type, a.source_ref, t.student_user_id
       from assignments a join assignment_targets t on t.assignment_id = a.id where a.title = $1`, [canonicalTitle]);
  check("B3-C03 canonical path: the exact revision shown to the teacher is the one persisted",
    canonicalRow?.content_version_id === versionId && canonicalRow?.source_ref === contentRef,
    `version=${canonicalRow?.content_version_id?.slice(0, 8)} vs ${versionId?.slice(0, 8)}; ref=${canonicalRow?.source_ref === contentRef}`);
  check("B3-C04 canonical path: teacher and student identities persisted",
    canonicalRow?.created_by_user_id === teacherA.id && canonicalRow?.student_user_id === studentA.id);

  /* ------------------------- 3. THE OPEN QUESTION: authorization parity between the two paths */
  step("3 · authorization parity — same actor, same student, only the reference differs");
  const parity = async (label, actor, expectRefusal, reason) => {
    const legacyTitle = `${RUN}-${label}-legacy`;
    const canonicalTitle = `${RUN}-${label}-canonical`;
    const legacy = await actor.post("/api/assignments", {
      title: legacyTitle, description: null, targetUserId: studentA.id, relatedWritingPromptId: livePrompt.id,
    });
    const canonical = await actor.post("/api/assignments", {
      title: canonicalTitle, description: null, targetUserId: studentA.id,
      module: "writing", contentType: "task2", sourceRef: contentRef, contentVersionId: versionId,
    });
    const lRows = await written(legacyTitle);
    const cRows = await written(canonicalTitle);
    const refused = (res) => res.status === 401 || res.status === 403 || res.status === 404 || res.status === 422;
    if (expectRefusal) {
      check(`${label}: canonical path refuses (${reason})`, refused(canonical), brief(canonical));
      check(`${label}: legacy path refuses too (${reason})`, refused(legacy),
        `${brief(legacy)} — the canonical path answered ${canonical.status} for the identical actor and student`);
      check(`${label}: the canonical refusal wrote nothing`,
        cRows.assignments === 0 && cRows.targets === 0 && cRows.events === 0,
        `assignments=${cRows.assignments} targets=${cRows.targets} events=${cRows.events}`);
      check(`${label}: the legacy refusal wrote nothing`,
        lRows.assignments === 0 && lRows.targets === 0 && lRows.events === 0,
        `assignments=${lRows.assignments} targets=${lRows.targets} events=${lRows.events}`);
    } else {
      check(`${label}: both paths accept (${reason})`,
        canonical.status === 201 && legacy.status === 200, `canonical=${brief(canonical)} legacy=${brief(legacy)}`);
      check(`${label}: both wrote assignment + target + event`,
        cRows.assignments === 1 && cRows.targets === 1 && cRows.events === 1
        && lRows.assignments === 1 && lRows.targets === 1 && lRows.events === 1,
        `canonical ${cRows.assignments}/${cRows.targets}/${cRows.events} · legacy ${lRows.assignments}/${lRows.targets}/${lRows.events}`);
    }
    return { legacy, canonical };
  };

  await parity("B3-A01 TEACHER_A on roster", actors.TEACHER_A, false, "roster link exists");
  await parity("B3-A02 TEACHER_B off roster", actors.TEACHER_B, true, "no teacher_student_links row");
  await parity("B3-A03 ADMIN", actors.ADMIN, false, "isAdministrator bypasses the roster rule");
  await parity("B3-A04 OWNER", actors.OWNER, false, "isAdministrator bypasses the roster rule");
  await parity("B3-A05 STUDENT_A", actors.STUDENT_A, true, "a student may not assign work, even to themselves");
  await parity("B3-A06 STUDENT_B", actors.STUDENT_B, true, "a student may not assign work");
  await parity("B3-A07 ANONYMOUS", actors.ANONYMOUS, true, "no session");

  /* ------------------------------- 4. forged / invalid references on the legacy path */
  step("4 · the legacy path's reference is only checked for UUID shape");
  const forgedStudent = `${RUN}-forged-student`;
  const forgedStudentLegacy = await actors.TEACHER_A.post("/api/assignments", {
    title: forgedStudent, description: null, targetUserId: teacherB.id, relatedWritingPromptId: livePrompt.id,
  });
  const forgedStudentCanonical = await actors.TEACHER_A.post("/api/assignments", {
    title: `${forgedStudent}-c`, description: null, targetUserId: teacherB.id,
    module: "writing", contentType: "task2", sourceRef: contentRef, contentVersionId: versionId,
  });
  const fsRows = await written(forgedStudent);
  check("B3-V01 a target who is not a student is refused by the canonical path",
    forgedStudentCanonical.status === 403 && /not_a_student/.test(JSON.stringify(forgedStudentCanonical.json ?? {})),
    brief(forgedStudentCanonical));
  check("B3-V02 the same forged targetUserId is refused by the legacy path",
    forgedStudentLegacy.status === 403 || forgedStudentLegacy.status === 422,
    `${brief(forgedStudentLegacy)} — canonical answered ${forgedStudentCanonical.status}`);
  check("B3-V03 the refused forged target wrote no rows",
    fsRows.assignments === 0 && fsRows.targets === 0 && fsRows.events === 0,
    `assignments=${fsRows.assignments} targets=${fsRows.targets} events=${fsRows.events}`);

  const ghost = "00000000-0000-4000-8000-000000000000";
  const ghostTitle = `${RUN}-ghost-prompt`;
  const ghostRes = await actors.TEACHER_A.post("/api/assignments", {
    title: ghostTitle, description: null, targetUserId: studentA.id, relatedWritingPromptId: ghost,
  });
  const ghostRows = await written(ghostTitle);
  check("B3-V04 a relatedWritingPromptId that exists nowhere is refused",
    ghostRes.status === 422 || ghostRes.status === 404 || ghostRes.status === 400,
    `${brief(ghostRes)} — a valid UUID with no row is not a content reference`);
  check("B3-V05 and it wrote no rows", ghostRows.assignments === 0 && ghostRows.targets === 0,
    `assignments=${ghostRows.assignments} targets=${ghostRows.targets}`);

  const draftPromptId = naturalDraft?.id ?? livePrompt?.id ?? null;
  if (!draftPromptId) {
    check("B3-V06 a prompt that is not live cannot be set as work", false, "no writing prompt available to test against");
  } else {
    if (!naturalDraft) {
      borrower = createRowBorrower({ client: admin, table: "writing_prompts", probe: "assignment-b3" });
      const borrowed = await borrower.borrow("id = $1", [draftPromptId]);
      if (borrowed !== 1) throw new Error(`expected to borrow exactly one writing prompt, borrowed ${borrowed}`);
      await admin.query("update writing_prompts set publication_state='draft' where id=$1", [draftPromptId]);
      console.log(`  NOTE  borrowed prompt ${draftPromptId.slice(0, 8)} and set it to draft for B3-V06 only`);
    }
    const draftTitle = `${RUN}-draft-prompt`;
    const draftRes = await actors.TEACHER_A.post("/api/assignments", {
      title: draftTitle, description: null, targetUserId: studentA.id, relatedWritingPromptId: draftPromptId,
    });
    const draftRows = await written(draftTitle);
    // Put it back BEFORE anything else runs, so no later check observes a borrowed row.
    if (borrower) {
      const restored = await borrower.restore();
      console.log(`  NOTE  prompt restored and verified: ${restored} row(s)`);
      borrower = null;
    }
    check("B3-V06 a prompt that is not live for learners cannot be set as work",
      draftRes.status === 422 || draftRes.status === 404,
      `${brief(draftRes)} — the canonical path refuses this as content_not_live`);
    check("B3-V07 and it wrote no rows", draftRows.assignments === 0 && draftRows.targets === 0,
      `assignments=${draftRows.assignments} targets=${draftRows.targets}`);
    // And prove the restore actually took: the same prompt is assignable again.
    const afterRestore = await actors.TEACHER_A.post("/api/assignments", {
      title: `${RUN}-after-restore`, description: null, targetUserId: studentA.id, relatedWritingPromptId: livePrompt.id,
    });
    check("B3-V08 the borrowed prompt was really put back — the same reference is accepted again",
      afterRestore.status === 200, `${brief(afterRestore)} — a 422 here would mean the restore did not take`);
  }

  /* --------------------------- 5. failure injection, rollback and retry (B3-02/03/04, C07-C10) */
  step("5 · a refused creation writes nothing, and a retry creates exactly one");
  /*
   * WHAT THIS SECTION DOES AND DOES NOT PROVE — stated precisely, because it changed meaning when the
   * fix landed.
   *
   * Injected through the product, not by stubbing it: a targetUserId shaped like a UUID with no user
   * row. BEFORE the fix this reached the insert and failed on a foreign-key violation, answering 500
   * (observed: code 23503 on assignments_target_user_id_users_id_fk) while the transaction rolled
   * back — so it did prove rollback, by accident, through an unhandled error.
   *
   * AFTER the fix the same request is refused by mayAssignTo with 403 before anything is written,
   * which is better product behaviour but no longer exercises a partially written transaction. So
   * these checks now prove "refused, nothing written, retry creates exactly one" and NOT "written,
   * then rolled back". Those are different claims.
   *
   * Genuine mid-transaction rollback is proven elsewhere and is not repeated here:
   *   tests/assignment-atomicity-qa2.test.ts installs a real PostgreSQL BEFORE INSERT trigger on
   *     activity_events, scoped to its own teacher, INSIDE the server's transaction, and shows the
   *     assignment and its target both disappear and a retry creates exactly one (B3-02/03/04);
   *   tests/assignment-concurrency-qa2.test.ts B3-05f races two real backends into the unique
   *     (assignment_id, student_user_id) index, so one write fails mid-transaction and exactly one
   *     row survives.
   */
  const absentUser = "11111111-2222-4333-8444-555555555555";
  const failTitle = `${RUN}-rollback`;
  const before = await one("select count(*)::int n from assignments");
  const injected = await actors.TEACHER_A.post("/api/assignments", {
    title: failTitle, description: null, targetUserId: absentUser, relatedWritingPromptId: livePrompt.id,
  });
  const after = await one("select count(*)::int n from assignments");
  const failRows = await written(failTitle);
  check("B3-C07 the injected failure does not produce a success response",
    injected.status >= 400, `HTTP ${injected.status} — a 200 here would claim a write that did not land`);
  check("B3-C08 no orphan assignment survived the failed target insert",
    failRows.assignments === 0 && after.n === before.n,
    `assignments for this title=${failRows.assignments}; table ${before.n} → ${after.n}`);
  check("B3-C09 no target row and no activity event survived either",
    failRows.targets === 0 && failRows.events === 0,
    `targets=${failRows.targets} events=${failRows.events}`);

  // RETRY SEMANTICS. The route is explicit that assigned work is not idempotent under a
  // client-generated key, so the assertion is NOT "a retry produces one row where two requests would
  // produce two". It is: after a FAILED request, retrying the same intent successfully creates exactly
  // one — the failure left nothing to duplicate.
  const retryTitle = `${RUN}-retry`;
  const retryFailed = await actors.TEACHER_A.post("/api/assignments", {
    title: retryTitle, description: null, targetUserId: absentUser, relatedWritingPromptId: livePrompt.id,
  });
  const retrySucceeded = await actors.TEACHER_A.post("/api/assignments", {
    title: retryTitle, description: null, targetUserId: studentA.id, relatedWritingPromptId: livePrompt.id,
  });
  const retryRows = await written(retryTitle);
  check("B3-02 the failed attempt left nothing, so the retry had nothing to duplicate",
    retryFailed.status >= 400 && retrySucceeded.status === 200,
    `failed=${retryFailed.status} retry=${retrySucceeded.status}`);
  check("B3-03 the retry created exactly one assignment with one target and one event",
    retryRows.assignments === 1 && retryRows.targets === 1 && retryRows.events === 1,
    `assignments=${retryRows.assignments} targets=${retryRows.targets} events=${retryRows.events}`);

  /* ------------------------------------- 6. the learner can actually see what was created */
  step("6 · assigned work reaches the learner (a target row alone is not visibility)");
  const listA = await actors.STUDENT_A.get("/api/assignments");
  const listB = await actors.STUDENT_B.get("/api/assignments");
  check("B3-04 the targeted learner's list contains the work",
    listA.status === 200 && listA.body.includes(retryTitle), `HTTP ${listA.status}`);
  check("B3-06 the other learner's list does not",
    listB.status === 200 && !listB.body.includes(retryTitle), `HTTP ${listB.status}`);
} catch (error) {
  console.error("\nB3 PROBE ABORTED:", error?.message ?? error);
  failures.push(`aborted: ${error?.message ?? error}`);
} finally {
  if (borrower) {
    const restored = await borrower.restore().catch((e) => ({ error: e.message }));
    console.log(`\n  borrowed prompt restored: ${JSON.stringify(restored)}`);
    if (restored?.error) failures.push(`borrowed row not restored: ${restored.error}`);
  }
  const result = await sweeper.sweep().catch((e) => ({ error: e.message }));
  console.log(`  cleanup: removed ${JSON.stringify(result?.removed ?? result?.error)}`);
  if (result?.residue?.length) { failures.push(`residue: ${JSON.stringify(result.residue)}`); console.log(`  RESIDUE ${JSON.stringify(result.residue)}`); }
  const state = await one("select (select count(*)::int from writing_prompts where publication_state='published') pub, (select count(*)::int from assignments) a").catch(() => null);
  console.log(`  final state: published writing_prompts=${state?.pub} assignments=${state?.a}`);
  await admin.end().catch(() => {});
  console.log(`\n${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
