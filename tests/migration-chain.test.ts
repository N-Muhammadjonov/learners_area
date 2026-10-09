import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
// @ts-expect-error plain ESM script shared by migration CLIs
import { loadMigrationChain, planMigrationHistory, applyMigrationChain } from "../scripts/migration-chain.mjs";

function migrationClient(client: PGlite) {
  return { query: async (sql: string, parameters?: unknown[]) => parameters
    ? client.query(sql, parameters) : (await client.exec(sql))[0] };
}

type Entry = { idx: number; tag: string; when: number; sql: string; hash: string };
const chain: Entry[] = loadMigrationChain("drizzle");
const hash = (sql: string) => createHash("sha256").update(sql).digest("hex");
async function assertCurrentSchema(client: PGlite) {
  const tables = (await client.query<{ table_name: string }>(`select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('speaking_ai_sessions', 'speaking_ai_session_items', 'riwi_security_signals') order by table_name`)).rows;
  assert.equal(tables.length, 3);
  const column = (await client.query(`select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'speaking_attempts' and column_name = 'ai_session_item_id'`)).rows;
  assert.equal(column.length, 1);
  assert.equal((await client.query("select * from drizzle.__drizzle_migrations")).rows.length, chain.length);
}

test("real Drizzle timestamp upgrade reproduces skipped 0046–0048; hash runner repairs them without replaying 0049", async () => {
  const client = new PGlite();
  try {
    await applyMigrationChain(migrationClient(client), chain.slice(0, 46));
    const user = "11111111-2222-4333-8444-555555555555";
    await client.query("insert into users (id, name) values ($1, 'preserve upgrade learner')", [user]);
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    assert.equal((await client.query<{ t: string | null }>("select to_regclass('public.speaking_ai_sessions') as t")).rows[0]!.t, null,
      "the timestamp-based migrator skipped the Speaking tables");
    const before = (await client.query("select * from users where id = $1", [user])).rows[0];
    const applied = await applyMigrationChain(migrationClient(client), chain);
    assert.deepEqual(applied, chain.slice(46, 49).map((entry) => entry.tag));
    await assertCurrentSchema(client);
    assert.deepEqual((await client.query("select * from users where id = $1", [user])).rows[0], before);
    assert.deepEqual(await applyMigrationChain(migrationClient(client), chain), []);
  } finally { await client.close(); }
});

test("populated prefix through 0045 upgrades in journal order without skipping lower timestamps", async () => {
  const client = new PGlite();
  try {
    await applyMigrationChain(migrationClient(client), chain.slice(0, 46));
    await client.query("insert into users (name) values ('prefix learner')");
    assert.deepEqual(await applyMigrationChain(migrationClient(client), chain), chain.slice(46).map((entry) => entry.tag));
    await assertCurrentSchema(client);
    assert.equal((await client.query<{ name: string }>("select name from users")).rows[0]!.name, "prefix learner");
  } finally { await client.close(); }
});

test("fresh hash migration applies the complete current chain and a second run is a no-op", async () => {
  const client = new PGlite();
  try {
    assert.equal((await applyMigrationChain(migrationClient(client), chain)).length, chain.length);
    await assertCurrentSchema(client);
    assert.deepEqual(await applyMigrationChain(migrationClient(client), chain), []);
  } finally { await client.close(); }
});

test("history checks reject unknown hashes, duplicates, changed timestamps and unrelated gaps", () => {
  const row = (entry: Entry) => ({ hash: entry.hash, created_at: entry.when });
  assert.throws(() => planMigrationHistory(chain, [{ hash: "0".repeat(64), created_at: 1 }]), /divergent/);
  assert.throws(() => planMigrationHistory(chain, [row(chain[0]!), row(chain[0]!)]), /divergent/);
  assert.throws(() => planMigrationHistory(chain, [{ ...row(chain[0]!), created_at: 1 }]), /divergent/);
  assert.throws(() => planMigrationHistory(chain, [row(chain[1]!)]), /gap/);
});

test("failed SQL rolls back schema and history; populated untracked databases are refused without writes", async () => {
  const client = new PGlite();
  const firstSql = "create table rollback_fixture (id integer);";
  const broken: Entry[] = [
    { idx: 0, tag: "0000_fixture", when: 1, sql: firstSql, hash: hash(firstSql) },
    { idx: 1, tag: "0001_broken", when: 2, sql: "select no_such_column", hash: hash("select no_such_column") },
  ];
  try {
    await assert.rejects(applyMigrationChain(migrationClient(client), broken));
    assert.equal((await client.query<{ t: string | null }>("select to_regclass('public.rollback_fixture') as t")).rows[0]!.t, null);
    assert.equal((await client.query<{ t: string | null }>("select to_regclass('drizzle.__drizzle_migrations') as t")).rows[0]!.t, null);
    await client.exec("create table existing_data (id int); insert into existing_data values (7)");
    await assert.rejects(applyMigrationChain(migrationClient(client), chain), /history_missing/);
    assert.equal((await client.query<{ id: number }>("select id from existing_data")).rows[0]!.id, 7);
    assert.equal((await client.query<{ t: string | null }>("select to_regclass('drizzle.__drizzle_migrations') as t")).rows[0]!.t, null);
  } finally { await client.close(); }
});

// @ts-expect-error plain ESM production inspection script
import { decide } from "../scripts/migrate-production.mjs";
test("production inspection accepts valid hashes in application order and refuses divergent or foreign schemas", () => {
  const rows = chain.map((entry) => ({ hash: entry.hash, created_at: entry.when }));
  const info = { historyExists: true, historyRows: rows.length, history: rows, unknown: [], tables: ["users"] };
  assert.equal(decide(info, chain).verdict, "up-to-date");
  const prefix = rows.slice(0, 46);
  assert.equal(decide({ ...info, historyRows: prefix.length, history: prefix }, chain).verdict, "resume");
  assert.equal(decide({ ...info, historyRows: prefix.length, history: prefix, unknown: ["foreign_table"] }, chain).verdict, "divergent");
  assert.equal(decide({ ...info, history: [{ hash: "0".repeat(64), created_at: 1 }] }, chain).verdict, "divergent");
  const skipped = [...prefix, rows[49]!];
  assert.equal(decide({ ...info, historyRows: skipped.length, history: skipped }, chain).verdict, "resume");
});


test("timestamp-skip recovery permits only the same three omissions and a contiguous hash-verified later suffix", () => {
 const row=(entry:Entry)=>({hash:entry.hash,created_at:entry.when});
 const suffix=chain.slice(49);
 assert.deepEqual(planMigrationHistory(chain,[...chain.slice(0,46),...suffix].map(row)).map((entry:Entry)=>entry.tag),chain.slice(46,49).map(entry=>entry.tag));
 const sql="select 51";const extended=[...chain,{idx:chain.length,tag:"0051_test",when:1791500000013,sql,hash:hash(sql)}];
 assert.throws(()=>planMigrationHistory(extended,[...chain.slice(0,46),chain[49]!,extended.at(-1)!].map(row)),/gap/);
});
