import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { riwiKnowledgeSources, riwiKnowledgeUnits, uploadIntents, users } from "../src/db/schema";
import type { StorageService, ObjectKey, PresignedPut, PutInput, ReadResult } from "../src/lib/services/storage/types";
import { createUploadIntent, finalizeUploadIntent } from "../src/lib/data/uploads";
import { KnowledgeParseError } from "../src/lib/services/riwi/knowledge-parser";
import { getKnowledgeSourceDetail, KnowledgeServiceError } from "../src/lib/services/riwi/knowledge";
import { ingestUploadedKnowledgeSource, type KnowledgeUploadActor } from "../src/lib/services/riwi/knowledge-upload";
import { RIWI_SOURCE_LIMIT_BYTES } from "../src/lib/services/riwi/knowledge-parser";
import { createTestDatabase } from "./support/pglite";

class MemoryPrivateStorage implements StorageService {
  readonly kind = "local" as const;
  readonly supportsDirectUpload = true;
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  presignCalls = 0;

  async put(input: PutInput): Promise<void> {
    this.objects.set(input.key, { body: Buffer.from(input.body), contentType: input.contentType });
  }
  async putIfAbsent(input: PutInput): Promise<boolean> {
    if (this.objects.has(input.key)) return false;
    this.objects.set(input.key, { body: Buffer.from(input.body), contentType: input.contentType });
    return true;
  }
  async presignPut(input: { key: ObjectKey; contentType: string; expiresInSeconds: number }): Promise<PresignedPut | null> {
    this.presignCalls += 1;
    return { uploadUrl: "https://private-storage.invalid/signed", ...input };
  }
  async head(key: ObjectKey) {
    const stored = this.objects.get(key);
    return stored ? { key, size: stored.body.byteLength, contentType: stored.contentType } : null;
  }
  async signedReadUrl(): Promise<string | null> { return null; }
  async read(key: ObjectKey): Promise<ReadResult | null> {
    const stored = this.objects.get(key);
    return stored ? { body: Buffer.from(stored.body), contentType: stored.contentType } : null;
  }
  async readBounded(key: ObjectKey, maxBytes: number): Promise<ReadResult | null> {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return { body: Buffer.from(stored.body.subarray(0, maxBytes + 1)), contentType: stored.contentType };
  }
  async readHead(key: ObjectKey, maxBytes: number): Promise<Buffer | null> {
    const stored = this.objects.get(key);
    return stored ? Buffer.from(stored.body.subarray(0, maxBytes)) : null;
  }
  async delete(key: ObjectKey): Promise<void> { this.objects.delete(key); }
}

const owner = (id: string) => ({ id, role: "owner" as const, accountStatus: "active" as const });
const sourceMetadata = {
  title: "A safe grammar source",
  sourceType: "grammar_material" as const,
  provenance: "Owner-authored training material",
  rightsClass: "owner_authored" as const,
  scope: { kind: "global" as const },
};

async function setup() {
  const database = await createTestDatabase();
  const storage = new MemoryPrivateStorage();
  const ownerId = randomUUID();
  const teacherId = randomUUID();
  const adminId = randomUUID();
  await database.db.insert(users).values([
    { id: ownerId, name: "Knowledge upload owner", role: "owner", accountStatus: "active" },
    { id: teacherId, name: "Knowledge upload teacher", role: "teacher", accountStatus: "active" },
    { id: adminId, name: "Knowledge upload admin", role: "admin", accountStatus: "active" },
  ]);
  return { database, storage, owner: owner(ownerId), teacherId, adminId };
}

async function uploadAndFinalize(
  database: Awaited<ReturnType<typeof createTestDatabase>>,
  storage: MemoryPrivateStorage,
  actor: ReturnType<typeof owner>,
  filename: string,
  browserMime: string,
  bytes: Uint8Array,
) {
  const intent = await createUploadIntent({
    caller: actor, purpose: "riwi_knowledge_source", filename, contentType: browserMime, size: bytes.byteLength,
  }, { database: database.db, storage });
  if (!intent.ok) throw new Error(`fixture upload intent rejected: ${intent.error}`);
  await storage.put({ key: intent.objectKey, body: Buffer.from(bytes), contentType: intent.contentType });
  const finalized = await finalizeUploadIntent(actor.id, intent.uploadId, { database: database.db, storage });
  return { intent, finalized };
}

async function ingest(database: Awaited<ReturnType<typeof createTestDatabase>>, storage: MemoryPrivateStorage, actor: KnowledgeUploadActor, uploadId: string) {
  return ingestUploadedKnowledgeSource({ actor, uploadId, ...sourceMetadata }, { database: database.db, storage });
}

const textBytes = (value: string) => new TextEncoder().encode(value);

