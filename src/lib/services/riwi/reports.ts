import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { authorizeReport, type Actor, type ScopeKind } from "@/lib/reporter/access";
import { isOnRoster } from "@/lib/reporter/roster";
import { PERIOD_KINDS, resolvePeriod, type PeriodKind } from "@/lib/reporter/period";
import { buildReportSnapshot, REPORT_SCHEMA_VERSION, type ReportSnapshot } from "@/lib/reporter/snapshot";

export type RiwiReportRequest = {
  scope: ScopeKind;
  subjectId?: string | null;
  period: PeriodKind;
  from?: string | null;
  to?: string | null;
};

const reportScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("owner") }).strict(),
  z.object({ kind: z.literal("teacher"), teacherId: z.string().uuid().nullable() }).strict(),
  z.object({ kind: z.literal("student"), subjectId: z.string().uuid(), subjectName: z.string().max(200) }).strict(),
]);

/**
 * The tool carries the complete canonical snapshot across its server boundary.
 * The gateway may render its facts, but it cannot replace them with provider text.
 */
export const riwiReportSnapshotSchema = z.object({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  reportId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  generatedBy: z.object({ userId: z.string().uuid(), role: z.enum(["student", "teacher", "admin", "owner"]) }).strict(),
  timezone: z.string().max(80),
  period: z.object({
    kind: z.enum(PERIOD_KINDS), timezone: z.string().max(80), from: z.string().datetime(), to: z.string().datetime(),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict(),
  scope: reportScopeSchema,
  metrics: z.array(z.object({
    key: z.string().max(100), section: z.enum(["learning", "results", "people", "operations"]),
    label: z.object({ en: z.string().max(200), uz: z.string().max(200) }).strict(),
    unit: z.enum(["count", "ratio", "band", "score"]), value: z.number().finite().nullable(),
    source: z.object({ queryId: z.string().max(120), sql: z.string().max(4000),
      parameters: z.record(z.string().max(200)).refine((value) => Object.keys(value).length <= 4) }).strict(),
    window: z.object({ from: z.string().datetime(), to: z.string().datetime(), basis: z.enum(["window", "as_of_end"]) }).strict(),
    scope: z.string().max(200), generatedAt: z.string().datetime(),
  }).strict()).max(100),
  narrative: z.object({ source: z.literal("deterministic"), en: z.array(z.string().max(500)).max(30), uz: z.array(z.string().max(500)).max(30) }).strict(),
}).strict();

export const riwiReportResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), snapshot: riwiReportSnapshotSchema }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["not_available", "invalid_period", "generation_failed"]) }).strict(),
]);

export type RiwiReportResult =
  | { ok: true; snapshot: ReportSnapshot }
  | { ok: false; code: "forbidden" | "not_found" | "invalid_period" | "generation_failed" };

/**
 * RIWI's read-only Reporter adapter. It shares the canonical SQL snapshot and
 * Reporter authorization policy, but does not render/download an export. Tool
 * audit is recorded by the broker; this function never creates a false
 * `report.downloaded` event.
 */
export async function buildRiwiReport(input: {
  actor: { id: string; role: Role };
  request: RiwiReportRequest;
  now?: Date;
}, database: typeof db = db): Promise<RiwiReportResult> {
  const subject = await database.query.users.findFirst({
    where: eq(users.id, input.actor.id),
    columns: { id: true, name: true, role: true, accountStatus: true },
  });
  if (!subject || subject.accountStatus !== "active" || subject.role !== input.actor.role) return { ok: false, code: "forbidden" };

  const actor: Actor = { id: subject.id, name: subject.name, role: subject.role as Role };
  const scopeKind = input.request.scope satisfies ScopeKind;
  const access = await authorizeReport(actor, { scope: scopeKind, subjectId: input.request.subjectId }, async (id) => {
    const row = await database.query.users.findFirst({ where: eq(users.id, id), columns: { id: true, name: true, role: true, accountStatus: true } });
    return row && row.accountStatus === "active" ? { id: row.id, name: row.name, role: row.role as Role } : null;
  }, (teacherId, studentId) => isOnRoster(teacherId, studentId, database));
  if (!access.ok) return { ok: false, code: access.status === 403 ? "forbidden" : "not_found" };

  const period = resolvePeriod(input.request.period, input.now ?? new Date(), { from: input.request.from, to: input.request.to });
  if (!period.ok) return { ok: false, code: "invalid_period" };
  try {
    const snapshot = await buildReportSnapshot(database, {
      scope: access.scope,
      period: period.window,
      actor: { userId: actor.id, role: actor.role },
      now: input.now,
    });
    return { ok: true, snapshot };
  } catch {
    return { ok: false, code: "generation_failed" };
  }
}

export function isRiwiReportPeriod(value: unknown): value is PeriodKind {
  return typeof value === "string" && (PERIOD_KINDS as readonly string[]).includes(value);
}
