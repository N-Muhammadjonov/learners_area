import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function loadMigrationChain(folder) {
  const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8"));
  const files = readdirSync(folder).filter((name) => name.endsWith(".sql"));
  if (journal.entries.length !== files.length) throw new Error("migration_file_count_mismatch");
  const chain = journal.entries.map((entry, index) => {
    if (entry.idx !== index || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag)
      || !Number.isSafeInteger(entry.when)) throw new Error("migration_journal_invalid");
    const sql = readFileSync(join(folder, `${entry.tag}.sql`), "utf8");
    return { ...entry, sql, hash: createHash("sha256").update(sql).digest("hex") };
  });
  if (new Set(chain.map((entry) => entry.hash)).size !== chain.length) throw new Error("migration_hash_duplicate");
  return chain;
}

/** Use immutable SQL identity, never a maximum timestamp, to find pending work. */
export function planMigrationHistory(chain, rows) {
  const known = new Map(chain.map((entry) => [entry.hash, entry]));
  const applied = new Set();
  for (const row of rows) {
    const entry = known.get(row.hash);
    if (!entry || Number(row.created_at) !== entry.when || applied.has(row.hash)) {
      throw new Error("migration_history_divergent");
    }
    applied.add(row.hash);
  }
  const firstMissing = chain.findIndex((entry) => !applied.has(entry.hash));
  if (firstMissing !== -1 && chain.slice(firstMissing).some((entry) => applied.has(entry.hash))) {
    // Only the observed timestamp-skip defect is recoverable automatically:
    // 0000–0045 were applied, 0046–0048 missing, 0049 already applied.
    const recoverable = firstMissing === 46 && chain.slice(0, 46).every((entry) => applied.has(entry.hash))
      && chain.slice(46, 49).every((entry) => !applied.has(entry.hash))
      && chain[46]?.tag === "0046_tiny_george_stacy" && chain[47]?.tag === "0047_bent_bulldozer"
      && chain[48]?.tag === "0048_condemned_pyro" && chain[49]?.tag === "0049_riwi_online_activity_baseline"
      && chain.slice(49).filter((entry) => applied.has(entry.hash)).length === 1 && applied.has(chain[49].hash);
    if (!recoverable) throw new Error("migration_history_gap");
  }
  return chain.filter((entry) => !applied.has(entry.hash));
}

/** Dedicated connection, transaction, shared advisory lock; history and SQL commit together. */
export async function applyMigrationChain(client, chain) {
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock(hashtext('learners_area.migration_chain'))");
    const history = (await client.query("select to_regclass('drizzle.__drizzle_migrations') as present")).rows[0].present;
    const rows = history ? (await client.query("select hash, created_at from drizzle.__drizzle_migrations order by id")).rows : [];
    if (!rows.length) {
      const objects = await client.query(`select count(*)::int as count from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')`);
      if (objects.rows[0].count) throw new Error("migration_history_missing_for_populated_schema");
    }
    const pending = planMigrationHistory(chain, rows);
    if (pending.length) {
      await client.query('create schema if not exists "drizzle"');
      await client.query('create table if not exists "drizzle"."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)');
      for (const entry of pending) {
        for (const statement of entry.sql.split("--> statement-breakpoint").filter((part) => part.trim())) {
          await client.query(statement);
        }
        await client.query('insert into "drizzle"."__drizzle_migrations" (hash, created_at) values ($1, $2)', [entry.hash, entry.when]);
      }
    }
    await client.query("commit");
    return pending.map((entry) => entry.tag);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