test("shared knowledge intents authorize only active owners, distinguish parser support, cap bytes, and ignore MIME claims", async () => {
  const { database, storage, owner: actor, teacherId, adminId } = await setup();
  try {
    const deniedTeacher = await createUploadIntent({
      caller: { id: teacherId, role: "teacher" }, purpose: "riwi_knowledge_source", filename: "lesson.txt", contentType: "text/plain", size: 12,
    }, { database: database.db, storage });
    assert.deepEqual(deniedTeacher, { ok: false, status: 403, error: "forbidden" });
    const deniedAdmin = await createUploadIntent({
      caller: { id: adminId, role: "admin" }, purpose: "riwi_knowledge_source", filename: "lesson.txt", contentType: "text/plain", size: 12,
    }, { database: database.db, storage });
    assert.deepEqual(deniedAdmin, { ok: false, status: 403, error: "forbidden" });

    const unsupported = await createUploadIntent({
      caller: actor, purpose: "riwi_knowledge_source", filename: "lesson.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 12,
    }, { database: database.db, storage });
    assert.deepEqual(unsupported, { ok: false, status: 400, error: "unsupported_type" },
      "shared upload policy support does not imply RIWI parser support");
    const xml = await createUploadIntent({
      caller: actor, purpose: "riwi_knowledge_source", filename: "lesson.xml", contentType: "application/xml", size: 12,
    }, { database: database.db, storage });
    assert.equal(xml.ok, false, "XML is never promoted into parser support just because upload policy accepts it");

    const tooLarge = await createUploadIntent({
      caller: actor, purpose: "riwi_knowledge_source", filename: "lesson.txt", contentType: "text/plain", size: RIWI_SOURCE_LIMIT_BYTES + 1,
    }, { database: database.db, storage });
    assert.deepEqual(tooLarge, { ok: false, status: 413, error: "file_too_large" });

    const bytes = textBytes("A truthful UTF-8 lesson paragraph.");
    const upload = await uploadAndFinalize(database, storage, actor, "lesson.html", "text/html", bytes);
    assert.equal(upload.intent.contentType, "text/plain", "HTML is privately stored with an inert canonical MIME");
    assert.equal(upload.intent.mode, "proxy", "knowledge source originals never retain a reusable presigned PUT");
    assert.equal(upload.intent.uploadUrl, null);
    assert.equal(storage.presignCalls, 0);
    assert.equal(upload.finalized.ok, true, "signature evidence, not the browser MIME label, controls finalization");
    assert.equal(await storage.putIfAbsent({
      key: upload.intent.objectKey, body: Buffer.from("replacement source bytes"), contentType: upload.intent.contentType,
    }), false, "a replay cannot overwrite bytes after the upload key has received its source");
    assert.ok(upload.intent.objectKey.startsWith("pending/"));
    assert.ok(!upload.intent.objectKey.includes("lesson.html"), "the safe object key does not expose the uploaded filename");

    const candidate = await ingest(database, storage, actor, upload.intent.uploadId);
    const row = await database.db.query.riwiKnowledgeSources.findFirst({ where: eq(riwiKnowledgeSources.id, candidate.id) });
    assert.equal(candidate.state, "candidate", "successful parse creates an inactive candidate only");
    assert.equal(row?.sourceObjectKey, upload.intent.objectKey);
    assert.equal(row?.sourceChecksum, createHash("sha256").update(bytes).digest("hex"), "source checksum covers original bytes");
    assert.equal(row?.checksum, createHash("sha256").update("A truthful UTF-8 lesson paragraph.").digest("hex"), "knowledge checksum remains over normalized parser text");
    assert.ok(storage.objects.has(upload.intent.objectKey), "original bytes remain in private storage");
    assert.equal((await database.db.query.uploadIntents.findFirst({ where: eq(uploadIntents.id, upload.intent.uploadId) }))?.status, "attached");
    const detail = await getKnowledgeSourceDetail(actor, candidate.id, database.db);
    assert.equal(detail?.sourceChecksum, row?.sourceChecksum);
    assert.equal(detail?.units.length, 1);
  } finally {
    await database.close();
  }
});

test("real HTML uploads remain inert, strip scripts and event attributes, and persist the source checksum", async () => {
  const { database, storage, owner: actor } = await setup();
  const bytes = textBytes("<h1>Articles</h1><script>STEAL_PRIVATE_DATA()</script><p onclick=\"runBadCode()\">Use an article before a singular noun.</p>");
  try {
    const upload = await uploadAndFinalize(database, storage, actor, "grammar.html", "text/html", bytes);
    assert.equal(upload.finalized.ok, true);
    const candidate = await ingest(database, storage, actor, upload.intent.uploadId);
    const units = await database.db.select().from(riwiKnowledgeUnits).where(eq(riwiKnowledgeUnits.sourceId, candidate.id));
    const extracted = units.map((unit) => unit.content).join(" ");
    assert.match(extracted, /Articles/);
    assert.match(extracted, /singular noun/);
    assert.doesNotMatch(extracted, /STEAL_PRIVATE_DATA|runBadCode|onclick/i);
    const source = await database.db.query.riwiKnowledgeSources.findFirst({ where: eq(riwiKnowledgeSources.id, candidate.id) });
    assert.equal(source?.sourceChecksum, createHash("sha256").update(bytes).digest("hex"));
  } finally {
    await database.close();
  }
});

