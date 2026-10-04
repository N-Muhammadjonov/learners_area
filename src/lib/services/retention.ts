import "server-only";
import { and, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { db as database } from "@/db/client";
import {
  accessRequests,
  activityEvents,
  auditLog,
  evaluations,
  listeningAttempts,
  notifications,
  readingAttempts,
  speakingAttempts,
  users,
  uploadIntents,
  writingSubmissions,
} from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import { cleanupAbandonedUploads } from "@/lib/data/uploads";
import { hasRecentLearningActivity } from "@/lib/services/activity";
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
 *   read notifications ................... RETENTION_RAW_EVENT_MONTHS   (2)
 *   learning history + evaluations + work RETENTION_STRUCTURED_MONTHS  (18)
 *   speaking recordings (object store) ... RETENTION_STRUCTURED_MONTHS  (18)
 *   audit trail .......................... RETENTION_AUDIT_MONTHS       (18)
 *   generated exports .................... RETENTION_EXPORT_DAYS        (7)
 *   applicant free text after a decision . RETENTION_INACTIVE_STUDENT_MONTHS (6)
 *   inactive student accounts ............ RETENTION_INACTIVE_STUDENT_MONTHS (6)
 *
 * Rules this service deliberately does NOT follow blindly:
 *
 *  - A student account is only anonymised after genuine inactivity, and
 *    inactivity checks `last_meaningful_activity_at` AND persisted learner
 *    work (see services/activity.ts). Signing in daily
 *    to look at the dashboard is not studying. An account with no recorded work
 *    falls back to its registration date rather than to a guess.
 *  - Teacher, admin and owner accounts are outside the student inactivity rule
 *    entirely. They leave only by an explicit administrative decision.
 *  - Course and business content (courses, modules, units, lessons, materials,
 *    prompts, tests, plans, prices, entitlements) is never touched by a
 *    retention run. Only student-produced rows are.
 *  - A recording object is only removed after a reference check, and only for
 *    the attempt that owns it.
 *  - What an applicant *wrote* is kept only as long as it is useful. The
 *    application form asks for the minimum (a name, an email, an optional note),
 *    and once the centre has decided, the applicant's own words — their note, the
 *    decision note and the rejection reason — are cleared after the same
 *    six-month window. The decision itself is not erased: who applied, who
 *    decided, when and with what outcome stays, because that is the centre's own
 *    record. Only the words people wrote about each other go.
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

export function monthsAgo(months: number, now: Date): Date {
  // UTC calendar months, clamped to the last day of the target month. setMonth
  // alone overflows February into March and can expire accounts too early.
  const date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

function daysAgo(days: number, now: Date): Date {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
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

type RetentionOptions = { dryRun?: boolean; now?: Date; actorUserId?: string | null };
type RetentionDatabase = Pick<typeof database, "select" | "insert" | "update" | "delete" | "execute">;

export async function runRetention(options?: RetentionOptions) {
  if (options?.dryRun !== false) return runRetentionOn(options, database);
  // One transaction owns both the lock and the writes. A pooled db.execute
  // session lock could be acquired/unlocked on different backend connections.
  // Transaction-scoped advisory locks also work through transaction poolers.
  return database.transaction((tx) => runRetentionOn(options, tx));
}

async function runRetentionOn(options: RetentionOptions | undefined, db: RetentionDatabase): Promise<{
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
      sql`select pg_try_advisory_xact_lock(hashtext(${RETENTION_LOCK_KEY})) as got`
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

    // 1. These rows are learning history (vocabulary reviews, evaluated work),
    // not raw RIWI messages. The latter has no persisted table in this phase.
    const rawCutoff = monthsAgo(config.rawEventMonths, now);
    const structuredCutoff = monthsAgo(config.structuredResultMonths, now);
    const learningHistory = await deleteBatched({
      dryRun,
      batchSize: config.batchSize,
      selectIds: (limit) =>
        db.select({ id: activityEvents.id }).from(activityEvents).where(lt(activityEvents.createdAt, structuredCutoff)).limit(limit),
      deleteIds: async (ids) => {
        await db.delete(activityEvents).where(inArray(activityEvents.id, ids));
      },
    });
    results.push({ rule: "learning_history", affected: learningHistory, applied: !dryRun });

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
        sql`select count(*)::int as count from upload_intents where expires_at < ${now} and (
          status in ('pending','aborted') or (status = 'finalized' and purpose = 'riwi_knowledge_source'
            and not exists (select 1 from riwi_knowledge_sources s where s.source_object_key = upload_intents.object_key))
        )`
      );
      results.push({
        rule: "abandoned_uploads",
        affected: Number(stale.rows[0]?.count ?? 0),
        applied: false,
        note: "counted for the preview; the upload module performs the sweep",
      });
    } else {
      const swept = await cleanupAbandonedUploads(db);
      results.push({
        rule: "abandoned_uploads",
        affected: swept.removedIntents,
        applied: true,
        note: `${swept.removedObjects} objects removed from object storage`,
      });
    }

    // 4. Structured evaluations past their window. A deleted raw event never
    //    takes an evaluation with it; this is the evaluation's own window.
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
    const recordingsQuery = db
      .select({ id: speakingAttempts.id, objectKey: speakingAttempts.recordingObjectKey })
      .from(speakingAttempts)
      .where(and(
        sql`greatest(${speakingAttempts.createdAt}, ${speakingAttempts.submittedAt}) < ${structuredCutoff}`,
        isNotNull(speakingAttempts.recordingObjectKey),
        // A fresh upload can replace a recording on a much older draft.
        sql`not exists (select 1 from upload_intents u where u.speaking_attempt_id = speaking_attempts.id
          and u.object_key = speaking_attempts.recording_object_key and u.purpose = 'speaking_recording'
          and greatest(u.created_at, u.finalized_at, u.used_at) >= ${structuredCutoff})`
      ))
      .limit(config.batchSize);
    const recordings = await (dryRun ? recordingsQuery : recordingsQuery.for("update", { skipLocked: true }));

    let objectsRemoved = 0;
    if (!dryRun && recordings.length > 0) {
      const storage = getStorageService();
      for (const attempt of recordings) {
        if (!attempt.objectKey) continue;
        const stillReferenced = await db.execute<{ count: number }>(
          sql`select count(*)::int as count from (
            select id from upload_intents where object_key = ${attempt.objectKey} and status = 'attached'
              and (purpose <> 'speaking_recording' or speaking_attempt_id is distinct from ${attempt.id}::uuid
                or greatest(created_at, finalized_at, used_at) >= ${structuredCutoff})
            union all select id from speaking_attempts where recording_object_key = ${attempt.objectKey} and id <> ${attempt.id}::uuid
            union all select id from speaking_materials where primary_object_key = ${attempt.objectKey}
            union all select id from material_blocks where object_key = ${attempt.objectKey}
            union all select id from resource_blocks where object_key = ${attempt.objectKey}
          ) refs`
        );
        // A key still attached to a live resource is not this rule's to delete.
        if (Number(stillReferenced.rows[0]?.count ?? 0) > 0) continue;
        try {
          await storage.delete(attempt.objectKey);
        } catch {
          console.warn("retention: recording deletion failed; reference retained for retry");
          continue;
        }
        objectsRemoved += 1;
        await db.update(speakingAttempts).set({ recordingObjectKey: null }).where(
          and(eq(speakingAttempts.id, attempt.id), eq(speakingAttempts.recordingObjectKey, attempt.objectKey))
        );
        await db.delete(uploadIntents).where(and(
          eq(uploadIntents.objectKey, attempt.objectKey),
          eq(uploadIntents.purpose, "speaking_recording"),
          eq(uploadIntents.speakingAttemptId, attempt.id),
        ));
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
      { table: "writing_submissions", column: "greatest(t.created_at, t.updated_at, t.submitted_at)", protects: ["writing_submission"], label: "writing" },
      { table: "reading_attempts", column: "greatest(t.started_at, t.submitted_at)", protects: ["reading_attempt"], label: "reading" },
      { table: "listening_attempts", column: "greatest(t.started_at, t.submitted_at)", protects: ["listening_attempt"], label: "listening" },
      { table: "grammar_attempts", column: "attempted_at", protects: ["grammar_attempt"], label: "grammar" },
      { table: "vocabulary_usages", column: "created_at", protects: ["vocabulary_usage"], label: "vocabulary" },
      { table: "assignment_responses", column: "greatest(t.created_at, t.updated_at)", protects: ["assignment"], label: "assignments" },
      { table: "typing_runs", column: "created_at", protects: [], label: "typing" },
      { table: "mock_attempts", column: "greatest(t.started_at, t.finished_at)", protects: ["mock_attempt"], label: "mocks" },
      { table: "speaking_attempts", column: "greatest(t.created_at, t.submitted_at)", protects: ["speaking_attempt"], label: "speaking" },
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
      // Never lose the last retryable object reference if deletion failed or
      // this run only processed the first recording batch.
      const recordingProtection = entry.table === "speaking_attempts" ? sql`and t.recording_object_key is null
        and not exists (select 1 from upload_intents u where u.speaking_attempt_id = t.id and u.purpose = 'speaking_recording'
          and ((u.status in ('finalized', 'attached') and greatest(u.created_at, u.finalized_at, u.used_at) >= ${structuredCutoff})
            or (u.status = 'pending' and u.expires_at >= ${now})))` : sql``;
      const count = await deleteBatched({
        dryRun,
        batchSize: config.batchSize,
        selectIds: async (limit) => {
          const rows = await db.execute<{ id: string }>(
            sql`select t.id from ${sql.raw(entry.table)} t where ${sql.raw(entry.column)} < ${structuredCutoff} ${protect} ${recordingProtection} limit ${limit}`
          );
          return rows.rows;
        },
        deleteIds: async (ids) => {
          // One parameter per id: an array parameter would have to be parsed as
          // a Postgres array literal, which is a needless dependency on how the
          // driver serialises it.
          await db.execute(
            sql`delete from ${sql.raw(entry.table)} t where ${sql.raw(entry.column)} < ${structuredCutoff} ${protect} ${recordingProtection} and t.id in (${sql.join(
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

    // 8b. Applicant free text, once the decision about it is old enough.
    //
    // The admission form asks for almost nothing — a name, an email and an
    // optional note — but that note, the decision note and the rejection reason
    // are still personal text written by and about a person. They are cleared
    // after the same window as an inactive account, counted from the decision
    // rather than from the application: while a request is open, that note is
    // precisely what the centre has to read.
    const decisionCutoff = monthsAgo(config.inactiveStudentMonths, now);
    const staleApplicationNotes = await db
      .select({ id: accessRequests.id })
      .from(accessRequests)
      .where(
        and(
          isNotNull(accessRequests.decidedAt),
          lt(accessRequests.decidedAt, decisionCutoff),
          or(isNotNull(accessRequests.message), isNotNull(accessRequests.decisionNote))!
        )
      )
      .limit(config.batchSize);

    if (!dryRun && staleApplicationNotes.length > 0) {
      for (const row of chunk(staleApplicationNotes, 100)) {
        await db
          .update(accessRequests)
          .set({ message: null, decisionNote: null })
          .where(
            inArray(
              accessRequests.id,
              row.map((entry) => entry.id)
            )
          );
      }
    }
    results.push({
      rule: "applicant_free_text",
      affected: staleApplicationNotes.length,
      applied: !dryRun,
      note: "clears the applicant's note and the decision note; the decision record (who, when, outcome) is kept",
    });

    // 9. Inactive STUDENT accounts → anonymise personal data, keep the academic
    //    record. Staff accounts are excluded by role; the activity measure is
    //    real work, not sign-ins.
    const inactivityCutoff = monthsAgo(config.inactiveStudentMonths, now);
    const inactivityRule = and(
      eq(users.role, "student"),
      or(lt(users.lastMeaningfulActivityAt, inactivityCutoff), and(sql`${users.lastMeaningfulActivityAt} is null`, lt(users.createdAt, inactivityCutoff)))!,
      inArray(users.accountStatus, ["active", "pending", "rejected"]),
      sql`not ${hasRecentLearningActivity(sql`${users.id}`, inactivityCutoff)}`
    );
    const dormant = await db
      .select({ id: users.id })
      .from(users)
      .where(
        inactivityRule
      )
      .limit(config.batchSize);

    let anonymised = 0;
    if (!dryRun && dormant.length > 0) {
      for (const row of chunk(dormant, 100)) {
        const changed = await db
          .update(users)
          .set({
            name: "Former student",
            email: null,
            telegramId: null,
            passwordHash: null,
            accountStatus: "suspended",
            // A rejection reason is free text written about a person. Once the
            // account is anonymised there is nobody left for it to describe, so
            // the field carries the reason for the anonymisation itself.
            statusReason: "anonymised_by_retention",
            statusUpdatedAt: now,
          })
          .where(
            and(inactivityRule, inArray(users.id, row.map((entry) => entry.id)))
          ).returning({ id: users.id });
        anonymised += changed.length;
      }
    }
    results.push({
      rule: "inactive_student_accounts",
      affected: dryRun ? dormant.length : anonymised,
      applied: !dryRun,
      note: "measured on meaningful activity and persisted learner work, falling back to registration; personal fields are scrubbed, structured work stays until its own window closes",
    });

    if (!dryRun) {
      await recordAudit({
        actorUserId: options?.actorUserId ?? null,
        action: "retention.cleanup",
        metadata: { rules: results.map((result) => ({ rule: result.rule, affected: result.affected })) },
      }, db);
    }

    return { config, dryRun, locked, results };
  // PostgreSQL releases the transaction lock on commit AND rollback.
}
