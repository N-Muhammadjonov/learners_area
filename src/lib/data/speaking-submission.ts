import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { evaluations, speakingAttempts, speakingAiSessionItems, speakingAiSessions, users } from "@/db/schema";
import { findEvaluation, saveEvaluation } from "./evaluations";
import { evaluateSpeakingAttempt, transcribePrivateRecording } from "@/lib/services/coach";
import { readCoachConfig } from "@/lib/services/coach/config";
import { getStorageService } from "@/lib/services/storage";
import { submitAttemptSchema } from "@/lib/validation/speaking-practice";
import { z } from "zod";

type Body = z.infer<typeof submitAttemptSchema>;
type Attempt = typeof speakingAttempts.$inferSelect;
export class SpeakingClaimLost extends Error { constructor() { super("evaluation_claim_lost"); } }
const fail = (error: string, status = 409) => ({ ok: false as const, error, status });

/** Claim is committed before external work; the pool is never held across a provider call. */
export async function claimSpeakingSubmission(database: typeof db, userId: string, id: string, body: Body) {
  return database.transaction(async tx => {
    const [attempt] = await tx.select().from(speakingAttempts).where(and(eq(speakingAttempts.id, id), eq(speakingAttempts.userId, userId))).for("update");
    if (!attempt) return fail("not_found", 404);

    const [clock] = await tx.select({ now: sql<Date>`clock_timestamp()` }).from(speakingAttempts).where(eq(speakingAttempts.id, id)).limit(1);
    if (!clock) return fail("not_found", 404);
    const currentTime = new Date(clock.now).getTime();
    if (attempt.evaluationClaimToken && attempt.evaluationClaimExpiresAt!.getTime() > currentTime) return fail("evaluation_in_progress");
    if (!attempt.recordingObjectKey) return fail("no_recording");
    if (body.durationMs !== undefined && attempt.recordingDurationMs !== null && body.durationMs !== attempt.recordingDurationMs) return fail("recording_metadata_conflict");
    if (attempt.status !== "recording" && attempt.transcript) {
      const supplied = body.browserTranscript ?? body.manualTranscript;
      if (supplied !== undefined && supplied.trim() !== attempt.transcript) return fail("transcript_locked");
      if (body.browserTranscriptRaw !== undefined && body.browserTranscriptRaw.trim() !== attempt.transcriptRaw) return fail("transcript_locked");
    }
    const existing = await findEvaluation({ sourceType: "speaking_attempt", sourceId: id }, tx);
    if (existing) return { ok: true as const, attempt, existing, token: null };
    if (attempt.aiSessionId || attempt.aiSessionItemId) {
      const session = await tx.query.speakingAiSessions.findFirst({ where: and(eq(speakingAiSessions.id, attempt.aiSessionId!), eq(speakingAiSessions.userId, userId)) });
      const item = await tx.query.speakingAiSessionItems.findFirst({ where: and(eq(speakingAiSessionItems.id, attempt.aiSessionItemId!), eq(speakingAiSessionItems.sessionId, attempt.aiSessionId!)) });
      if (!session || !item || session.status !== "active" || item.status !== "pending" || item.ordinal !== session.currentItemIndex + 1 || item.promptId !== attempt.promptId || item.part !== attempt.part) return fail("stale_session_position");
    }
    if (attempt.aiSessionItemId) {
      const latest = await tx.query.speakingAttempts.findFirst({ where: and(eq(speakingAttempts.userId, userId), eq(speakingAttempts.aiSessionItemId, attempt.aiSessionItemId)), orderBy: [desc(speakingAttempts.createdAt), desc(speakingAttempts.id)] });
      if (latest?.id !== id) return fail("stale_answer_generation");
    }
    const config = readCoachConfig();
    // Includes STT, primary retries and bounded fallback plus a persistence margin.
    const leaseMs = 30_000 + 3 * config.maxAttempts * (config.timeoutMs + config.retryBackoffMs);
    const token = randomUUID();
    await tx.update(speakingAttempts).set({ evaluationClaimToken: token, evaluationClaimExpiresAt: new Date(currentTime + leaseMs) }).where(eq(speakingAttempts.id, id));
    return { ok: true as const, attempt, existing: null, token };
  });
}

export async function releaseSpeakingClaim(database: typeof db, id: string, token: string) {
  await database.update(speakingAttempts).set({ evaluationClaimToken: null, evaluationClaimExpiresAt: null }).where(and(eq(speakingAttempts.id, id), eq(speakingAttempts.evaluationClaimToken, token)));
}

/** The claim fence and result insertion are checked in the same transaction. */
export async function persistSpeakingEvaluation(database: typeof db, userId: string, id: string, token: string, result: Parameters<typeof saveEvaluation>[0]["result"]) {
  return database.transaction(async tx => {
    const [attempt] = await tx.select().from(speakingAttempts).where(and(eq(speakingAttempts.id, id), eq(speakingAttempts.userId, userId), sql`${speakingAttempts.evaluationClaimExpiresAt} > clock_timestamp()`)).for("update");
    if (!attempt || attempt.evaluationClaimToken !== token) throw new SpeakingClaimLost();
    const user = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (user?.accountStatus !== "active") throw new SpeakingClaimLost();
    const saved = await saveEvaluation({ userId, evaluationType: "speaking", sourceType: "speaking_attempt", sourceId: id, result }, tx);
    await tx.update(speakingAttempts).set({ evaluationClaimToken: null, evaluationClaimExpiresAt: null }).where(eq(speakingAttempts.id, id));
    return saved;
  });
}

