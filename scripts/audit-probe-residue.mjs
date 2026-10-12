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
 * A5. Two results are reported for every probe and they are NOT collapsed into one:
 *
 *   - whether the probe itself passed, and
 *   - whether it left residue behind.
 *
 * A probe that FAILED but cleaned up after itself is a FAILED probe. Reporting it as clean because
 * the row counts matched would turn this audit into a way of laundering a broken probe, and the
 * residue number is the less important of the two. The exit code is non-zero if either is wrong.
 *
 * The database is verified as disposable BEFORE any probe is launched, because this harness is what
 * launches them: pointing it at a database the fixture guard would refuse means the probes it runs
 * would mutate somewhere no sweeper was ever allowed to check.
 *
 * Usage: node scripts/audit-probe-residue.mjs [probe ...]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const run = promisify(execFile);
const { assertMutableDatabase } = await import("./lib/fixture-safety.mjs");
const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
// Fail closed before launching anything. assertMutableDatabase throws on an unparseable URL and on
// any database that does not look disposable, so a misconfigured audit cannot start a probe run
// that writes fixtures somewhere they will never be swept.
try {
  assertMutableDatabase(DB, { probe: "audit-probe-residue" });
} catch (error) {
  console.error(`refusing to launch probes: ${error.message}`);
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
  // Two independent results. `probeOk` is about the probe; `residue` is about the database.
  const probeOk = status === "ok";
  const residue = deltas.length === 0 ? "CLEAN" : "RESIDUE";
  const verdict = probeOk && residue === "CLEAN" ? "PASSED" : "FAILED";
  summary.push({ probe, status, deltas, seconds, probeOk, residue, verdict });
  console.log(
    `${verdict.padEnd(7)} ${probe.padEnd(40)} probe=${status.padEnd(9)} residue=${residue.padEnd(8)} ${String(seconds).padStart(4)}s  ${deltas.join(", ")}`,
  );
}

await client.end();

const dirty = summary.filter((s) => s.residue === "RESIDUE");
const brokenProbes = summary.filter((s) => !s.probeOk);
const passed = summary.filter((s) => s.verdict === "PASSED");
console.log(
  `\n${passed.length} passed, ${summary.length - passed.length} failed` +
  ` — probe failures: ${brokenProbes.length}${brokenProbes.length ? ` (${brokenProbes.map((s) => `${s.probe} ${s.status}`).join(", ")})` : ""}` +
  `, leaving residue: ${dirty.length}${dirty.length ? ` (${dirty.map((s) => s.probe).join(", ")})` : ""}`,
);
if (brokenProbes.length) {
  console.log("A failed probe with zero residue is still FAILED: it did not prove what it claims to.");
}
process.exit(passed.length === summary.length ? 0 : 1);
