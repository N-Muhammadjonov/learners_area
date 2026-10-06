// RIWI Reporter (owner override 2026-10-03): explicit-timezone windows, owner /
// teacher / student scopes with IDOR protection, ONE canonical snapshot with
// per-number provenance, six export formats rendered from that snapshot, audit trail,
// and no AI anywhere in the number path.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { sql } from "drizzle-orm";
import { resolvePeriod } from "../src/lib/reporter/period";
import { ADMIN_REPORT_POLICY, allowedScopes, authorizeReport, type Actor, type RosterCheck, type SubjectLookup } from "../src/lib/reporter/access";
import { isOnRoster, listRoster, setRosterLink } from "../src/lib/reporter/roster";
import { buildReportSnapshot, compileMetricSql, snapshotSha256, validateNarrative, type ReportSnapshot } from "../src/lib/reporter/snapshot";
import { bytesSha256, renderCsv, renderDocx, renderJson, renderPdf, renderXlsx, renderZip, safeCell } from "../src/lib/reporter/exports";
import { generateReport } from "../src/lib/reporter/service";
import { createTestDatabase, type TestDatabase } from "./support/pglite";

// ---------------------------------------------------------------- windows
test("RP1 periods are last COMPLETED periods in the centre timezone, half-open, reproducible", () => {
  const wed = new Date("2026-10-07T09:00:00Z"); // Wednesday 14:00 local
  const weekly = resolvePeriod("weekly", wed);
  assert.ok(weekly.ok);
  if (!weekly.ok) return;
  assert.equal(weekly.window.fromDate, "2026-09-28");
  assert.equal(weekly.window.toDate, "2026-10-04");
  assert.equal(weekly.window.from, "2026-09-27T19:00:00.000Z", "local midnight (+05:00)");
  assert.equal(weekly.window.to, "2026-10-04T19:00:00.000Z");
  assert.equal(weekly.window.timezone, "Asia/Tashkent");
  // Local date differs from UTC date just after local midnight.
  const lateUtc = resolvePeriod("monthly", new Date("2026-01-31T20:30:00Z")); // 1 Feb 01:30 local
  assert.ok(lateUtc.ok && lateUtc.window.fromDate === "2026-01-01" && lateUtc.window.toDate === "2026-01-31");
  const jan = resolvePeriod("monthly", new Date("2026-01-15T00:00:00Z"));
  assert.ok(jan.ok && jan.window.fromDate === "2025-12-01" && jan.window.toDate === "2025-12-31");
  const yearly = resolvePeriod("yearly", wed);
  assert.ok(yearly.ok && yearly.window.fromDate === "2025-01-01" && yearly.window.toDate === "2025-12-31");
  const onDemand = resolvePeriod("on_demand", wed);
  assert.ok(onDemand.ok && onDemand.window.to === wed.toISOString() && onDemand.window.fromDate === "2026-09-08");
  assert.deepEqual(resolvePeriod("weekly", wed), weekly, "same request → same window");
});

test("RP2 custom ranges are validated: real dates, ordered, ≤366 days, not in the future", () => {
  const now = new Date("2026-10-07T09:00:00Z");
  const r = (from: string, to: string) => resolvePeriod("custom", now, { from, to });
  assert.ok(r("2026-09-01", "2026-09-30").ok);
  assert.deepEqual(r("2026-02-30", "2026-03-01"), { ok: false, error: "invalid_date" });
  assert.deepEqual(r("x", "2026-03-01"), { ok: false, error: "invalid_date" });
  assert.deepEqual(r("2026-09-30", "2026-09-01"), { ok: false, error: "range_reversed" });
  assert.deepEqual(r("2026-10-01", "2026-10-08"), { ok: false, error: "range_in_future" });
  assert.deepEqual(r("2025-01-01", "2026-01-02"), { ok: false, error: "range_too_long" });
  assert.ok(r("2025-10-07", "2026-10-07").ok, "366 days inclusive is allowed");
});