/** Only bytes from the owned attached key establish the recording hash. */
export async function recordingFingerprint(storage: Pick<ReturnType<typeof getStorageService>, "readBounded">, attempt: Attempt) {
  if (!attempt.recordingObjectKey || !attempt.recordingSize || attempt.recordingSize > 50 * 1024 * 1024) throw new Error("recording_integrity_failed");
  const object = await storage.readBounded(attempt.recordingObjectKey, attempt.recordingSize);
  if (!object || object.body.length !== attempt.recordingSize || (attempt.recordingSha256 && createHash("sha256").update(object.body).digest("hex") !== attempt.recordingSha256)) throw new Error("recording_integrity_failed");
  return createHash("sha256").update(object.body).digest("hex");
}

type Dependencies = {
  fingerprint: (attempt: Attempt) => Promise<string>;
  transcribe: typeof transcribePrivateRecording;
  evaluate: typeof evaluateSpeakingAttempt;
};
const defaults: Dependencies = {
  fingerprint: attempt => recordingFingerprint(getStorageService(), attempt),
  transcribe: transcribePrivateRecording,
  evaluate: evaluateSpeakingAttempt,
};

export async function submitSpeakingAttempt(database: typeof db, userId: string, id: string, body: Body, language: "uz" | "en", dependencies: Dependencies = defaults) {
  const claim = await claimSpeakingSubmission(database, userId, id, body);
  if (!claim.ok) return claim;
  if (claim.existing) return { ok: true as const, attempt: claim.attempt, evaluation: claim.existing, reused: true };
  const token = claim.token!;
  try {
    const sha256 = await dependencies.fingerprint(claim.attempt);
    let transcript = claim.attempt.transcript;
    let transcriptRaw = claim.attempt.transcriptRaw;
    let transcriptOrigin = claim.attempt.transcriptOrigin as "manual" | "browser_stt" | "stt" | null;
    let transcriptProvider = claim.attempt.transcriptProvider;
    let transcriptEdited = claim.attempt.transcriptEdited;
    if (claim.attempt.status === "recording" || !transcript) {
      if (body.browserTranscript) {
        transcript = body.browserTranscript.trim(); transcriptRaw = (body.browserTranscriptRaw ?? body.browserTranscript).trim(); transcriptOrigin = "browser_stt";
        transcriptEdited = transcript !== transcriptRaw;
      } else if (body.manualTranscript) {
        transcript = body.manualTranscript.trim(); transcriptRaw = transcript; transcriptOrigin = "manual";
      } else {
        const speech = await dependencies.transcribe({ objectKey: claim.attempt.recordingObjectKey!, contentType: claim.attempt.recordingMimeType, durationMs: claim.attempt.recordingDurationMs, language });
        if (!speech.ok) {
          // Practice on Your Own can save audio without inventing a transcript.
          const [audioOnly] = await database.update(speakingAttempts).set({ status: "submitted", submittedAt: claim.attempt.submittedAt ?? new Date(), recordingSha256: sha256 })
            .where(and(eq(speakingAttempts.id,id),eq(speakingAttempts.evaluationClaimToken,token))).returning();
          if (!audioOnly) return fail("evaluation_in_progress");
          return { ok: true as const, attempt: { ...audioOnly, evaluationClaimToken: null, evaluationClaimExpiresAt: null }, evaluation: null, reused: false };
        }
        transcript = speech.transcript.trim(); transcriptRaw = transcript; transcriptOrigin = "stt"; transcriptProvider = speech.providerId;
      }
    }
    if (!transcript) return fail("transcript_unavailable", 503);
    const [updated] = await database.update(speakingAttempts).set({ status: "submitted", submittedAt: claim.attempt.submittedAt ?? new Date(), recordingSha256: sha256,
      transcript, transcriptRaw, transcriptOrigin, transcriptProvider, transcriptEdited,
      transcriptEditedAt: claim.attempt.transcriptEditedAt ?? (transcriptEdited ? new Date() : null),
    }).where(and(eq(speakingAttempts.id, id), eq(speakingAttempts.evaluationClaimToken, token))).returning();
    if (!updated) return fail("evaluation_in_progress");
    const prompt = updated.promptId ? await database.query.speakingPrompts.findFirst({ where: (p, { eq: equals }) => equals(p.id, updated.promptId!) }) : null;
    const outcome = await dependencies.evaluate({ userId, attemptId: id, part: updated.part, promptText: prompt?.promptText ?? null, transcript, transcriptOrigin,
      durationMs: updated.recordingDurationMs, language, persist: result => persistSpeakingEvaluation(database, userId, id, token, result) });
    if (!outcome.ok) return fail(outcome.error, 503);
    return { ok: true as const, attempt: { ...updated, evaluationClaimToken: null, evaluationClaimExpiresAt: null }, evaluation: outcome.evaluation, reused: outcome.reused };
  } catch (error) {
    return fail(error instanceof SpeakingClaimLost ? "evaluation_in_progress" : "evaluation_unavailable", error instanceof SpeakingClaimLost ? 409 : 503);
  } finally { await releaseSpeakingClaim(database, id, token); }
}

export async function discardSpeakingAttempt(database: typeof db, userId: string, id: string) {
  return database.transaction(async tx => {
    const [attempt] = await tx.select().from(speakingAttempts).where(and(eq(speakingAttempts.id, id), eq(speakingAttempts.userId, userId))).for("update");
    if (!attempt) return fail("not_found", 404);
    if (attempt.status !== "recording" || attempt.evaluationClaimToken) return fail("attempt_already_submitted");
    await tx.delete(evaluations).where(and(eq(evaluations.sourceType, "speaking_attempt"), eq(evaluations.sourceId, id)));
    await tx.delete(speakingAttempts).where(eq(speakingAttempts.id, id));
    return { ok: true as const, objectKey: attempt.recordingObjectKey };
  });
}
