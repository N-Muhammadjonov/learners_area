import { db } from "@/db/client";
import { touchMeaningfulActivity } from "@/lib/services/activity";
import { effectiveCoachConfig } from "./owner-control";
import "server-only";
import { findEvaluation, recordEvaluationEvent, recordFallbackEvent, recordWeaknessesFromEvaluation, saveEvaluation, type EvaluationRecord } from "@/lib/data/evaluations";
import { getStorageService } from "@/lib/services/storage";
import { resolveEvaluation, type CoachEvaluationError, type EvaluationRequest, type ResolveExtras, type ResolvePolicy } from "./resolver";
import type { EvaluationResult, EvaluationType } from "./schema";
import type { ProviderFailure } from "./types";

/**
 * Shared plumbing for every specialised evaluation service.
 *
 * The services (Writing, Speaking, Grammar, Vocabulary, Assignment) each own
 * their own input shape and their own session/authorization rules, but they all
 * go through this function — which means there is exactly one place where an
 * evaluation is de-duplicated, resolved, persisted and fed into weakness
 * tracking. Provider selection is never re-implemented per service.
 */

export type ServiceOutcome =
  | { ok: true; evaluation: EvaluationRecord; reused: boolean; extras?: ResolveExtras }
  | { ok: false; error: ServiceError; detail?: string };

export type ServiceError =
  | CoachEvaluationError
  | "transcript_unavailable"
  | "stt_not_configured"
  | "unsupported_task_type"
  | "invalid_input";

export type TranscriptOrigin = "stt" | "manual";

/**
 * Ask the configured SpeechToTextService for a transcript of a private
 * recording. Nothing is stored by this function; the caller decides whether a
 * transcript is worth keeping (and tags its origin, so a typed transcript is
 * never presented as machine transcription).
 */
export async function transcribePrivateRecording(params: {
  objectKey: string;
  contentType: string | null;
  durationMs: number | null;
  language: "uz" | "en";
}): Promise<
  | { ok: true; transcript: string; providerId: string; confidence: number | null }
  | { ok: false; failure: ProviderFailure }
> {
  const { SpeechToTextService } = await import("./stt");
  if (!SpeechToTextService.isConfigured()) {
    return {
      ok: false,
      failure: {
        reason: "not_configured",
        detail: "No speech-to-text provider is configured (STT_PRIMARY_PROVIDER).",
        retryable: false,
      },
    };
  }

  // The adapter receives the private object key and reads the bytes through the
  // application storage service. Recordings never become public objects just to
  // be transcribed.
  const storage = getStorageService();
  const head = await storage.head(params.objectKey);
  if (!head) {
    return {
      ok: false,
      failure: { reason: "network", detail: "recording_object_missing", retryable: false },
    };
  }

  const control = await effectiveCoachConfig();
  const outcome = await SpeechToTextService.transcribe({
    objectKey: params.objectKey,
    contentType: params.contentType,
    durationMs: params.durationMs,
    language: params.language,
  }, { externalEnabled: control.externalEnabled });
  if (!outcome.ok) return { ok: false, failure: outcome.failure };
  return {
    ok: true,
    transcript: outcome.transcript,
    providerId: outcome.providerId,
    confidence: outcome.confidence,
  };
}

export async function evaluateAndPersist(params: {
  userId: string;
  evaluationType: EvaluationType;
  sourceType: string;
  sourceId: string;
  request: EvaluationRequest;
  language: "uz" | "en";
  /** Default "riwi". Grade My Work passes "none" (external result or nothing). */
  policy?: ResolvePolicy;
  /** Last check before persisting; null rejects the result (nothing is saved). */
  normalize?: (result: EvaluationResult) => EvaluationResult | null;
}): Promise<ServiceOutcome> {
  // 1. One authoritative evaluation per submission. An existing row is reused,
  //    so a retry never pays a provider twice and never produces a second,
  //    competing verdict for the same work.
  const existing = await findEvaluation({ sourceType: params.sourceType, sourceId: params.sourceId });
  if (existing) return { ok: true, evaluation: existing, reused: true };

  // 2. Resolve: configured provider first, RIWI on any failure.
  //    Owner master switch + deployment ceiling, enforced server-side (fail-closed).
  const control = await effectiveCoachConfig();
  const outcome = await resolveEvaluation(params.request, {
    userId: params.userId,
    language: params.language,
  }, { externalEnabled: control.externalEnabled, aiPrimaryProvider: control.aiPrimaryProvider, modelOverride: control.modelOverride ?? null },
  // The stricter policy wins: a caller's "none" (Grade My Work) is never relaxed,
  // and the owner may make every check strict.
  params.policy?.fallback === "none" || control.ownerFallback === "none" ? { fallback: "none" } : { fallback: "riwi" });
  if (!outcome.ok) {
    return { ok: false, error: outcome.error };
  }
  const result = params.normalize ? params.normalize(outcome.result) : outcome.result;
  if (!result) return { ok: false, error: "invalid_evaluation" };

  /*
   * 3. Persist the result together with the identity of the evaluator that actually produced it.
   *
   * All four writes are ONE transaction, and this is what makes the step-1 de-duplication safe
   * rather than a trap. Step 1 returns `{ reused: true }` before the provider is ever called, so once
   * an evaluation row exists no retry reaches this block again. A partial write here was therefore
   * unrecoverable: if the evaluation committed but a weakness row or the completion event did not,
   * nothing would ever write them, and the learner would keep a verdict that `coach-dashboard.ts`
   * could not account for. Committing the four together means either the whole record exists or the
   * learner can simply try again.
   *
   * The provider call in step 2 stays OUTSIDE the transaction: a pooled connection is never held
   * while waiting on an external AI provider. Nothing in here is best-effort either, so a failure
   * rolls the unit back instead of being swallowed.
   */
  const { record, created } = await db.transaction(async (tx) => {
    const saved = await saveEvaluation(
      {
        userId: params.userId,
        evaluationType: params.evaluationType,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        result,
      },
      tx,
    );
    // Lost the race, or the work was already evaluated: the winner wrote the side effects, so this
    // caller must not write them a second time.
    if (!saved.created) return saved;

    await recordWeaknessesFromEvaluation(
      { userId: params.userId, evaluationType: params.evaluationType, result },
      tx,
    );
    await recordEvaluationEvent(
      {
        userId: params.userId,
        evaluationType: params.evaluationType,
        providerId: saved.record.providerId,
        sourceId: params.sourceId,
        overallEstimate: saved.record.overallEstimate,
      },
      tx,
    );
    if (saved.record.fallbackUsed && saved.record.fallbackFrom) {
      await recordFallbackEvent(
        {
          userId: params.userId,
          evaluationType: params.evaluationType,
          fallbackFrom: saved.record.fallbackFrom,
          sourceId: params.sourceId,
        },
        tx,
      );
    }
    return saved;
  });

  if (created) {
    /*
     * Real work was produced and recorded: the retention clock cares about this, not about how often
     * the student signed in. Deliberately OUTSIDE the transaction and after the commit — it is
     * documented as best-effort and non-fatal, so making it a prerequisite would let a timestamp
     * update roll back a verdict the learner had already earned.
     */
    await touchMeaningfulActivity(params.userId);
  }

  return { ok: true, evaluation: record, reused: !created, extras: outcome.extras };
}