// ---------------------------------------------------------------- access / IDOR
const S1 = "aaaaaaaa-0000-4000-8000-000000000001";
const S2 = "aaaaaaaa-0000-4000-8000-000000000002";
const TCH = "aaaaaaaa-0000-4000-8000-000000000003";
const OWN = "aaaaaaaa-0000-4000-8000-000000000004";
const people: Record<string, { id: string; role: Actor["role"]; name: string }> = {
  [S1]: { id: S1, role: "student", name: "Student One" },
  [S2]: { id: S2, role: "student", name: "=HYPERLINK(\"http://x\")" },
  [TCH]: { id: TCH, role: "teacher", name: "Teacher" },
  [OWN]: { id: OWN, role: "owner", name: "Owner" },
};
const lookup: SubjectLookup = async (id) => people[id] ?? null;

test("RP3 access matrix: students only see themselves; staff cannot reach owner scope; unknown, non-student or malformed subjects are 404", async () => {
  const student = people[S1]!, teacher = people[TCH]!, owner = people[OWN]!;
  const admin = { ...teacher, role: "admin" as const };
  assert.deepEqual(await authorizeReport(student, { scope: "owner" }, lookup), { ok: false, status: 403 });
  assert.deepEqual(await authorizeReport(student, { scope: "teacher" }, lookup), { ok: false, status: 403 });
  assert.deepEqual(await authorizeReport(student, { scope: "student", subjectId: S2 }, lookup), { ok: false, status: 404 }, "IDOR");
  const self = await authorizeReport(student, { scope: "student" }, lookup);
  assert.ok(self.ok && self.scope.kind === "student" && self.scope.subjectId === S1);
  assert.deepEqual(await authorizeReport(teacher, { scope: "owner" }, lookup), { ok: false, status: 403 });
  assert.deepEqual(await authorizeReport(admin, { scope: "owner" }, lookup), { ok: false, status: 403 });
  assert.deepEqual(await authorizeReport(teacher, { scope: "student", subjectId: OWN }, lookup), { ok: false, status: 404 }, "non-student subject");
  assert.deepEqual(await authorizeReport(teacher, { scope: "student", subjectId: "aaaaaaaa-0000-4000-8000-00000000ffff" }, lookup), { ok: false, status: 404 });
  assert.deepEqual(await authorizeReport(teacher, { scope: "student", subjectId: "1 or 1=1" }, lookup), { ok: false, status: 404 });
  // Corrected 2026-10-03 (§9): a teacher no longer reaches an arbitrary student.
  // Admin keeps any-student reach by its explicit policy; an unrostered teacher gets 404.
  assert.ok((await authorizeReport(admin, { scope: "student", subjectId: S2 }, lookup)).ok);
  assert.deepEqual(await authorizeReport(teacher, { scope: "student", subjectId: S2 }, lookup), { ok: false, status: 404 }, "no roster → indistinguishable from missing");
  for (const scope of ["owner", "teacher", "student"] as const) {
    assert.ok((await authorizeReport(owner, { scope, subjectId: S1 }, lookup)).ok, scope);
  }
});

// ---------------------------------------------------------------- snapshot on a real schema
let database: TestDatabase;
const NOW = new Date("2026-10-07T09:00:00Z");
const IN = "2026-09-30T08:00:00Z"; // inside last full week (2026-09-28..2026-10-04)
const OUT = "2026-09-20T08:00:00Z";

before(async () => {
  database = await createTestDatabase();
  for (const p of Object.values(people)) {
    await database.query(`insert into users (id, email, name, role, account_status, created_at) values ($1, $2, $3, $4, 'active', '2026-01-01')`, [p.id, `${p.id}@example.test`, p.name, p.role]);
  }
  const [passage] = await database.query<{ id: string }>(`insert into reading_passages (title, body_text) values ('RP', 'body') returning id`);
  const attempt = (user: string, at: string, score: number, total: number) =>
    database.query(`insert into reading_attempts (user_id, passage_id, status, score, total_questions, started_at, submitted_at) values ($1, $2, 'completed', $3, $4, $5, $5)`, [user, passage!.id, score, total, at]);
  await attempt(S1, IN, 8, 10);
  await attempt(S1, IN, 6, 10);
  await attempt(S2, IN, 1, 10);
  await attempt(S1, OUT, 0, 10); // outside window
  await attempt(TCH, IN, 10, 10); // staff activity is not learner activity
  for (const [user, at] of [[S1, IN], [S2, IN], [S2, OUT], [TCH, IN]] as const) {
    await database.query(`insert into activity_events (user_id, type, created_at) values ($1, 'reading.submitted', $2)`, [user, at]);
  }
  await database.query(`insert into problem_reports (user_id, route, module, message, created_at) values ($1, '/x', 'reading', 'm', $2)`, [S1, IN]);
});
after(async () => { await database.close(); });

