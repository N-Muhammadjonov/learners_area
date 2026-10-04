// RIWI Reporter — the ONE canonical snapshot. Every export format (JSON, CSV, XLSX,
// DOCX, PDF, ZIP) is rendered from this object and nothing else, so formats can never
// disagree. Every number carries its provenance: the exact SQL text that produced it
// (the text below IS what executes — `compileMetricSql` only binds the parameters),
// the window, the scope and the generation time. Numbers are computed by SQL alone;
// no AI is involved anywhere in this file.
import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { Role } from "@/lib/auth/roles";
import { reportSnapshotSchema } from "./snapshot-schema";
import type { ReportWindow } from "./period";

export const REPORT_SCHEMA_VERSION = "riwi-report/1";

export type ReportScope =
  | { kind: "owner" }
  /** teacherId null = all-students cohort (owner/admin); a uuid = that teacher's explicit roster. */
  | { kind: "teacher"; teacherId: string | null }
  | { kind: "student"; subjectId: string; subjectName: string };

export type MetricUnit = "count" | "ratio" | "band" | "score";
export type MetricSection = "learning" | "results" | "people" | "operations";

export type ReportMetric = {
  key: string;
  section: MetricSection;
  label: { en: string; uz: string };
  unit: MetricUnit;
  /** null = no data in the window (never silently 0). */
  value: number | null;
  source: { queryId: string; sql: string; parameters: Record<string, string> };
  window: { from: string; to: string; basis: "window" | "as_of_end" };
  scope: string;
  generatedAt: string;
};

export type ReportSnapshot = {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  reportId: string;
  generatedAt: string;
  generatedBy: { userId: string; role: Role };
  timezone: string;
  period: ReportWindow;
  scope: ReportScope;
  metrics: ReportMetric[];
  /** Deterministic, number-faithful summary (works with no AI configured). */
  narrative: { source: "deterministic"; en: string[]; uz: string[] };
};

type Spec = {
  key: string;
  section: MetricSection;
  label: { en: string; uz: string };
  unit: MetricUnit;
  basis?: "window" | "as_of_end";
  /** SQL with tokens :from, :to, :subject and the learner filter {{LEARNERS}}. Must return one row with column v. */
  sql: string;
};

// The learner population of a scope. The owner scope and the all-students cohort
// (owner/admin) cover every student account; a teacher's scope covers ONLY the
// students explicitly linked to them in teacher_student_links (0035), as of
// generation time; the student scope covers exactly one account.
const COHORT = "user_id in (select id from users where role = 'student')";
const ROSTER = "user_id in (select l.student_user_id from teacher_student_links l join users u on u.id = l.student_user_id where l.teacher_user_id = :teacher and u.role = 'student')";
const SELF = "user_id = :subject";

