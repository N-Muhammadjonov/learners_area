import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "./support/pglite";
import { exportEncryptedPostgresBundle } from "../src/lib/portability/bundle";
import { runPortableImportCommand } from "../src/lib/portability/import-command";
import type { ObjectCopyStore } from "../src/lib/portability/object-lifecycle";
import type { PortableObject } from "../src/lib/portability/types";
import { createSessionToken } from "../src/lib/auth/session";

// Database: PGlite relational. Object store: MOCKED in memory. Neither is native PostgreSQL nor real R2/S3 acceptance.
const bytes = Buffer.from("owner-command-object-bytes");
const portableObject: PortableObject = { objectClass: "site-private", sourceKey: "speaking/qa-object.webm", destinationKey: null, ownerId: null, scope: "global",
  retentionState: "active", sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength, mimeType: "audio/webm" };

function store(corruptRead = false) {
  const objects = new Map<string, Buffer>(); const deleted: string[] = [];
  const value: ObjectCopyStore = {
    kind: "s3",
    async putIfAbsent({ key, body }) { if (objects.has(key)) return false; objects.set(key, Buffer.from(body)); return true; },
    async read(key) { const item = objects.get(key); return item ? { body: corruptRead ? Buffer.from("corrupt") : item, contentType: "audio/webm" } : null; },
    async delete(key) { deleted.push(key); objects.delete(key); },
  };
  return { value, objects, deleted };
}

test("move-objects import through the owner command: store required, read-back verified, DB and objects roll back together on failure", async () => {
  const source = await createTestDatabase(); const okTarget = await createTestDatabase(); const failTarget = await createTestDatabase(); const noStoreTarget = await createTestDatabase();
  const folder = await mkdtemp(join(tmpdir(), "riwi-object-command-")); const key = randomBytes(32); const owner = randomUUID();
  const oldSecret = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "qa-only-object-command-secret-0000000";
  const pool = (database: typeof source) => ({ async connect() { return { async query(text: string, values?: unknown[]) { return { rows: await database.query(text, values) }; } }; } });
  const count = async (database: typeof source) => (await database.query<{ n: number }>("select count(*)::int n from grammar_topics"))[0]?.n;
  try {
    for (const database of [source, okTarget, failTarget, noStoreTarget]) await database.query("insert into users(id,name,role,account_status)values($1,'OWNER','owner','active')", [owner]);
    await source.query("insert into grammar_topics(title,explanation,\"order\")values('Topic one','Authored source',1)");
    const archive = join(folder, "backup.lap");
    await exportEncryptedPostgresBundle({ pool: pool(source), ownerId: owner, scope: "learners-area", objectMode: "move-objects", destination: archive, key, sourceFingerprint: "source-fixture",
      snapshotAt: new Date(), async *objects() { yield portableObject; }, async *readObject() { yield bytes; } });
    const token = await createSessionToken({ sub: owner, role: "student", name: "QA", locale: "en", onboarded: true });
    const request = { source: archive, expectedScope: "learners-area", dryRun: false, destinationFingerprint: "destination-fixture" };

    await assert.rejects(runPortableImportCommand({ request, sessionToken: token, pool: pool(noStoreTarget), key }), /portable_object_store_required/);
    assert.equal(await count(noStoreTarget), 0);

    const bad = store(true);
    await assert.rejects(runPortableImportCommand({ request, sessionToken: token, pool: pool(failTarget), key, objectStore: bad.value }), (error: Error & { objectReceipt?: { state: string } }) => {
      assert.match(error.message, /object_readback_mismatch/); assert.equal(error.objectReceipt?.state, "rolled_back"); return true;
    });
    assert.equal(await count(failTarget), 0, "database rolled back");
    assert.equal(bad.objects.size, 0, "newly staged object removed");

    const good = store();
    const dry = await runPortableImportCommand({ request: { ...request, dryRun: true }, sessionToken: token, pool: pool(okTarget), key, objectStore: good.value });
    assert.equal(dry.dryRun, true); assert.equal(dry.objectReceipt?.state, "dry_run"); assert.equal(good.objects.size, 0); assert.equal(await count(okTarget), 0);
    const applied = await runPortableImportCommand({ request, sessionToken: token, pool: pool(okTarget), key, objectStore: good.value });
    assert.equal(await count(okTarget), 1);
    assert.equal(good.objects.get(portableObject.sourceKey)?.toString(), bytes.toString());
    assert.equal(applied.objectReceipt?.state, "committed");
    assert.equal(applied.objectReceipt?.staged.length, 1);
  } finally {
    if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret;
    key.fill(0); for (const database of [source, okTarget, failTarget, noStoreTarget]) await database.close(); await rm(folder, { recursive: true, force: true });
  }
});