const week = () => { const p = resolvePeriod("weekly", NOW); if (!p.ok) throw new Error("period"); return p.window; };
const metric = (s: ReportSnapshot, key: string) => s.metrics.find((m) => m.key === key);

test("RP4 numbers come from SQL over the window and scope; empty = null, never a silent 0", async () => {
  const actor = { userId: OWN, role: "owner" };
  const owner = await buildReportSnapshot(database.db, { scope: { kind: "owner" }, period: week(), actor, now: NOW });
  assert.equal(metric(owner, "reading.completed")!.value, 3, "students only, window only");
  assert.equal(metric(owner, "reading.accuracy")!.value, 15 / 30);
  assert.equal(metric(owner, "learners.active")!.value, 2);
  assert.equal(metric(owner, "operations.problemReports")!.value, 1);
  assert.equal(metric(owner, "people.students")!.value, 2);
  assert.equal(metric(owner, "writing.band")!.value, null, "no data → null");

  const self = await buildReportSnapshot(database.db, { scope: { kind: "student", subjectId: S1, subjectName: "Student One" }, period: week(), actor: { userId: S1, role: "student" }, now: NOW });
  assert.equal(metric(self, "reading.completed")!.value, 2, "only the subject's rows");
  assert.equal(metric(self, "reading.accuracy")!.value, 0.7);
  assert.ok(!self.metrics.some((m) => m.section === "operations" || m.section === "people"), "a student report has no centre data");

  const teacher = await buildReportSnapshot(database.db, { scope: { kind: "teacher", teacherId: null }, period: week(), actor: { userId: TCH, role: "admin" }, now: NOW });
  assert.ok(!teacher.metrics.some((m) => m.section === "operations"), "provider provenance and support data are owner-only");
});

test("RP5 every number carries its exact source query, window, scope and generatedAt — and re-running the recorded query reproduces it", async () => {
  const s = await buildReportSnapshot(database.db, { scope: { kind: "student", subjectId: S1, subjectName: "x" }, period: week(), actor: { userId: S1, role: "student" }, now: NOW });
  for (const m of s.metrics) {
    assert.match(m.source.queryId, /^riwi\./);
    assert.ok(m.source.sql.startsWith("select "), m.key);
    assert.ok(!m.source.sql.includes("{{"), "no unexpanded macros");
    assert.equal(m.window.from, s.period.from);
    assert.equal(m.window.to, s.period.to);
    assert.equal(m.scope, `student:${S1}`);
    assert.equal(m.generatedAt, NOW.toISOString());
    const again = await database.db.execute(compileMetricSql(m.source.sql, { from: new Date(m.source.parameters.from!), to: new Date(m.source.parameters.to!), subject: m.source.parameters.subject ?? null })) as unknown as { rows: Array<{ v: unknown }> };
    const v = again.rows[0]?.v;
    assert.equal(v === null || v === undefined ? null : Number(v), m.value, m.key);
  }
  assert.ok(s.narrative.en.length > 0 && s.narrative.uz.length > 0);
  assert.ok(!/[\u0400-\u04FF]/.test(s.narrative.uz.join(" ")), "Uzbek Latin only");
});

// ---------------------------------------------------------------- exports
async function sample(): Promise<ReportSnapshot> {
  return buildReportSnapshot(database.db, { scope: { kind: "student", subjectId: S2, subjectName: people[S2]!.name }, period: week(), actor: { userId: OWN, role: "owner" }, now: NOW, reportId: "11111111-1111-4111-8111-111111111111" });
}

