import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { exportPortableArchive, importPortableArchive, sha256, stableJson, verifyManifest, type ExportSink } from "../src/lib/portability/archive";
import { PORTABILITY_TABLES, tablesForScope, type PortableTable } from "../src/lib/portability/classification";
import type { ExportScope, PortableManifest, PortableObject, PortableRow } from "../src/lib/portability/types";
import { decryptPortableFile, encryptPortableFile } from "../src/lib/portability/encryption";

test("RIWI archives bind code-bundled contracts; missing or incompatible metadata fails before import", async () => {
  const { manifest } = await build("riwi");
  assert.equal(manifest.assessmentContracts?.length, 105);
  assert.ok(manifest.assessmentContracts?.every((contract) => /^[a-f0-9]{64}$/.test(contract.sha256)));
  assert.equal(verifyManifest(manifest), undefined);
  const resign = (value: Omit<PortableManifest, "manifestSha256">): PortableManifest => ({ ...value, manifestSha256: sha256(stableJson(value)) });
  const { manifestSha256: _hash, assessmentContracts, ...withoutProof } = manifest;
  assert.throws(() => verifyManifest(resign(withoutProof)), /assessment_contract_manifest_required/);
  const incompatible = { ...withoutProof, assessmentContracts: assessmentContracts!.map((contract, index) => index === 0 ? { ...contract, sha256: "f".repeat(64) } : contract) };
  assert.throws(() => verifyManifest(resign(incompatible)), /assessment_contract_incompatible/);
  const incomplete = { ...withoutProof, assessmentContracts: assessmentContracts!.slice(1) };
  assert.throws(() => verifyManifest(resign(incomplete)), /assessment_contract_manifest_incomplete/);
  const duplicate = { ...withoutProof, assessmentContracts: [...assessmentContracts!, assessmentContracts![0]!] };
  assert.throws(() => verifyManifest(resign(duplicate)), /assessment_contract_incompatible/);
  const { manifest: site } = await build("learners-area");
  assert.equal(site.assessmentContracts, undefined);
  const { manifestSha256: _siteHash, ...siteUnsigned } = site;
  assert.throws(() => verifyManifest(resign({ ...siteUnsigned, assessmentContracts })), /site_export_riwi_contracts/);
});

class MemorySink implements ExportSink {
  files = new Map<string, string>(); private file = "";
  async beginFile(path: string) { this.file = path; this.files.set(path, ""); }
  async write(chunk: string) { this.files.set(this.file, this.files.get(this.file)! + chunk); }
  async endFile() { this.file = ""; }
}

function fixture(scope: ExportScope, objectMode: "keep-r2" | "move-objects" = "keep-r2", count = 2) {
  const sink = new MemorySink();
  const rows: Partial<Record<PortableTable, PortableRow[]>> = {
    users: Array.from({ length: count }, (_, index) => ({ id: `user-${index}`, email: `canary-${index}@private.test`, password_hash: "hash-not-deployment-secret" })),
    courses: [{ id: "course-1", title: "Course" }],
    riwi_knowledge_sources: [{ id: "knowledge-1", state: "active", checksum: "a".repeat(64) }],
    riwi_knowledge_units: [{ id: "unit-1", sourceId: "knowledge-1", content: "approved fact" }],
    riwi_assessment_policies: [{ id: "policy-1", state: "approved", candidateHash: "p".repeat(64) }],
    speaking_attempts: [{ id: "attempt-1", userId: "user-0", transcript: "PRIVATE_SPEAKING_CANARY" }],
    riwi_conversations: [{ id: "conversation-1", userId: "user-0" }],
    riwi_conversation_messages: [{ id: "message-1", conversationId: "conversation-1", createdAt: "2026-10-05T00:00:00Z", content: "PRIVATE_RIWI_CONVERSATION_CANARY" }],
  };
  const objects: PortableObject[] = [
    { objectClass: "riwi-knowledge-source", sourceKey: "riwi/source.pdf", destinationKey: objectMode === "move-objects" ? "riwi/source.pdf" : null, ownerId: null, scope: "global", retentionState: "active", sha256: sha256("pdf"), byteLength: 3, mimeType: "application/pdf" },
    { objectClass: "speaking-audio", sourceKey: "speaking/private.webm", destinationKey: objectMode === "move-objects" ? "speaking/private.webm" : null, ownerId: "user-0", scope: "user", retentionState: "active", sha256: sha256("audio"), byteLength: 5, mimeType: "audio/webm" },
  ];
  const source = {
    async *rows(table: PortableTable, batchSize: number) {
      const values = rows[table] ?? [];
      for (let index = 0; index < values.length; index += batchSize) yield values.slice(index, index + batchSize);
    },
    async *objects(selectedScope: ExportScope) {
      for (const object of objects) {
        if (selectedScope === "riwi" && object.objectClass !== "riwi-knowledge-source") continue;
        if (selectedScope === "learners-area" && object.objectClass === "riwi-knowledge-source") continue;
        yield object;
      }
    },
    async activeConversationIds(ids: readonly string[]) { return ids.filter((id) => id === "conversation-1"); },
  };
  return { sink, source, objectBytes: new Map([["riwi/source.pdf", Buffer.from("pdf")], ["speaking/private.webm", Buffer.from("audio")]]) };
}

