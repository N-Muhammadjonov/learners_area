#!/usr/bin/env node
/**
 * §7 — Live-class ownership: staff-side IDOR probe with PostgreSQL evidence per row.
 *
 *   node scripts/verify-live-class-ownership.mjs [baseUrl]
 *
 * `live_classes` carries `teacher_user_id`, and POST /api/teacher/live-classes stamps it with the
 * creating teacher, so a class has an owner. PATCH /api/teacher/live-classes/[id] gated on
 * `isStaff(role)` — teacher | admin | owner — and then updated `where id = :id` with no ownership
 * condition, so any teacher could rewrite any other teacher's class: its status, and worse, its
 * `meeting_url`, which is the link learners are given to join. `listAllForTeacher()` has the same
 * shape on the read side: no `where` at all, despite its name.
 *
 * The repository's own role model says which of those is intended: `isStaff` is "anyone who may
 * author or review content in the centre", while `isAdministrator` is "may run centre-wide
 * administration". Centre-wide reach over other teachers' classes is therefore an administrator
 * capability, not a teacher one.
 *
 * Every row records the actor, the action, the expected permission, the actual HTTP response, and
 * the ACTUAL DATABASE EFFECT afterwards — a 403 with a mutated row, or a 200 that changed nothing,
 * is not the same result as a clean refusal, and status-only assertions cannot tell them apart.
 * Positive controls are included so that a fix which simply refuses everything cannot pass.
 */
import { writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is required."); process.exit(2); }

const { assertMutableDatabase, createRowSweeper, installSweepHandlers } = await import("./lib/fixture-safety.mjs");
const { launchBrowser, createSession } = await import("./lib/browser-qa.mjs");
const pg = (await import("pg")).default;
assertMutableDatabase(DATABASE_URL, { probe: "verify-live-class-ownership" });

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0] ?? null;
const all = async (sql, p = []) => (await db.query(sql, p)).rows;

const MARKER = `QA-LIVECLASS-${Date.now().toString(36)}`;
const sweeper = createRowSweeper({
  client: db, probe: "verify-live-class-ownership",
  tables: ["live_class_attendance", "live_classes"],
});
const finalSweep = installSweepHandlers(sweeper, { probe: "verify-live-class-ownership", onDone: () => db.end().catch(() => {}) });
await sweeper.capture();

const rows = [];
let failures = 0;
function row(r) {
  const pass = r.expected === r.actualPermission && r.dbEffect === r.expectedDbEffect;
  rows.push({ ...r, result: pass ? "PASS" : "FAIL" });
  if (!pass) failures++;
  console.log(`    ${pass ? "ok  " : "FAIL"} [${r.actor}] ${r.action} → HTTP ${r.status} · expected=${r.expected} actual=${r.actualPermission} · db: expected=${r.expectedDbEffect} actual=${r.dbEffect}`);
  return pass;
}

const TEACHER_A = ["teacher@learnersarea.uz", "Teacher12345!"];
const TEACHER_B = ["teacher2@learnersarea.uz", "Teacher12345!"];
const ADMIN = ["admin@learnersarea.uz", "Admin12345!"];
const STUDENT = ["demo.student@learnersarea.uz", "Student12345!"];
const HIJACK = "https://hijack.example/meeting";

/** Read the row back so every judgement is made on the database, not on the response body. */
const readClass = (id) => one("select id, teacher_user_id, status, meeting_url, recording_url, title from live_classes where id=$1", [id]);

