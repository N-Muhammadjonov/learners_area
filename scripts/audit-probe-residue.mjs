#!/usr/bin/env node
/**
 * AUDIT: which mutating probes leave residue in the database?
 *
 * Grepping a probe for "INSERT" or for a cleanup block proves nothing in either
 * direction: a POST to /login is not a fixture, and a cleanup block that silently
 * fails looks identical to one that works. So this measures instead.
 *
 * For each probe: count every row in every public table, run the probe to
 * completion, count again, and report the per-table delta. A probe that is
 * net-neutral on the success path leaves no residue for the next run to inherit.
 *
 * Scope and honesty about it:
 *   - This measures the SUCCESS path only. A probe that cleans up correctly here
 *     can still orphan rows when an assertion throws midway; proving that needs
 *     fault injection, which is per-probe work and is done separately.
 *   - A zero delta is not proof of zero mutation: a probe could create and delete
 *     a row, or update one in place. Updates are invisible to a row count. What a
 *     non-zero delta DOES prove is a real, reproducible leak.
 *
 * Usage: node scripts/audit-probe-residue.mjs [probe ...]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const run = promisify(execFile);
const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

async function counts(client) {
  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  const out = new Map();
  for (const { table_name: t } of tables) {
    const { rows } = await client.query(`select count(*)::int n from "${t}"`);
    out.set(t, rows[0].n);
  }
  return out;
}

const probes = process.argv.slice(2);
if (probes.length === 0) {
  console.error("name at least one probe, e.g. verify-publication");
  process.exit(2);
}

const client = new pg.Client({ connectionString: DB });
await client.connect();

const summary = [];
for (const probe of probes) {
  const before = await counts(client);
  let status = "ok";
  const started = Date.now();
  try {
    await run("node", [`scripts/${probe}.mjs`], {
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
  } catch (error) {
    // A failing probe still tells us about residue — arguably more, because the
    // failure path is the one that orphans rows. Record it and keep measuring.
    status = error.killed ? "timeout" : `exit ${error.code}`;
  }
  const after = await counts(client);

  const deltas = [];
  for (const [table, n] of after) {
    const d = n - (before.get(table) ?? 0);
    if (d !== 0) deltas.push(`${table} ${d > 0 ? "+" : ""}${d}`);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  summary.push({ probe, status, deltas, seconds });
  const verdict = deltas.length === 0 ? "CLEAN" : "RESIDUE";
  console.log(
    `${verdict.padEnd(8)} ${probe.padEnd(40)} ${status.padEnd(9)} ${seconds}s  ${deltas.join(", ")}`,
  );
}

await client.end();

const dirty = summary.filter((s) => s.deltas.length > 0);
console.log(`\n${summary.length - dirty.length} clean, ${dirty.length} leaving residue`);
process.exit(dirty.length === 0 ? 0 : 1);
