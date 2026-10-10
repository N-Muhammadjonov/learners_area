#!/usr/bin/env node
/*
 * §6 — STAFF → STUDENT ASSIGNMENT JOURNEY, IN A REAL BROWSER.
 *
 * The acceptance rule this probe is written against is the owner's, verbatim:
 *
 *     "A successful teacher POST without learner visibility does not count as accepted."
 *
 * So every step is checked in three places at once — the rendered DOM, the HTTP response, and
 * PostgreSQL — and a step only passes when all three agree. An API-level journey already exists
 * (verify-journeys.mjs E4); this one drives the product a teacher and a learner actually use:
 * the assignment form on the student page, and the assignment board.
 *
 * The route:
 *   teacher authors curriculum content  → the picker offers it  → teacher assigns it to a student
 *   on their roster → the learner SEES it → opens it → completes the supported action → the status
 *   the teacher and the learner read reflects that → the learner's history persists in a fresh
 *   session. Plus the negatives: a student who was not targeted sees nothing, and a teacher with no
 *   roster link is refused with no rows written at all.
 *
 * Fixtures are created through the product's own endpoints and removed by the differential sweeper.
 */
const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required — refusing to guess a database.");
  process.exit(2);
}

const { assertMutableDatabase, createRowSweeper, installSweepHandlers } = await import("./lib/fixture-safety.mjs");
assertMutableDatabase(DATABASE_URL, { probe: "verify-assignment-journey" });
const { launchBrowser, createSession } = await import("./lib/browser-qa.mjs");
const pg = (await import("pg")).default;

const TEACHER = ["teacher@learnersarea.uz", "Teacher12345!"];
const TEACHER_B = ["teacher2@learnersarea.uz", "Teacher12345!"]; // no teacher_student_links row
const STUDENT_A = ["demo.student@learnersarea.uz", "Student12345!"]; // on TEACHER's roster
const STUDENT_B = ["new.student@learnersarea.uz", "Student12345!"]; // also on TEACHER's roster

const SWEEP_TABLES = [
  "assignment_responses", "writing_feedback", "evaluations", "assignment_targets",
  "assignments", "activity_events", "content_versions", "material_blocks", "speaking_materials",
];

const failures = [];
let pass = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
const step = (label) => console.log(`\n── ${label}`);