test("RP6 every format renders the same snapshot; spreadsheet formula injection is neutralised", async () => {
  const s = await sample();
  assert.deepEqual(JSON.parse(strFromU8(renderJson(s))), s);
  const csv = strFromU8(renderCsv(s, "en"));
  assert.ok(!/(^|,)"?[=+@]/m.test(csv), "no CSV cell begins with a formula trigger");
  assert.ok(csv.includes("=HYPERLINK"), "the name itself is preserved as inert text");
  assert.ok(csv.includes(s.reportId) && csv.includes(snapshotSha256(s)));
  assert.equal(safeCell("-0.5"), "-0.5", "plain negative numbers are not mangled");
  assert.equal(safeCell("@SUM(A1)"), "'@SUM(A1)");

  const xlsx = unzipSync(renderXlsx(s, "uz"));
  const sheet = strFromU8(xlsx["xl/worksheets/sheet1.xml"]!);
  assert.ok(sheet.includes("=HYPERLINK(&quot;http://x&quot;)") && sheet.includes('t="inlineStr"'));
  assert.ok(!sheet.includes("<f>"), "no formulas are ever written");
  assert.ok(xlsx["xl/worksheets/sheet2.xml"] && strFromU8(xlsx["xl/worksheets/sheet2.xml"]).includes("reading_attempts"), "sources sheet carries the SQL");

  const doc = strFromU8(unzipSync(renderDocx(s, "uz"))["word/document.xml"]!);
  assert.ok(doc.includes("=HYPERLINK(&quot;http://x&quot;)"), "escaped, inert text");
  assert.ok(doc.includes("RIWI hisoboti"));

  const pdf = Buffer.from(renderPdf(s, "en")).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4") && pdf.trimEnd().endsWith("%%EOF"));
  const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]);
  assert.ok(pdf.slice(xrefAt).startsWith("xref"), "startxref points at the xref table");
  const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(pdf.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`));
  assert.ok(pdf.includes(s.reportId));
  const uz = { ...s, scope: { kind: "student" as const, subjectId: S2, subjectName: "O\u2018g\u2019il (test) \u2014 ok" } };
  assert.ok(Buffer.from(renderPdf(uz, "uz")).toString("latin1").includes("O'g'il \\(test\\) - ok"), "Uzbek apostrophes map to ASCII; parentheses escaped");
});

test("RP7 ZIP bundle: every format plus a manifest whose hashes match the files and the snapshot", async () => {
  const s = await sample();
  const files = unzipSync(renderZip(s, "en"));
  assert.deepEqual(Object.keys(files).sort(), ["manifest.json", "report.csv", "report.docx", "report.json", "report.pdf", "report.xlsx"]);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
  assert.equal(manifest.reportId, s.reportId);
  assert.equal(manifest.snapshotSha256, snapshotSha256(s));
  assert.equal(manifest.timezone, "Asia/Tashkent");
  for (const f of manifest.files) assert.equal(bytesSha256(files[f.name]!), f.sha256, f.name);
  assert.deepEqual(JSON.parse(strFromU8(files["report.json"]!)), s, "the bundle's JSON is the canonical snapshot");
});

// ---------------------------------------------------------------- service: audit + IDOR end-to-end
test("RP8 generateReport audits generation and download (hash, never contents); refused requests write nothing", async () => {
  const count = async () => (await database.query<{ n: number }>(`select count(*)::int as n from audit_log where action like 'report.%'`))[0]!.n;
  const before = await count();
  const denied = await generateReport(people[S1]!, { scope: "student", subject: S2, period: "weekly", format: "pdf" }, { database: database.db, lookup, now: () => NOW });
  assert.deepEqual(denied, { ok: false, status: 404, code: "not_found" });
  assert.deepEqual(await generateReport(people[S1]!, { scope: "owner", period: "weekly", format: "pdf" }, { database: database.db, lookup, now: () => NOW }), { ok: false, status: 403, code: "forbidden" });
  assert.equal((await generateReport(people[S1]!, { scope: "student", period: "weekly", format: "exe" }, { database: database.db, lookup, now: () => NOW })).ok, false);
  assert.equal((await generateReport(people[S1]!, { scope: "student", period: "weekly", format: "pdf", extra: 1 }, { database: database.db, lookup, now: () => NOW })).ok, false, "strict input");
  assert.equal(await count(), before, "no audit rows for refused requests");

  const ok = await generateReport(people[S1]!, { scope: "student", period: "weekly", format: "csv", lang: "en" }, { database: database.db, lookup, now: () => NOW });
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.snapshot.scope.kind === "student" && ok.snapshot.scope.subjectId, S1);
  assert.equal(ok.contentType, "text/csv; charset=utf-8");
  const rows = await database.query<{ action: string; actor_user_id: string; metadata: Record<string, unknown> }>(`select action, actor_user_id, metadata from audit_log where action like 'report.%' order by created_at, action desc`);
  const downloaded = rows.find((r) => r.action === "report.downloaded")!;
  assert.equal(downloaded.actor_user_id, S1);
  assert.equal(downloaded.metadata.sha256, bytesSha256(ok.bytes));
  assert.equal(downloaded.metadata.reportId, ok.snapshot.reportId);
  assert.ok(rows.some((r) => r.action === "report.generated" && r.metadata.snapshotSha256 === snapshotSha256(ok.snapshot)));
  assert.ok(!JSON.stringify(rows).includes("Student One"), "audit holds identifiers and hashes, not report contents");
});

test("RP9 an optional AI narrative may only restate snapshot numbers; links, markup and invented numbers are refused", async () => {
  const s = await sample();
  const completed = String(s.metrics.find((m) => m.key === "reading.completed")!.value);
  assert.deepEqual(validateNarrative(`This learner completed ${completed} reading attempts.`, s), { ok: true });
  assert.deepEqual(validateNarrative("This learner completed 97 reading attempts.", s), { ok: false, reason: "unknown_number" });
  assert.deepEqual(validateNarrative("See https://evil.example", s), { ok: false, reason: "forbidden_content" });
  assert.deepEqual(validateNarrative("<script>x</script>", s), { ok: false, reason: "forbidden_content" });
  assert.deepEqual(validateNarrative("", s), { ok: false, reason: "length" });
});

test("RP10 structure: separate private route (not /api/support/reports), DB-backed auth, no AI import in the number path, no-store downloads", () => {
  const route = readFileSync("src/app/api/reports/route.ts", "utf8");
  assert.match(route, /requireActiveUser\(\)/);
  assert.match(route, /private, no-store/);
  assert.match(route, /attachment; filename=/);
  for (const file of readdirSync("src/lib/reporter")) {
    const src = readFileSync(`src/lib/reporter/${file}`, "utf8");
    assert.doesNotMatch(src, /services\/coach|openai|anthropic|resolveEvaluation/i, `${file} must not call AI`);
  }
  const support = readFileSync("src/app/api/support/reports/route.ts", "utf8");
  assert.doesNotMatch(support, /reporter/);
});

test("RP11 the recorded query binds the subject as a parameter (no string interpolation of ids)", () => {
  const compiled = compileMetricSql("select 1 as v from users where user_id = :subject and created_at >= :from", { from: NOW, to: NOW, subject: S1 });
  const rendered = database.db.execute(sql`select 1`); // touch the driver type
  void rendered;
  const text = JSON.stringify(compiled);
  assert.ok(!text.includes(`'${S1}'`), "id is a bound parameter, not inlined SQL");
  assert.throws(() => compileMetricSql("select :subject", { from: NOW, to: NOW, subject: null }));
});

test("RP12 Grammar and video metrics are included; audit records AI-narrative provenance (none used); file names are fixed-pattern", async () => {
  const s = await sample();
  for (const key of ["grammar.attempts", "grammar.accuracy", "video.completed"]) assert.ok(metric(s, key), key);
  const ok = await generateReport(people[OWN]!, { scope: "owner", period: "weekly", format: "zip" }, { database: database.db, lookup, now: () => NOW });
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.match(ok.fileName, /^riwi-report-owner-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.zip$/);
  for (const name of Object.keys(unzipSync(ok.bytes))) assert.match(name, /^[a-z]+\.[a-z]+$/, "no paths inside the bundle");
  const [row] = await database.query<{ metadata: { aiNarrative: { used: boolean }; filters: unknown; schemaVersion: string } }>(`select metadata from audit_log where action = 'report.generated' order by created_at desc limit 1`);
  assert.equal(row!.metadata.aiNarrative.used, false);
  assert.equal(row!.metadata.schemaVersion, "riwi-report/1");
});

// ---------------------------------------------------------------- §9 explicit teacher roster
const TCH2 = "aaaaaaaa-0000-4000-8000-000000000005";
const ADM = "aaaaaaaa-0000-4000-8000-000000000006";

test("RP13 role matrix is explicit: admin policy is declared, teacher reach is roster-only, roster failure fails closed", async () => {
  const teacher = people[TCH]!, admin = { id: ADM, role: "admin" as const, name: "Admin" };
  assert.deepEqual(ADMIN_REPORT_POLICY, { ownerScope: false, cohort: "all_students", student: "any_student" });
  assert.deepEqual(allowedScopes("owner"), ["owner", "teacher", "student"]);
  assert.deepEqual(allowedScopes("admin"), ["teacher", "student"]);
  assert.deepEqual(allowedScopes("teacher"), ["teacher", "student"]);
  assert.deepEqual(allowedScopes("student"), ["student"]);
  const roster: RosterCheck = async (t, s) => t === TCH && s === S1;
  // Teacher: cohort is ALWAYS their own roster, never all students.
  assert.deepEqual(await authorizeReport(teacher, { scope: "teacher" }, lookup, roster), { ok: true, scope: { kind: "teacher", teacherId: TCH } });
  assert.ok((await authorizeReport(teacher, { scope: "student", subjectId: S1 }, lookup, roster)).ok, "rostered student");
  assert.deepEqual(await authorizeReport(teacher, { scope: "student", subjectId: S2 }, lookup, roster), { ok: false, status: 404 }, "unrostered = 404");
  assert.deepEqual(await authorizeReport(teacher, { scope: "student", subjectId: "aaaaaaaa-0000-4000-8000-00000000ffff" }, lookup, roster), { ok: false, status: 404 }, "missing = same 404");
  assert.deepEqual(await authorizeReport(teacher, { scope: "student", subjectId: S1 }, lookup), { ok: false, status: 404 }, "no roster check wired → fail closed");
  assert.deepEqual(await authorizeReport(teacher, { scope: "student", subjectId: S1 }, lookup, async () => { throw new Error("db down"); }), { ok: false, status: 404 }, "roster error → fail closed");
  // Admin: explicit all-students cohort, any student, never owner scope; roster irrelevant.
  assert.deepEqual(await authorizeReport(admin, { scope: "teacher" }, lookup, roster), { ok: true, scope: { kind: "teacher", teacherId: null } });
  assert.ok((await authorizeReport(admin, { scope: "student", subjectId: S2 }, lookup, async () => false)).ok);
  assert.deepEqual(await authorizeReport(admin, { scope: "owner" }, lookup), { ok: false, status: 403 });
});

test("RP14 teacher snapshot numbers cover ONLY explicitly linked students (real schema)", async () => {
  await database.query(`insert into users (id, email, name, role, account_status, created_at) values ($1, $2, 'Teacher Two', 'teacher', 'active', '2026-01-01') on conflict do nothing`, [TCH2, `${TCH2}@example.test`]);
  await database.query(`delete from teacher_student_links`);
  // Roster of TCH = {S2}. Weak signals (an assignment from TCH to S1) must NOT grant reach.
  // The link's own moment is part of the answer: the report's `people.assigned` is an
  // as-of-end count (`created_at < window end`), so a fixture that lets the database clock
  // decide makes this test pass only while the wall clock happens to be before the pinned
  // window — which is how it rotted. The moment is written explicitly.
  await database.query(`insert into teacher_student_links (teacher_user_id, student_user_id, created_at) values ($1, $2, $3)`, [TCH, S2, IN]);
  await database.query(`insert into assignments (title, created_by_user_id, target_user_id) values ('weak', $1, $2)`, [TCH, S1]);
  const mine = await buildReportSnapshot(database.db, { scope: { kind: "teacher", teacherId: TCH }, period: week(), actor: { userId: TCH, role: "teacher" }, now: NOW });
  assert.equal(metric(mine, "reading.completed")!.value, 1, "only S2's attempt");
  assert.equal(metric(mine, "reading.accuracy")!.value, 0.1);
  assert.equal(metric(mine, "people.assigned")!.value, 1);
  assert.equal(metric(mine, "people.students"), undefined, "centre head-count is not in a teacher report");
  assert.ok(!mine.metrics.some((m) => m.section === "operations"));
  assert.equal(mine.metrics[0]!.scope, `teacher:${TCH}:assigned`);
  assert.equal(metric(mine, "reading.completed")!.source.parameters.teacher, TCH, "provenance records the roster owner");
  const empty = await buildReportSnapshot(database.db, { scope: { kind: "teacher", teacherId: TCH2 }, period: week(), actor: { userId: TCH2, role: "teacher" }, now: NOW });
  assert.equal(metric(empty, "reading.completed")!.value, 0, "no roster → zero learners, not the whole centre");
  assert.equal(metric(empty, "learners.active")!.value, 0);
  const cohort = await buildReportSnapshot(database.db, { scope: { kind: "teacher", teacherId: null }, period: week(), actor: { userId: ADM, role: "admin" }, now: NOW });
  assert.equal(metric(cohort, "reading.completed")!.value, 3, "admin cohort still covers all students");
  // A staff account linked by hand (bypassing setRosterLink) never counts as a learner.
  await database.query(`insert into teacher_student_links (teacher_user_id, student_user_id, created_at) values ($1, $2, $3)`, [TCH2, OWN, IN]);
  const staffLinked = await buildReportSnapshot(database.db, { scope: { kind: "teacher", teacherId: TCH2 }, period: week(), actor: { userId: TCH2, role: "teacher" }, now: NOW });
  assert.equal(metric(staffLinked, "people.assigned")!.value, 0);
  assert.equal(await isOnRoster(TCH2, OWN, database.db), false, "role filter applies to the roster check too");
  await database.query(`delete from teacher_student_links where teacher_user_id = $1`, [TCH2]);
});

test("RP15 teacher IDOR through generateReport: rostered → file; unrostered and missing → identical 404; audit stores ids only", async () => {
  await database.query(`delete from teacher_student_links`);
  await database.query(`insert into teacher_student_links (teacher_user_id, student_user_id, created_at) values ($1, $2, $3)`, [TCH, S2, IN]);
  const deps = { database: database.db, lookup, now: () => NOW }; // default roster check runs real SQL
  const ok = await generateReport(people[TCH]!, { scope: "student", subject: S2, period: "weekly", format: "json" }, deps);
  assert.ok(ok.ok);
  const denied = await generateReport(people[TCH]!, { scope: "student", subject: S1, period: "weekly", format: "json" }, deps);
  const missing = await generateReport(people[TCH]!, { scope: "student", subject: "aaaaaaaa-0000-4000-8000-00000000ffff", period: "weekly", format: "json" }, deps);
  assert.deepEqual(denied, { ok: false, status: 404, code: "not_found" });
  assert.deepEqual(missing, denied, "unauthorised and missing are indistinguishable");
  const cohort = await generateReport(people[TCH]!, { scope: "teacher", period: "weekly", format: "json" }, deps);
  assert.ok(cohort.ok && cohort.snapshot.scope.kind === "teacher" && cohort.snapshot.scope.teacherId === TCH, "teacher cohort request is forced to own roster");
  const [audit] = await database.query<{ metadata: Record<string, unknown> }>(`select metadata from audit_log where action = 'report.generated' order by created_at desc limit 1`);
  const filters = audit!.metadata.filters as Record<string, unknown>;
  assert.equal(filters.roster, TCH);
  assert.ok(!JSON.stringify(audit!.metadata).includes("Student Two"), "no report contents / names in audit");
});

test("RP16 roster changes: owner/admin only, teacher→student roles enforced, idempotent, audited", async () => {
  await database.query(`insert into users (id, email, name, role, account_status, created_at) values ($1, $2, 'Admin', 'admin', 'active', '2026-01-01') on conflict do nothing`, [ADM, `${ADM}@example.test`]);
  await database.query(`delete from teacher_student_links`);
  const admin = { id: ADM, role: "admin" as const };
  assert.deepEqual(await setRosterLink({ id: TCH, role: "teacher" }, { teacherId: TCH, studentId: S1, assigned: true }, database.db), { ok: false, status: 403, code: "forbidden" }, "a teacher cannot grow their own roster");
  assert.deepEqual(await setRosterLink({ id: S1, role: "student" }, { teacherId: TCH, studentId: S1, assigned: true }, database.db), { ok: false, status: 403, code: "forbidden" });
  assert.deepEqual(await setRosterLink(admin, { teacherId: TCH, studentId: "x", assigned: true }, database.db), { ok: false, status: 400, code: "invalid_input" });
  assert.deepEqual(await setRosterLink(admin, { teacherId: TCH, studentId: OWN, assigned: true }, database.db), { ok: false, status: 404, code: "not_found" }, "staff cannot be rostered");
  assert.deepEqual(await setRosterLink(admin, { teacherId: S2, studentId: S1, assigned: true }, database.db), { ok: false, status: 404, code: "not_found" }, "a student is not a teacher");
  assert.deepEqual(await setRosterLink(admin, { teacherId: TCH, studentId: S1, assigned: true }, database.db), { ok: true, changed: true });
  assert.deepEqual(await setRosterLink(admin, { teacherId: TCH, studentId: S1, assigned: true }, database.db), { ok: true, changed: false }, "idempotent");
  assert.deepEqual((await listRoster(TCH, database.db)).map((s) => s.id), [S1]);
  assert.equal(await isOnRoster(TCH, S1, database.db), true);
  assert.deepEqual(await setRosterLink({ id: OWN, role: "owner" }, { teacherId: TCH, studentId: S1, assigned: false }, database.db), { ok: true, changed: true });
  assert.equal(await isOnRoster(TCH, S1, database.db), false);
  const rows = await database.query<{ action: string; metadata: Record<string, unknown> }>(`select action, metadata from audit_log where action like 'roster.%' order by created_at`);
  assert.deepEqual(rows.map((r) => r.action), ["roster.assigned", "roster.unassigned"], "only real changes are audited");
  assert.deepEqual(rows[0]!.metadata, { teacherId: TCH, studentId: S1 });
});

test("RP17 migration 0035 is additive and journalled directly after 0034", () => {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string }[] };
  const last = journal.entries.find(entry => entry.idx === 35)!;
  assert.deepEqual([last.idx, last.tag], [35, "0035_teacher_student_links"]);
  assert.equal(journal.entries.find(entry => entry.idx === 34)!.tag, "0034_typing_duration_presets");
  const text = readFileSync("drizzle/0035_teacher_student_links.sql", "utf8").replace(/--.*$/gm, "");
  const statements = text.split(/;|--> statement-breakpoint/).map((x) => x.trim()).filter(Boolean);
  for (const st of statements) assert.match(st, /^create (table|unique index|index) if not exists /i, "only additive CREATE statements");
  assert.match(text, /create table if not exists teacher_student_links/i);
});

test("RP18 the student-name filter matches typed text literally (LIKE wildcards escaped) on a real database", async () => {
  const { escapeLike } = await import("../src/lib/validation/like");
  const ids = ["aaaaaaaa-0000-4000-8000-0000000000a1", "aaaaaaaa-0000-4000-8000-0000000000a2"];
  await database.query(`insert into users (id, email, name, role, account_status) values ($1, $2, '100% Sure', 'student', 'active'), ($3, $4, '1000 Surely', 'student', 'active')`, [ids[0], `${ids[0]}@example.test`, ids[1], `${ids[1]}@example.test`]);
  const find = async (q: string) => (await database.query<{ name: string }>(`select name from users where role = 'student' and name ilike $1 order by name`, [`%${escapeLike(q)}%`])).map((r) => r.name);
  assert.deepEqual(await find("100%"), ["100% Sure"], "% is literal, not a wildcard");
  assert.deepEqual(await find("_"), [], "_ is literal");
  assert.deepEqual(await find("sure"), ["100% Sure", "1000 Surely"]);
  await database.query(`delete from users where id = any($1::uuid[])`, [ids]);
});
