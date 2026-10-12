import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAttempts } from "@/db/schema";
import { transcribePrivateRecording } from "@/lib/services/coach";
import type { ProviderFailure } from "@/lib/services/coach/types";
import type { SpeakingAttemptRow } from "./attempts";

/** Recording persistence is independent of automated transcription availability. */
export async function saveSpeakingSubmission(
  input: { attempt: SpeakingAttemptRow; durationMs?: number; manualTranscript: string; language: "en" | "uz" },
  deps: { database?: typeof db; transcribe?: typeof transcribePrivateRecording } = {},
) {
  const database = deps.database ?? db;
  const transcribe = deps.transcribe ?? transcribePrivateRecording;
  let transcript: string | null = null;
  let transcriptOrigin: "stt" | "manual" | null = null;
  let transcriptProvider: string | null = null;
  let transcriptionFailure: Pick<ProviderFailure, "reason" | "retryable"> | null = null;
  if (input.manualTranscript.length >= 10) {
    transcript = input.manualTranscript;
    transcriptOrigin = "manual";
  } else {
    const speech = await transcribe({
      objectKey: input.attempt.recordingObjectKey!,
      contentType: input.attempt.recordingMimeType,
      durationMs: input.durationMs ?? input.attempt.recordingDurationMs,
      language: input.language,
    });
    if (speech.ok) {
      transcript = speech.transcript;
      transcriptOrigin = "stt";
      transcriptProvider = speech.providerId;
    } else {
      transcriptionFailure = { reason: speech.failure.reason, retryable: speech.failure.retryable };
    }
  }
  const [attempt] = await database.update(speakingAttempts).set({
    status: "submitted",
    submittedAt: new Date(),
    ...(input.durationMs !== undefined ? { recordingDurationMs: input.durationMs } : {}),
    ...(transcript ? { transcript, transcriptOrigin, transcriptProvider } : {}),
  }).where(eq(speakingAttempts.id, input.attempt.id)).returning();
  if (!attempt) throw new Error("speaking_attempt_not_persisted");
  return { attempt, transcript, transcriptOrigin, transcriptionFailure };
}