const browser = await launchBrowser();
let classId = null;
let ownerA = null;
let teacherB = null;
try {
  const a = await createSession(browser, { base: BASE, email: TEACHER_A[0], password: TEACHER_A[1], viewport: 1440, locale: "en" });
  const b = await createSession(browser, { base: BASE, email: TEACHER_B[0], password: TEACHER_B[1], viewport: 1440, locale: "en" });
  const adm = await createSession(browser, { base: BASE, email: ADMIN[0], password: ADMIN[1], viewport: 1440, locale: "en" });
  const stu = await createSession(browser, { base: BASE, email: STUDENT[0], password: STUDENT[1], viewport: 1440, locale: "en" });
  ownerA = await one("select id from users where email=$1", [TEACHER_A[0]]);
  teacherB = await one("select id from users where email=$1", [TEACHER_B[0]]);

  const patch = (session, id, body) => session.page.evaluate(async (p) => {
    const r = await fetch(`/api/teacher/live-classes/${p.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(p.body) });
    return { status: r.status, body: (await r.text()).slice(0, 140) };
  }, { id, body });

  /* ------------------------------------------- setup: A creates a class */
  const created = await a.page.evaluate(async (marker) => {
    const r = await fetch("/api/teacher/live-classes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: `${marker} ownership probe`, topic: "probe",
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 16),
        durationMinutes: 60, meetingUrl: "https://centre.example/room-a",
      }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, MARKER);
  classId = created.body?.id ?? null;
  const createdRow = classId ? await readClass(classId) : null;
  row({
    actor: "TEACHER_A", action: "POST /api/teacher/live-classes (create a class)", status: created.status,
    expected: "allowed", actualPermission: created.status === 200 ? "allowed" : "denied",
    expectedDbEffect: "row owned by A", dbEffect: createdRow?.teacher_user_id === ownerA?.id ? "row owned by A" : `owner=${createdRow?.teacher_user_id ?? "no row"}`,
    note: `id=${String(classId).slice(0, 8)}; meeting_url=${createdRow?.meeting_url}; status=${createdRow?.status}. This is the fixture every later row attacks.`,
  });
  if (!classId) throw new Error("could not create the fixture class — the probe cannot continue");

  /* ----------------------- POSITIVE CONTROL: A may change A's own class */
  let res = await patch(a, classId, { status: "live" });
  let now = await readClass(classId);
  row({
    actor: "TEACHER_A", action: "PATCH own class status=live", status: res.status,
    expected: "allowed", actualPermission: res.status === 200 ? "allowed" : "denied",
    expectedDbEffect: "status=live", dbEffect: `status=${now?.status}`,
    note: "Positive control: if this row fails, the endpoint refuses everyone and the negative controls below prove nothing.",
  });

  /* ------------- NEGATIVE CONTROL: B must not change A's class at all */
  res = await patch(b, classId, { status: "cancelled" });
  now = await readClass(classId);
  row({
    actor: "TEACHER_B", action: "PATCH A's class status=cancelled", status: res.status,
    expected: "denied", actualPermission: res.status === 403 || res.status === 404 ? "denied" : "allowed",
    expectedDbEffect: "status=live", dbEffect: `status=${now?.status}`,
    note: `response body="${res.body.slice(0, 60)}". A teacher cancelling another teacher's class is a centre-wide action.`,
  });

  res = await patch(b, classId, { meetingUrl: HIJACK });
  now = await readClass(classId);
  row({
    actor: "TEACHER_B", action: "PATCH A's class meeting_url to an attacker URL", status: res.status,
    expected: "denied", actualPermission: res.status === 403 || res.status === 404 ? "denied" : "allowed",
    expectedDbEffect: "meeting_url=https://centre.example/room-a",
    dbEffect: `meeting_url=${now?.meeting_url}`,
    note: `The severe case: learners are handed this URL to join, so overwriting it redirects a whole class to an attacker's meeting. body="${res.body.slice(0, 60)}"`,
  });

  res = await patch(b, classId, { recordingUrl: HIJACK });
  now = await readClass(classId);
  row({
    actor: "TEACHER_B", action: "PATCH A's class recording_url", status: res.status,
    expected: "denied", actualPermission: res.status === 403 || res.status === 404 ? "denied" : "allowed",
    expectedDbEffect: "recording_url=NULL", dbEffect: `recording_url=${now?.recording_url ?? "NULL"}`,
    note: `body="${res.body.slice(0, 60)}"`,
  });

  /* ---- POSITIVE CONTROL: an administrator MAY act centre-wide */
  res = await patch(adm, classId, { status: "upcoming" });
  now = await readClass(classId);
  row({
    actor: "ADMIN", action: "PATCH A's class status=upcoming", status: res.status,
    expected: "allowed", actualPermission: res.status === 200 ? "allowed" : "denied",
    expectedDbEffect: "status=upcoming", dbEffect: `status=${now?.status}`,
    note: "Positive control against over-restriction: roles.ts documents isAdministrator as 'may run centre-wide administration', so the fix must not lock admins out of another teacher's class.",
  });

  /* ------------------------- a student is refused by the role gate */
  res = await patch(stu, classId, { status: "cancelled" });
  now = await readClass(classId);
  row({
    actor: "STUDENT", action: "PATCH A's class status=cancelled", status: res.status,
    expected: "denied", actualPermission: res.status === 403 || res.status === 404 ? "denied" : "allowed",
    expectedDbEffect: "status=upcoming", dbEffect: `status=${now?.status}`,
    note: "Already enforced by the isStaff gate; recorded so the matrix shows the whole actor set.",
  });

  /* --------------------------------------------- READ SIDE: the list */
  async function surveyPage(session, actor) {
    const r = await session.goto("/app/teacher/live-classes");
    await new Promise((wait) => setTimeout(wait, 2200));
    const dom = await session.page.evaluate((marker) => {
      const html = document.documentElement.innerHTML;
      const main = document.querySelector("main") ?? document.body;
      return {
        markerPresent: html.includes(marker),
        hijackPresent: html.includes("hijack.example"),
        roomAPresent: html.includes("centre.example/room-a"),
        // Management-only surface: the status controls a learner must never be offered.
        statusControls: main.querySelectorAll("select, form button[type=submit]").length,
        cards: main.querySelectorAll("a[href*='/app/teacher/live-classes/'], .card").length,
        redirected: location.pathname,
      };
    }, MARKER);
    return { status: r.status, ...dom, actor };
  }
  const readA = await surveyPage(a, "TEACHER_A");
  const readB = await surveyPage(b, "TEACHER_B");
  const readAdm = await surveyPage(adm, "ADMIN");
  const readStu = await surveyPage(stu, "STUDENT");
  rows.push({
    actor: "TEACHER_A", action: "GET /app/teacher/live-classes (read side)", status: readA.status,
    expected: "allowed", actualPermission: readA.markerPresent ? "allowed" : "denied",
    expectedDbEffect: "own class listed", dbEffect: readA.markerPresent ? "own class listed" : "own class MISSING",
    result: readA.markerPresent ? "PASS" : "FAIL",
    note: `marker present=${readA.markerPresent}; meeting URL rendered=${readA.roomAPresent}`,
  });
  if (!readA.markerPresent) failures++;
  rows.push({
    actor: "TEACHER_B", action: "GET /app/teacher/live-classes (read side)", status: readB.status,
    expected: "denied", actualPermission: readB.markerPresent ? "allowed" : "denied",
    expectedDbEffect: "A's class not listed", dbEffect: readB.markerPresent ? "A's class LISTED" : "A's class not listed",
    result: !readB.markerPresent ? "PASS" : "FAIL",
    note: `This is the read half of the same defect: listAllForTeacher() had no where clause despite its name. Unlike a learner's dashboard, this page is the management timetable, so another teacher's class must not appear at all. A's meeting URL rendered for B=${readB.roomAPresent}; cards=${readB.cards}`,
  });
  if (readB.markerPresent) failures++;
  rows.push({
    actor: "ADMIN", action: "GET /app/teacher/live-classes (read side)", status: readAdm.status,
    expected: "allowed", actualPermission: readAdm.markerPresent ? "allowed" : "denied",
    expectedDbEffect: "A's class listed (centre-wide)", dbEffect: readAdm.markerPresent ? "A's class listed" : "A's class MISSING",
    result: readAdm.markerPresent ? "PASS" : "FAIL",
    note: "Positive control: an administrator runs centre-wide administration and must still see every class.",
  });
  if (!readAdm.markerPresent) failures++;
  // The learner dashboard is EXPECTED to list upcoming IELTS classes by title and start time
  // (dashboard.ts selects only id/title/scheduledAt), so the marker appearing there after the
  // redirect is the product working. What must not reach a learner is the management page itself or
  // the management-only fields: the meeting URL and the status controls.
  const studentRefused = readStu.redirected !== "/app/teacher/live-classes";
  const studentLeak = readStu.roomAPresent || readStu.hijackPresent;
  rows.push({
    actor: "STUDENT", action: "GET /app/teacher/live-classes (read side)", status: readStu.status,
    expected: "denied", actualPermission: studentRefused ? "denied" : "allowed",
    expectedDbEffect: "redirected, no meeting URL", dbEffect: studentRefused && !studentLeak ? "redirected, no meeting URL" : `redirected=${studentRefused}, meetingUrlLeaked=${studentLeak}`,
    result: studentRefused && !studentLeak ? "PASS" : "FAIL",
    note: `final path=${readStu.redirected}; the class TITLE is present=${readStu.markerPresent}, which is correct — the learner dashboard lists upcoming IELTS classes by title and start time; meeting URL present=${readStu.roomAPresent}; attacker URL present=${readStu.hijackPresent}; status controls offered=${readStu.statusControls}`,
  });
  if (!studentRefused || studentLeak) failures++;

  /* ------- attendee counts: the grouped COUNT must equal the old per-class length ------- */
  /*
   * With an empty attendance table both the old `findMany().length` loop and the new grouped COUNT
   * render 0 for every class, so a passing measurement there proves nothing. Build a 2 / 1 / 0
   * spread across three of A's own classes and compare the rendered numbers with PostgreSQL.
   */
  const students = await all("select id from users where role='student' order by created_at limit 3");
  const seededForA = await all("select id from live_classes where teacher_user_id=$1 and id <> $2 order by scheduled_at limit 2", [ownerA.id, classId]);
  if (students.length >= 3 && seededForA.length >= 1) {
    await db.query("insert into live_class_attendance (live_class_id, user_id, joined_at) values ($1,$2,now()),($1,$3,now())", [classId, students[0].id, students[1].id]);
    await db.query("insert into live_class_attendance (live_class_id, user_id, joined_at) values ($1,$2,now())", [seededForA[0].id, students[2].id]);
  }
  const expectedCounts = new Map(
    (await all("select live_class_id, count(*)::int n from live_class_attendance group by live_class_id")).map((r) => [r.live_class_id, Number(r.n)]),
  );
  await a.goto("/app/listening");
  const countPage = await a.goto("/app/teacher/live-classes");
  await new Promise((wait) => setTimeout(wait, 2200));
  const renderedCounts = await countPage && await a.page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    return Array.from(main.querySelectorAll(".card"))
      .map((card) => {
        const text = card.innerText.replace(/\s+/g, " ");
        const m = text.match(/(\d+)\s+attendee/i);
        const href = card.querySelector("a[href*='/app/teacher/live-classes/']")?.getAttribute("href") ?? "";
        return { count: m ? Number(m[1]) : null, id: (href.match(/live-classes\/([0-9a-f-]{36})/) ?? [])[1] ?? null, text: text.slice(0, 60) };
      })
      .filter((c) => c.count !== null);
  });
  const countMismatches = renderedCounts.filter((c) => c.id && Number(expectedCounts.get(c.id) ?? 0) !== c.count);
  const nonZeroSeen = renderedCounts.filter((c) => c.count > 0).length;
  rows.push({
    actor: "TEACHER_A", action: "attendee counts rendered vs PostgreSQL (grouped COUNT equivalence)", status: countPage.status,
    expected: "allowed", actualPermission: "allowed",
    expectedDbEffect: "rendered counts equal the grouped DB counts",
    dbEffect: countMismatches.length === 0 && nonZeroSeen >= 2
      ? `equal on ${renderedCounts.length} cards, ${nonZeroSeen} non-zero`
      : `mismatches=${countMismatches.length}, non-zero cards=${nonZeroSeen}`,
    result: countMismatches.length === 0 && nonZeroSeen >= 2 ? "PASS" : "FAIL",
    note: `A 2/1/0 attendance spread was built across A's own classes so the equivalence is measured on non-zero data: rendered=${JSON.stringify(renderedCounts.map((c) => c.count))}, database=${JSON.stringify([...expectedCounts.values()])}. Requiring at least two non-zero cards is what stops this row from passing vacuously on an empty table.`,
  });
  if (countMismatches.length !== 0 || nonZeroSeen < 2) failures++;

  /* --------------------- N+1 on the read side, measured not assumed */
  await db.query("select pg_stat_statements_reset()").catch(() => {});
  const beforeQueries = await one("select count(*)::int n, coalesce(sum(calls)::bigint,0)::int calls from pg_stat_statements");
  await a.goto("/app/listening"); // settle
  await surveyPage(a, "TEACHER_A");
  const afterQueries = await one("select coalesce(sum(calls)::bigint,0)::int calls from pg_stat_statements");
  const attendanceQueries = await one(`
    select count(*)::int statements, coalesce(sum(calls)::bigint,0)::int calls
    from pg_stat_statements where query ilike '%live_class_attendance%'`);
  rows.push({
    actor: "TEACHER_A", action: "MEASURED query count for the live-classes page (pg_stat_statements)", status: 200,
    expected: "bounded", actualPermission: "measured",
    expectedDbEffect: "attendance counted in one grouped query",
    dbEffect: `live_class_attendance statements=${attendanceQueries?.statements}, calls=${attendanceQueries?.calls}`,
    result: Number(attendanceQueries?.calls ?? 0) <= 1 ? "PASS" : "FAIL",
    note: `The page loops over every class and runs findMany() on live_class_attendance purely to take .length, so attendance calls scale with the number of classes: ${attendanceQueries?.calls} calls for the classes on the page. Total statement calls during the load=${afterQueries?.calls - (beforeQueries?.calls ?? 0)}.`,
  });
  if (Number(attendanceQueries?.calls ?? 0) > 1) failures++;

  for (const s of [a, b, adm, stu]) await s.close();
} catch (error) {
  console.error("\nPROBE ABORTED:", error?.message ?? error);
  failures++;
} finally {
  await browser.close().catch(() => {});
  try {
    const sweep = await sweeper.sweep();
    if (sweep.removed.length) console.log(`\n  sweeper removed: ${sweep.removed.join(", ")}`);
    if (sweep.residue.length) { console.error(`  RESIDUE: ${sweep.residue.join(", ")}`); failures++; }
    else console.log("  residue: none");
    const left = await db.query("select count(*)::int n from live_classes");
    console.log(`  live_classes after sweep: ${left.rows[0].n}`);
  } catch (error) { console.error("  sweeper failed:", error.message); failures++; }
  await finalSweep("end of run");

  const passed = rows.filter((r) => r.result === "PASS").length;
  const lines = [
    "# §7 Live-class ownership matrix",
    "",
    "`live_classes` carries `teacher_user_id` and the create route stamps it with the acting teacher,",
    "so a class has an owner. The update route gated on `isStaff` (teacher | admin | owner) and then",
    "wrote `where id = :id`, and `listAllForTeacher()` had no `where` at all — so any teacher could",
    "read and rewrite any other teacher's class, including the `meeting_url` learners are handed.",
    "",
    "The repository's own role model settles which behaviour is intended: `isStaff` is \"anyone who may",
    "author or review content in the centre\", while `isAdministrator` is \"may run centre-wide",
    "administration\". Centre-wide reach over other teachers' classes is an administrator capability.",
    "",
    `**${passed} / ${rows.length} rows PASS · ${failures} FAIL.**`,
    "",
    "| actor | action | HTTP | expected | actual | expected DB effect | actual DB effect | result |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.actor} | ${String(r.action).replace(/\|/g, "\\|")} | ${r.status} | ${r.expected} | ${r.actualPermission} | ${String(r.expectedDbEffect).replace(/\|/g, "\\|")} | ${String(r.dbEffect).replace(/\|/g, "\\|")} | ${r.result} |`),
    "",
    "## Notes",
    "",
    ...rows.filter((r) => r.note).map((r) => `- **${r.actor} — ${r.action}**: ${r.note}`),
    "",
  ];
  writeFileSync("docs/LIVE-CLASS-OWNERSHIP.md", `${lines.join("\n")}\n`);
  console.log(`\n${passed}/${rows.length} rows PASS · ${failures} FAIL · docs/LIVE-CLASS-OWNERSHIP.md`);
}
process.exit(failures ? 1 : 0);
