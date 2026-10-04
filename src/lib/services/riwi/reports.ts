import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { authorizeReport, type Actor, type ScopeKind } from "@/lib/reporter/access";
import { isOnRoster } from "@/lib/reporter/roster";
import { PERIOD_KINDS, resolvePeriod, type PeriodKind } from "@/lib/reporter/period";
import { buildReportSnapshot, type ReportSnapshot } from "@/lib/reporter/snapshot";
import { reportSnapshotSchema } from "@/lib/reporter/snapshot-schema";

export type RiwiReportRequest = {
  scope: ScopeKind;
  subjectId?: string | null;
  period: PeriodKind;
  from?: string | null;
  to?: string | null;
};

/** Shared strict Reporter schema; the tool boundary cannot drift from chat/transcript validation. */
export const riwiReportSnapshotSchema = reportSnapshotSchema;
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
  database?: typeof db;
}): Promise<RiwiReportResult> {
  const database = input.database ?? db;
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
