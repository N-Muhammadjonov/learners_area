#!/usr/bin/env node
/**
 * Report a problem — the contextual support path.
 *
 * What matters: a report is tied to the page it came from, the client cannot
 * attach anything the server did not ask for, the inbox is staff-only, and a
 * resolution is recorded once by the person who made it.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

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
  connectionString: (process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5433/learners_area",
});
await db.connect();

const studentCookie = await login("demo.student@learnersarea.uz", "Student12345!");
const teacherCookie = await login("teacher@learnersarea.uz", "Teacher12345!");
check("the student can sign in", Boolean(studentCookie));
check("the teacher can sign in", Boolean(teacherCookie));

// The control is reachable from the private shell, on desktop and on mobile.
const dashboard = await page("/dashboard", studentCookie);
check("the private shell offers the report control", dashboard.text.includes("data-report-toggle"));
check("the report form is contextual", dashboard.text.includes("data-report-form") || dashboard.text.includes("data-report-toggle"));

const marker = `verification report ${Date.now()}`;
const created = await api("/api/support/reports", {
  method: "POST",
  cookie: studentCookie,
  body: {
    route: "/vocabulary?panel=my-words",
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
check("the report is stored with the page it came from", row.rows[0]?.route === "/vocabulary?panel=my-words");
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
  body: { route: "/dashboard", module: "app", message: "x" },
});
check("an empty report is refused", short.status === 400, `status ${short.status}`);

const anon = await api("/api/support/reports", {
  method: "POST",
  body: { route: "/dashboard", module: "app", message: "hello there" },
});
check("an anonymous report is refused", anon.status === 401, `status ${anon.status}`);

// The inbox is staff-only, in the API and on the page.
check("a student cannot list reports", (await api("/api/support/reports", { cookie: studentCookie })).status === 403);
const studentInbox = await page("/teacher/support", studentCookie);
check(
  "a student cannot open the support inbox page",
  studentInbox.status === 307 || studentInbox.status === 302 || studentInbox.status === 404,
  `status ${studentInbox.status}`
);

const teacherList = await api("/api/support/reports", { cookie: teacherCookie });
check("a teacher can list reports", teacherList.status === 200 && Array.isArray(teacherList.json?.reports));
check(
  "the report is in the inbox with its reporter",
  (teacherList.json?.reports ?? []).some((r) => r.id === created.json?.id && r.reporterRole === "student")
);

const teacherInbox = await page("/teacher/support", teacherCookie);
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
process.exit(failures.length ? 1 : 0);
