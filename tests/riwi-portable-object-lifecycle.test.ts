import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { importPortableArchive, type ImportDestination, type ImportTransaction } from "../src/lib/portability/archive";
import { withObjectCopyLifecycle, type ObjectCopyStore } from "../src/lib/portability/object-lifecycle";
import type { PortableObject } from "../src/lib/portability/types";

// MOCKED object store (in memory). This proves lifecycle logic only; it is not real R2/S3 acceptance.
function memoryStore(options: { failDelete?: Set<string>; corruptRead?: Set<string>; raceOn?: Set<string>; loseWriteResponse?: Set<string> } = {}) {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const deleted: string[] = [];
  const store: ObjectCopyStore = {
    kind: "s3",
    async putIfAbsent({ key, body, contentType }) {
      if (options.raceOn?.has(key)) { objects.set(key, { body: Buffer.from("raced"), contentType }); return false; }
      if (objects.has(key)) return false;
      objects.set(key, { body: Buffer.from(body), contentType });
      if (options.loseWriteResponse?.has(key)) throw new Error("secret-provider-detail");
      return true;
    },
    async read(key) {
      const item = objects.get(key); if (!item) return null;
      return options.corruptRead?.has(key) ? { body: Buffer.from("corrupt"), contentType: item.contentType } : { ...item };
    },
    async delete(key) { if (options.failDelete?.has(key)) throw new Error("secret-provider-detail"); deleted.push(key); objects.delete(key); },
  };
  return { store, objects, deleted };
}

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function object(key: string, bytes: Buffer, over: Partial<PortableObject> = {}): PortableObject {
  return { objectClass: "site-private", sourceKey: key, destinationKey: null, ownerId: null, scope: "global", retentionState: "active",
    sha256: digest(bytes), byteLength: bytes.byteLength, mimeType: "audio/webm", ...over };
}
function dbDestination(outcome: "commit" | "fail_before_commit" | "uncertain"): ImportDestination {
  return {
    async transaction<T>(work: (tx: ImportTransaction) => Promise<T>) {
      const value = await work({ planRow: async () => "create", applyRow: async () => {}, copyObject: async () => { throw new Error("replaced_by_lifecycle"); } });
      if (outcome === "fail_before_commit") throw new Error("injected_precommit_failure");
      if (outcome === "uncertain") throw new Error("portable_import_commit_uncertain");
      return value;
    },
  };
}
const archiveOf = (bytes: Map<string, Buffer>) => ({ async *readRows() {}, async readObject(o: PortableObject) {
  const value = bytes.get(o.sourceKey); if (!value) throw new Error("object_missing:" + o.sourceKey); return value; } });

// Manifests are produced by the real exporter and verified by the real importer.
async function run(objects: PortableObject[], bytes: Map<string, Buffer>, lifecycle: ReturnType<typeof withObjectCopyLifecycle>, dryRun = false) {
  const { exportPortableArchive } = await import("../src/lib/portability/archive");
  const files = new Map<string, string>(); let current = "";
  const manifest = await exportPortableArchive({ scope: "full-system", objectMode: "move-objects", sourceFingerprint: "qa", createdAt: new Date("2026-10-11T00:00:00Z"), batchSize: 10,
    source: { async *rows() {}, async *objects() { for (const item of objects) yield item; } },
    sink: { async beginFile(f) { current = f; files.set(f, ""); }, async write(c) { files.set(current, (files.get(current) ?? "") + c); }, async endFile() {} } });
  return importPortableArchive({ manifest, archive: archiveOf(bytes), destination: lifecycle.destination, dryRun });
}

const A = Buffer.from("audio-a"), B = Buffer.from("audio-b");

test("positive: new objects are copied, read back and kept after COMMIT", async () => {
  const { store, objects } = memoryStore();
  const lifecycle = withObjectCopyLifecycle(dbDestination("commit"), store);
  const plan = await run([object("speaking/a.webm", A), object("speaking/b.webm", B)], new Map([["speaking/a.webm", A], ["speaking/b.webm", B]]), lifecycle);
  assert.equal(plan.objectCopies, 2);
  const receipt = lifecycle.receipt();
  assert.equal(receipt.state, "committed"); assert.equal(receipt.staged.length, 2); assert.equal(objects.size, 2);
  assert.equal(receipt.staged[0]!.sha256, digest(A));
});

