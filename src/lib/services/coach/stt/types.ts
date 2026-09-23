import type { ProviderFailure } from "../types";

/**
 * Speech-to-text is deliberately a *separate* subsystem from evaluation.
 *
 * Reasons this is not one "AI service":
 *   - a transcription provider and an evaluation provider are often different
 *     companies, and the project must allow "STT Provider A + Evaluation
 *     Provider B" or "STT Provider C + RIWI";
 *   - transcription is not evaluation, so a transcription provider must never
 *     appear as the evaluator in "Checked by";
 *   - audio never leaves the private storage path except through an adapter the
 *     operator explicitly configured.
 *
 * `STT_PRIMARY_PROVIDER` and `AI_PRIMARY_PROVIDER` are read independently.
 */

export type SttCapability = "speech-to-text" | "audio-input" | "pronunciation";

export type TranscriptionRequest = {
  /**
   * The private object key of the recording. An adapter reads the bytes through
   * the application's storage service — it is never handed a public URL, and
   * never given a signed URL that could outlive the request.
   */
  objectKey: string;
  contentType: string | null;
  durationMs: number | null;
  language: "uz" | "en";
  signal?: AbortSignal;
};

export type TranscriptionResult =
  | {
      ok: true;
      providerId: string;
      providerDisplayName: string;
      transcript: string;
      /** Null when the provider does not report a confidence. Never invented. */
      confidence: number | null;
    }
  | { ok: false; failure: ProviderFailure };

export interface SpeechToTextProvider {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly type: "internal" | "external";
  readonly capabilities: readonly SttCapability[];
  /** Environment-variable NAMES only. */
  readonly requiredSecrets: readonly string[];
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}
