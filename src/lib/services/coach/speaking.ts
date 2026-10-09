import "server-only";
import { evaluateAndPersist, type ServiceOutcome } from "./service";
import type { SpeakingPart } from "./types";
import { speakingContractKey } from "./contracts/registry";

export type SpeakingEvaluationRequest = {
  userId: string;
  attemptId: string;
  part: SpeakingPart;
  promptText: string | null;
  /**
   * The transcript to evaluate, or null. There are exactly two honest sources:
   * a configured SpeechToTextService, or the student's own typed transcript
   * (clearly labelled as such). Nothing else may populate this field.
   */
  transcript: string | null;
  transcriptOrigin: "stt" | "manual" | "browser_stt" | null;
  durationMs: number | null;
  language: "uz" | "en";
  persist?: Parameters<typeof evaluateAndPersist>[0]["persist"];
};

/**
 * SpeakingEvaluationService.
 *
 * Deliberately separate from SpeechToTextService: transcription produces text,
 * this service judges it. That separation is why an STT provider can never be
 * reported as the evaluator in "Checked by" — it has no access to the
 * evaluation path at all.
 *
 * With no transcript there is no evaluation. RIWI will not infer spoken content
 * from audio, because it cannot.
 */
export async function evaluateSpeakingAttempt(
  input: SpeakingEvaluationRequest
): Promise<ServiceOutcome> {
  if (!input.transcript || input.transcript.trim().length === 0) {
    return { ok: false, error: "transcript_unavailable" };
  }

  // No acoustic evidence enters this transcript-only request. Registry capability alone is not assessment.

  return evaluateAndPersist({
    userId: input.userId,
    evaluationType: "speaking",
    sourceType: "speaking_attempt",
    sourceId: input.attemptId,
    language: input.language,
    persist: input.persist,
    request: speakingEvaluationRequest(input),
  });
}


/** Transcript-only requests never assert that a registry capability assessed these bytes. */
export function speakingEvaluationRequest(input: SpeakingEvaluationRequest) {
  return { evaluationType: "speaking" as const, assessmentContractKey: speakingContractKey(input.part), input: {
    part: input.part, promptText: input.promptText, transcript: input.transcript, transcriptOrigin: input.transcriptOrigin, durationMs: input.durationMs, pronunciationAvailable: false,
  } };
}
