import type { speakingAttempts } from "@/db/schema";

/** Internal worker claims are never exposed through a learner API. */
export function learnerSpeakingAttempt(attempt: typeof speakingAttempts.$inferSelect) {
  return {
    id: attempt.id, userId: attempt.userId, promptId: attempt.promptId, part: attempt.part, status: attempt.status,
    recordingObjectKey: attempt.recordingObjectKey, recordingOriginalName: attempt.recordingOriginalName,
    recordingMimeType: attempt.recordingMimeType, recordingSize: attempt.recordingSize, recordingDurationMs: attempt.recordingDurationMs, recordingSha256: attempt.recordingSha256,
    transcript: attempt.transcript, transcriptOrigin: attempt.transcriptOrigin, transcriptRaw: attempt.transcriptRaw, transcriptEdited: attempt.transcriptEdited, transcriptEditedAt: attempt.transcriptEditedAt,
    retryOfAttemptId: attempt.retryOfAttemptId, aiSessionId: attempt.aiSessionId, aiSessionItemId: attempt.aiSessionItemId,
    startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, createdAt: attempt.createdAt,
  };
}
