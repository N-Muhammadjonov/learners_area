import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { PgPool } from "../../src/lib/portability/postgres-adapter";
import { createTestDatabase, type TestDatabase } from "./pglite";

export type PortableTestDatabase = Pick<TestDatabase, "query" | "close"> & { pool?: PgPool };
export const nativePortableTestsEnabled = Boolean(process.env.PORTABILITY_DATABASE_URL && process.env.RIWI_QA_DATA_DIR);

/** Native cases use new databases only inside the QA runner's identified private
 * cluster. They never reset the supplied database or use an arbitrary URL. */
export async function createPortableTestDatabase(kind: "pglite" | "native"): Promise<PortableTestDatabase> {
  if (kind === "pglite") return createTestDatabase();
  const url = new URL(process.env.PORTABILITY_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.pathname, "/learners_portability");
  assert.equal(url.search, "");
  assert.ok(process.env.RIWI_QA_DATA_DIR, "private QA cluster identity is required");
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.toString() });
  const database = "riwi_multi_owner_" + randomUUID().replaceAll("-", "");
  assert.match(database, /^riwi_multi_owner_[a-f0-9]{32}$/);
  let created = false;
  let client: pg.Client | undefined;
  let pool: pg.Pool | undefined;
  try {
    await admin.connect();
    const identity = (await admin.query<{ data_dir: string; version: number }>("select current_setting('data_directory') data_dir,current_setting('server_version_num')::int version")).rows[0]!;
    assert.ok(identity.version >= 150000);
    assert.equal(await realpath(identity.data_dir), await realpath(process.env.RIWI_QA_DATA_DIR!));
    await admin.query('create database "' + database + '"');
    created = true;
    url.pathname = "/" + database;
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    const journal = JSON.parse(await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: { tag: string }[] };
    assert.equal(journal.entries.length, 51);
    for (const entry of journal.entries) {
      assert.match(entry.tag, /^[0-9]{4}_[a-zA-Z0-9_]+$/);
      const migration = fileURLToPath(new URL("../../drizzle/" + entry.tag + ".sql", import.meta.url));
      const sql = await readFile(migration, "utf8");
      for (const statement of sql.split("--> statement-breakpoint").map(item => item.trim()).filter(Boolean)) await client.query(statement);
    }
    const connection = client;
    pool = new pg.Pool({ connectionString: url.toString(), max: 5 });
    const connections = pool;
    return {
      pool: connections,
      query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await connection.query(sql, params)).rows as T[],
      async close() {
        try {
          await connections.end();
          await connection.end();
          await admin.query('drop database "' + database + '"');
        } finally { await admin.end(); }
      },
    };
  } catch (error) {
    await pool?.end().catch(() => {});
    await client?.end().catch(() => {});
    if (created) await admin.query('drop database "' + database + '"').catch(() => {});
    await admin.end().catch(() => {});
    throw error;
  }
}
