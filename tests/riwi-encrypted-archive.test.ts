import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "./support/pglite";
import { exportEncryptedPostgresBundle } from "../src/lib/portability/bundle";
import { decryptPortableFile, encryptPortableFile } from "../src/lib/portability/encryption";
import { withEncryptedPortableArchive } from "../src/lib/portability/encrypted-archive";
import { importPortableArchive } from "../src/lib/portability/archive";

test("authenticated stored bundle streams over 1,000 rows, rejects truncation and cleans plaintext on all paths", async () => {
  const d = await createTestDatabase(); const folder = await mkdtemp(join(tmpdir(), "riwi-archive-test-"));
  const key = randomBytes(32); const owner = randomUUID();
  const pool = { async connect() { return { async query(text: string, values?: unknown[]) { return { rows: await d.query(text, values) }; } }; } };
  const staging = async () => new Set((await readdir(tmpdir())).filter(name => name.startsWith("riwi-import-")));
  try {
    await d.query("insert into users(id,name,role,account_status)values($1,'owner','owner','active')", [owner]);
    await d.query("insert into grammar_topics(title,explanation,\"order\") select 'Fixture topic '||n,'Authored fixture explanation',n from generate_series(1,1001)n");
    const encrypted = join(folder, "backup.lap");
    await exportEncryptedPostgresBundle({ pool, ownerId: owner, scope: "learners-area", objectMode: "keep-r2", destination: encrypted, key, sourceFingerprint: "source-fixture", snapshotAt: new Date(), async *objects() {} });
    const before = await staging(); let planned = 0; let applied = 0;
    const result = await withEncryptedPortableArchive({ source: encrypted, key }, (manifest, archive) => importPortableArchive({ manifest, archive, dryRun: true,
      destination: { async transaction(work) { return work({ async planRow() { planned++; return "create"; }, async applyRow() { applied++; }, async copyObject() { throw new Error("O1 must not copy"); } }); } } }));
    assert.ok(result.creates > 1000); assert.equal(planned, result.creates); assert.equal(applied, 0);
    assert.deepEqual(await staging(), before);
    await assert.rejects(withEncryptedPortableArchive({ source: encrypted, key }, async () => { throw new Error("destination failure"); }), /destination failure/);
    assert.deepEqual(await staging(), before);
    await assert.rejects(withEncryptedPortableArchive({ source: encrypted, key, maxBytes: 10 }, async () => {}), /size_limit/);
    const plain = join(folder, "plain.zip"); await decryptPortableFile(encrypted, plain, key);
    const broken = join(folder, "broken.zip"); const brokenEncrypted = join(folder, "broken.lap");
    const bytes = await readFile(plain); await writeFile(broken, bytes.subarray(0, bytes.length - 1), { mode: 0o600 });
    await encryptPortableFile(broken, brokenEncrypted, key);
    let accepted = false;
    await assert.rejects(withEncryptedPortableArchive({ source: brokenEncrypted, key }, async () => { accepted = true; }), /truncated/);
    assert.equal(accepted, false); assert.deepEqual(await staging(), before);
  } finally { await d.close(); await rm(folder, { recursive: true, force: true }); key.fill(0); }
});