test("duplicate hash under different keys copies both; same key same bytes is reused and never staged", async () => {
  const { store, objects, deleted } = memoryStore();
  objects.set("speaking/same.webm", { body: A, contentType: "audio/webm" });
  const lifecycle = withObjectCopyLifecycle(dbDestination("fail_before_commit"), store);
  await assert.rejects(() => run([object("speaking/same.webm", A), object("speaking/dup.webm", A)], new Map([["speaking/same.webm", A], ["speaking/dup.webm", A]]), lifecycle), /injected_precommit_failure/);
  const receipt = lifecycle.receipt();
  assert.deepEqual(receipt.reused.map(item => item.key), ["speaking/same.webm"]);
  assert.deepEqual(receipt.staged.map(item => item.key), ["speaking/dup.webm"]);
  assert.deepEqual(deleted, ["speaking/dup.webm"], "only the object this attempt created is removed");
  assert.ok(objects.has("speaking/same.webm"), "pre-existing/shared object survives precommit cleanup");
});

test("destination collision with different bytes fails closed and removes only earlier staged objects", async () => {
  const { store, objects, deleted } = memoryStore();
  objects.set("speaking/b.webm", { body: Buffer.from("someone-else"), contentType: "audio/webm" });
  const lifecycle = withObjectCopyLifecycle(dbDestination("commit"), store);
  await assert.rejects(() => run([object("speaking/a.webm", A), object("speaking/b.webm", B)], new Map([["speaking/a.webm", A], ["speaking/b.webm", B]]), lifecycle), /object_destination_collision:speaking\/b\.webm/);
  assert.deepEqual(deleted, ["speaking/a.webm"]);
  assert.equal(objects.get("speaking/b.webm")!.body.toString(), "someone-else");
  assert.equal(lifecycle.receipt().state, "rolled_back");
});

test("lost creation race with different bytes is a collision; the other writer's object is never deleted", async () => {
  const { store, objects, deleted } = memoryStore({ raceOn: new Set(["speaking/a.webm"]) });
  const lifecycle = withObjectCopyLifecycle(dbDestination("commit"), store);
  await assert.rejects(() => run([object("speaking/a.webm", A)], new Map([["speaking/a.webm", A]]), lifecycle), /object_destination_collision/);
  assert.deepEqual(deleted, []); assert.ok(objects.has("speaking/a.webm"));
});

test("read-back mismatch, missing source and corrupt archive bytes fail closed with scoped cleanup", async () => {
  const bad = memoryStore({ corruptRead: new Set(["speaking/b.webm"]) });
  const l1 = withObjectCopyLifecycle(dbDestination("commit"), bad.store);
  await assert.rejects(() => run([object("speaking/a.webm", A), object("speaking/b.webm", B)], new Map([["speaking/a.webm", A], ["speaking/b.webm", B]]), l1), /object_readback_mismatch:speaking\/b\.webm/);
  assert.deepEqual(bad.deleted.sort(), ["speaking/a.webm", "speaking/b.webm"]);
  const missing = memoryStore();
  const l2 = withObjectCopyLifecycle(dbDestination("commit"), missing.store);
  await assert.rejects(() => run([object("speaking/a.webm", A), object("speaking/b.webm", B)], new Map([["speaking/a.webm", A]]), l2), /object_missing:speaking\/b\.webm/);
  assert.deepEqual(missing.deleted, ["speaking/a.webm"]);
  const corrupt = memoryStore();
  const l3 = withObjectCopyLifecycle(dbDestination("commit"), corrupt.store);
  await assert.rejects(() => run([object("speaking/a.webm", A)], new Map([["speaking/a.webm", Buffer.from("tampered")]]), l3), /object_checksum_mismatch/);
  assert.equal(corrupt.objects.size, 0);
});