test("disguised PDF and executable bytes fail shared signature finalization even with plausible browser MIME", async () => {
  const { database, storage, owner: actor } = await setup();
  try {
    const disguised = await uploadAndFinalize(database, storage, actor, "lesson.pdf", "application/pdf", textBytes("<script>not actually a PDF</script>"));
    assert.deepEqual(disguised.finalized, { ok: false, status: 422, error: "upload_type_mismatch" });
    assert.equal(storage.objects.has(disguised.intent.objectKey), false, "signature mismatch aborts and deletes the staged object");
    assert.equal((await database.db.select().from(riwiKnowledgeSources)).length, 0);

    const executable = await uploadAndFinalize(database, storage, actor, "lesson.txt", "text/plain", new Uint8Array([0x4d, 0x5a, 0x90, 0x00]));
    assert.deepEqual(executable.finalized, { ok: false, status: 422, error: "dangerous_type" });
    assert.equal(storage.objects.has(executable.intent.objectKey), false, "MZ executable bytes do not become a source despite a .txt extension and truthful MIME claim");
    assert.equal((await database.db.select().from(riwiKnowledgeSources)).length, 0);
  } finally {
    await database.close();
  }
});

test("malformed and traversal DOCX uploads are parsed from real archive bytes and never create candidates", async () => {
  const { database, storage, owner: actor } = await setup();
  const document = strToU8("<w:document><w:body><w:p><w:r><w:t>Safe lesson text.</w:t></w:r></w:p></w:body></w:document>");
  const traversalBytes = new Uint8Array(zipSync({
    "word/document.xml": document,
    "word/../../outside.txt": strToU8("outside"),
  }));
  try {
    const malformed = await uploadAndFinalize(database, storage, actor, "malformed.docx", "application/octet-stream", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]));
    assert.equal(malformed.finalized.ok, true, "a ZIP prefix is only preliminary signature evidence; the archive parser must still validate it");
    await assert.rejects(ingest(database, storage, actor, malformed.intent.uploadId),
      (error: unknown) => error instanceof KnowledgeParseError && error.code === "source_unsafe_archive");
    assert.equal(storage.objects.has(malformed.intent.objectKey), false);
    assert.equal((await database.db.query.uploadIntents.findFirst({ where: eq(uploadIntents.id, malformed.intent.uploadId) }))?.status, "aborted");

    const traversal = await uploadAndFinalize(database, storage, actor, "traversal.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", traversalBytes);
    assert.equal(traversal.finalized.ok, true);
    await assert.rejects(ingest(database, storage, actor, traversal.intent.uploadId),
      (error: unknown) => error instanceof KnowledgeParseError && error.code === "source_unsafe_archive");
    assert.equal(storage.objects.has(traversal.intent.objectKey), false, "unsafe archive bytes are removed after rejection");

    const bombBytes = new Uint8Array(zipSync({
      "word/document.xml": strToU8("x".repeat(RIWI_SOURCE_LIMIT_BYTES + 1)),
    }, { level: 9 }));
    assert.ok(bombBytes.byteLength < RIWI_SOURCE_LIMIT_BYTES, "compressed DOCX bomb stays within the source-upload ceiling");
    const bomb = await uploadAndFinalize(database, storage, actor, "bomb.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bombBytes);
    assert.equal(bomb.finalized.ok, true, "signature finalization is separate from bounded archive parsing");
    await assert.rejects(ingest(database, storage, actor, bomb.intent.uploadId),
      (error: unknown) => error instanceof KnowledgeParseError && error.code === "source_unsafe_archive");
    assert.equal(storage.objects.has(bomb.intent.objectKey), false, "expanded archive bomb bytes are removed after rejection");
    assert.equal((await database.db.select().from(riwiKnowledgeSources)).length, 0, "no malformed or over-expanded source can create a candidate row");
  } finally {
    await database.close();
  }
});

test("upload consumption is owner-only, atomic, and cannot replay a finalized source intent", async () => {
  const { database, storage, owner: actor, teacherId } = await setup();
  const bytes = textBytes("One owner-approved source intent can be consumed only once.");
  try {
    const upload = await uploadAndFinalize(database, storage, actor, "single-use.txt", "text/plain", bytes);
    assert.equal(upload.finalized.ok, true);
    await assert.rejects(ingest(database, storage, { id: teacherId, role: "teacher", accountStatus: "active" }, upload.intent.uploadId),
      (error: unknown) => error instanceof KnowledgeServiceError && error.code === "forbidden");
    assert.equal((await database.db.query.uploadIntents.findFirst({ where: eq(uploadIntents.id, upload.intent.uploadId) }))?.status, "finalized");

    const outcomes = await Promise.allSettled([
      ingest(database, storage, actor, upload.intent.uploadId),
      ingest(database, storage, actor, upload.intent.uploadId),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal((await database.db.select().from(riwiKnowledgeSources)).length, 1);
    assert.equal((await database.db.query.uploadIntents.findFirst({ where: eq(uploadIntents.id, upload.intent.uploadId) }))?.status, "attached");
  } finally {
    await database.close();
  }
});