const LEARNER_SPECS: Spec[] = [
  { key: "learners.active", section: "learning", unit: "count", label: { en: "Active learners", uz: "Faol o'quvchilar" },
    sql: "select count(distinct user_id)::int as v from activity_events where {{LEARNERS}} and created_at >= :from and created_at < :to" },
  { key: "reading.completed", section: "learning", unit: "count", label: { en: "Reading attempts completed", uz: "Yakunlangan Reading urinishlari" },
    sql: "select count(*)::int as v from reading_attempts where {{LEARNERS}} and status = 'completed' and submitted_at >= :from and submitted_at < :to" },
  { key: "reading.accuracy", section: "results", unit: "ratio", label: { en: "Reading accuracy", uz: "Reading aniqligi" },
    sql: "select case when sum(total_questions) > 0 then sum(score)::float8 / sum(total_questions) end as v from reading_attempts where {{LEARNERS}} and status = 'completed' and total_questions > 0 and submitted_at >= :from and submitted_at < :to" },
  { key: "listening.completed", section: "learning", unit: "count", label: { en: "Listening attempts completed", uz: "Yakunlangan Listening urinishlari" },
    sql: "select count(*)::int as v from listening_attempts where {{LEARNERS}} and status = 'completed' and submitted_at >= :from and submitted_at < :to" },
  { key: "listening.accuracy", section: "results", unit: "ratio", label: { en: "Listening accuracy", uz: "Listening aniqligi" },
    sql: "select case when sum(total_questions) > 0 then sum(score)::float8 / sum(total_questions) end as v from listening_attempts where {{LEARNERS}} and status = 'completed' and total_questions > 0 and submitted_at >= :from and submitted_at < :to" },
  { key: "writing.submitted", section: "learning", unit: "count", label: { en: "Writing essays submitted", uz: "Topshirilgan Writing insholari" },
    sql: "select count(*)::int as v from writing_submissions where {{LEARNERS}} and status in ('submitted', 'evaluated') and submitted_at >= :from and submitted_at < :to" },
  { key: "writing.band", section: "results", unit: "band", label: { en: "Average Writing band (checked)", uz: "O'rtacha Writing bali (tekshirilgan)" },
    sql: "select round(avg(overall_estimate)::numeric, 2)::float8 as v from evaluations where {{LEARNERS}} and source_type in ('writing_submission', 'writing_grade') and overall_estimate is not null and created_at >= :from and created_at < :to" },
  { key: "speaking.submitted", section: "learning", unit: "count", label: { en: "Speaking recordings submitted", uz: "Topshirilgan Speaking yozuvlari" },
    sql: "select count(*)::int as v from speaking_attempts where {{LEARNERS}} and status in ('submitted', 'reviewed') and submitted_at >= :from and submitted_at < :to" },
  { key: "speaking.band", section: "results", unit: "band", label: { en: "Average Speaking band (checked)", uz: "O'rtacha Speaking bali (tekshirilgan)" },
    sql: "select round(avg(overall_estimate)::numeric, 2)::float8 as v from evaluations where {{LEARNERS}} and source_type = 'speaking_attempt' and overall_estimate is not null and created_at >= :from and created_at < :to" },
  { key: "retention.completed", section: "learning", unit: "count", label: { en: "Retention texts completed", uz: "Yakunlangan Retention matnlari" },
    sql: "select count(*)::int as v from retention_attempts where {{LEARNERS}} and status = 'completed' and completed_at >= :from and completed_at < :to" },
  { key: "retention.score", section: "results", unit: "score", label: { en: "Average Retention score", uz: "O'rtacha Retention natijasi" },
    sql: "select round(avg(score)::numeric, 2)::float8 as v from retention_attempts where {{LEARNERS}} and status = 'completed' and score is not null and completed_at >= :from and completed_at < :to" },
  { key: "grammar.attempts", section: "learning", unit: "count", label: { en: "Grammar exercise attempts", uz: "Grammatika mashqi urinishlari" },
    sql: "select count(*)::int as v from grammar_attempts where {{LEARNERS}} and attempted_at >= :from and attempted_at < :to" },
  { key: "grammar.accuracy", section: "results", unit: "ratio", label: { en: "Grammar accuracy", uz: "Grammatika aniqligi" },
    sql: "select case when count(*) filter (where is_correct is not null) > 0 then (count(*) filter (where is_correct))::float8 / count(*) filter (where is_correct is not null) end as v from grammar_attempts where {{LEARNERS}} and attempted_at >= :from and attempted_at < :to" },
  { key: "video.completed", section: "learning", unit: "count", label: { en: "Video (TED) lessons completed", uz: "Yakunlangan video (TED) darslar" },
    sql: "select count(*)::int as v from video_lesson_progress where {{LEARNERS}} and completed_at >= :from and completed_at < :to" },
  { key: "vocabulary.added", section: "learning", unit: "count", label: { en: "Words added to vocabulary", uz: "Lug'atga qo'shilgan so'zlar" },
    sql: "select count(*)::int as v from user_vocabulary where {{LEARNERS}} and created_at >= :from and created_at < :to" },
];

const COHORT_SPECS: Spec[] = [
  { key: "people.students", section: "people", unit: "count", basis: "as_of_end", label: { en: "Approved student accounts", uz: "Tasdiqlangan talaba hisoblari" },
    sql: "select count(*)::int as v from users where role = 'student' and account_status = 'active' and created_at < :to" },
  { key: "people.registered", section: "people", unit: "count", label: { en: "New student registrations", uz: "Yangi talaba ro'yxatdan o'tishlari" },
    sql: "select count(*)::int as v from users where role = 'student' and created_at >= :from and created_at < :to" },
];

const ROSTER_SPECS: Spec[] = [
  { key: "people.assigned", section: "people", unit: "count", basis: "as_of_end", label: { en: "Students assigned to this teacher", uz: "Ushbu o'qituvchiga biriktirilgan talabalar" },
    sql: "select count(*)::int as v from teacher_student_links l join users u on u.id = l.student_user_id where l.teacher_user_id = :teacher and u.role = 'student' and u.account_status = 'active' and l.created_at < :to" },
];

