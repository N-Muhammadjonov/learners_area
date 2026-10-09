import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { createSessionToken } from "../src/lib/auth/session";
import { createTestDatabase } from "./support/pglite";
import { runPortableExportCommand, portableExportCommandSchema } from "../src/lib/portability/export-command";
import { decryptPortableFile } from "../src/lib/portability/encryption";
import { verifyManifest } from "../src/lib/portability/archive";

test("explicit owner export supports zero-write dry-run and private encrypted site-only delivery", async () => {
  const d = await createTestDatabase();
  const folder = await mkdtemp(join(tmpdir(), "riwi-export-command-"));
  const owner = randomUUID(); const student = randomUUID(); const key = randomBytes(32);
  const priorSecret = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "qa-only-export-session-secret-000000000";
  const pool = { async connect() { return { async query(text: string, values?: unknown[]) { return { rows: await d.query(text, values) }; } }; } };
  const token = (id: string) => createSessionToken({ sub: id, role: "owner", name: "QA", locale: "en", onboarded: true });
  const request = { scope: "learners-area", dryRun: true, sourceFingerprint: "isolated-native-fixture" };
  try {
    await d.query("insert into users(id,name,role,account_status)values($1,'PRIVATE_OWNER_CANARY','owner','active'),($2,'student','student','active')", [owner, student]);
    const before = await d.query("select count(*)::int n from audit_log");
    const input = { request, sessionToken: await token(owner), pool, async *objects() {} };
    assert.equal(portableExportCommandSchema.safeParse({ dryRun: true, sourceFingerprint: "fixture" }).success, false, "no implicit full-system scope");
    await assert.rejects(runPortableExportCommand({ ...input, sessionToken: "forged" }), /portable_owner_required/);
    await assert.rejects(runPortableExportCommand({ ...input, sessionToken: await token(student) }), /portable_owner_required/, "JWT presentation role is not authority");
    const riwi = await runPortableExportCommand({ ...input, request: { ...request, scope: "riwi" } });
    verifyManifest(riwi);
    assert.ok(riwi.assessmentContracts?.length);
    assert.ok(riwi.tables.every(item => item.table.startsWith("riwi_")));
    const dry = await runPortableExportCommand(input);
    assert.equal(dry.scope, "learners-area"); verifyManifest(dry);
    assert.equal(dry.assessmentContracts, undefined);
    assert.ok(!dry.tables.some(item => item.table.startsWith("riwi_")));
    assert.deepEqual(await readdir(folder), []);
    assert.deepEqual(await d.query("select count(*)::int n from audit_log"), before);
    const destination = join(folder, "backup.lap");
    const manifest = await runPortableExportCommand({ ...input, request: { ...request, dryRun: false, destination }, key });
    assert.ok(!(await readFile(destination)).includes(Buffer.from("PRIVATE_OWNER_CANARY")));
    const zip = join(folder, "verified.zip"); await decryptPortableFile(destination, zip, key);
    const files = unzipSync(await readFile(zip));
    assert.deepEqual(JSON.parse(strFromU8(files["manifest.json"]!)), manifest);
    assert.ok(Object.keys(files).every(name => name === "manifest.json" || name.startsWith("tables/")));
    assert.match(strFromU8(files["tables/users.jsonl"]!), /PRIVATE_OWNER_CANARY/);
    const old = await readFile(destination);
    await assert.rejects(runPortableExportCommand({ ...input, request: { ...request, dryRun: false, destination }, key }), /EEXIST/);
    assert.deepEqual(await readFile(destination), old);
    await d.query("update users set account_status='suspended' where id=$1", [owner]);
    await assert.rejects(runPortableExportCommand(input), /portable_owner_required/);
  } finally {
    key.fill(0); if (priorSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = priorSecret;
    await d.close(); await rm(folder, { recursive: true, force: true });
  }
});
