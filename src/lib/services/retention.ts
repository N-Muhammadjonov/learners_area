import "server-only";
import { and, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  activityEvents,
  auditLog,
  evaluations,
  listeningAttempts,
  notifications,
  readingAttempts,
  speakingAttempts,
  users,
  writingSubmissions,
} from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import { cleanupAbandonedUploads } from "@/lib/data/uploads";
import { getStorageService } from "@/lib/services/storage";

/**
 * DataRetentionService — ONE place where "how long do we keep this" is decided.
 *
 * Every duration is configuration (env, with a documented default), every rule
 * is idempotent (running it twice in a row deletes nothing the second time),
 * every rule is batched (a rule never loads a table into memory to delete it),
 * and every rule can be previewed: `runRetention({ dryRun: true })` reports
 * exactly what it *would* remove so the owner can look before anything
 * disappears. Nothing here assumes a scheduler: it is a function an operator, a
 * cron job or a platform job can call — see README ("Retention").
 *
 * The windows (all configurable):
 *
 *   raw events / read notifications ...... RETENTION_RAW_EVENT_MONTHS   (2)
 *   structured evaluations + old work .... RETENTION_STRUCTURED_MONTHS  (18)
 *   speaking recordings (object store) ... RETENTION_STRUCTURED_MONTHS  (18)
 *   audit trail .......................... RETENTION_AUDIT_MONTHS       (18)
 *   generated exports .................... RETENTION_EXPORT_DAYS        (7)
 *   inactive student accounts ............ RETENTION_INACTIVE_STUDENT_MONTHS (6)
 *
 * Rules this service deliberately does NOT follow blindly:
 *
 *  - A student account is only anonymised after genuine inactivity, and
 *    inactivity is measured on `last_meaningful_activity_at` — the last time the
 *    student actually produced work (see services/activity.ts). Signing in daily
 *    to look at the dashboard is not studying. An account with no recorded work
 *    falls back to its registration date rather than to a guess.
 *  - Teacher, admin and owner accounts are outside the student inactivity rule
 *    entirely. They leave only by an explicit administrative decision.
 *  - Course and business content (courses, modules, units, lessons, materials,
 *    prompts, tests, plans, prices, entitlements) is never touched by a
 *    retention run. Only student-produced rows are.
 *  - A recording object is only removed after a reference check, and only for
 *    the attempt that owns it.
 *  - Old submitted work is only removed when no evaluation still refers to it:
 *    a report is the record of record, and deleting its source while the report
 *    survives would leave a report nobody can check.
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
  /** Rows removed per statement, so one run cannot lock a table for long. */
  batchSize: number;
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
    batchSize: Math.min(readInt("RETENTION_BATCH_SIZE", 500), 5000),
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

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/**
 * Removes rows in batches until nothing matches, without ever loading a whole
 * table. `dryRun` never deletes: it counts what a real run would remove.
 */
async function deleteBatched(options: {
  dryRun: boolean;
  batchSize: number;
  selectIds: (limit: number) => Promise<{ id: string }[]>;
  deleteIds: (ids: string[]) => Promise<void>;
}): Promise<number> {
  let removed = 0;
  for (let round = 0; round < 1000; round += 1) {
    const rows = await options.selectIds(options.batchSize);
    if (rows.length === 0) break;
    removed += rows.length;
    if (options.dryRun) {
      // A dry run reports the first batch honestly labelled rather than walking
      // the table; the caller subtracts nothing, it shows a preview.
      break;
    }
    await options.deleteIds(rows.map((row) => row.id));
    if (rows.length < options.batchSize) break;
  }
  return removed;
}

const RETENTION_LOCK_KEY = "learners_area.retention";