test("the exporter omits non-active objects and the lifecycle independently rejects them and unsafe keys before any write", async () => {
  // Defense in depth: a hand-built or tampered plan must not reach the store.
  for (const [item, expected] of [
    [object("speaking/a.webm", A, { retentionState: "expired" }), /object_retention_not_active/],
    [object("speaking/a.webm", A, { retentionState: "deleted" }), /object_retention_not_active/],
    [object("../escape.webm", A), /object_destination_key_unsafe/],
    [object("speaking/ok.webm", A, { destinationKey: "a//b" }), /object_destination_key_unsafe/],
  ] as const) {
    const { store, objects } = memoryStore();
    const lifecycle = withObjectCopyLifecycle(dbDestination("commit"), store);
    await assert.rejects(() => lifecycle.destination.transaction(tx => tx.copyObject(item, A)), expected);
    assert.equal(objects.size, 0);
  }
  const { store } = memoryStore();
  const lifecycle = withObjectCopyLifecycle(dbDestination("commit"), store);
  const plan = await run([object("speaking/expired.webm", A, { retentionState: "expired" })], new Map(), lifecycle);
  assert.equal(plan.objectCopies, 0, "exporter never plans an expired object");
});

test("uncertain COMMIT preserves every staged object and reports reconciliation, not rollback", async () => {
  const { store, objects, deleted } = memoryStore();
  const lifecycle = withObjectCopyLifecycle(dbDestination("uncertain"), store);
  await assert.rejects(() => run([object("speaking/a.webm", A)], new Map([["speaking/a.webm", A]]), lifecycle), /portable_import_commit_uncertain/);
  const receipt = lifecycle.receipt();
  assert.equal(receipt.state, "commit_uncertain_preserved");
  assert.deepEqual(receipt.reconciliation?.stagedKeys, ["speaking/a.webm"]);
  assert.deepEqual(deleted, []); assert.ok(objects.has("speaking/a.webm"));
  await lifecycle.retryCleanup();
  assert.deepEqual(deleted, [], "retryCleanup never deletes after an uncertain COMMIT");
});

test("cleanup failure is recorded without provider detail and can be retried later", async () => {
  const failDelete = new Set(["speaking/a.webm"]);
  const { store, objects } = memoryStore({ failDelete });
  const lifecycle = withObjectCopyLifecycle(dbDestination("fail_before_commit"), store);
  await assert.rejects(() => run([object("speaking/a.webm", A)], new Map([["speaking/a.webm", A]]), lifecycle), /injected_precommit_failure/);
  const first = lifecycle.receipt();
  assert.deepEqual(first.cleanupFailures, [{ key: "speaking/a.webm", code: "object_cleanup_failed" }]);
  assert.doesNotMatch(JSON.stringify(first), /secret-provider-detail/);
  assert.ok(objects.has("speaking/a.webm"));
  failDelete.clear();
  const retried = await lifecycle.retryCleanup();
  assert.deepEqual(retried.cleanupFailures, []); assert.equal(objects.size, 0);
});

test("dry-run copies nothing and a lifecycle instance is single use", async () => {
  const { store, objects } = memoryStore();
  const lifecycle = withObjectCopyLifecycle(dbDestination("commit"), store, { dryRun: true });
  const plan = await run([object("speaking/a.webm", A)], new Map([["speaking/a.webm", A]]), lifecycle, true);
  assert.equal(plan.dryRun, true); assert.equal(objects.size, 0);
  assert.equal(lifecycle.receipt().state, "dry_run");
  await assert.rejects(() => run([object("speaking/a.webm", A)], new Map([["speaking/a.webm", A]]), lifecycle), /object_lifecycle_single_use/);
});

test("lost object write response preserves unknown ownership and cleans only confirmed earlier writes", async () => {
  const { store, objects, deleted } = memoryStore({ loseWriteResponse: new Set(["speaking/b.webm"]) });
  const lifecycle = withObjectCopyLifecycle(dbDestination("commit"), store);
  await assert.rejects(() => run([object("speaking/a.webm", A), object("speaking/b.webm", B)], new Map([["speaking/a.webm", A], ["speaking/b.webm", B]]), lifecycle), /object_create_outcome_uncertain/);
  const receipt = lifecycle.receipt();
  assert.equal(receipt.state, "object_write_uncertain_preserved");
  assert.deepEqual(receipt.uncertainWrites, [{ key: "speaking/b.webm", sha256: digest(B), byteLength: B.byteLength }]);
  assert.equal(receipt.reconciliation?.action, "verify_object_creation_ownership");
  assert.deepEqual(deleted, ["speaking/a.webm"]);
  assert.ok(objects.has("speaking/b.webm"));
  assert.doesNotMatch(JSON.stringify(receipt), /secret-provider-detail/);
  await lifecycle.retryCleanup();
  assert.deepEqual(deleted, ["speaking/a.webm"]);
});
