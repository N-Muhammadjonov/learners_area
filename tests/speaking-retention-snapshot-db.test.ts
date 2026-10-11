import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestDatabase } from "./support/pglite";
import { readSpeakingRetentionSnapshot } from "../src/lib/data/speaking-retention-snapshot";
import { planSpeakingRetention } from "../src/lib/speaking/retention-plan";
import { speakingAiSessions, speakingAiSessionItems, speakingPrompts, speakingAttempts, users } from "../src/db/schema";
const proposal = { version: 1, state: "proposed", audioDays: 30, rawTranscriptDays: 90,
  reviewedTranscriptDays: 90, metricsDays: 730, graceDays: 7, orphanRetryHours: 24 };

test("Speaking dry-run reads one coherent database snapshot without sensitive text or writes", async () => {
  const database = await createTestDatabase();
  try {
    const user = randomUUID(), id = randomUUID(), key = "speaking/attempts/" + id + "/audio.webm";
    await database.query("insert into users(id,name,role)values($1,'Retention fixture','student')", [user]);
    await database.query("insert into speaking_attempts(id,user_id,part,status,recording_object_key,recording_size,transcript_raw,transcript,created_at)values($1,$2,'part1','submitted',$3,42,'PRIVATE_RAW_MARKER','PRIVATE_REVIEWED_MARKER',now()-interval '98 days')", [id, user, key]);
    const before = await database.query("select * from speaking_attempts order by id");
    const snapshot = await readSpeakingRetentionSnapshot(database.db, []);
    assert.equal(snapshot.attempts.length, 1);
    assert.equal(snapshot.attempts[0]!.hasRawTranscript, true);
    assert.equal(snapshot.attempts[0]!.hasReviewedTranscript, true);
    assert.ok(!JSON.stringify(snapshot).includes("PRIVATE_"));
    const plan = planSpeakingRetention(snapshot, proposal, new Date(snapshot.capturedAt));
    assert.deepEqual(plan.decisions[0]!.actions, ["delete_audio", "clear_raw_transcript", "clear_reviewed_transcript"]);
    assert.equal(plan.audioDeletionBytes.recordedBytes, 42);
    assert.deepEqual(await database.query("select * from speaking_attempts order by id"), before);
  } finally { await database.close(); }
});

test("active recordings and indirect active session items protect audio and both transcripts", async () => {
  const database = await createTestDatabase();
  try {
    const user = randomUUID(), recording = randomUUID(), linked = randomUUID(), session = randomUUID(), prompt = randomUUID();
    await database.db.insert(users).values({ id: user, name: "Retention guard fixture" });
    await database.db.insert(speakingPrompts).values({ id: prompt, part: "part1", category: "general", promptText: "A fixture prompt" });
    await database.db.insert(speakingAiSessions).values({ id: session, userId: user, mode: "practice", sessionSeed: "fixture", status: "active" });
    await database.db.insert(speakingAttempts).values([recording, linked].map(id => ({
      id, userId: user, part: "part1" as const, status: id === recording ? "recording" as const : "submitted" as const,
      createdAt: new Date("2023-01-01T00:00:00Z"), recordingObjectKey: `speaking/attempts/${id}/audio.webm`,
      transcriptRaw: "PRIVATE_RAW_MARKER", transcript: "PRIVATE_REVIEWED_MARKER",
    })));
    await database.db.insert(speakingAiSessionItems).values({ sessionId: session, ordinal: 0, promptId: prompt,
      part: "part1", topicKey: "fixture", topicPosition: 0, questionPosition: 0, attemptId: linked });
    const before = await database.query("select * from speaking_attempts order by id");
    const snapshot = await readSpeakingRetentionSnapshot(database.db, []);
    const plan = planSpeakingRetention(snapshot, proposal, new Date(snapshot.capturedAt));
    assert.equal(plan.blocked, 2);
    assert.deepEqual(plan.decisions.find(d => d.attemptId === recording)?.blockedBy, ["active_recording"]);
    assert.deepEqual(plan.decisions.find(d => d.attemptId === linked)?.blockedBy, ["active_session"]);
    assert.ok(plan.decisions.every(d => d.actions.length === 0));
    assert.ok(!JSON.stringify(snapshot).includes("PRIVATE_"));
    assert.deepEqual(await database.query("select * from speaking_attempts order by id"), before);
  } finally { await database.close(); }
});

test("indirect session ownership mismatch refuses a retention snapshot", async () => {
  const database = await createTestDatabase();
  try {
    const user = randomUUID(), other = randomUUID(), attempt = randomUUID(), session = randomUUID(), prompt = randomUUID();
    await database.db.insert(users).values([{ id: user, name: "Attempt owner" }, { id: other, name: "Session owner" }]);
    await database.db.insert(speakingPrompts).values({ id: prompt, part: "part1", category: "general", promptText: "A fixture prompt" });
    await database.db.insert(speakingAttempts).values({ id: attempt, userId: user, part: "part1", status: "submitted" });
    await database.db.insert(speakingAiSessions).values({ id: session, userId: other, mode: "practice", sessionSeed: "fixture" });
    await database.db.insert(speakingAiSessionItems).values({ sessionId: session, ordinal: 0, promptId: prompt,
      part: "part1", topicKey: "fixture", topicPosition: 0, questionPosition: 0, attemptId: attempt });
    await assert.rejects(readSpeakingRetentionSnapshot(database.db, []), /retention_session_scope_invalid/);
  } finally { await database.close(); }
});
