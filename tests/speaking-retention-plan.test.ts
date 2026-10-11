import test from "node:test";
import assert from "node:assert/strict";
import { planSpeakingRetention, type SpeakingRetentionSnapshot } from "../src/lib/speaking/retention-plan";

const id = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const evaluation = "33333333-3333-4333-8333-333333333333";
const createdAt = "2026-01-01T00:00:00Z";
const proposal = { version: 1, state: "proposed", audioDays: 30, rawTranscriptDays: 90,
  reviewedTranscriptDays: 90, metricsDays: 730, graceDays: 7, orphanRetryHours: 24 };
const snapshot: SpeakingRetentionSnapshot = { version: 1, complete: true, capturedAt: createdAt, holds: [],
  attempts: [{ id, userId, createdAt, recordingObjectKey: "speaking/attempts/" + id + "/answer.webm", recordingSize: 42,
    hasRawTranscript: true, hasReviewedTranscript: true, evaluationIds: [evaluation], hasEvaluationClaim: false, activeSession: false, recordingActive: false }] };
const afterDays = (days: number) => new Date(Date.parse(createdAt) + days * 86_400_000);
test("C08 retains the exact expiry/grace boundary, then plans audio alone without chat pruning", () => {
  const original = JSON.stringify(snapshot);
  assert.deepEqual(planSpeakingRetention(snapshot, proposal, afterDays(37)).decisions[0]!.actions, []);
  const now = new Date(afterDays(37).getTime() + 1);
  const plan = planSpeakingRetention(snapshot, proposal, now);
  assert.deepEqual(plan.decisions[0]!.actions, ["delete_audio"]);
  assert.deepEqual(plan.audioDeletionBytes, { recordedBytes: 42, unknownSizeObjects: 0, source: "database_metadata", objectReadBackVerified: false });
  assert.equal(plan.enabled, false); assert.equal(plan.ownerPolicyApproved, false);
  assert.equal(JSON.stringify(snapshot), original);
});
test("transcript expiry includes derived evaluation prose while keeping transcript-free metrics", () => {
  const plan = planSpeakingRetention(snapshot, proposal, afterDays(98));
  assert.deepEqual(plan.decisions[0]!.actions, ["delete_audio", "clear_raw_transcript", "clear_reviewed_transcript", "redact_evaluation_text"]);
  const full = planSpeakingRetention(snapshot, proposal, afterDays(738));
  assert.deepEqual(full.decisions[0]!.actions, ["delete_audio", "delete_evaluations", "delete_attempt"]);
});
test("recorded holds and in-flight work protect every linked class", () => {
  for (const flag of ["hasEvaluationClaim", "activeSession", "recordingActive"] as const) {
    const plan = planSpeakingRetention({ ...snapshot, attempts: [{ ...snapshot.attempts[0], [flag]: true }] }, proposal, afterDays(738));
    assert.deepEqual(plan.decisions[0]!.actions, []); assert.equal(plan.blocked, 1);
  }
  const held = { ...snapshot, holds: [{ attemptId: id, reasonRef: "hold-1", until: afterDays(738).toISOString() }] };
  assert.equal(planSpeakingRetention(held, proposal, afterDays(738)).blocked, 1);
  assert.equal(planSpeakingRetention(held, proposal, new Date(afterDays(738).getTime() + 1)).blocked, 0);
});
test("foreign/unsafe keys, duplicated provenance and incomplete snapshots fail before planning", () => {
  for (const key of ["site-private/audio.webm", "speaking/attempts/" + userId + "/a.webm",
    "speaking/attempts/" + id + "/../a.webm", "speaking/attempts/" + id + "/a\\b", "speaking/attempts/" + id + "/%2e%2e/a.webm"]) {
    const forged = { ...snapshot, attempts: [{ ...snapshot.attempts[0], recordingObjectKey: key }] };
    assert.throws(() => planSpeakingRetention(forged, proposal, afterDays(738)), /scope/);
  }
  assert.throws(() => planSpeakingRetention({ ...snapshot, attempts: [...snapshot.attempts, ...snapshot.attempts] }, proposal, afterDays(738)), /duplicate/);
  assert.throws(() => planSpeakingRetention({ ...snapshot, complete: false }, proposal, afterDays(738)));
  assert.throws(() => planSpeakingRetention(snapshot, { ...proposal, state: "approved" }, afterDays(738)));
  assert.throws(() => planSpeakingRetention(snapshot, proposal, new Date("invalid")));
});

test("retention byte counts distinguish unknown metadata and exclude protected objects", () => {
  const unknown = { ...snapshot, attempts: [{ ...snapshot.attempts[0], recordingSize: null }] };
  assert.deepEqual(planSpeakingRetention(unknown, proposal, afterDays(98)).audioDeletionBytes,
    { recordedBytes: 0, unknownSizeObjects: 1, source: "database_metadata", objectReadBackVerified: false });
  const protectedAttempt = { ...snapshot, attempts: [{ ...snapshot.attempts[0], recordingActive: true }] };
  assert.equal(planSpeakingRetention(protectedAttempt, proposal, afterDays(98)).audioDeletionBytes.recordedBytes, 0);
  assert.throws(() => planSpeakingRetention({ ...snapshot, attempts: [{ ...snapshot.attempts[0], recordingSize: -1 }] }, proposal, afterDays(98)));
});