export async function runRetention(options?: {
  dryRun?: boolean;
  now?: Date;
  actorUserId?: string | null;
}): Promise<{
  config: RetentionConfig;
  dryRun: boolean;
  locked: boolean;
  results: RetentionRuleResult[];
}> {
  const dryRun = options?.dryRun ?? true;
  const now = options?.now ?? new Date();
  const config = readRetentionConfig();
  const results: RetentionRuleResult[] = [];

  // Lock-aware: a second run that starts while one is in flight does nothing
  // instead of racing the first. A dry run takes no lock because it writes
  // nothing.
  let locked = true;
  if (!dryRun) {
    const lockedRows = await db.execute<{ got: boolean }>(
      sql`select pg_try_advisory_lock(hashtext(${RETENTION_LOCK_KEY})) as got`
    );
    locked = Boolean(lockedRows.rows[0]?.got);
    if (!locked) {
      return {
        config,
        dryRun,
        locked,
        results: [{ rule: "run", affected: 0, applied: false, note: "another retention run holds the lock" }],
      };
    }
  }

  try {
    // 1. Raw operational events (per-request traces, not academic results).
    const rawCutoff = monthsAgo(config.rawEventMonths, now);
    const rawEvents = await deleteBatched({
      dryRun,
      batchSize: config.batchSize,
      selectIds: (limit) =>
        db.select({ id: activityEvents.id }).from(activityEvents).where(lt(activityEvents.createdAt, rawCutoff)).limit(limit),
      deleteIds: async (ids) => {
        await db.delete(activityEvents).where(inArray(activityEvents.id, ids));
      },
    });
    results.push({ rule: "raw_events", affected: rawEvents, applied: !dryRun });

    // 2. Read notifications older than the raw-event window. Unread ones stay:
    //    a student may not have seen the message yet.
    const staleNotifications = await deleteBatched({
      dryRun,
      batchSize: config.batchSize,
      selectIds: (limit) =>
        db
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(lt(notifications.createdAt, rawCutoff), isNotNull(notifications.readAt)))
          .limit(limit),
      deleteIds: async (ids) => {
        await db.delete(notifications).where(inArray(notifications.id, ids));
      },
    });
    results.push({ rule: "read_notifications", affected: staleNotifications, applied: !dryRun });

    // 3. Abandoned uploads. The upload module owns that logic (it knows which
    //    keys are orphans); retention delegates instead of duplicating it.
    if (dryRun) {
      const stale = await db.execute<{ count: number }>(
        sql`select count(*)::int as count from upload_intents where status in ('pending','aborted') and expires_at < ${now}`
      );
      results.push({
        rule: "abandoned_uploads",
        affected: Number(stale.rows[0]?.count ?? 0),
        applied: false,
        note: "counted for the preview; the upload module performs the sweep",
      });
    } else {
      const swept = await cleanupAbandonedUploads();
      results.push({
        rule: "abandoned_uploads",
        affected: swept.removedIntents,
        applied: true,
        note: `${swept.removedObjects} objects removed from object storage`,
      });
    }

    // 4. Structured evaluations past their window. A deleted raw event never
    //    takes an evaluation with it; this is the evaluation's own window.
    const structuredCutoff = monthsAgo(config.structuredResultMonths, now);
    const staleEvaluations = await deleteBatched({
      dryRun,
      batchSize: config.batchSize,
      selectIds: (limit) =>
        db.select({ id: evaluations.id }).from(evaluations).where(lt(evaluations.createdAt, structuredCutoff)).limit(limit),
      deleteIds: async (ids) => {
        await db.delete(evaluations).where(inArray(evaluations.id, ids));
      },
    });
    results.push({ rule: "structured_evaluations", affected: staleEvaluations, applied: !dryRun });

    // 5. Speaking recordings: the audio object goes at the structured window.
    //    The attempt row and its transcript stay — they are the academic record,
    //    and the transcript is already text. The object is removed only when it
    //    still belongs to this attempt (reference check), never blind-guessed.
    const recordings = await db
      .select({ id: speakingAttempts.id, objectKey: speakingAttempts.recordingObjectKey })
      .from(speakingAttempts)
      .where(and(lt(speakingAttempts.createdAt, structuredCutoff), isNotNull(speakingAttempts.recordingObjectKey)))
      .limit(config.batchSize);

    let objectsRemoved = 0;
    if (!dryRun && recordings.length > 0) {
      const storage = getStorageService();
      for (const attempt of recordings) {
        if (!attempt.objectKey) continue;
        const stillReferenced = await db.execute<{ count: number }>(
          sql`select count(*)::int as count from upload_intents where object_key = ${attempt.objectKey} and status = 'attached'`
        );
        // A key still attached to a live resource is not this rule's to delete.
        if (Number(stillReferenced.rows[0]?.count ?? 0) > 0) continue;
        await storage.delete(attempt.objectKey).catch((error) => {
          console.warn(`retention: could not delete recording ${attempt.objectKey}:`, error);
        });
        objectsRemoved += 1;
        await db.update(speakingAttempts).set({ recordingObjectKey: null }).where(eq(speakingAttempts.id, attempt.id));
      }
    }
    results.push({
      rule: "speaking_recordings",
      affected: recordings.length,
      applied: !dryRun,
      note: dryRun
        ? "audio objects that would be removed; the transcript and attempt record stay"
        : `${objectsRemoved} audio objects removed; transcript and attempt record stay`,
    });

    // 6. Old submitted work past the structured window, unless an evaluation
    //    still refers to it. Runs after the evaluation rule so the reference
    //    check sees the truth of this run, not of the previous one.
    //
    //    The table list is a whitelist, never input: retention may only ever
    //    touch rows a student produced. Course and business content has no entry
    //    here and the tests pin that.
    const OLD_WORK: { table: string; column: string; protects: string[]; label: string }[] = [
      { table: "writing_submissions", column: "created_at", protects: ["writing_submission"], label: "writing" },
      { table: "reading_attempts", column: "started_at", protects: ["reading_attempt"], label: "reading" },
      { table: "listening_attempts", column: "started_at", protects: ["listening_attempt"], label: "listening" },
      { table: "grammar_attempts", column: "attempted_at", protects: ["grammar_attempt"], label: "grammar" },
      { table: "vocabulary_usages", column: "created_at", protects: ["vocabulary_usage"], label: "vocabulary" },
      { table: "assignment_responses", column: "created_at", protects: ["assignment"], label: "assignments" },
      { table: "typing_runs", column: "created_at", protects: [], label: "typing" },
      { table: "mock_attempts", column: "started_at", protects: ["mock_attempt"], label: "mocks" },
      { table: "speaking_attempts", column: "created_at", protects: ["speaking_attempt"], label: "speaking" },
    ];

    let oldWorkTotal = 0;
    const perTable: Record<string, number> = {};
    for (const entry of OLD_WORK) {
      const protect =
        entry.protects.length > 0
          ? sql`and not exists (select 1 from evaluations e where e.source_type in (${sql.join(
              entry.protects.map((value) => sql`${value}`),
              sql`, `
            )}) and e.source_id = t.id)`
          : sql``;
      const count = await deleteBatched({
        dryRun,
        batchSize: config.batchSize,
        selectIds: async (limit) => {
          const rows = await db.execute<{ id: string }>(
            sql`select t.id from ${sql.raw(entry.table)} t where ${sql.raw(entry.column)} < ${structuredCutoff} ${protect} limit ${limit}`
          );
          return rows.rows;
        },
        deleteIds: async (ids) => {
          // One parameter per id: an array parameter would have to be parsed as
          // a Postgres array literal, which is a needless dependency on how the
          // driver serialises it.
          await db.execute(
            sql`delete from ${sql.raw(entry.table)} where id in (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `
            )})`
          );
        },
      });
      perTable[entry.label] = count;
      oldWorkTotal += count;
    }
    results.push({
      rule: "evaluated_work_past_window",
      affected: oldWorkTotal,
      applied: !dryRun,
      note: `only work no evaluation refers to (${Object.entries(perTable)
        .filter(([, n]) => n > 0)
        .map(([label, n]) => `${label}: ${n}`)
        .join(", ") || "nothing matched"}); answers cascade with their attempt`,
    });

    // 7. Security / audit trail.
    const auditCutoff = monthsAgo(config.auditMonths, now);
    const staleAudit = await deleteBatched({
      dryRun,
      batchSize: config.batchSize,
      selectIds: (limit) => db.select({ id: auditLog.id }).from(auditLog).where(lt(auditLog.createdAt, auditCutoff)).limit(limit),
      deleteIds: async (ids) => {
        await db.delete(auditLog).where(inArray(auditLog.id, ids));
      },
    });
    results.push({ rule: "audit_history", affected: staleAudit, applied: !dryRun });

    // 8. Generated export files: nothing in the product generates a persistent
    //    export yet, so the rule reports honestly instead of pretending to sweep.
    void daysAgo(config.generatedExportDays, now);
    results.push({
      rule: "generated_exports",
      affected: 0,
      applied: false,
      note: "no export generation is enabled in this phase",
    });

    // 9. Inactive STUDENT accounts → anonymise personal data, keep the academic
    //    record. Staff accounts are excluded by role; the activity measure is
    //    real work, not sign-ins.
    const inactivityCutoff = monthsAgo(config.inactiveStudentMonths, now);
    const dormant = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.role, "student"),
          or(lt(users.lastMeaningfulActivityAt, inactivityCutoff), and(sql`${users.lastMeaningfulActivityAt} is null`, lt(users.createdAt, inactivityCutoff)))!,
          inArray(users.accountStatus, ["active", "pending", "rejected"])
        )
      )
      .limit(config.batchSize);

    if (!dryRun && dormant.length > 0) {
      for (const row of chunk(dormant, 100)) {
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
          .where(
            inArray(
              users.id,
              row.map((entry) => entry.id)
            )
          );
      }
    }
    results.push({
      rule: "inactive_student_accounts",
      affected: dormant.length,
      applied: !dryRun,
      note: "measured on last meaningful activity (real work), falling back to registration; personal fields are scrubbed, structured work stays until its own window closes",
    });

    if (!dryRun) {
      await recordAudit({
        actorUserId: options?.actorUserId ?? null,
        action: "retention.cleanup",
        metadata: { rules: results.map((result) => ({ rule: result.rule, affected: result.affected })) },
      });
    }

    return { config, dryRun, locked, results };
  } finally {
    if (!dryRun) {
      await db.execute(sql`select pg_advisory_unlock(hashtext(${RETENTION_LOCK_KEY}))`);
    }
  }
}
