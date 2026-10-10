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
import { withEncryptedPortableArchive } from "../src/lib/portability/encrypted-archive";
import { sha256, stableJson } from "../src/lib/portability/archive";
import { tablesForScope } from "../src/lib/portability/classification";
import type { PgPool } from "../src/lib/portability/postgres-adapter";

const poolFor = (database: PortableTestDatabase): PgPool => database.pool ?? {
  async connect() { return { async query(sql: string, params?: unknown[]) { return { rows: await database.query(sql, params) }; } }; },
};

async function databaseFingerprint(database: PortableTestDatabase) {
  const rows = [];
  for (const table of tablesForScope("full-system").sort()) {
    const contents = await database.query("select to_jsonb(t) row from \"" + table + "\" t order by to_jsonb(t)::text");
    rows.push({ table, contents });
  }
  return sha256(stableJson(rows));
}

// Both engines use canonical migrations. Native cases are a separate gate and
// cannot be claimed from the local PGlite rehearsal or from a skipped test.
for (const kind of ["pglite", "native"] as const) for (const scope of ["full-system", "riwi", "learners-area"] as const) {
  test(kind + " " + scope + ": encrypted >1000-row command rehearsal preserves scope, relationships, timestamps, dry-run and rollback", {
    skip: kind === "native" && !nativePortableTestsEnabled ? "requires an identified private native PostgreSQL cluster" : false,
    timeout: 120000,
  }, async () => {
    const source = await createPortableTestDatabase(kind);
    const target = await createPortableTestDatabase(kind).catch(async error => { await source.close(); throw error; });
    const root = await mkdtemp(join(tmpdir(), "riwi-tri-mode-")), key = randomBytes(32);
    const sourceOwner = randomUUID(), targetOwner = randomUUID(), learner = randomUUID(), global = randomUUID(), privateSource = randomUUID();
    const conversation = randomUUID(), expiredConversation = randomUUID(), recentMessage = randomUUID();
    const oldSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "tri-mode-command-session-00000000000000000000";
    const timestamp = "2026-01-02T03:04:05.123Z";
    const token = (id: string) => createSessionToken({ sub: id, role: "student", name: "Untrusted role claim", locale: "en", onboarded: true });
    try {
      await source.query("insert into users(id,name,role,account_status,password_hash,last_active_at)values($1,'Source owner','owner','active','source-auth',now()),($2,'PRIVATE_LEARNER_CANARY','student','active',null,now())", [sourceOwner, learner]);
      await target.query("insert into users(id,name,role,account_status,password_hash)values($1,'Target owner','owner','active','target-auth')", [targetOwner]);
      await source.query("update users set status_updated_at=$1 where id=$2", [timestamp, learner]);
      await source.query("insert into grammar_topics(title,explanation,\"order\") select 'Topic '||n,'SITE_CONTENT_CANARY '||n,n from generate_series(1,1005)n");
      await source.query("insert into riwi_knowledge_sources(id,source_type,title,checksum,provenance,rights_class,scope,scope_user_id,created_by_user_id,created_at)values($1,'owner_instruction','Public source',repeat('a',64),'QA','owned','global',null,$3,$4),($2,'owner_instruction','PRIVATE_SOURCE_CANARY',repeat('b',64),'QA','owned','user',$5,$3,$4)", [global, privateSource, sourceOwner, timestamp, learner]);
      await source.query("insert into riwi_knowledge_units(source_id,ordinal,content,content_hash,character_count,created_at) select $1,n,'Public fact '||n,lpad(n::text,64,'0'),length('Public fact '||n),$2::timestamptz from generate_series(1,1005)n", [global, timestamp]);
      await source.query("insert into riwi_knowledge_units(source_id,ordinal,content,content_hash,character_count)values($1,1,'PRIVATE_UNIT_CANARY',repeat('c',64),19)", [privateSource]);
      await source.query("insert into riwi_conversations(id,user_id,role_at_creation,expires_at)values($1,$3,'student',now()+interval '30 days'),($2,$3,'student',now()-interval '1 day')", [conversation, expiredConversation, learner]);
      await source.query("insert into riwi_conversation_messages(id,conversation_id,role,content,created_at)values($1,$2,'user','RECENT_CHAT_CANARY',now()),(gen_random_uuid(),$2,'user','OLD_CHAT_CANARY',now()-interval '31 days'),(gen_random_uuid(),$3,'user','EXPIRED_PARENT_CHAT_CANARY',now())", [recentMessage, conversation, expiredConversation]);

      // B must preserve the target site; C must preserve the target's independent
      // RIWI state. Neither scope is allowed to silently expand into the other.
      if (scope === "riwi") await target.query("insert into grammar_topics(title,explanation,\"order\")values('Destination site','TARGET_SITE_CANARY',1)");
      if (scope === "learners-area") await target.query("insert into riwi_knowledge_sources(source_type,title,checksum,provenance,rights_class,created_by_user_id)values('owner_instruction','Target RIWI',repeat('d',64),'TARGET_RIWI_CANARY','owned',$1)", [targetOwner]);
      const before = await databaseFingerprint(target);
      const archive = join(root, "source.lap");
      const manifest = await runPortableExportCommand({ request: { scope, dryRun: false, destination: archive, sourceFingerprint: "tri-mode-source" }, sessionToken: await token(sourceOwner), pool: poolFor(source), key, async *objects() {} });
      const count = (table: string) => manifest.tables.find(entry => entry.table === table)?.rowCount;
      assert.equal(count(scope === "riwi" ? "riwi_knowledge_units" : "grammar_topics"), 1005);
      assert.equal(count("riwi_knowledge_units"), scope === "riwi" ? 1005 : scope === "full-system" ? 1006 : undefined);
      assert.equal(count("riwi_conversation_messages"), scope === "full-system" ? 1 : undefined);
      assert.equal(count("riwi_conversations"), scope === "full-system" ? 1 : undefined);
      assert.equal(count("users"), scope === "riwi" ? undefined : 2);
      await withEncryptedPortableArchive({ source: archive, key }, async (checked, reader) => {
        assert.equal(checked.manifestSha256, manifest.manifestSha256);
        for (const table of checked.tables) {
          let rows = 0;
          const chunks: string[] = [];
          for await (const chunk of reader.readRows(table.file)) { chunks.push(chunk.endsWith("\n") ? chunk : chunk + "\n"); rows++; }
          const body = chunks.join("");
          assert.equal(rows, table.rowCount);
          assert.equal(Buffer.byteLength(body), table.byteLength);
          assert.equal(sha256(body), table.sha256);
          assert.ok(!body.includes("OLD_CHAT_CANARY") && !body.includes("EXPIRED_PARENT_CHAT_CANARY"));
          if (scope === "riwi") assert.ok(!/PRIVATE_|SITE_CONTENT_CANARY|RECENT_CHAT_CANARY/.test(body));
        }
      });

      const input = { request: { source: archive, expectedScope: scope, dryRun: true, destinationFingerprint: "tri-mode-target" }, sessionToken: await token(targetOwner), pool: poolFor(target), key, identityMapping: [{ sourceId: sourceOwner, targetId: targetOwner }] };
      const dry = await runPortableImportCommand(input);
      assert.equal(dry.dryRun, true);
      assert.equal(await databaseFingerprint(target), before, "zero persistent writes across every classified table");
      await assert.rejects(runPortableImportCommand({ ...input, request: { ...input.request, dryRun: false }, identityMapping: [...input.identityMapping, { sourceId: randomUUID(), targetId: targetOwner }] }), /one_to_one/);
      assert.equal(await databaseFingerprint(target), before);

      // Inject a real mid-import DB failure after prior rows have been inserted.
      let inserted = 0;
      const realPool = poolFor(target);
      const failingPool = { async connect() {
        const client = await realPool.connect();
        return {
          async query(sql: string, values?: unknown[]) {
            if (sql.startsWith("insert into ") && ++inserted === 25) throw new Error("qa_mid_import_failure");
            return client.query(sql, values);
          },
          release: (error?: Error | boolean) => client.release?.(error),
        };
      } };
      await assert.rejects(runPortableImportCommand({ ...input, request: { ...input.request, dryRun: false }, pool: failingPool }), /qa_mid_import_failure/);
      assert.equal(inserted, 25);
      assert.equal(await databaseFingerprint(target), before, "failure rolls back every earlier insertion");
      const applied = await runPortableImportCommand({ ...input, request: { ...input.request, dryRun: false } });
      assert.equal(applied.creates, dry.creates);
      assert.equal(applied.skips, dry.skips);
      assert.equal(applied.identityMappingHash, dry.identityMappingHash);
      assert.deepEqual((await target.query("select name,password_hash,role,account_status from users where id=$1", [targetOwner]))[0], { name: "Target owner", password_hash: "target-auth", role: "owner", account_status: "active" });
      const topics = await target.query<{ n: number }>("select count(*)::int n from grammar_topics");
      assert.equal(topics[0]!.n, scope === "riwi" ? 1 : 1005);
      if (scope !== "riwi") {
        const dates = await target.query<{ status_updated_at: Date }>("select status_updated_at from users where id=$1", [learner]);
        assert.equal(new Date(dates[0]!.status_updated_at).toISOString(), timestamp);
      }
      const units = await target.query<{ n: number }>("select count(*)::int n from riwi_knowledge_units");
      assert.equal(units[0]!.n, scope === "full-system" ? 1006 : scope === "riwi" ? 1005 : 0);
      if (scope !== "learners-area") {
        const [saved] = await target.query<{ created_by_user_id: string; created_at: Date }>("select created_by_user_id,created_at from riwi_knowledge_sources where id=$1", [global]);
        assert.equal(saved!.created_by_user_id, targetOwner);
        assert.equal(new Date(saved!.created_at).toISOString(), timestamp);
        await assert.rejects(target.query("update riwi_knowledge_units set source_id=$1 where source_id=$2", [randomUUID(), global]), /foreign key|violates/);
      }
      assert.equal((await target.query<{ n: number }>("select count(*)::int n from riwi_conversation_messages"))[0]!.n, scope === "full-system" ? 1 : 0);
      if (scope === "full-system") assert.equal((await target.query<{ conversation_id: string }>("select conversation_id from riwi_conversation_messages where id=$1", [recentMessage]))[0]!.conversation_id, conversation);
      const after = await databaseFingerprint(target);
      await assert.rejects(runPortableImportCommand({ ...input, request: { ...input.request, dryRun: false } }), /fresh_destination_required/);
      assert.equal(await databaseFingerprint(target), after, "a duplicate command never partially overwrites restored state");
    } finally {
      if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret;
      key.fill(0);
      await source.close(); await target.close(); await rm(root, { recursive: true, force: true });
    }
  });
}
