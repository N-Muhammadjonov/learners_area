import { createHash } from "node:crypto";
import { z } from "zod";

/** C08 proposal only. No clock, database, object store or deletion side effects. */
const days = z.number().int().min(1).max(3650);
export const speakingRetentionProposalSchema = z.object({
  version: z.literal(1),
  state: z.literal("proposed"),
  audioDays: days,
  rawTranscriptDays: days,
  reviewedTranscriptDays: days,
  metricsDays: days,
  graceDays: z.number().int().min(0).max(365),
  orphanRetryHours: z.number().int().min(1).max(168),
}).strict().superRefine((p, ctx) => {
  if (p.metricsDays < Math.max(p.audioDays, p.rawTranscriptDays, p.reviewedTranscriptDays)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "metrics must outlive sensitive source classes" });
  }
});
export type SpeakingRetentionProposal = z.infer<typeof speakingRetentionProposalSchema>;
const instant = z.string().datetime({ offset: true });
export const speakingRetentionSnapshotSchema = z.object({
  version: z.literal(1),
  capturedAt: instant,
  complete: z.literal(true),
  attempts: z.array(z.object({
    id: z.string().uuid(), userId: z.string().uuid(), createdAt: instant,
    recordingObjectKey: z.string().min(1).nullable(),
    recordingSize: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    hasRawTranscript: z.boolean(), hasReviewedTranscript: z.boolean(),
    evaluationIds: z.array(z.string().uuid()),
    hasEvaluationClaim: z.boolean(), activeSession: z.boolean(), recordingActive: z.boolean(),
  }).strict()),
  holds: z.array(z.object({
    attemptId: z.string().uuid(), reasonRef: z.string().min(1).max(120),
    until: instant.nullable(),
  }).strict()),
}).strict();
export type SpeakingRetentionSnapshot = z.infer<typeof speakingRetentionSnapshotSchema>;
type Action = "delete_audio" | "clear_raw_transcript" | "clear_reviewed_transcript"
  | "redact_evaluation_text" | "delete_evaluations" | "delete_attempt";
type Decision = { attemptId: string; actions: Action[]; blockedBy: string[] };
const DAY = 86_400_000;

/** Planning is separate from D-01 chat retention. Caller supplies an immutable
 * complete snapshot and explicit evaluation instant. At the exact expiry/grace
 * boundary the record is retained. Unknown/foreign metadata fails closed.
 * Evaluation prose/quotes cannot remain indefinitely as a transcript copy. */
export function planSpeakingRetention(snapshotInput: unknown, proposalInput: unknown, now: Date) {
  const snapshot = speakingRetentionSnapshotSchema.parse(snapshotInput);
  const proposal = speakingRetentionProposalSchema.parse(proposalInput);
  const at = now.getTime(), captured = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(at) || at < captured) throw new Error("retention_clock_invalid");
  const seen = new Set<string>(), evaluationIds = new Set<string>(), keys = new Set<string>();
  const ids = new Set(snapshot.attempts.map(a => a.id));
  for (const hold of snapshot.holds) if (!ids.has(hold.attemptId)) throw new Error("retention_unknown_hold");
  const decisions: Decision[] = [];
  for (const a of [...snapshot.attempts].sort((x, y) => x.id.localeCompare(y.id))) {
    if (seen.has(a.id)) throw new Error("retention_duplicate_attempt");
    seen.add(a.id);
    const created = Date.parse(a.createdAt);
    if (created > captured) throw new Error("retention_snapshot_clock_invalid");
    for (const id of a.evaluationIds) {
      if (evaluationIds.has(id)) throw new Error("retention_duplicate_evaluation");
      evaluationIds.add(id);
    }
    if (a.recordingObjectKey !== null) {
      const prefix = "speaking/attempts/" + a.id + "/";
      const tail = a.recordingObjectKey.slice(prefix.length);
      if (!a.recordingObjectKey.startsWith(prefix) || !tail || tail.includes("\\")
        || tail.split("/").some(p => !p || p === "." || p === "..")
        || /[\u0000-\u001f\u007f%?#\s]/.test(tail) || keys.has(a.recordingObjectKey)) {
        throw new Error("retention_object_scope_invalid");
      }
      keys.add(a.recordingObjectKey);
    }
    const blockedBy: string[] = [];
    if (a.recordingActive) blockedBy.push("active_recording");
    if (a.hasEvaluationClaim) blockedBy.push("evaluation_claim");
    if (a.activeSession) blockedBy.push("active_session");
    if (snapshot.holds.some(h => h.attemptId === a.id && (h.until === null || Date.parse(h.until) >= at))) blockedBy.push("recorded_hold");
    const actions: Action[] = [];
    const expired = (duration: number) => at > created + (duration + proposal.graceDays) * DAY;
    if (!blockedBy.length) {
      if (expired(proposal.metricsDays)) {
        if (a.recordingObjectKey) actions.push("delete_audio");
        if (a.evaluationIds.length) actions.push("delete_evaluations");
        actions.push("delete_attempt");
      } else {
        if (a.recordingObjectKey && expired(proposal.audioDays)) actions.push("delete_audio");
        if (a.hasRawTranscript && expired(proposal.rawTranscriptDays)) actions.push("clear_raw_transcript");
        if (a.hasReviewedTranscript && expired(proposal.reviewedTranscriptDays)) actions.push("clear_reviewed_transcript");
        if (a.evaluationIds.length && expired(Math.min(proposal.rawTranscriptDays, proposal.reviewedTranscriptDays))) actions.push("redact_evaluation_text");
      }
    }
    decisions.push({ attemptId: a.id, actions, blockedBy });
  }
  const counts: Record<Action, number> = { delete_audio: 0, clear_raw_transcript: 0,
    clear_reviewed_transcript: 0, redact_evaluation_text: 0, delete_evaluations: 0, delete_attempt: 0 };
  for (const d of decisions) for (const action of d.actions) counts[action]++;
  let recordedBytes = 0, unknownSizeObjects = 0;
  const attemptsById = new Map(snapshot.attempts.map(a => [a.id, a]));
  for (const d of decisions) if (d.actions.includes("delete_audio")) {
    const size = attemptsById.get(d.attemptId)!.recordingSize;
    if (size === null) unknownSizeObjects++;
    else recordedBytes += size;
    if (!Number.isSafeInteger(recordedBytes)) throw new Error("retention_byte_total_invalid");
  }
  const proposalSha256 = createHash("sha256").update(JSON.stringify(proposal)).digest("hex");
  const snapshotSha256 = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return { version: 1 as const, mode: "dry_run" as const, enabled: false as const,
    ownerPolicyApproved: false as const, generatedAt: now.toISOString(),
    capturedAt: snapshot.capturedAt, proposalSha256, snapshotSha256,
    attempts: decisions.length, blocked: decisions.filter(d => d.blockedBy.length).length, counts, decisions,
    audioDeletionBytes: { recordedBytes, unknownSizeObjects, source: "database_metadata" as const, objectReadBackVerified: false as const },
    limitations: ["No database or object was changed", "A complete database snapshot is required; object inventory and orphan read-back are separate",
      "Proposed durations are not an approved deletion policy", "No executable deletion or production scheduler is enabled"] };
}
