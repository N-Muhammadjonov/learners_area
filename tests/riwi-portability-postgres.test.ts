import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { exportPortableArchive, importPortableArchive, type ExportSink } from "../src/lib/portability/archive";
import { createPostgresImportDestination } from "../src/lib/portability/postgres-adapter";
import type { PortableRow } from "../src/lib/portability/types";

const enabled = Boolean(process.env.PORTABILITY_DATABASE_URL);

test("portable archive imports transactionally into fresh real PostgreSQL and duplicate retry rolls back", { skip: !enabled }, async () => {
  const url = new URL(process.env.PORTABILITY_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.pathname, "/learners_portability");
  const files = new Map<string, string>(); let current = "";
  const sink: ExportSink = {
    async beginFile(file) { current = file; files.set(file, ""); },
    async write(chunk) { files.set(current, `${files.get(current) ?? ""}${chunk}`); },
    async endFile() {},
  };
  const id = "00000000-0000-4000-8000-000000000099";
  const manifest = await exportPortableArchive({
    scope: "full-system", objectMode: "keep-r2", sourceFingerprint: "qa-local", createdAt: new Date("2026-10-05T00:00:00Z"), batchSize: 50,
    source: {
      async *rows(table) { if (table === "users") yield [{ id, name: "Portable Learner", role: "student", accountStatus: "active" } satisfies PortableRow]; },
      async *objects() { /* no object fixtures */ },
    }, sink,
  });
  const pool = new pg.Pool({ connectionString: process.env.PORTABILITY_DATABASE_URL, max: 2 });
  const destination = createPostgresImportDestination(pool);
  const archive = { async *readRows(file: string) { for (const line of (files.get(file) ?? "").split("\n")) if (line) yield line; }, async readObject() { return new Uint8Array(); } };
  try {
    const dryRun = await importPortableArchive({ manifest, archive, destination, dryRun: true });
    assert.equal(dryRun.creates, 1);
    assert.equal((await pool.query("select count(*)::int count from users")).rows[0].count, 0);
    const applied = await importPortableArchive({ manifest, archive, destination, dryRun: false });
    assert.equal(applied.creates, 1);
    assert.equal((await pool.query("select name from users where id=$1", [id])).rows[0].name, "Portable Learner");
    await assert.rejects(() => importPortableArchive({ manifest, archive, destination, dryRun: false }), /import_conflicts:1/);
    assert.equal((await pool.query("select count(*)::int count from users")).rows[0].count, 1);
  } finally { await pool.end(); }
});
