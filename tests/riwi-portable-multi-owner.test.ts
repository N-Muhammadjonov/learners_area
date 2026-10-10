import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPortableTestDatabase, nativePortableTestsEnabled, type PortableTestDatabase } from "./support/riwi-portability-database";
import { createSessionToken } from "../src/lib/auth/session";
import { runPortableExportCommand } from "../src/lib/portability/export-command";
import { runPortableImportCommand } from "../src/lib/portability/import-command";

for (const kind of ["pglite", "native"] as const) for (const scope of ["full-system", "learners-area"] as const) {
  test(kind + " " + scope + ": two explicit owner mappings preserve destination credentials and distinct dependent identities", { skip: kind === "native" && !nativePortableTestsEnabled ? "set PORTABILITY_DATABASE_URL and the private RIWI_QA_DATA_DIR" : false }, async () => {
    const source = await createPortableTestDatabase(kind);
    const target = await createPortableTestDatabase(kind).catch(async error => { await source.close(); throw error; });
    const folder = await mkdtemp(join(tmpdir(), "riwi-multi-owner-")), key = randomBytes(32);
    const sourceA = randomUUID(), sourceB = randomUUID(), targetA = randomUUID(), targetB = randomUUID(), learner = randomUUID();
    const oldSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "multi-owner-qa-session-secret-000000000000";
    const pool = (d: PortableTestDatabase) => ({
      async connect() {
        return { async query(sql: string, values?: unknown[]) { return { rows: await d.query(sql, values) }; } };
      },
    });
    const counts = async () => ({
      users: (await target.query<{ n: number }>("select count(*)::int n from users"))[0]!.n,
      profiles: (await target.query<{ n: number }>("select count(*)::int n from onboarding_profiles"))[0]!.n,
      attempts: (await target.query<{ n: number }>("select count(*)::int n from speaking_attempts"))[0]!.n,
    });
    try {
      await source.query("insert into users(id,name,role,account_status,password_hash)values($1,'Source A','owner','active','source-a'),($2,'Source B','owner','active','source-b'),($3,'Learner','student','active',null)", [sourceA, sourceB, learner]);
      await target.query("insert into users(id,name,role,account_status,password_hash)values($1,'Target A','owner','active','target-a'),($2,'Target B','owner','active','target-b')", [targetA, targetB]);
      await source.query("insert into onboarding_profiles(user_id,current_level)values($1,'B2'),($2,'C1')", [sourceA, sourceB]);
      const attemptA = randomUUID(), attemptB = randomUUID();
      await source.query("insert into speaking_attempts(id,user_id,part)values($1,$2,'part1'),($3,$4,'part2')", [attemptA, sourceA, attemptB, sourceB]);
      await source.query("insert into riwi_knowledge_sources(source_type,title,checksum,provenance,rights_class,created_by_user_id)values('owner_instruction','Knowledge A',repeat('a',64),'QA','owned',$1),('owner_instruction','Knowledge B',repeat('b',64),'QA','owned',$2)", [sourceA, sourceB]);
      const token = (id: string) => createSessionToken({ sub: id, role: "student", name: "Untrusted token role", locale: "en", onboarded: true });
      const archive = join(folder, "source.lap");
      await runPortableExportCommand({ request: { scope, dryRun: false, destination: archive, sourceFingerprint: "multi-owner-source" }, sessionToken: await token(sourceA), pool: pool(source), key, async *objects() {} });
      const request = { source: archive, expectedScope: scope, dryRun: true, destinationFingerprint: "multi-owner-target" };
      const input = { request, sessionToken: await token(targetA), pool: pool(target), key };
      const identityMapping = [{ sourceId: sourceA, targetId: targetA }, { sourceId: sourceB, targetId: targetB }];

      const dry = await runPortableImportCommand({ ...input, identityMapping });
      assert.equal(dry.skips, 2, "both pre-provisioned owners are retained");
      assert.equal(dry.dryRun, true);
      assert.deepEqual(await counts(), { users: 2, profiles: 0, attempts: 0 }, "dry-run performs no writes");
      const reversed = await runPortableImportCommand({ ...input, identityMapping: [...identityMapping].reverse().map(item => ({ sourceId: item.sourceId.toUpperCase(), targetId: item.targetId.toUpperCase() })) });
      assert.equal(dry.identityMappingHash, reversed.identityMappingHash, "reviewed mapping identity ignores input ordering and UUID case");

      await assert.rejects(runPortableImportCommand({ ...input, identityMapping: [identityMapping[0]!] }), /fresh_destination_required/);
      await assert.rejects(runPortableImportCommand({ ...input, identityMapping: [identityMapping[0]!, { sourceId: sourceB, targetId: targetA }] }), /one_to_one/);
      await assert.rejects(runPortableImportCommand({ ...input, identityMapping: [identityMapping[0]!, { sourceId: sourceB, targetId: randomUUID() }] }), /target_owner_required/);
      await target.query("update users set account_status='suspended' where id=$1", [targetB]);
      await assert.rejects(runPortableImportCommand({ ...input, identityMapping }), /target_owner_required/);
      await target.query("update users set account_status='active' where id=$1", [targetB]);
      await assert.rejects(runPortableImportCommand({ ...input, identityMapping: [identityMapping[0]!, { sourceId: learner, targetId: targetB }] }), /source_owner_required|owner_identity_reconciliation_required/);

      const extra = randomUUID(), unusedSource = randomUUID();
      await target.query("insert into users(id,name,role,account_status)values($1,'Unmapped owner','owner','active')", [extra]);
      await assert.rejects(runPortableImportCommand({ ...input, identityMapping }), /fresh_destination_required/);
      await assert.rejects(runPortableImportCommand({ ...input, request: { ...request, dryRun: false }, identityMapping: [...identityMapping, { sourceId: unusedSource, targetId: extra }] }), /identity_mapping_unused/);
      assert.deepEqual(await counts(), { users: 3, profiles: 0, attempts: 0 }, "an unused mapping rolls all imported rows back");
      await target.query("delete from users where id=$1", [extra]);

      await source.query("update users set account_status='suspended' where id=$1", [sourceB]);
      const suspendedArchive = join(folder, "suspended-source.lap");
      await runPortableExportCommand({ request: { scope, dryRun: false, destination: suspendedArchive, sourceFingerprint: "suspended-source" }, sessionToken: await token(sourceA), pool: pool(source), key, async *objects() {} });
      await assert.rejects(runPortableImportCommand({ ...input, request: { ...request, source: suspendedArchive, dryRun: false }, identityMapping }), /source_owner_required/);
      assert.deepEqual(await counts(), { users: 2, profiles: 0, attempts: 0 }, "inactive source authority is never rebound to an active destination owner");

      const applied = await runPortableImportCommand({ ...input, request: { ...request, dryRun: false }, identityMapping });
      assert.equal(applied.identityMappingHash, dry.identityMappingHash);
      for (const [id, name, password] of [[targetA, "Target A", "target-a"], [targetB, "Target B", "target-b"]]) {
        assert.deepEqual((await target.query("select name,password_hash,role,account_status from users where id=$1", [id]))[0], { name, password_hash: password, role: "owner", account_status: "active" });
      }
      assert.deepEqual(await counts(), { users: 3, profiles: 2, attempts: 2 });
      assert.equal((await target.query<{ user_id: string }>("select user_id from speaking_attempts where id=$1", [attemptA]))[0]!.user_id, targetA);
      assert.equal((await target.query<{ user_id: string }>("select user_id from speaking_attempts where id=$1", [attemptB]))[0]!.user_id, targetB);
      assert.equal((await target.query<{ current_level: string }>("select current_level from onboarding_profiles where user_id=$1", [targetA]))[0]!.current_level, "B2");
      assert.equal((await target.query<{ current_level: string }>("select current_level from onboarding_profiles where user_id=$1", [targetB]))[0]!.current_level, "C1");
      assert.equal((await target.query<{ n: number }>("select count(*)::int n from users where id in ($1,$2)", [sourceA, sourceB]))[0]!.n, 0);
      const importedKnowledge = await target.query<{ title: string; created_by_user_id: string }>("select title,created_by_user_id from riwi_knowledge_sources order by title");
      assert.deepEqual(importedKnowledge, scope === "full-system" ? [{ title: "Knowledge A", created_by_user_id: targetA }, { title: "Knowledge B", created_by_user_id: targetB }] : []);
      await assert.rejects(runPortableImportCommand({ ...input, identityMapping }), /fresh_destination_required/);
    } finally {
      if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret;
      key.fill(0);
      await source.close(); await target.close(); await rm(folder, { recursive: true, force: true });
    }
  });
}
