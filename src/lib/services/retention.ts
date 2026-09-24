import "server-only";
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  activityEvents,
  auditLog,
  evaluations,
  notifications,
  readingAttempts,
  speakingAttempts,
  users,
  writingSubmissions,
} from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";

/**
 * DataRetentionService — ONE place where "how long do we keep this" is decided.
 *
 * Every duration is configuration (env, with a documented default), every rule
 * is idempotent (running it twice in a row deletes nothing the second time) and
 * every rule can be previewed: `runRetention({ dryRun: true })` reports exactly
 * what it *would* remove so the owner can look before anything disappears.
 *
 * Two rules this service deliberately does NOT follow blindly:
 *
 *  - A student account is only anonymised after genuine inactivity. An active
 *    student is never removed because their account is old — activity is read
 *    from `last_active_at`, which the session layer touches.
 *  - Teacher, admin and owner accounts are outside the student inactivity rule
 *    entirely. They leave only by an explicit administrative decision.
 *
 * "Anonymise" rather than "delete" is the deliberate choice for accounts:
 * deleting a student would also delete the structured academic history that the
 * 18-month rule exists to preserve, and would break the evaluations that
 * reference their work. Personal fields are scrubbed; the academic record stays
 * until its own retention window closes.
 */

export type RetentionConfig = {
  /** Months of inactivity after which a student account is anonymised. */
  inactiveStudentMonths: number;
  /** Months raw operational events are kept. */
  rawEventMonths: number;
  /** Months structured evaluations and academic history are kept. */
  structuredResultMonths: number;
  /** Months the security/audit trail is kept. */
  auditMonths: number;
  /** Days a generated export file may live in object storage. */
  generatedExportDays: number;
};

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readRetentionConfig(): RetentionConfig {
  return {
    inactiveStudentMonths: readInt("RETENTION_INACTIVE_STUDENT_MONTHS", 6),
    rawEventMonths: readInt("RETENTION_RAW_EVENT_MONTHS", 2),
    structuredResultMonths: readInt("RETENTION_STRUCTURED_MONTHS", 18),
    auditMonths: readInt("RETENTION_AUDIT_MONTHS", 18),
    generatedExportDays: readInt("RETENTION_EXPORT_DAYS", 7),
  };
}

export type RetentionRuleResult = {
  rule: string;
  /** Rows the rule matched. In a dry run this is what *would* be removed. */
  affected: number;
  applied: boolean;
  note?: string;
};

function monthsAgo(months: number, now: Date): Date {
  const date = new Date(now);
  date.setMonth(date.getMonth() - months);
  return date;
}

function daysAgo(days: number, now: Date): Date {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date;
}

