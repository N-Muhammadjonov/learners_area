import "server-only";
import { eq, sql } from "drizzle-orm";
import type { db } from "@/db/client";
import { evaluations, speakingAttempts, speakingAiSessions, speakingAiSessionItems } from "@/db/schema";
import { speakingRetentionSnapshotSchema, type SpeakingRetentionSnapshot } from "@/lib/speaking/retention-plan";

/** Read-only planning source. Explicit recorded hold inventory is mandatory;
 * it is not inferred from chat activity or from a missing policy. This function
 * never reads transcript/audio content and never schedules or applies deletion. */
export async function readSpeakingRetentionSnapshot(database: typeof db, holds: SpeakingRetentionSnapshot["holds"]) {
  return database.transaction(async tx => {
    const clock = await tx.execute<{ now: string }>(sql.raw("select transaction_timestamp()::text as now"));
    const capturedAt = new Date(clock.rows[0]!.now).toISOString();
    const rows = await tx.select({
      id: speakingAttempts.id, userId: speakingAttempts.userId, createdAt: speakingAttempts.createdAt,
      status: speakingAttempts.status, linkedSessionId: speakingAttempts.aiSessionId,
      recordingObjectKey: speakingAttempts.recordingObjectKey,
      recordingSize: speakingAttempts.recordingSize,
      hasRawTranscript: sql.raw("speaking_attempts.transcript_raw is not null and speaking_attempts.transcript_raw <> ''"),
      hasReviewedTranscript: sql.raw("speaking_attempts.transcript is not null and speaking_attempts.transcript <> ''"),
      hasEvaluationClaim: sql.raw("speaking_attempts.evaluation_claim_token is not null"),
      sessionId: speakingAiSessions.id, sessionUserId: speakingAiSessions.userId, sessionStatus: speakingAiSessions.status,
    }).from(speakingAttempts).leftJoin(speakingAiSessions, eq(speakingAttempts.aiSessionId, speakingAiSessions.id));
    const measured = await tx.select({ id: evaluations.id, sourceId: evaluations.sourceId, userId: evaluations.userId,
      evaluationType: evaluations.evaluationType }).from(evaluations).where(eq(evaluations.sourceType, "speaking_attempt"));
    const attempts = new Map(rows.map(a => [a.id, a]));
    // Session items can reference an attempt even when its direct session link
    // is absent. Read both directions in this same read-only transaction.
    const linkedItems = await tx.select({ attemptId: speakingAiSessionItems.attemptId,
      sessionId: speakingAiSessions.id, sessionUserId: speakingAiSessions.userId,
      sessionStatus: speakingAiSessions.status,
    }).from(speakingAiSessionItems).innerJoin(speakingAiSessions, eq(speakingAiSessionItems.sessionId, speakingAiSessions.id));
    const activeItemAttempts = new Set<string>();
    for (const item of linkedItems) {
      if (item.attemptId === null) continue;
      const attempt = attempts.get(item.attemptId);
      if (!attempt || item.sessionUserId !== attempt.userId
        || (attempt.linkedSessionId !== null && attempt.linkedSessionId !== item.sessionId)) {
        throw new Error("retention_session_scope_invalid");
      }
      if (item.sessionStatus === "active") activeItemAttempts.add(item.attemptId);
    }
    const byAttempt = new Map<string, string[]>();
    for (const e of measured) {
      const attempt = attempts.get(e.sourceId);
      if (!attempt || e.userId !== attempt.userId || e.evaluationType !== "speaking") throw new Error("retention_evaluation_scope_invalid");
      byAttempt.set(e.sourceId, [...(byAttempt.get(e.sourceId) ?? []), e.id]);
    }
    return speakingRetentionSnapshotSchema.parse({ version: 1, capturedAt, complete: true, holds,
      attempts: rows.map(a => {
        if (a.sessionId && a.sessionUserId !== a.userId) throw new Error("retention_session_scope_invalid");
        return { id: a.id, userId: a.userId, createdAt: a.createdAt.toISOString(), recordingObjectKey: a.recordingObjectKey, recordingSize: a.recordingSize,
          hasRawTranscript: a.hasRawTranscript, hasReviewedTranscript: a.hasReviewedTranscript,
          evaluationIds: (byAttempt.get(a.id) ?? []).sort(), hasEvaluationClaim: a.hasEvaluationClaim,
          activeSession: a.sessionStatus === "active" || activeItemAttempts.has(a.id), recordingActive: a.status === "recording" };
      }).sort((a, b) => a.id.localeCompare(b.id)),
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
