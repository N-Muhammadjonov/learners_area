import test from "node:test";
import assert from "node:assert/strict";
import { listeningSchemaReady } from "../src/lib/data/listening-schema-ready";
import { SchemaNotReadyError, assertSchemaRequirements } from "../src/lib/data/schema-requirements";
import { listTopicPacksForLearner } from "../src/lib/content/vocabulary-packs";
import { safeDatabaseDiagnostic } from "../src/lib/observability/errors";
import { classifyThrown, withUploadErrorBoundary } from "../src/lib/uploads/server-errors";
import { createTestDatabase } from "./support/pglite";

test("Listening readiness distinguishes complete schema from missing0052, even with the column in another schema", async () => {
  const database = await createTestDatabase();
  try {
    assert.equal(await listeningSchemaReady(database.db), true);
    await database.query("alter table listening_tests drop column program_ref cascade");
    await database.query("create schema shadow");
    await database.query("create table shadow.listening_tests (program_ref text)");
    await assert.rejects(listeningSchemaReady(database.db), (error: unknown) => {
      assert.ok(error instanceof SchemaNotReadyError);
      assert.deepEqual(error.missing, [{ table: "listening_tests", column: "program_ref", migration: "0052_listening_mcq_program_days" }]);
      return true;
    });
  } finally {
    await database.close();
  }
});

test("Vocabulary missing schema stays a visible PostgreSQL failure, never built-in content", async () => {
  const database = await createTestDatabase();
  try {
    await database.query("drop table vocabulary_topic_packs cascade");
    await assert.rejects(listTopicPacksForLearner("en", database.db), (error: unknown) => safeDatabaseDiagnostic(error).sqlState === "42P01");
  } finally {
    await database.close();
  }
});

test("Readiness never converts a database outage to missing schema or an empty result", async () => {
  const outage = Object.assign(new Error("unavailable"), { code: "ECONNREFUSED" });
  const database = { execute: async () => { throw outage; } };
  await assert.rejects(assertSchemaRequirements("listening", [{ table: "listening_tests", column: "program_ref", migration: "0052_listening_mcq_program_days" }], database as never), (error: unknown) => error === outage);
});

test("Cause-aware classification distinguishes pg drift, pg outage and storage, including aggregate causes", () => {
  const drift = new Error("Failed query: private SQL", { cause: Object.assign(new Error("relation missing"), { code: "42P01" }) });
  assert.deepEqual(classifyThrown(drift), { code: "server_error", status: 500 });
  const socket = Object.assign(new Error("socket refused"), { code: "ECONNREFUSED" });
  const dbFailure = new Error("Failed query: private SQL", { cause: new AggregateError([socket]) });
  assert.deepEqual(classifyThrown(dbFailure), { code: "database_unavailable", status: 503 });
  assert.deepEqual(classifyThrown(socket, "database"), { code: "database_unavailable", status: 503 });
  assert.deepEqual(classifyThrown(socket, "storage"), { code: "storage_unavailable", status: 503 });
  const exhausted = new Error("Failed query", { cause: Object.assign(new Error("slots exhausted"), { code: "53300" }) });
  assert.deepEqual(classifyThrown(exhausted), { code: "database_unavailable", status: 503 });
  const auth = new Error("database credentials", { cause: Object.assign(new Error("password authentication failed"), { code: "28P01" }) });
  assert.deepEqual(classifyThrown(auth), { code: "database_unavailable", status: 503 });
});

test("Speaking error boundary reports the failing stage and correlation without SQL or credentials", async () => {
  const entries: unknown[][] = [];
  const previous = console.error;
  console.error = (...items: unknown[]) => { entries.push(items); };
  try {
    const error = new Error("Failed query: secret transcript and credential", { cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }) });
    const response = await withUploadErrorBoundary("speaking_recording_attach", async () => { throw error; }, "database");
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.code, "database_unavailable");
    assert.equal(payload.stage, "speaking_recording_attach");
    assert.equal(payload.retryable, true);
    assert.match(payload.correlationId, /^[0-9a-f-]{8}$/);
    assert.doesNotMatch(JSON.stringify([payload, entries]), /secret transcript|credential|Failed query/);
  } finally {
    console.error = previous;
  }
});

test("A missing transcription provider still saves the private recording with no invented transcript", async () => {
  const { saveSpeakingSubmission } = await import("../src/lib/services/speaking/submission");
  const { LocalDiskStorageProvider } = await import("../src/lib/services/storage/local-provider");
  const storage = new LocalDiskStorageProvider();
  const objectKey = `speaking/attempts/${crypto.randomUUID()}/audio.m4a`;
  const recordingBytes = Buffer.from([0, 0, 0, 32, 102, 116, 121, 112, 77, 52, 65, 32]);
  await storage.put({ key: objectKey, body: recordingBytes, contentType: "audio/mp4" });
  const database = await createTestDatabase();
  try {
    const [user] = await database.query<{ id: string }>("insert into users(name,role) values('Recording learner','student') returning id");
    const [row] = await database.query<{ id: string }>("insert into speaking_attempts(user_id,part,status,recording_object_key,recording_mime_type) values($1,'part1','recording',$2,'audio/mp4') returning id", [user!.id, objectKey]);
    const { eq } = await import("drizzle-orm");
    const { speakingAttempts } = await import("../src/db/schema");
    const [attempt] = await database.db.select().from(speakingAttempts).where(eq(speakingAttempts.id, row!.id));
    const saved = await saveSpeakingSubmission({ attempt: attempt!, durationMs: 15000, manualTranscript: "", language: "en" }, {
      database: database.db,
      transcribe: async () => ({ ok: false, failure: { reason: "not_configured", detail: "No provider", retryable: false } }),
    });
    assert.deepEqual(saved.transcriptionFailure, { reason: "not_configured", retryable: false });
    assert.equal(saved.transcript, null);
    assert.equal(saved.transcriptOrigin, null);
    const [persisted] = await database.query<{ status: string; recording_object_key: string; transcript: string | null; recording_duration_ms: number }>("select status,recording_object_key,transcript,recording_duration_ms from speaking_attempts where id=$1", [row!.id]);
    assert.equal(persisted!.status, "submitted");
    assert.equal(persisted!.recording_object_key, objectKey);
    assert.equal((await storage.head(objectKey))!.size, recordingBytes.length);
    assert.deepEqual(await storage.readHead(objectKey, 32), recordingBytes);
    assert.equal(persisted!.recording_duration_ms, 15000);
    assert.equal(persisted!.transcript, null);
    assert.equal((await database.query("select id from evaluations where source_id=$1", [row!.id])).length, 0);
  } finally {
    await database.close();
    await storage.delete(objectKey);
  }
});
