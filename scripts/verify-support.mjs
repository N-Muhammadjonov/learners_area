#!/usr/bin/env node
/**
 * Report a problem — the contextual support path.
 *
 * What matters: a report is tied to the page it came from, the client cannot
 * attach anything the server did not ask for, the inbox is staff-only, and a
 * resolution is recorded once by the person who made it.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

/*
 * QA SAFETY (section 03.4). This probe mutates and did not clean up after itself.
 * It files a real problem report, which stayed in the staff inbox after the run.
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
  assertMutableDatabase(SWEEP_DB_URL, { probe: "verify-support" });
  const sweepClient = new (await import("pg")).default.Client({ connectionString: SWEEP_DB_URL });
  await sweepClient.connect();
  const sweeper = createRowSweeper({
    client: sweepClient,
    probe: "verify-support",
    tables: ["problem_reports", "audit_log"],
  });
  finalSweep = installSweepHandlers(sweeper, {
    probe: "verify-support",
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

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`ok   - ${name}`);
  } else {
    failures.push(name);
    console.log(`not ok - ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path, { method = "GET", cookie, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json };
}

async function page(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: res.status, text: await res.text(), location: res.headers.get("location") };
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

console.log(`\nLearners Area — Report a problem against ${BASE}\n`);

const { default: pg } = await import("pg");
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});
await db.connect();

const studentCookie = await login("demo.student@learnersarea.uz", "Student12345!");
const teacherCookie = await login("teacher@learnersarea.uz", "Teacher12345!");
check("the student can sign in", Boolean(studentCookie));
check("the teacher can sign in", Boolean(teacherCookie));

/*
 * REACHABILITY, measured for what it actually is.
 *
 * These two checks used to grep the dashboard HTML for `data-report-toggle` and
 * `data-report-form`. Both are invisible to server HTML by design and the checks were
 * simply failing:
 *   - on /app the report control lives inside the utilities stack, which is collapsed
 *     until the student opens the launcher, so only `data-utilities-launcher` is
 *     server-rendered;
 *   - `data-report-form` is behind the component's `open` state on EVERY surface, so no
 *     page has ever served it.
 * The product is right and the probe was wrong, so the assertions now measure the
 * entry points that really exist: the launcher in the shell, and the dedicated support
 * page that renders the toggle directly.
 *
 * LIMIT, stated rather than papered over: this proves the control is reachable, not
 * that the expanded form carries the route and module. That is client state and needs
 * a real browser. The contextual payload is proven below at the API level instead —
 * a report is posted with a route and module and read back from the database.
 */
const dashboard = await page("/app", studentCookie);
check("the private shell offers a way to reach the report control",
  dashboard.text.includes("data-utilities-launcher"));
const supportPage = await page("/app/support", studentCookie);
check("the support page renders the report control itself",
  supportPage.text.includes("data-report-toggle"));

const marker = `verification report ${Date.now()}`;
const created = await api("/api/support/reports", {
  method: "POST",
  cookie: studentCookie,
  body: {
    route: "/app/vocabulary?panel=my-words",
    module: "vocabulary",
    message: marker,
    viewport: "430×932",
    // Anything else the client tries to attach must not reach the database.
    token: "super-secret-token",
    password: "hunter2",
    cookie: "learners-area-session=abc",
  },
});
check("a report can be sent", created.status === 200 && Boolean(created.json?.id), created.text.slice(0, 120));

const row = await db.query(
  "select route, module, message, viewport, status from problem_reports where id = $1",
  [created.json?.id]
);
check("the report is stored with the page it came from", row.rows[0]?.route === "/app/vocabulary?panel=my-words");
check("the report is stored open", row.rows[0]?.status === "open");
check("the message is stored as written", row.rows[0]?.message === marker);