const OWNER_SPECS: Spec[] = [
  { key: "people.staff", section: "people", unit: "count", basis: "as_of_end", label: { en: "Approved staff accounts", uz: "Tasdiqlangan xodim hisoblari" },
    sql: "select count(*)::int as v from users where role in ('teacher', 'admin', 'owner') and account_status = 'active' and created_at < :to" },
  { key: "people.pending", section: "people", unit: "count", basis: "as_of_end", label: { en: "Accounts awaiting approval (current status)", uz: "Tasdiq kutayotgan hisoblar (joriy holat)" },
    sql: "select count(*)::int as v from users where account_status = 'pending' and created_at < :to" },
  { key: "operations.problemReports", section: "operations", unit: "count", label: { en: "Problem reports received", uz: "Qabul qilingan muammo xabarlari" },
    sql: "select count(*)::int as v from problem_reports where created_at >= :from and created_at < :to" },
  { key: "operations.checksExternal", section: "operations", unit: "count", label: { en: "Checks by an external AI provider", uz: "Tashqi AI provayderi tekshiruvlari" },
    sql: "select count(*)::int as v from evaluations where provider_type = 'external' and created_at >= :from and created_at < :to" },
  { key: "operations.checksInternal", section: "operations", unit: "count", label: { en: "Checks by RIWI's own checker", uz: "RIWI'ning o'z tekshiruvlari" },
    sql: "select count(*)::int as v from evaluations where provider_type = 'internal' and created_at >= :from and created_at < :to" },
  { key: "operations.checksFallback", section: "operations", unit: "count", label: { en: "Checks that used a fallback", uz: "Zaxira yo'li ishlatilgan tekshiruvlar" },
    sql: "select count(*)::int as v from evaluations where fallback_used = true and created_at >= :from and created_at < :to" },
];

export function specsFor(scope: ReportScope): Array<Spec & { compiledText: string }> {
  const roster = scope.kind === "teacher" && scope.teacherId !== null;
  const learners = scope.kind === "student" ? SELF : roster ? ROSTER : COHORT;
  const learnerSpecs = LEARNER_SPECS.map((s) => ({ ...s, compiledText: s.sql.replaceAll("{{LEARNERS}}", learners) }));
  if (scope.kind === "student") return learnerSpecs;
  if (roster) return [...ROSTER_SPECS.map((s) => ({ ...s, compiledText: s.sql })), ...learnerSpecs];
  const cohort = COHORT_SPECS.map((s) => ({ ...s, compiledText: s.sql }));
  if (scope.kind === "teacher") return [...cohort, ...learnerSpecs];
  return [...cohort, ...OWNER_SPECS.map((s) => ({ ...s, compiledText: s.sql })), ...learnerSpecs];
}

/** Binds :from/:to/:subject/:teacher as real parameters; the remaining text is used verbatim. */
export function compileMetricSql(text: string, params: { from: Date; to: Date; subject: string | null; teacher?: string | null }): SQL {
  const pieces = text.split(/(:from|:to|:subject|:teacher)\b/);
  const chunks: SQL[] = pieces.map((piece) => {
    if (piece === ":from") return sql`${params.from.toISOString()}::timestamptz`;
    if (piece === ":to") return sql`${params.to.toISOString()}::timestamptz`;
    if (piece === ":subject") {
      if (!params.subject) throw new Error("subject parameter required");
      return sql`${params.subject}::uuid`;
    }
    if (piece === ":teacher") {
      if (!params.teacher) throw new Error("teacher parameter required");
      return sql`${params.teacher}::uuid`;
    }
    return sql.raw(piece);
  });
  return sql.join(chunks, sql.raw(""));
}

type Executor = { execute: (query: SQL) => Promise<unknown> };

export function scopeLabel(scope: ReportScope): string {
  return scope.kind === "student" ? `student:${scope.subjectId}` : scope.kind === "teacher" ? (scope.teacherId ? `teacher:${scope.teacherId}:assigned` : "teacher:all-students") : "owner:centre";
}

