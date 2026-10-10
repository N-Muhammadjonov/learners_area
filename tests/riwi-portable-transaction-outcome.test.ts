import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestDatabase } from "./support/pglite";
import { createPostgresImportDestination } from "../src/lib/portability/postgres-adapter";

for (const committed of [false, true]) {
  test("lost COMMIT response discards the connection and refuses a success receipt, committed=" + committed, async () => {
    const database = await createTestDatabase();
    const id = randomUUID();
    const transportError = new Error("connection_lost_during_commit");
    let discarded: Error | boolean | undefined;
    let commits = 0;
    const destination = createPostgresImportDestination({ async connect() { return {
      async query(sql, values) {
        if (sql === "commit") {
          commits++;
          if (committed) await database.query(sql);
          throw transportError;
        }
        return { rows: await database.query(sql, values) };
      },
      release(error) { discarded = error; },
    }; } });
    try {
      await assert.rejects(destination.transaction(async transaction => {
        const row = { id, name: "QA", role: "student", accountStatus: "active" };
        assert.equal(await transaction.planRow("users", row, new Map()), "create");
        await transaction.applyRow("users", row, new Map());
        return "must not be returned";
      }), error => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "portable_import_commit_uncertain");
        assert.equal(error.cause, transportError);
        assert.equal(discarded, error);
        return true;
      });
      assert.equal(commits, 1, "the adapter never retries COMMIT or the import");
      assert.equal((await database.query<{ n: number }>("select count(*)::int n from users where id=$1", [id]))[0]!.n, committed ? 1 : 0);
    } finally { await database.close(); }
  });
}

test("failed rollback discards the connection while preserving the original import error", async () => {
  const original = new Error("archive_checksum_mismatch");
  const rollback = new Error("rollback_connection_lost");
  let discarded: Error | boolean | undefined;
  let releases = 0;
  const destination = createPostgresImportDestination({ async connect() { return {
    async query(sql) { if (sql === "rollback") throw rollback; return { rows: [] }; },
    release(error) { discarded = error; releases++; },
  }; } });
  await assert.rejects(destination.transaction(async () => { throw original; }), error => error === original);
  assert.equal(discarded, rollback);
  assert.equal(releases, 1);
});

test("a known rollback allows safe connection reuse and never converts failure into success", async () => {
  const original = new Error("archive_checksum_mismatch");
  let discarded: Error | boolean | undefined;
  let releases = 0;
  const destination = createPostgresImportDestination({ async connect() { return {
    async query() { return { rows: [] }; },
    release(error) { discarded = error; releases++; },
  }; } });
  await assert.rejects(destination.transaction(async () => { throw original; }), error => error === original);
  assert.equal(discarded, undefined);
  assert.equal(releases, 1);
});