export async function runRetention(options?: {
  dryRun?: boolean;
  now?: Date;
  actorUserId?: string | null;
}): Promise<{ config: RetentionConfig; dryRun: boolean; results: RetentionRuleResult[] }> {
  const dryRun = options?.dryRun ?? true;
  const now = options?.now ?? new Date();
  const config = readRetentionConfig();
  const results: RetentionRuleResult[] = [];

  // 1. Raw operational events (the closest thing to "raw conversation" rows:
  //    per-request traces, not academic results).
  const rawCutoff = monthsAgo(config.rawEventMonths, now);
  const staleEvents = await db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(lt(activityEvents.createdAt, rawCutoff));
  if (!dryRun && staleEvents.length > 0) {
    await db.delete(activityEvents).where(
      inArray(
        activityEvents.id,
        staleEvents.map((row) => row.id)
      )
    );
  }
  results.push({ rule: "raw_events", affected: staleEvents.length, applied: !dryRun });

  // 2. Read notifications older than the raw-event window.
  const staleNotifications = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(lt(notifications.createdAt, rawCutoff), isNotNull(notifications.readAt)));
  if (!dryRun && staleNotifications.length > 0) {
    await db.delete(notifications).where(
      inArray(
        notifications.id,
        staleNotifications.map((row) => row.id)
      )
    );
  }
  results.push({ rule: "read_notifications", affected: staleNotifications.length, applied: !dryRun });

  // 3. Structured academic history: evaluations past their window go, but only
  //    with their window — a deleted raw chat never takes an evaluation with it.
  const structuredCutoff = monthsAgo(config.structuredResultMonths, now);
  const staleEvaluations = await db
    .select({ id: evaluations.id })
    .from(evaluations)
    .where(lt(evaluations.createdAt, structuredCutoff));
  if (!dryRun && staleEvaluations.length > 0) {
    await db.delete(evaluations).where(
      inArray(
        evaluations.id,
        staleEvaluations.map((row) => row.id)
      )
    );
  }
  results.push({
    rule: "structured_evaluations",
    affected: staleEvaluations.length,
    applied: !dryRun,
  });

  // 4. Security / audit trail.
  const auditCutoff = monthsAgo(config.auditMonths, now);
  const staleAudit = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(lt(auditLog.createdAt, auditCutoff));
  if (!dryRun && staleAudit.length > 0) {
    await db.delete(auditLog).where(
      inArray(
        auditLog.id,
        staleAudit.map((row) => row.id)
      )
    );
  }
  results.push({ rule: "audit_history", affected: staleAudit.length, applied: !dryRun });

  // 5. Generated export files: nothing in the product generates a persistent
  //    export yet, so the rule reports honestly instead of pretending to sweep.
  results.push({
    rule: "generated_exports",
    affected: 0,
    applied: false,
    note: "no export generation is enabled in this phase",
  });

  // 6. Inactive STUDENT accounts → anonymise personal data, keep the academic
  //    record. Staff accounts are excluded by role, active accounts by date.
  const inactivityCutoff = monthsAgo(config.inactiveStudentMonths, now);
  const dormant = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "student"),
        lt(users.lastActiveAt, inactivityCutoff),
        inArray(users.accountStatus, ["active", "pending", "rejected"])
      )
    );

  if (!dryRun && dormant.length > 0) {
    for (const row of dormant) {
      await db
        .update(users)
        .set({
          name: "Former student",
          email: null,
          telegramId: null,
          passwordHash: null,
          accountStatus: "suspended",
          statusReason: "anonymised_by_retention",
          statusUpdatedAt: now,
        })
        .where(eq(users.id, row.id));
    }
  }
  results.push({
    rule: "inactive_student_accounts",
    affected: dormant.length,
    applied: !dryRun,
    note: "personal fields are scrubbed; evaluations and submissions stay until their own window closes",
  });

  // 7. Submissions whose owner no longer exists cannot be displayed to anyone;
  //    they are reported so the owner can see the state rather than guess.
  const orphanSubmissions = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(writingSubmissions)
    .where(sql`not exists (select 1 from ${users} where ${users.id} = ${writingSubmissions.userId})`);
  const orphanSpeaking = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(speakingAttempts)
    .where(sql`not exists (select 1 from ${users} where ${users.id} = ${speakingAttempts.userId})`);
  const orphanReading = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(readingAttempts)
    .where(sql`not exists (select 1 from ${users} where ${users.id} = ${readingAttempts.userId})`);
  const orphanTotal =
    (orphanSubmissions[0]?.count ?? 0) + (orphanSpeaking[0]?.count ?? 0) + (orphanReading[0]?.count ?? 0);
  results.push({
    rule: "orphaned_student_work",
    affected: orphanTotal,
    applied: false,
    note: "foreign keys cascade on real deletes; this counts historical leftovers",
  });

  if (!dryRun) {
    await recordAudit({
      actorUserId: options?.actorUserId ?? null,
      action: "retention.cleanup",
      metadata: { rules: results.map((result) => ({ rule: result.rule, affected: result.affected })) },
    });
  }

  return { config, dryRun, results };
}
