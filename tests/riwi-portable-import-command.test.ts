import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "./support/pglite";
import { exportEncryptedPostgresBundle } from "../src/lib/portability/bundle";
import { runPortableImportCommand, portableImportCommandSchema } from "../src/lib/portability/import-command";
import { createSessionToken } from "../src/lib/auth/session";

test("owner import validates scope/freshness, dry-run leaves no rows, apply preserves bootstrap owner, and retries do not overwrite", async () => {
  const source = await createTestDatabase(); const target = await createTestDatabase();
  const folder = await mkdtemp(join(tmpdir(), "riwi-import-command-")); const key = randomBytes(32); const owner = randomUUID();
  const oldSecret = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "qa-only-import-owner-secret-000000000";
  const pool = (database: typeof source) => ({ async connect() { return { async query(text: string, values?: unknown[]) { return { rows: await database.query(text, values) }; } }; } });
  try {
    await source.query("insert into users(id,name,role,account_status)values($1,'SOURCE_OWNER','owner','active')", [owner]);
    await target.query("insert into users(id,name,role,account_status)values($1,'KEEP_TARGET_OWNER','owner','active')", [owner]);
    await source.query("insert into grammar_topics(title,explanation,\"order\")values('Topic one','Authored source',1),('Topic two','Authored source',2)");
    const archive = join(folder, "backup.lap");
    await exportEncryptedPostgresBundle({ pool: pool(source), ownerId: owner, scope: "learners-area", objectMode: "keep-r2", destination: archive, key, sourceFingerprint: "source-fixture", snapshotAt: new Date(), async *objects() {} });
    const token = await createSessionToken({ sub: owner, role: "student", name: "QA", locale: "en", onboarded: true });
    const request = { source: archive, expectedScope: "learners-area", dryRun: true, destinationFingerprint: "destination-fixture" };
    const input = { request, sessionToken: token, pool: pool(target), key };
    assert.equal(portableImportCommandSchema.safeParse({ ...request, identityMap: { fake: "actor" } }).success, false);
    await assert.rejects(runPortableImportCommand({ ...input, request: { ...request, expectedScope: "full-system" } }), /scope_mismatch/);
    await assert.rejects(runPortableImportCommand({ ...input, request: { ...request, destinationFingerprint: "source-fixture" } }), /must_differ/);
    const plan = await runPortableImportCommand(input);
    assert.equal(plan.dryRun, true); assert.equal(plan.skips, 1); assert.equal(plan.creates, 2);
    assert.equal((await target.query<{ n: number }>("select count(*)::int n from grammar_topics"))[0]?.n, 0);
    const applied = await runPortableImportCommand({ ...input, request: { ...request, dryRun: false } });
    assert.equal(applied.creates, 2);
    assert.equal((await target.query<{ n: number }>("select count(*)::int n from grammar_topics"))[0]?.n, 2);
    assert.equal((await target.query<{ name: string }>("select name from users where id=$1", [owner]))[0]?.name, "KEEP_TARGET_OWNER");
    await assert.rejects(runPortableImportCommand(input), /fresh_destination_required/);
    await target.query("update users set account_status='suspended' where id=$1", [owner]);
    await assert.rejects(runPortableImportCommand(input), /portable_owner_required/);
  } finally {
    if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret;
    key.fill(0); await source.close(); await target.close(); await rm(folder, { recursive: true, force: true });
  }
});