async function build(scope: ExportScope, objectMode: "keep-r2" | "move-objects" = "keep-r2", count = 2) {
  const value = fixture(scope, objectMode, count);
  const manifest = await exportPortableArchive({ scope, objectMode, sourceFingerprint: "postgres-fixture", source: value.source, sink: value.sink, createdAt: new Date("2026-10-05T00:00:00.000Z") });
  return { ...value, manifest };
}

test("schema classification is closed over every Drizzle table and tri-mode has no unsafe default", () => {
  const schema = readFileSync(new URL("../src/db/schema.ts", import.meta.url), "utf8");
  const actual = [...schema.matchAll(/pgTable\(\s*["']([^"']+)["']/g)].map((match) => match[1]!).sort();
  const classified = Object.keys(PORTABILITY_TABLES).sort();
  assert.deepEqual(classified, actual);
  assert.deepEqual(new Set(tablesForScope("riwi")).has("users"), false);
  assert.deepEqual(new Set(tablesForScope("riwi")).has("speaking_attempts"), false);
  assert.deepEqual(new Set(tablesForScope("learners-area")).has("riwi_knowledge_sources"), false);
  assert.deepEqual(new Set(tablesForScope("full-system")).has("riwi_knowledge_sources"), true);
  assert.deepEqual(new Set(tablesForScope("full-system")).has("users"), true);
});

test("MODE A/B/C exports are deterministic and enforce privacy canaries", async () => {
  for (const scope of ["full-system", "riwi", "learners-area"] as const) {
    const first = await build(scope); const second = await build(scope);
    assert.equal(first.manifest.manifestSha256, second.manifest.manifestSha256);
    verifyManifest(first.manifest);
    const archive = [...first.sink.files.values()].join("");
    if (scope === "riwi") {
      assert.doesNotMatch(archive, /private\.test|PRIVATE_SPEAKING_CANARY|user-0/);
      assert.match(archive, /approved fact/);
    } else if (scope === "learners-area") {
      assert.doesNotMatch(archive, /approved fact|policy-1|PRIVATE_RIWI_CONVERSATION_CANARY/);
      assert.equal(first.manifest.tables.some((entry) => entry.table.startsWith("riwi_")), false);
      assert.match(archive, /PRIVATE_SPEAKING_CANARY/);
    } else {
      assert.match(archive, /approved fact/); assert.match(archive, /PRIVATE_SPEAKING_CANARY/);
      assert.match(archive, /PRIVATE_RIWI_CONVERSATION_CANARY/);
    }
  }
});

test("manifest and truncated/tampered table archives fail before accepted import", async () => {
  const value = await build("riwi");
  const tampered = { ...value.manifest, sourceFingerprint: "changed" } as PortableManifest;
  assert.throws(() => verifyManifest(tampered), /manifest_checksum_mismatch/);
  const file = value.manifest.tables.find((entry) => entry.rowCount > 0)!.file;
  value.sink.files.set(file, `${value.sink.files.get(file)}{"tampered":true}\n`);
  const archive = { async *readRows(path: string) { for (const line of (value.sink.files.get(path) ?? "").split("\n").filter(Boolean)) yield line; }, async readObject() { return new Uint8Array(); } };
  await assert.rejects(() => importPortableArchive({ manifest: value.manifest, archive, dryRun: true, destination: { transaction: async (work) => work({ planRow: async () => "create", applyRow: async () => {}, copyObject: async () => {} }) } }), /table_checksum_mismatch/);
});

test(">1,000 rows export/import without cap, dry-run has no apply, and retry rolls back", async () => {
  const value = await build("full-system", "keep-r2", 1205);
  const users = value.manifest.tables.find((entry) => entry.table === "users")!;
  assert.equal(users.rowCount, 1205);
  let applied = 0;
  const archive = { async *readRows(path: string) { for (const line of (value.sink.files.get(path) ?? "").split("\n").filter(Boolean)) yield line; }, async readObject() { return new Uint8Array(); } };
  const destination = { transaction: async <T>(work: (tx: any) => Promise<T>) => work({ planRow: async () => "create", applyRow: async () => { applied += 1; }, copyObject: async () => {} }) };
  const plan = await importPortableArchive({ manifest: value.manifest, archive, dryRun: true, destination });
  assert.equal(plan.creates, 1212); assert.equal(applied, 0);
  let committed = 0;
  const atomicDestination = { transaction: async <T>(work: (tx: any) => Promise<T>) => { let staged = 0; const result = await work({ planRow: async () => "create", applyRow: async () => { staged += 1; if (staged === 600) throw new Error("injected_failure"); }, copyObject: async () => {} }); committed += staged; return result; } };
  await assert.rejects(() => importPortableArchive({ manifest: value.manifest, archive, dryRun: false, destination: atomicDestination }), /injected_failure/);
  assert.equal(committed, 0);
  const result = await importPortableArchive({ manifest: value.manifest, archive, dryRun: false, destination });
  assert.equal(result.creates, 1212); assert.equal(applied, 1212);
});

test("O1 keeps object references and O2 verifies bytes before copy", async () => {
  const keep = await build("riwi", "keep-r2");
  assert.equal(keep.manifest.objects[0]?.destinationKey, null);
  const move = await build("riwi", "move-objects");
  let copies = 0;
  const archive = { async *readRows(path: string) { for (const line of (move.sink.files.get(path) ?? "").split("\n").filter(Boolean)) yield line; }, async readObject(object: PortableObject) { return move.objectBytes.get(object.sourceKey)!; } };
  const destination = { transaction: async <T>(work: (tx: any) => Promise<T>) => work({ planRow: async () => "create", applyRow: async () => {}, copyObject: async () => { copies += 1; } }) };
  const result = await importPortableArchive({ manifest: move.manifest, archive, dryRun: false, destination });
  assert.equal(result.objectCopies, 1); assert.equal(copies, 1);
  const badArchive = { ...archive, readObject: async () => Buffer.from("bad") };
  await assert.rejects(() => importPortableArchive({ manifest: move.manifest, archive: badArchive, dryRun: false, destination }), /object_checksum_mismatch/);
});

test("private archive encryption streams AES-GCM, uses fresh IVs, removes plaintext, and rejects corruption", async () => {
  const directory = await mkdtemp(join(tmpdir(), "riwi-portable-"));
  try {
    const plain = join(directory, "archive.tar"); const encrypted = join(directory, "archive.enc");
    const encryptedAgain = join(directory, "archive-again.enc"); const restored = join(directory, "restored.tar");
    const payload = Buffer.alloc(2_000_000, 0x5a); writeFileSync(plain, payload);
    const key = randomBytes(32);
    await encryptPortableFile(plain, encrypted, key);
    await encryptPortableFile(plain, encryptedAgain, key);
    assert.notDeepEqual(await readFile(encrypted), payload);
    assert.notDeepEqual(await readFile(encrypted), await readFile(encryptedAgain), "fresh IV must change ciphertext");
    await decryptPortableFile(encrypted, restored, key);
    assert.deepEqual(await readFile(restored), payload);
    await assert.rejects(() => decryptPortableFile(encrypted, `${restored}.bad-key`, randomBytes(32)), /authentication_failed/);

    const ciphertext = await readFile(encrypted);
    const tampered = join(directory, "tampered.enc"); const modified = Buffer.from(ciphertext); modified[100] = modified[100]! ^ 0xff; writeFileSync(tampered, modified);
    await assert.rejects(() => decryptPortableFile(tampered, `${restored}.tampered`, key), /authentication_failed/);
    const truncated = join(directory, "truncated.enc"); writeFileSync(truncated, ciphertext.subarray(0, 20));
    await assert.rejects(() => decryptPortableFile(truncated, `${restored}.truncated`, key), /truncated/);

    const finalEnvelope = join(directory, "final.enc");
    await encryptPortableFile(plain, finalEnvelope, key, { removeSourceAfterSuccess: true });
    await assert.rejects(() => readFile(plain), /ENOENT/);
    assert.equal((await readFile(finalEnvelope)).subarray(0, 4).toString(), "LAP1");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("portable canonical JSON handles timestamps/bytes and remains stable", () => {
  assert.equal(stableJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.match(stableJson({ values: [3, 2, 1] }), /3,2,1/);
  assert.equal(stableJson(new Date("2026-10-05T00:00:00Z")), '"2026-10-05T00:00:00.000Z"');
});

test("expired conversation messages and orphan messages cannot leave the private archive", async () => {
  const sink = new MemorySink();
  const now = new Date("2026-10-08T00:00:00Z");
  const source = {
    async *rows(table: PortableTable) {
      if (table === "riwi_conversations") yield [
        { id: "active", expiresAt: "2026-10-09T00:00:00Z" },
        { id: "expired", expiresAt: "2026-10-08T00:00:00Z" },
      ];
      if (table === "riwi_conversation_messages") yield [
        { id: "a", conversationId: "active", createdAt: now.toISOString(), content: "ACTIVE_CONVERSATION" },
        { id: "e", conversationId: "expired", createdAt: now.toISOString(), content: "EXPIRED_PRIVATE_CANARY" },
        { id: "o", conversationId: "orphan", createdAt: now.toISOString(), content: "ORPHAN_PRIVATE_CANARY" },
        { id: "old", conversationId: "active", createdAt: "2026-09-01T00:00:00Z", content: "OLDER_THAN_30_DAYS_CANARY" },
      ];
    },
    async *objects() {},
    async activeConversationIds(ids: readonly string[], at: Date) {
      assert.equal(at.toISOString(), now.toISOString());
      assert.deepEqual(ids, ["active", "expired", "orphan"]);
      return ["active"];
    },
  };
  await exportPortableArchive({ scope: "full-system", objectMode: "keep-r2", sourceFingerprint: "retention-fixture", source, sink, createdAt: now });
  assert.match(sink.files.get("tables/riwi_conversation_messages.jsonl")!, /ACTIVE_CONVERSATION/);
  assert.doesNotMatch([...sink.files.values()].join(""), /EXPIRED_PRIVATE_CANARY|ORPHAN_PRIVATE_CANARY|OLDER_THAN_30_DAYS_CANARY/);
  assert.doesNotMatch(sink.files.get("tables/riwi_conversations.jsonl")!, /"expired"/);
  const { activeConversationIds: _proof, ...withoutProof } = source;
  await assert.rejects(() => exportPortableArchive({ scope: "full-system", objectMode: "keep-r2", sourceFingerprint: "retention-fixture", source: withoutProof, sink: new MemorySink(), createdAt: now }), /conversation_retention_proof_required/);
});
