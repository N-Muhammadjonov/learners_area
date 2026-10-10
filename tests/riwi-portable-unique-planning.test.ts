import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPortableTestDatabase, nativePortableTestsEnabled } from "./support/riwi-portability-database";
import { exportPortableArchive, importPortableArchive } from "../src/lib/portability/archive";
import { createPostgresImportDestination, type PgPool } from "../src/lib/portability/postgres-adapter";
import type { PortableRow } from "../src/lib/portability/types";

for (const kind of ["pglite", "native"] as const) {
  test(kind + ": dry-run and apply agree on normalized primary, secondary, composite and partial unique conflicts", { skip: kind === "native" && !nativePortableTestsEnabled ? "requires an identified private native PostgreSQL cluster" : false, timeout: 60000 }, async () => {
    const database = await createPortableTestDatabase(kind);
    const owner = randomUUID();
    const pool: PgPool = database.pool ?? { async connect() { return { async query(sql, values) { return { rows: await database.query(sql, values) }; } }; } };
    const run = async (rows: Record<string, PortableRow[]>, dryRun: boolean) => {
      const files = new Map<string, string>(); let current = "";
      const manifest = await exportPortableArchive({ scope: "full-system", objectMode: "keep-r2", sourceFingerprint: "unique-planning", source: { async *rows(table) { if (rows[table]) yield rows[table]!; }, async *objects() {} },
        sink: { async beginFile(file) { current = file; files.set(file, ""); }, async write(line) { files.set(current, files.get(current)! + line); }, async endFile() {} } });
      return importPortableArchive({ manifest, dryRun, destination: createPostgresImportDestination(pool, undefined, { ownerId: owner, scope: "full-system", dryRun }), archive: {
        async *readRows(file) { yield* files.get(file)!.split("\n").filter(Boolean); }, async readObject() { throw new Error("no objects"); },
      } });
    };
    try {
      await database.query("insert into users(id,name,email,role,account_status)values($1,'Owner','owner@example.test','owner','active')", [owner]);
      const user = (id: string, email: string | null) => ({ id, email, name: "Learner", role: "student", accountStatus: "active" });
      const id = randomUUID(), global = randomUUID(), learner = randomUUID();
      const invite = (status?: string) => ({ id: randomUUID(), fromUserId: owner, toUserId: learner, expiresAt: new Date(Date.now() + 86400000).toISOString(), ...(status ? { status } : {}) });
      const conflicts: Record<string, PortableRow[]>[] = [
        { users: [user(id, null), user(id.toUpperCase(), null)] },
        { users: [user(randomUUID(), "same@example.test"), user(randomUUID(), "same@example.test")] },
        { users: [user(randomUUID(), "owner@example.test")] },
        { riwi_knowledge_sources: [{ id: global, sourceType: "owner_instruction", title: "Source", checksum: "a".repeat(64), provenance: "QA", rightsClass: "owned", createdByUserId: owner }], riwi_knowledge_units: [
          { id: randomUUID(), sourceId: global, ordinal: 1, content: "One", contentHash: "b".repeat(64), characterCount: 3 },
          { id: randomUUID(), sourceId: global, ordinal: 1, content: "Two", contentHash: "c".repeat(64), characterCount: 3 },
        ] },
        { users: [user(learner, null)], live_partner_invites: [invite("pending"), invite("pending")] },
        { users: [user(learner, null)], live_partner_invites: [invite(), invite()] },
      ];
      for (const rows of conflicts) for (const dryRun of [true, false]) {
        await assert.rejects(run(rows, dryRun), /import_conflicts/);
        assert.equal((await database.query<{ n: number }>("select count(*)::int n from users"))[0]!.n, 1);
        assert.equal((await database.query<{ n: number }>("select count(*)::int n from riwi_knowledge_units"))[0]!.n, 0);
        assert.equal((await database.query<{ n: number }>("select count(*)::int n from live_partner_invites"))[0]!.n, 0);
      }
      const accepted = { users: [user(learner, null), user(randomUUID(), null)], live_partner_invites: [invite("cancelled"), invite("cancelled"), invite("pending")] };
      const dry = await run(accepted, true);
      assert.equal(dry.creates, 5, "NULL-distinct values and rows outside the partial predicate must remain valid");
      assert.equal((await database.query<{ n: number }>("select count(*)::int n from users"))[0]!.n, 1);
      assert.equal((await run(accepted, false)).creates, dry.creates);
      assert.equal((await database.query<{ n: number }>("select count(*)::int n from live_partner_invites"))[0]!.n, 3);
    } finally { await database.close(); }
  });
}