const admin = new pg.Client({ connectionString: DATABASE_URL });
await admin.connect();
const q = async (sql, params) => (await admin.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

const sweeper = createRowSweeper({ client: admin, tables: SWEEP_TABLES, probe: "assignment-journey" });
installSweepHandlers(sweeper, { probe: "assignment-journey" });
await sweeper.capture();

const MARKER = `qa6-journey-${Date.now()}`;
const RESPONSE_TEXT = `This is the learner's own response to ${MARKER}, long enough to pass the twenty character floor.`;

const browser = await launchBrowser();
let teacherSession = null;
let learnerSession = null;

try {
  /* ---------------------------------------------------------- 0. the roster is real */
  step("0 · the roster the teacher is allowed to assign to");
  const links = await q("select teacher_user_id, student_user_id from teacher_student_links");
  const teacherId = (await one("select id from users where email=$1", [TEACHER[0]])).id;
  const studentA = (await one("select id, name, email from users where email=$1", [STUDENT_A[0]]));
  const studentB = (await one("select id from users where email=$1", [STUDENT_B[0]]));
  const teacherB = (await one("select id from users where email=$1", [TEACHER_B[0]]));
  check("student A is on the teacher's roster", links.some((l) => l.teacher_user_id === teacherId && l.student_user_id === studentA.id),
    `${links.length} link(s) in teacher_student_links`);
  check("the negative-control teacher has NO roster link to student A",
    !links.some((l) => l.teacher_user_id === teacherB.id && l.student_user_id === studentA.id),
    "so a refusal below is attributable to the roster rule, not to a missing row");

  /* ------------------------------------------- 1. teacher authors curriculum content */
  step("1 · the teacher authors curriculum content through the product's own endpoint");
  teacherSession = await createSession(browser, { base: BASE, email: TEACHER[0], password: TEACHER[1], viewport: 1440, locale: "en" });
  teacherSession.page.on("dialog", async (d) => { await d.accept(); });
  const materialTitle = `${MARKER} speaking resource`;
  const authored = await teacherSession.page.evaluate(async (payload) => {
    const res = await fetch("/api/speaking/materials", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { title: materialTitle, category: "part1", primary: { mode: "link", primaryType: "link", primaryUrl: "https://example.edu/qa6-journey" } });
  check("the teacher can author a speaking resource", authored.status === 200 && authored.body?.ok === true,
    `HTTP ${authored.status} id=${authored.body?.id?.slice(0, 8) ?? "none"}`);
  const materialId = authored.body?.id;

  const revision = await one("select id, module, content_type, source_ref, publication_state, target_type, target_id from content_versions where target_id=$1", [materialId]);
  check("authoring pinned a published revision", revision?.publication_state === "published",
    revision ? `${revision.module}:${revision.content_type} target=${revision.target_type} v=${revision.id.slice(0, 8)}` : "no revision row");

  /* ------------------------------------ 2. the picker offers what a learner can open */
  step("2 · the assignment picker offers that content in the real UI");
  await teacherSession.page.goto(`${BASE}/app/teacher/students/${studentA.id}`, { waitUntil: "networkidle2", timeout: 60_000 });
  check("the teacher's student page rendered (roster authorized)",
    await teacherSession.page.evaluate(() => Boolean(document.querySelector("h1"))),
    teacherSession.page.url().replace(BASE, ""));

  // The form is collapsed behind one button; open it without depending on its label's locale.
  const opened = await teacherSession.page.evaluate(async () => {
    if (document.querySelector("#assignment-title")) return "already-open";
    for (const button of [...document.querySelectorAll("button")]) {
      button.click();
      await new Promise((r) => setTimeout(r, 120));
      if (document.querySelector("#assignment-title")) return "opened";
    }
    return "not-found";
  });
  check("the New Assignment form opens for the teacher", opened !== "not-found", opened);
  await teacherSession.page.waitForSelector('[data-assignment-content-select]', { timeout: 20_000 });
  await teacherSession.page.waitForFunction(
    () => !document.querySelector('[data-assignment-content-select]')?.disabled, { timeout: 20_000 },
  ).catch(() => {});

  const picker = await teacherSession.page.evaluate(() => {
    const select = document.querySelector('[data-assignment-content-select]');
    return {
      options: [...select.options].map((o) => ({ value: o.value, label: o.textContent.trim() })),
      hint: document.querySelector('[data-assignment-content-hint]')?.textContent.trim() ?? null,
    };
  });
  const canonicalValue = `speaking:material:${revision?.source_ref}`;
  const offered = picker.options.find((o) => o.value === canonicalValue);
  check("the picker lists the resource the teacher just published",
    Boolean(offered),
    offered ? offered.label : `${picker.options.length} option(s); hint="${picker.hint}"`);

  // Selecting it must reveal the exact revision that will be pinned — the teacher is shown what
  // the learner will be bound to, rather than "whatever is newest at open time".
  await teacherSession.page.select('[data-assignment-content-select]', canonicalValue);
  await teacherSession.page.waitForSelector('[data-assignment-pinned-revision]', { timeout: 10_000 }).catch(() => {});
  const pinned = await teacherSession.page.evaluate(() =>
    document.querySelector('[data-assignment-pinned-revision]')?.textContent.trim() ?? null);
  check("choosing it names the revision that will be pinned",
    Boolean(pinned) && pinned.includes(revision.id.slice(0, 8)), pinned ?? "no revision shown");

  /* ------------------------------------------------ 3. the teacher assigns the work */
  step("3 · the teacher assigns it to the student on their roster");
  await teacherSession.page.type("#assignment-title", MARKER);
  await teacherSession.page.type("#assignment-description", "Complete the speaking resource and respond below.");
  const assignResponse = await teacherSession.page.evaluate(async () => {
    // Record what the form itself sends, so the assertion is about the product's request.
    window.__assignResult = null;
    const original = window.fetch;
    window.fetch = async (...args) => {
      const res = await original(...args);
      if (String(args[0]).includes("/api/assignments") && args[1]?.method === "POST") {
        window.__assignResult = { status: res.status, body: await res.clone().json().catch(() => null) };
      }
      return res;
    };
    const card = document.querySelector("#assignment-title").closest("div");
    const footer = [...card.parentElement.querySelectorAll("div.flex.gap-2 button")];
    (footer[0] ?? [...document.querySelectorAll("button")].find((b) => !b.disabled))?.click();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (window.__assignResult) break;
    }
    return window.__assignResult;
  });
  check("the form's own POST was accepted", assignResponse?.status === 201,
    `HTTP ${assignResponse?.status ?? "no request observed"}`);
  const assignmentId = assignResponse?.body?.assignment?.id;

  const savedRow = await one("select id, title, status, target_user_id, content_version_id, created_by_user_id from assignments where id=$1", [assignmentId]);
  check("the assignment row exists, titled exactly what the teacher typed",
    savedRow?.title === MARKER, savedRow ? `title=${savedRow.title}` : "no row");
  check("it was created by the teacher, not by the request payload",
    savedRow?.created_by_user_id === teacherId, `created_by=${savedRow?.created_by_user_id?.slice(0, 8)}`);
  check("it pinned the revision the UI showed",
    savedRow?.content_version_id === revision?.id, `${savedRow?.content_version_id?.slice(0, 8)} vs ${revision?.id?.slice(0, 8)}`);

  const target = await one("select assignment_id, student_user_id, status from assignment_targets where assignment_id=$1", [assignmentId]);
  check("assignment_targets maps the work to the CORRECT learner",
    target?.student_user_id === studentA.id,
    target ? `student=${target.student_user_id.slice(0, 8)} (expected ${studentA.id.slice(0, 8)}) status=${target.status}` : "NO TARGET ROW — invisible to the learner");
  const event = await one("select count(*)::int n from activity_events where payload::text like $1", [`%${assignmentId}%`]);
  check("an ASSIGNMENT_CREATED activity event was recorded", (event?.n ?? 0) >= 1, `${event?.n} event(s)`);

  /* ---------------------------- 4. THE ACCEPTANCE CRITERION: the learner can see it */
  step("4 · the learner sees the work in their own browser (the acceptance criterion)");
  learnerSession = await createSession(browser, { base: BASE, email: STUDENT_A[0], password: STUDENT_A[1], viewport: 1440, locale: "en" });
  learnerSession.page.on("dialog", async (d) => { await d.accept(); });
  await learnerSession.page.goto(`${BASE}/app/assignments`, { waitUntil: "networkidle2", timeout: 60_000 });
  await learnerSession.page.waitForSelector('[data-assignment-content]', { timeout: 30_000 }).catch(() => {});
  const seen = await learnerSession.page.evaluate((marker) => {
    const board = document.querySelector('[data-assignment-content]');
    const text = board?.innerText ?? document.body.innerText;
    return { rendered: text.includes(marker), hasTextarea: Boolean(document.querySelector(`textarea[id^="response-"]`)) };
  }, MARKER);
  check("the assigned work is rendered to the learner", seen.rendered,
    seen.rendered ? `marker present; response box=${seen.hasTextarea}` : "the teacher's POST succeeded but the learner cannot see it");

  const beforeBadge = await learnerSession.page.evaluate((id) => {
    const box = document.querySelector(`#response-${id}`);
    return box?.closest("div")?.parentElement?.querySelector(".badge")?.textContent.trim() ?? null;
  }, assignmentId);

  /* -------------------------------------- 5. the learner completes the work */
  step("5 · the learner opens it and completes the supported action");
  await learnerSession.page.type(`#response-${assignmentId}`, RESPONSE_TEXT);
  const evaluate = await learnerSession.page.evaluate(async (id) => {
    window.__evalResult = null;
    const original = window.fetch;
    window.fetch = async (...args) => {
      const res = await original(...args);
      if (String(args[0]).includes(`/api/assignments/${id}/evaluate`)) {
        window.__evalResult = { status: res.status, body: await res.clone().json().catch(() => null) };
      }
      return res;
    };
    const box = document.querySelector(`#response-${id}`);
    const card = box.closest("div").parentElement;
    [...card.querySelectorAll("button")].find((b) => !b.disabled)?.click();
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (window.__evalResult) break;
    }
    return window.__evalResult;
  }, assignmentId);
  check("the learner's submission was accepted", evaluate?.status === 200 && evaluate?.body?.ok === true,
    `HTTP ${evaluate?.status ?? "no request observed"} dispatchedTo=${evaluate?.body?.dispatchedTo ?? "?"}`);

  const responseRow = await one("select id, content, user_id from assignment_responses where assignment_id=$1", [assignmentId]);
  check("the response is stored against the learner who wrote it",
    responseRow?.user_id === studentA.id && responseRow?.content === RESPONSE_TEXT,
    responseRow ? `${responseRow.content.length} chars, user=${responseRow.user_id.slice(0, 8)}` : "no response row");
  const evaluationRow = await one("select id, verdict, source_type from evaluations where source_id=$1", [assignmentId]);
  check("an evaluation was recorded for the submission", Boolean(evaluationRow),
    evaluationRow ? `verdict=${evaluationRow.verdict} source=${evaluationRow.source_type}` : "none");
  const assignmentStatus = await one("select status from assignments where id=$1", [assignmentId]);
  const targetStatus = await one("select status from assignment_targets where assignment_id=$1", [assignmentId]);
  check("assignments.status moved to completed", assignmentStatus?.status === "completed", `status=${assignmentStatus?.status}`);
  /*
   * The board the learner reads, and the status the teacher reads, both come from
   * assignment_targets.status — the page says so explicitly, because one assignment can be set for
   * several students. If completing the work only moves assignments.status, then the card the
   * learner just submitted from still reports "not started" forever, and the teacher never sees the
   * work as done. This is the assertion that decides whether the status a person reads is the
   * status the product actually maintains.
   */
  check("the TARGET status the learner and teacher read moved too",
    targetStatus?.status === "completed",
    `assignment_targets.status=${targetStatus?.status} while assignments.status=${assignmentStatus?.status}`);

  await learnerSession.page.reload({ waitUntil: "networkidle2", timeout: 60_000 });
  /*
   * Address the card by its TITLE, not by the response box: once an evaluation exists the board
   * renders the outcome branch INSTEAD of the textarea, so a selector anchored on `#response-<id>`
   * returns null for everything. Anchored that way this check passed vacuously — `null !== "Not
   * started"` is true whether or not the product did anything.
   */
  const afterBadge = await learnerSession.page.evaluate((payload) => {
    const cards = [...document.querySelectorAll("[data-assignment-content] .badge")];
    const card = cards.find((b) => b.closest("div")?.parentElement?.innerText.includes(payload.marker))?.closest("div")?.parentElement;
    return {
      found: Boolean(card),
      badge: card?.querySelector(".badge")?.textContent.trim() ?? null,
      checkedBy: card?.querySelector("[data-checked-by]")?.getAttribute("data-checked-by") ?? null,
      stillEditable: Boolean(card?.querySelector(`#response-${payload.id}`)),
    };
  }, { marker: MARKER, id: assignmentId });
  check("the board shows the outcome of the submission",
    afterBadge.found && Boolean(afterBadge.checkedBy),
    `badge "${beforeBadge}" → "${afterBadge.badge}"; checkedBy=${afterBadge.checkedBy ?? "none"}`);
  check("the learner's card no longer reports the work as untouched",
    afterBadge.badge !== beforeBadge && !/not started/i.test(afterBadge.badge ?? ""),
    `"${beforeBadge}" → "${afterBadge.badge}"`);

  /* ------------------------------------------- 6. the teacher sees the learner's work */
  step("6 · the teacher sees the authorized status and the learner's response");
  const teacherView = await teacherSession.page.evaluate(async (id) => {
    const res = await fetch("/api/assignments", { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => null);
    const list = body?.assignments ?? body?.items ?? [];
    const mine = list.find((a) => a.id === id);
    return { status: res.status, count: list.length, mine: mine ?? null };
  }, assignmentId);
  check("the teacher's own list contains the assignment they created",
    teacherView.status === 200 && Boolean(teacherView.mine),
    `HTTP ${teacherView.status}; ${teacherView.count} row(s); status=${teacherView.mine?.status ?? "absent"}`);

  /* ------------------------------------------ 7. the learner's history persists */
  step("7 · the learner's history persists in a completely fresh session");
  const fresh = await createSession(browser, { base: BASE, email: STUDENT_A[0], password: STUDENT_A[1], viewport: 1440, locale: "en" });
  fresh.page.on("dialog", async (d) => { await d.accept(); });
  await fresh.page.goto(`${BASE}/app/assignments`, { waitUntil: "networkidle2", timeout: 60_000 });
  const persisted = await fresh.page.evaluate((payload) => {
    const board = document.querySelector("[data-assignment-content]");
    const card = [...(board?.querySelectorAll(".badge") ?? [])]
      .find((b) => b.closest("div")?.parentElement?.innerText.includes(payload.marker))?.closest("div")?.parentElement;
    return {
      hasAssignment: Boolean(card),
      status: card?.querySelector(".badge")?.textContent.trim() ?? null,
      outcome: card?.querySelector("[data-checked-by]")?.getAttribute("data-checked-by") ?? null,
    };
  }, { marker: MARKER });
  // The response text itself is not re-rendered once evaluated — the board shows the outcome, and
  // the stored text seeds the draft box if the work is ever reopened. Persistence is therefore
  // asserted as: the work is still listed, still marked done, still carrying its outcome, and the
  // learner's own words are still in the database.
  const responseStillStored = await one("select content, user_id from assignment_responses where assignment_id=$1", [assignmentId]);
  check("a new session still lists the assignment as completed with its outcome",
    persisted.hasAssignment && persisted.outcome !== null && !/not started/i.test(persisted.status ?? ""),
    `status="${persisted.status}"; checkedBy=${persisted.outcome ?? "none"}`);
  check("and the learner's own response is still stored against them",
    responseStillStored?.content === RESPONSE_TEXT && responseStillStored?.user_id === studentA.id,
    responseStillStored ? `${responseStillStored.content.length} chars intact` : "the response row is gone");
  await fresh.close?.().catch?.(() => {});

  /* ------------------------------------------------------- 8. negative controls */
  step("8 · negatives: a student who was not targeted, and a teacher with no roster link");
  const outsider = await createSession(browser, { base: BASE, email: STUDENT_B[0], password: STUDENT_B[1], viewport: 1440, locale: "en" });
  outsider.page.on("dialog", async (d) => { await d.accept(); });
  await outsider.page.goto(`${BASE}/app/assignments`, { waitUntil: "networkidle2", timeout: 60_000 });
  const leak = await outsider.page.evaluate((payload) => {
    const text = document.querySelector('[data-assignment-content]')?.innerText ?? document.body.innerText;
    return { seesTitle: text.includes(payload.marker), hasBox: Boolean(document.querySelector(`#response-${payload.id}`)) };
  }, { marker: MARKER, id: assignmentId });
  check("a student who was not targeted sees neither the title nor a response box",
    !leak.seesTitle && !leak.hasBox, `title=${leak.seesTitle}; response box=${leak.hasBox}`);

  const outsiderSubmit = await outsider.page.evaluate(async (payload) => {
    const res = await fetch(`/api/assignments/${payload.id}/evaluate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: payload.text }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { id: assignmentId, text: "An outsider trying to complete someone else's work, padded to length." });
  check("and is refused when they try to complete it anyway",
    outsiderSubmit.status === 403, `HTTP ${outsiderSubmit.status} ${outsiderSubmit.body?.error ?? ""}`);
  const stolenRows = await one("select count(*)::int n from assignment_responses where assignment_id=$1 and user_id=$2", [assignmentId, studentB.id]);
  check("the refused attempt wrote nothing", (stolenRows?.n ?? 0) === 0, `${stolenRows?.n} response row(s) from the outsider`);
  await outsider.close?.().catch?.(() => {});

  // A teacher with no roster link: the page itself must 404, and the API must refuse without writing.
  const teacherBSession = await createSession(browser, { base: BASE, email: TEACHER_B[0], password: TEACHER_B[1], viewport: 1440, locale: "en" });
  teacherBSession.page.on("dialog", async (d) => { await d.accept(); });
  // A real published revision, so the payload is well-formed and the refusal can only be about the
  // roster. Then the identical payload is sent by the authorized teacher as a positive control: if
  // both were refused, the negative control would be proving nothing.
  const reference = await one("select module, content_type, source_ref, id from content_versions where publication_state='published' order by created_at desc limit 1");
  const offRosterTitle = `${MARKER}-offroster`;
  const onRosterTitle = `${MARKER}-onroster`;
  const offRoster = await teacherBSession.page.evaluate(async ({ studentId, studentName, studentEmail, payload }) => {
    const page = await fetch(`/app/teacher/students/${studentId}`, { redirect: "manual" });
    const html = await page.text();
    const api = await fetch("/api/assignments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return {
      pageStatus: page.status, apiStatus: api.status, apiBody: await api.json().catch(() => null),
      leaksName: html.includes(studentName), leaksEmail: html.includes(studentEmail),
      leaksForm: html.includes("assignment-title"),
    };
  }, {
    studentId: studentA.id,
    studentName: studentA.name,
    studentEmail: studentA.email ?? "@@no-email@@",
    payload: {
      title: offRosterTitle, description: null, targetUserId: studentA.id,
      module: reference.module, contentType: reference.content_type,
      sourceRef: reference.source_ref, contentVersionId: reference.id,
    },
  });
  check("a teacher with no roster link gets none of the student's protected data",
    offRoster.leaksName === false && offRoster.leaksEmail === false && offRoster.leaksForm === false,
    `HTTP ${offRoster.pageStatus}; name=${offRoster.leaksName}; email=${offRoster.leaksEmail}; assignment form=${offRoster.leaksForm}`);
  // Recorded, not asserted as a breach: the shell answers 200 and renders not-found content rather
  // than a 404 status. No protected payload is exposed, so this is a status-code question, tracked
  // separately from authorization (the same class as the valid-UUID/no-row 200 in §11).
  if (offRoster.pageStatus !== 404) console.log(`  NOTE  off-roster student page returned HTTP ${offRoster.pageStatus} with not-found content (status-code issue, no data exposed)`);
  check("and cannot assign work to that student through the API",
    offRoster.apiStatus === 403 && /roster/i.test(JSON.stringify(offRoster.apiBody ?? {})),
    `HTTP ${offRoster.apiStatus} ${JSON.stringify(offRoster.apiBody?.issues?.[0]?.code ?? offRoster.apiBody?.error ?? "")}`);
  const offRosterRows = await one(
    "select count(*)::int n from assignments where title=$1 and created_by_user_id=$2", [offRosterTitle, teacherB.id]);
  check("the refused off-roster assignment wrote no rows at all (atomicity)",
    (offRosterRows?.n ?? 0) === 0, `${offRosterRows?.n} assignment row(s) attributable to the off-roster teacher`);
  const offRosterTargets = await one(
    "select count(*)::int n from assignment_targets t join assignments a on a.id=t.assignment_id where a.title=$1", [offRosterTitle]);
  check("and no target row was written for it either", (offRosterTargets?.n ?? 0) === 0,
    `${offRosterTargets?.n} target row(s)`);

  // POSITIVE CONTROL: the same payload from the teacher who IS on the roster must succeed. Without
  // this, a refusal caused by anything else (a bad payload, a broken route) would look like the
  // roster rule working.
  const onRoster = await teacherSession.page.evaluate(async (payload) => {
    const res = await fetch("/api/assignments", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { title: onRosterTitle, description: null, targetUserId: studentA.id, module: reference.module,
       contentType: reference.content_type, sourceRef: reference.source_ref, contentVersionId: reference.id });
  check("POSITIVE CONTROL: the identical payload from the on-roster teacher is accepted",
    onRoster.status === 201, `HTTP ${onRoster.status} — so the 403 above is attributable to the roster, not to the payload`);
  await teacherBSession.close?.().catch?.(() => {});

  /* ------------------------------------------------- 9. the legacy path is live too */
  step("9 · the legacy writing-prompt path still reaches the learner");
  const prompt = await one("select id from writing_prompts where publication_state='published' limit 1");
  if (!prompt) {
    check("legacy path: a published writing prompt exists to assign", false, "no published writing_prompts row");
  } else {
    const legacy = await teacherSession.page.evaluate(async (payload) => {
      const res = await fetch("/api/assignments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: payload.title, description: null, targetUserId: payload.studentId, relatedWritingPromptId: payload.promptId }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { title: `${MARKER}-legacy`, studentId: studentA.id, promptId: prompt.id });
    check("the legacy path is accepted", legacy.status === 200 && legacy.body?.ok === true, `HTTP ${legacy.status}`);
    const legacyTarget = await one("select student_user_id from assignment_targets where assignment_id=$1", [legacy.body?.assignment?.id]);
    check("and writes its target row too, so the learner can see it",
      legacyTarget?.student_user_id === studentA.id, legacyTarget ? `student=${legacyTarget.student_user_id.slice(0, 8)}` : "NO TARGET ROW");
    const legacySeen = await learnerSession.page.evaluate(async (marker) => {
      const res = await fetch("/app/assignments");
      return (await res.text()).includes(marker);
    }, `${MARKER}-legacy`);
    check("the learner's board renders the legacy assignment", legacySeen, legacySeen ? "marker present" : "absent");
  }
} catch (error) {
  console.error("\nJOURNEY ABORTED:", error?.message ?? error);
  failures.push(`aborted: ${error?.message ?? error}`);
} finally {
  for (const session of [teacherSession, learnerSession]) await session?.close?.().catch?.(() => {});
  await browser.close().catch(() => {});
  const result = await sweeper.sweep().catch((e) => ({ error: e.message }));
  console.log(`\n  cleanup: removed ${JSON.stringify(result?.removed ?? result?.error)}`);
  if (result?.residue?.length) { failures.push(`residue: ${JSON.stringify(result.residue)}`); console.log(`  RESIDUE ${JSON.stringify(result.residue)}`); }
  await admin.end().catch(() => {});
  console.log(`\n${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
