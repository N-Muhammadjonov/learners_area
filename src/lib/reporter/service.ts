// RIWI Reporter — generate → audit → deliver. Reports are produced on demand and
// streamed straight to the authorised requester: nothing is written to object storage
// and no shareable link exists, so the only retained trace is the audit_log record
// (report id, scope, window, format, content hash — never report contents).
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import type { Role } from "@/lib/auth/roles";
import { authorizeReport, SCOPE_KINDS, type Actor, type RosterCheck, type SubjectLookup } from "./access";
import { isOnRoster } from "./roster";
import { PERIOD_KINDS, resolvePeriod, type PeriodError } from "./period";
import { buildReportSnapshot, snapshotSha256, type ReportSnapshot } from "./snapshot";
import { bytesSha256, CONTENT_TYPES, REPORT_FORMATS, renderReport, reportFileName, type ReportFormat } from "./exports";

export const reportRequestSchema = z.object({
  scope: z.enum(SCOPE_KINDS),
  subject: z.string().trim().max(64).optional().nullable(),
  period: z.enum(PERIOD_KINDS),
  from: z.string().trim().max(10).optional().nullable(),
  to: z.string().trim().max(10).optional().nullable(),
  format: z.enum(REPORT_FORMATS),
  lang: z.enum(["en", "uz"]).default("uz"),
}).strict();
export type ReportRequest = z.infer<typeof reportRequestSchema>;

export type GenerateResult =
  | { ok: true; snapshot: ReportSnapshot; bytes: Uint8Array; contentType: string; fileName: string }
  | { ok: false; status: 400 | 403 | 404 | 503; code: "invalid_input" | "forbidden" | "not_found" | PeriodError | "generation_failed" };

type Deps = {
  database?: Pick<typeof db, "execute" | "insert">;
  lookup?: SubjectLookup;
  rosterCheck?: RosterCheck;
  now?: () => Date;
};

export const defaultSubjectLookup: SubjectLookup = async (id) => {
  const row = await db.query.users.findFirst({ where: eq(users.id, id), columns: { id: true, role: true, name: true } });
  return row ? { id: row.id, role: row.role as Role, name: row.name } : null;
};

export async function generateReport(actor: Actor, raw: unknown, deps: Deps = {}): Promise<GenerateResult> {
  const parsed = reportRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, code: "invalid_input" };
  const request = parsed.data;
  const rosterDb = deps.database ?? db;
  const access = await authorizeReport(actor, { scope: request.scope, subjectId: request.subject }, deps.lookup ?? defaultSubjectLookup, deps.rosterCheck ?? ((teacherId, studentId) => isOnRoster(teacherId, studentId, rosterDb)));
  if (!access.ok) return { ok: false, status: access.status, code: access.status === 403 ? "forbidden" : "not_found" };
  const now = deps.now?.() ?? new Date();
  const period = resolvePeriod(request.period, now, { from: request.from, to: request.to });
  if (!period.ok) return { ok: false, status: 400, code: period.error };

  const database = deps.database ?? db;
  let snapshot: ReportSnapshot;
  try {
    snapshot = await buildReportSnapshot(database, { scope: access.scope, period: period.window, actor: { userId: actor.id, role: actor.role }, now });
  } catch {
    return { ok: false, status: 503, code: "generation_failed" };
  }
  const format: ReportFormat = request.format;
  const bytes = renderReport(snapshot, format, request.lang);
  const target = access.scope.kind === "student" ? access.scope.subjectId : access.scope.kind;
  const common = {
    reportId: snapshot.reportId, scope: access.scope.kind, period: snapshot.period.kind,
    from: snapshot.period.from, to: snapshot.period.to, timezone: snapshot.timezone,
  };
  try {
    await recordAudit({ actorUserId: actor.id, action: "report.generated", targetType: "report", targetId: target, metadata: { ...common, snapshotSha256: snapshotSha256(snapshot), metrics: snapshot.metrics.length, schemaVersion: snapshot.schemaVersion, filters: { subject: access.scope.kind === "student" ? access.scope.subjectId : null, roster: access.scope.kind === "teacher" ? access.scope.teacherId : null }, aiNarrative: { used: false, providerId: null, model: null, fallbackUsed: false } } }, database);
    await recordAudit({ actorUserId: actor.id, action: "report.downloaded", targetType: "report", targetId: target, metadata: { ...common, format, lang: request.lang, bytes: bytes.length, sha256: bytesSha256(bytes) } }, database);
  } catch {
    // An unaudited report is not delivered.
    return { ok: false, status: 503, code: "generation_failed" };
  }
  return { ok: true, snapshot, bytes, contentType: CONTENT_TYPES[format], fileName: reportFileName(snapshot, format) };
}