const columns = await db.query(
  "select column_name from information_schema.columns where table_name = 'problem_reports'"
);
const columnNames = columns.rows.map((r) => r.column_name);
check(
  "the table has no field for a secret",
  !columnNames.some((name) => /token|password|cookie|secret/i.test(name)),
  columnNames.join(",")
);
const leaked = await db.query(
  "select 1 from problem_reports where message ilike '%super-secret-token%' or route ilike '%super-secret-token%'"
);
check("nothing the client volunteered was stored", leaked.rows.length === 0);

const externalRoute = await api("/api/support/reports", {
  method: "POST",
  cookie: studentCookie,
  body: { route: "https://evil.example.com/steal", module: "app", message: "nope" },
});
check("an external route is refused", externalRoute.status === 400, `status ${externalRoute.status}`);

const short = await api("/api/support/reports", {
  method: "POST",
  cookie: studentCookie,
  body: { route: "/app", module: "app", message: "x" },
});
check("an empty report is refused", short.status === 400, `status ${short.status}`);

const anon = await api("/api/support/reports", {
  method: "POST",
  body: { route: "/app", module: "app", message: "hello there" },
});
check("an anonymous report is refused", anon.status === 401, `status ${anon.status}`);

// The inbox is staff-only, in the API and on the page.
check("a student cannot list reports", (await api("/api/support/reports", { cookie: studentCookie })).status === 403);
const studentInbox = await page("/app/teacher/support", studentCookie);
check(
  "a student cannot open the support inbox page",
  ([307, 302, 404].includes(studentInbox.status) ||
    (studentInbox.status === 200 && studentInbox.text.includes("NEXT_REDIRECT"))) &&
    !studentInbox.text.includes(String(created.json?.id)) && !studentInbox.text.includes(marker),
  `status ${studentInbox.status}`
);

const teacherList = await api("/api/support/reports", { cookie: teacherCookie });
check("a teacher can list reports", teacherList.status === 200 && Array.isArray(teacherList.json?.reports));
check(
  "the report is in the inbox with its reporter",
  (teacherList.json?.reports ?? []).some((r) => r.id === created.json?.id && r.reporterRole === "student")
);

const teacherInbox = await page("/app/teacher/support", teacherCookie);
check("the inbox page renders for staff", teacherInbox.status === 200, `status ${teacherInbox.status}`);
check("the inbox shows the report", teacherInbox.text.includes(String(created.json?.id)));

check("a student cannot resolve a report", (await api(`/api/support/reports/${created.json?.id}`, { method: "PATCH", cookie: studentCookie })).status === 403);
check("an anonymous caller cannot resolve a report", (await api(`/api/support/reports/${created.json?.id}`, { method: "PATCH" })).status === 401);

const resolved = await api(`/api/support/reports/${created.json?.id}`, { method: "PATCH", cookie: teacherCookie });
check("staff can resolve a report", resolved.status === 200 && resolved.json?.status === "resolved");

const again = await api(`/api/support/reports/${created.json?.id}`, { method: "PATCH", cookie: teacherCookie });
check("a resolved report cannot be resolved twice", again.status === 409, `status ${again.status}`);

const resolvedRow = await db.query(
  "select resolved_at, resolved_by_user_id from problem_reports where id = $1",
  [created.json?.id]
);
check(
  "the resolution names who did it and when",
  Boolean(resolvedRow.rows[0]?.resolved_at) && Boolean(resolvedRow.rows[0]?.resolved_by_user_id)
);

const audit = await db.query(
  "select metadata from audit_log where action = 'support.reported' and target_id = $1",
  [created.json?.id]
);
check("the report is in the audit trail", audit.rows.length === 1);

const unknown = await api("/api/support/reports/00000000-0000-0000-0000-000000000000", {
  method: "PATCH",
  cookie: teacherCookie,
});
check("resolving an unknown report is a 404", unknown.status === 404, `status ${unknown.status}`);

await db.end();

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}

// process.exit() skips beforeExit, so the sweep is awaited here on the normal path.
await finalSweep("end of run");
process.exit(failures.length || process.exitCode === 1 ? 1 : 0);
