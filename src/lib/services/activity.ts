import "server-only";
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

/**
 * The one place that answers "when did this student last do real work?".
 *
 * Retention needs that question answered honestly: a student who signs in every
 * day to look at the dashboard but never submits anything is inactive in the
 * sense the policy cares about (see services/retention.ts). So this is called
 * from the write paths where work is actually produced and recorded — never from
 * a page render or a session touch.
 *
 * This is a summary, not the sole authority for destructive retention. The
 * cleanup guard also checks persisted learner work below, including legacy
 * writes that predate this clock and submissions where bookkeeping failed.
 */
export async function touchMeaningfulActivity(userId: string): Promise<void> {
  try {
    await db.update(users).set({ lastMeaningfulActivityAt: sql`greatest(${users.lastMeaningfulActivityAt}, ${new Date()})` }).where(eq(users.id, userId));
  } catch {
    // See above: intentionally not fatal.
  }
}

/** Parameterised, read-only evidence from learner-owned records, not logins,
 * page views, staff feedback, or the mere existence of an unfinished attempt.
 * The fixed table list is internal SQL, never caller-controlled identifiers.
 */
export function hasRecentLearningActivity(userId: SQL, since: Date): SQL {
  const sources = [
    ["user_vocabulary", "greatest(a.created_at, a.last_reviewed_at)", "true"],
    ["vocab_point_events", "a.created_at", "a.kind in ('new_word', 'revision', 'game_answer', 'sentence')"],
    ["activity_events", "a.created_at", "a.type = 'VOCAB_GAME_PRACTICED'"],
    ["vocabulary_usages", "a.created_at", "length(trim(a.sentence)) > 0"],
    ["reading_attempts", "a.submitted_at", "a.status = 'completed'"],
    ["listening_attempts", "a.submitted_at", "a.status = 'completed'"],
    ["listening_mcq_sessions", "a.updated_at", "a.stage <> 'listen'"],
    ["writing_submissions", "greatest(a.submitted_at, a.updated_at)", "length(trim(a.content)) > 0"],
    ["typing_runs", "a.created_at", "a.typed_chars > 0"],
    ["upload_intents", "greatest(a.finalized_at, a.used_at)", "a.purpose = 'speaking_recording' and a.status in ('finalized', 'attached')"],
    ["speaking_attempts", "a.submitted_at", "a.submitted_at is not null"],
    ["grammar_attempts", "a.attempted_at", "true"],
    ["assignment_responses", "a.updated_at", "length(trim(a.content)) > 0"],
    ["lesson_progress", "a.completed_at", "a.state = 'completed'"],
    ["video_lesson_progress", "a.updated_at", "a.watched_seconds > 0 or coalesce(a.answers, '{}'::jsonb) <> '{}'::jsonb or length(trim(coalesce(a.response_text, '') || coalesce(a.summary_text, ''))) > 0"],
    ["live_class_attendance", "a.joined_at", "true"],
    ["mock_attempts", "a.finished_at", "a.finished_at is not null"],
  ] as const;
  return sql`(${sql.join(sources.map(([table, timestamp, condition]) =>
    sql`exists (select 1 from ${sql.raw(table)} a where a.user_id = ${userId} and ${sql.raw(timestamp)} >= ${since} and (${sql.raw(condition)}))`
  ), sql` or `)})`;
}
