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
import { authorizeReport, type Actor, type SubjectLookup } from "../src/lib/reporter/access";
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
  assert.ok((await authorizeReport(teacher, { scope: "student", subjectId: S2 }, lookup)).ok);
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

  const teacher = await buildReportSnapshot(database.db, { scope: { kind: "teacher" }, period: week(), actor: { userId: TCH, role: "teacher" }, now: NOW });
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
