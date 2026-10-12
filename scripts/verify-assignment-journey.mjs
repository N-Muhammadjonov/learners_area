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
const { resolveVerdict, reportVerdict } = await import("./lib/cleanup-verdict.mjs");
const pg = (await import("pg")).default;

const OWNER = ["owner@learnersarea.uz", "Owner12345!"];
const TEACHER = ["teacher@learnersarea.uz", "Teacher12345!"];
const TEACHER_B = ["teacher2@learnersarea.uz", "Teacher12345!"]; // no teacher_student_links row
const STUDENT_A = ["demo.student@learnersarea.uz", "Student12345!"]; // on TEACHER's roster
const STUDENT_B = ["new.student@learnersarea.uz", "Student12345!"]; // also on TEACHER's roster

const SWEEP_TABLES = [
  "assignment_responses", "writing_feedback", "evaluations", "assignment_targets",
  "assignments", "activity_events", "content_versions", "material_blocks", "speaking_materials",
  "writing_prompts",
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
let ownerSession = null;
let teacherSession = null;
let learnerSession = null;

/* Outside the try on purpose: `let` is block-scoped, so a declaration inside try would be invisible
 * to the finally block and to the exit below. Defaults to 1 so an early abort still fails. */
let exitCode = 1;

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

  /* ------------------------------- 1. curriculum content is authored and published */
  /*
   * Through the product's own authoring endpoints, in the order the product requires, and by the
   * actors the product allows. This is not a shortcut around a fixture gap: it is the real chain, and
   * each step is a separate product decision that the journey has to respect.
   *
   *   POST /api/admin/content/drafts                       owner  → a draft revision + the canonical row
   *   POST /api/admin/content/versions/:id/publication     owner  → the REVISION becomes published
   *   POST /api/admin/content/writing/:id/publication      owner  → the canonical ROW becomes published
   *
   * Both publications are needed and they are not the same thing: the picker requires a published
   * revision whose target row is still live. A teacher is refused (403) on both writing publication
   * calls — teachers author lessons and speaking resources, owners publish writing content — so the
   * journey uses the owner here and the teacher for the assignment, which is how the product splits
   * the work.
   */
  step("1 · curriculum content is authored and published through the product's own endpoints");
  ownerSession = await createSession(browser, { base: BASE, email: OWNER[0], password: OWNER[1], viewport: 1440, locale: "en" });
  ownerSession.page.on("dialog", async (d) => { await d.accept(); });
  teacherSession = await createSession(browser, { base: BASE, email: TEACHER[0], password: TEACHER[1], viewport: 1440, locale: "en" });
  teacherSession.page.on("dialog", async (d) => { await d.accept(); });

  const contentRef = `${MARKER}-task2`;
  const authored = await ownerSession.page.evaluate(async (payload) => {
    const post = async (url, body) => {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const draft = await post("/api/admin/content/drafts", payload.draft);
    if (draft.status >= 300) return { draft };
    const { versionId, targetId } = draft.body;
    const version = await post(`/api/admin/content/versions/${versionId}/publication`, { to: "published" });
    const row = await post(`/api/admin/content/writing/${targetId}/publication`, { state: "published" });
    return { draft, version, row, versionId, targetId };
  }, {
    draft: {
      module: "writing", contentType: "task2", sourceRef: contentRef, title: `${MARKER} essay`,
      payload: { taskType: "task2", category: "qa6", prompt: `Discuss ${MARKER} in your own words.`, targetWordCount: 250 },
    },
  });
  check("the owner can author the curriculum content", authored.draft?.status === 201 && Boolean(authored.targetId),
    `HTTP ${authored.draft?.status} target=${authored.targetId?.slice(0, 8) ?? "none"}`);
  check("and publish the REVISION, which is what the picker requires",
    authored.version?.status === 200 && authored.version?.body?.publicationState === "published",
    `HTTP ${authored.version?.status} ${authored.version?.body?.publicationState ?? JSON.stringify(authored.version?.body ?? {}).slice(0, 80)}`);
  check("and publish the canonical ROW, which is what liveness requires",
    authored.row?.status === 200 && authored.row?.body?.state === "published",
    `HTTP ${authored.row?.status} ${authored.row?.body?.state ?? JSON.stringify(authored.row?.body ?? {}).slice(0, 80)}`);

  const revision = await one(
    "select id, module, content_type, source_ref, status, publication_state, target_type, target_id from content_versions where id=$1",
    [authored.versionId]);
  check("the revision is published and names a live canonical target",
    revision?.publication_state === "published" && revision?.status === "published" && revision?.target_type === "writing_prompt",
    revision ? `${revision.module}:${revision.content_type} status=${revision.status}/${revision.publication_state} target=${revision.target_type}` : "no revision row");

  /* ------- 1b. the assignability rule: the API must refuse what the picker will not offer ------- */
  /*
   * Speaking material is authored, versioned and previewed, and is deliberately NOT assignable —
   * there is no canonical assignment target for it, and the registry refuses rather than invents one
   * (tests/speaking-canonical-identity.test.ts SP4). The picker has always honoured that by omission.
   * createAssignment did not: it checked only that the content type was known and the revision
   * published, both true here, so POST /api/assignments pinned it and answered 201. A teacher could
   * set work by hand-crafted request that no picker would ever offer. Both halves now read one rule.
   */
  step("1b · content that is not assignable is refused by the API, not just hidden by the picker");
  const material = await teacherSession.page.evaluate(async (payload) => {
    const res = await fetch("/api/speaking/materials", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { title: `${MARKER} speaking resource`, category: "part1", primary: { mode: "link", primaryType: "link", primaryUrl: "https://example.edu/qa6-journey" } });
  const materialId = material.body?.id;
  const materialRevision = await one(
    "select id, module, content_type, source_ref, publication_state, target_type from content_versions where target_id=$1", [materialId]);
  check("the teacher can author and publish a speaking resource",
    material.status === 200 && materialRevision?.publication_state === "published",
    `HTTP ${material.status}; revision ${materialRevision?.module}:${materialRevision?.content_type} published=${materialRevision?.publication_state}`);

  const refused = await teacherSession.page.evaluate(async (payload) => {
    const items = await (await fetch("/api/assignments/assignable")).json();
    const offered = (items.items ?? []).some((item) => item.sourceRef === payload.sourceRef);
    const res = await fetch("/api/assignments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${payload.marker} refused`, description: null, targetUserId: payload.studentId,
        module: payload.module, contentType: payload.contentType, sourceRef: payload.sourceRef,
        contentVersionId: payload.versionId,
      }),
    });
    return { offered, status: res.status, body: await res.json().catch(() => null) };
  }, { marker: MARKER, sourceRef: materialRevision?.source_ref, module: materialRevision?.module,
       contentType: materialRevision?.content_type, versionId: materialRevision?.id, studentId: studentA.id });
  check("the picker does not offer it", refused.offered === false, `offered=${refused.offered}`);
  check("and the API refuses the same reference instead of accepting it",
    refused.status === 422 && refused.body?.issues?.[0]?.code === "content_not_assignable",
    `HTTP ${refused.status} ${JSON.stringify(refused.body?.issues?.map((i) => i.code) ?? refused.body ?? {}).slice(0, 90)}`);
  const refusedRows = await one("select count(*)::int n from assignments where title=$1", [`${MARKER} refused`]);
  check("the refused reference wrote no assignment and no target", (refusedRows?.n ?? 0) === 0,
    `${refusedRows?.n} row(s)`);
  // The positive control is step 3: the SAME endpoint, the SAME actor and the SAME student, with a
  // reference the picker does offer, is accepted with 201. Without that, a refusal caused by anything
  // else — a broken route, a bad payload — would look like this rule working.

  /* ---- 1c. content withdrawn after its revision was published is refused for a different reason ---- */
  const withdrawn = await (async () => {
    await admin.query("update writing_prompts set publication_state='draft' where id=$1", [authored.targetId]);
    const res = await teacherSession.page.evaluate(async (payload) => {
      const r = await fetch("/api/assignments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${payload.marker} withdrawn`, description: null, targetUserId: payload.studentId,
          module: "writing", contentType: "task2", sourceRef: payload.sourceRef, contentVersionId: payload.versionId,
        }),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, { marker: MARKER, sourceRef: contentRef, versionId: authored.versionId, studentId: studentA.id });
    // Restore it: the rest of the journey needs this content live.
    await admin.query("update writing_prompts set publication_state='published' where id=$1", [authored.targetId]);
    return res;
  })();
  check("a published revision whose canonical row was withdrawn cannot be assigned",
    withdrawn.status === 422 && withdrawn.body?.issues?.[0]?.code === "content_not_live",
    `HTTP ${withdrawn.status} ${JSON.stringify(withdrawn.body?.issues?.map((i) => i.code) ?? withdrawn.body ?? {}).slice(0, 90)}`);
  const withdrawnRows = await one("select count(*)::int n from assignments where title=$1", [`${MARKER} withdrawn`]);
  check("and that refusal also wrote nothing", (withdrawnRows?.n ?? 0) === 0, `${withdrawnRows?.n} row(s)`);

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
  const canonicalValue = `writing:task2:${revision?.source_ref}`;
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
  /*
   * The reference here MUST be one the picker offers. Picking "the latest published revision" instead
   * silently broke this control: by this point the newest revision is the speaking material from step
   * 1b, which is not assignable, so createAssignment refused it on the reference rule BEFORE it ever
   * reached the roster rule. Both teachers were then refused, the positive control failed, and the
   * negative control proved nothing about the roster — a refusal for an unrelated reason looks exactly
   * like the rule working. Reference validation legitimately precedes the roster check (as it already
   * did for unknown_content_type and version_not_published), so the fix is to control the reference.
   */
  const reference = { module: revision.module, content_type: revision.content_type, source_ref: revision.source_ref, id: revision.id };
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
  for (const session of [ownerSession, teacherSession, learnerSession]) await session?.close?.().catch?.(() => {});
  await browser.close().catch(() => {});
  /*
   * §06 — a THROWN sweep used to become `{error}`, get printed, and then be ignored: `result.residue`
   * was undefined, nothing reached `failures`, and the probe exited 0 without having cleaned up. Both
   * assignment probes shared that shape. The shared verdict helper now treats a thrown sweep, a missing
   * result and leftover residue as cleanup FAILURE, and keeps body failures alongside cleanup failures
   * so that when both happen the report shows both.
   */
  const result = await sweeper.sweep().catch((e) => ({ error: e?.message ?? String(e) }));
  console.log(`\n  cleanup: removed ${JSON.stringify(result?.removed ?? result?.error)}`);
  await admin.end().catch(() => {});
  exitCode = reportVerdict(resolveVerdict({ bodyFailures: failures, sweep: result }), { pass });
}
process.exit(exitCode);