export async function buildReportSnapshot(
  executor: Executor,
  input: { scope: ReportScope; period: ReportWindow; actor: { userId: string; role: Role }; now?: Date; reportId?: string },
): Promise<ReportSnapshot> {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const subject = input.scope.kind === "student" ? input.scope.subjectId : null;
  const teacher = input.scope.kind === "teacher" ? input.scope.teacherId : null;
  const from = new Date(input.period.from);
  const to = new Date(input.period.to);
  const scope = scopeLabel(input.scope);
  const metrics: ReportMetric[] = [];
  for (const spec of specsFor(input.scope)) {
    const result = (await executor.execute(compileMetricSql(spec.compiledText, { from, to, subject, teacher }))) as { rows: Array<{ v: unknown }> };
    const raw = result.rows[0]?.v;
    const value = raw === null || raw === undefined ? null : Number(raw);
    const parameters: Record<string, string> = { from: input.period.from, to: input.period.to };
    if (subject && spec.compiledText.includes(":subject")) parameters.subject = subject;
    if (teacher && spec.compiledText.includes(":teacher")) parameters.teacher = teacher;
    metrics.push({
      key: spec.key, section: spec.section, label: spec.label, unit: spec.unit,
      value: value === null || Number.isFinite(value) ? value : null,
      source: { queryId: `riwi.${spec.key}`, sql: spec.compiledText, parameters },
      window: { from: input.period.from, to: input.period.to, basis: spec.basis ?? "window" },
      scope, generatedAt,
    });
  }
  const snapshot: ReportSnapshot = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reportId: input.reportId ?? randomUUID(),
    generatedAt,
    generatedBy: input.actor,
    timezone: input.period.timezone,
    period: input.period,
    scope: input.scope,
    metrics,
    narrative: { source: "deterministic", en: [], uz: [] },
  };
  snapshot.narrative = deterministicNarrative(snapshot);
  return reportSnapshotSchema.parse(snapshot);
}

export function formatMetricValue(metric: Pick<ReportMetric, "unit" | "value">): string {
  if (metric.value === null) return "—";
  if (metric.unit === "ratio") return `${(metric.value * 100).toFixed(1)}%`;
  if (metric.unit === "band" || metric.unit === "score") return metric.value.toFixed(2);
  return String(Math.round(metric.value));
}

function deterministicNarrative(snapshot: ReportSnapshot): ReportSnapshot["narrative"] {
  const en: string[] = [];
  const uz: string[] = [];
  const get = (key: string) => snapshot.metrics.find((m) => m.key === key);
  const line = (key: string, enText: (v: string) => string, uzText: (v: string) => string) => {
    const m = get(key);
    if (!m || m.value === null) return;
    const v = formatMetricValue(m);
    en.push(enText(v));
    uz.push(uzText(v));
  };
  line("learners.active", (v) => `${v} learner(s) were active in this period.`, (v) => `Bu davrda ${v} ta o'quvchi faol bo'ldi.`);
  line("reading.completed", (v) => `${v} Reading attempt(s) were completed.`, (v) => `${v} ta Reading urinishi yakunlandi.`);
  line("listening.completed", (v) => `${v} Listening attempt(s) were completed.`, (v) => `${v} ta Listening urinishi yakunlandi.`);
  line("writing.submitted", (v) => `${v} Writing essay(s) were submitted.`, (v) => `${v} ta Writing inshosi topshirildi.`);
  line("speaking.submitted", (v) => `${v} Speaking recording(s) were submitted.`, (v) => `${v} ta Speaking yozuvi topshirildi.`);
  line("retention.completed", (v) => `${v} Retention text(s) were completed.`, (v) => `${v} ta Retention matni yakunlandi.`);
  if (en.length === 0) {
    en.push("No recorded activity in this period.");
    uz.push("Bu davrda qayd etilgan faollik yo'q.");
  }
  return { source: "deterministic", en, uz };
}

/** Stable hash of the canonical snapshot (key order as constructed). */
export function snapshotSha256(snapshot: ReportSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

/**
 * Validation for an OPTIONAL AI-written narrative. An AI may only rephrase: every
 * number it mentions must already be a formatted value in the snapshot, it may not
 * contain links, e-mail addresses or markup, and it is bounded in length. It never
 * replaces or alters the metrics. Not wired to a provider in this release.
 */
export function validateNarrative(text: string, snapshot: ReportSnapshot): { ok: true } | { ok: false; reason: string } {
  if (text.length === 0 || text.length > 2000) return { ok: false, reason: "length" };
  if (/https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[\w.]+|<[a-z/!]/i.test(text)) return { ok: false, reason: "forbidden_content" };
  const allowed = new Set<string>();
  for (const m of snapshot.metrics) {
    if (m.value === null) continue;
    const f = formatMetricValue(m);
    allowed.add(f.replace(/%$/, ""));
    allowed.add(String(m.value));
  }
  for (const n of text.match(/\d+(?:[.,]\d+)?/g) ?? []) {
    if (!allowed.has(n.replace(",", "."))) return { ok: false, reason: "unknown_number" };
  }
  return { ok: true };
}
