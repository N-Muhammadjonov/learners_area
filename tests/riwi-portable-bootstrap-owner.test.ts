import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "./support/pglite";
import { createSessionToken } from "../src/lib/auth/session";
import { runPortableExportCommand } from "../src/lib/portability/export-command";
import { runPortableImportCommand } from "../src/lib/portability/import-command";

for (const scope of ["full-system", "learners-area"] as const) for (const ownerFirst of [true, false]) {
  test(`${scope} (${ownerFirst ? "owner first" : "learner first"}): explicit bootstrap owner reconciliation preserves credentials and owner/learner references; unauthorized mappings roll back`, async () => {
    const source = await createTestDatabase(), target = await createTestDatabase();
    const folder = await mkdtemp(join(tmpdir(), "riwi-bootstrap-")), key = randomBytes(32);
    // Export order is UUID order. Exercise both early rejection paths explicitly
    // instead of letting random UUIDs decide which authorization error appears.
    const first = "00000000-0000-4000-8000-000000000001";
    const last = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const origin = ownerFirst ? first : last, owner = randomUUID(), learner = ownerFirst ? last : first;
    const rejectedLearnerMapping = ownerFirst ? /owner_identity_reconciliation_required/ : /source_owner_required/;
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "bootstrap-qa-session-secret-000000000000";
    const pool = (d: typeof source) => ({ async connect() { return { async query(sql: string, values?: unknown[]) { return { rows: await d.query(sql, values) }; } }; } });
    try {
      await source.query("insert into users(id,name,role,account_status,password_hash)values($1,'Origin','owner','active','origin-secret'),($2,'Learner','student','active',null)", [origin, learner]);
      await target.query("insert into users(id,name,role,account_status,password_hash)values($1,'Destination','owner','active','destination-secret')", [owner]);
      await source.query("insert into onboarding_profiles(user_id,current_level)values($1,'B2')", [origin]);
      const prompt = randomUUID(), attempt = randomUUID();
      await source.query("insert into speaking_prompts(id,part,category,prompt_text)values($1,'part1','part1','What do you enjoy?')", [prompt]);
      await source.query("insert into speaking_attempts(id,user_id,part)values($1,$2,'part1')", [attempt, origin]);
      await source.query("insert into riwi_knowledge_sources(source_type,title,checksum,provenance,rights_class,created_by_user_id)values('owner_instruction','Knowledge',repeat('a',64),'QA','owned',$1)", [origin]);
      const sourceToken = await createSessionToken({ sub: origin, role: "student", name: "QA", locale: "en", onboarded: true });
      const targetToken = await createSessionToken({ sub: owner, role: "student", name: "QA", locale: "en", onboarded: true });
      const archive = join(folder, "archive.lap");
      const exported = await runPortableExportCommand({ request: { scope, dryRun: false, destination: archive, sourceFingerprint: "bootstrap-source" }, sessionToken: sourceToken, pool: pool(source), key, async *objects() {} });
      assert.equal(exported.tables.some(t => t.table === "riwi_knowledge_sources"), scope === "full-system");
      const input = { request: { source: archive, expectedScope: scope, dryRun: true, destinationFingerprint: "bootstrap-target" }, sessionToken: targetToken, pool: pool(target), key };
      await assert.rejects(runPortableImportCommand(input), /owner_identity_reconciliation_required/);
      await assert.rejects(runPortableImportCommand({ ...input, identityMapping: [{ sourceId: origin, targetId: randomUUID() }] }), /target_owner_required/);
      await assert.rejects(runPortableImportCommand({ ...input, identityMapping: [{ sourceId: learner, targetId: owner }] }), rejectedLearnerMapping);
      await assert.rejects(runPortableImportCommand({ ...input, identityMapping: [{ sourceId: randomUUID(), targetId: owner }] }), /owner_identity_reconciliation_required|mapping_unused/);
      await assert.rejects(runPortableImportCommand({ ...input, request: { ...input.request, dryRun: false }, identityMapping: [{ sourceId: learner, targetId: owner }] }), rejectedLearnerMapping);
      assert.equal((await target.query<{ n: number }>("select count(*)::int n from users"))[0]!.n, 1, "failed apply preserves only the destination owner");
      assert.equal((await target.query<{ n: number }>("select count(*)::int n from speaking_attempts"))[0]!.n, 0, "invalid mapping cannot insert dependent attempts");
      assert.equal((await target.query<{ n: number }>("select count(*)::int n from onboarding_profiles"))[0]!.n, 0, "invalid mapping cannot insert user-backed profiles");
      const identityMapping = [{ sourceId: origin.toUpperCase(), targetId: owner.toUpperCase() }];
      const dry = await runPortableImportCommand({ ...input, identityMapping });
      assert.equal(dry.skips, 1); assert.match(dry.identityMappingHash!, /^[a-f0-9]{64}$/);
      assert.equal((await target.query<{ n: number }>("select count(*)::int n from speaking_attempts"))[0]!.n, 0);
      const applied = await runPortableImportCommand({ ...input, identityMapping, request: { ...input.request, dryRun: false } });
      assert.equal(applied.identityMappingHash, dry.identityMappingHash);
      assert.deepEqual((await target.query("select name,password_hash from users where id=$1", [owner]))[0], { name: "Destination", password_hash: "destination-secret" });
      assert.equal((await target.query<{ n: number }>("select count(*)::int n from users where id=$1", [origin]))[0]!.n, 0);
      assert.deepEqual((await target.query("select role,name from users where id=$1", [learner]))[0], { role: "student", name: "Learner" });
      assert.equal((await target.query<{ user_id: string }>("select user_id from speaking_attempts where id=$1", [attempt]))[0]!.user_id, owner);
      assert.equal((await target.query<{ user_id: string }>("select user_id from onboarding_profiles"))[0]!.user_id, owner, "user-backed primary keys are remapped too");
      if (scope === "full-system") assert.equal((await target.query<{ created_by_user_id: string }>("select created_by_user_id from riwi_knowledge_sources"))[0]!.created_by_user_id, owner);
      else assert.equal((await target.query<{ n: number }>("select count(*)::int n from riwi_knowledge_sources"))[0]!.n, 0);
      await assert.rejects(runPortableImportCommand({ ...input, identityMapping }), /fresh_destination_required/);
    } finally {
      if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;
      key.fill(0); await source.close(); await target.close(); await rm(folder, { recursive: true, force: true });
    }
  });
}
