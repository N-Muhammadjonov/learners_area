#!/usr/bin/env node
/**
 * PACKAGE C — per-test-file database residue audit.
 *
 *   node scripts/audit-test-residue.mjs [--db <url>] [--files <glob-or-list>] [--run]
 *
 * WHAT THIS IS FOR. A unit test that writes to a real database is a mutating probe, and the same
 * rule applies to it as to a probe script: it must prove it cleaned up after itself, or it must
 * not run. Measuring the whole suite at once cannot tell you WHICH file leaked, and "the suite is
 * green" says nothing about what it left behind — a test can pass every assertion and still leave
 * sixty rows in `users`.
 *
 * So this audits one file at a time: capture every table's row count, run that single file,
 * capture again, and report the delta. Zero delta is the pass condition.
 *
 * A CAVEAT THAT MATTERS. Zero delta is not the same as zero mutation: a test that inserts a row
 * and deletes it nets to zero, and a test that UPDATEs a row is invisible to a count. This tool
 * therefore reports counts as the cheap first line, and says so in its output rather than
 * implying it has proven isolation.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const shouldRun = args.includes("--run");

const DATABASE_URL = flag("db", process.env.DATABASE_URL);
if (!DATABASE_URL || !/localhost|127\.0\.0\.1/.test(DATABASE_URL)) {
  console.error("Refusing to run: a residue audit mutates nothing itself but drives tests that do.");
  console.error("Pass --db with a LOCAL disposable database (localhost/127.0.0.1 only).");
  process.exit(2);
}

const pg = (await import("pg")).default;

/** Every table in the public schema with its row count. */
async function snapshot(client) {
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name",
  );
  const out = new Map();
  for (const { table_name: table } of rows) {
    const { rows: counted } = await client.query(`select count(*)::bigint n from "${table}"`);
    out.set(table, Number(counted[0].n));
  }
  return out;
}

function diff(before, after) {
  const changes = [];
  for (const [table, count] of after) {
    const was = before.get(table);
    if (was === undefined) { changes.push({ table, was: 0, now: count, delta: count, kind: "new table" }); continue; }
    if (was !== count) changes.push({ table, was, now: count, delta: count - was, kind: count > was ? "rows added" : "ROWS REMOVED" });
  }
  for (const [table, count] of before) {
    if (!after.has(table)) changes.push({ table, was: count, now: 0, delta: -count, kind: "table dropped" });
  }
  return changes;
}

const files = flag("files", "")
  ? flag("files", "").split(",").map((f) => f.trim()).filter(Boolean)
  : readdirSync("tests").filter((n) => n.endsWith(".test.ts")).map((n) => `tests/${n}`);

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

const results = [];
for (const file of files) {
  const before = await snapshot(client);
  let status = "pass";
  let output = "";
  try {
    output = execFileSync("npx", ["tsx", "--conditions=react-server", "--test", "--test-concurrency=1", file], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL, QA2_DATABASE_TESTS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600_000,
    });
  } catch (error) {
    status = "test-failed";
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  const after = await snapshot(client);
  const changes = diff(before, after);
  const totals = /# tests (\d+)[\s\S]*?# pass (\d+)[\s\S]*?# fail (\d+)[\s\S]*?# skipped (\d+)/.exec(output);
  results.push({
    file,
    tests: totals ? Number(totals[1]) : null,
    pass: totals ? Number(totals[2]) : null,
    fail: totals ? Number(totals[3]) : null,
    skipped: totals ? Number(totals[4]) : null,
    status: status === "test-failed" ? "test-failed" : changes.length ? "RESIDUE" : "clean",
    changes,
  });
  const label = results.at(-1).status;
  console.log(`  ${label === "clean" ? "  ok" : "FAIL"} ${file.padEnd(52)} ${label}` +
    (changes.length ? ` — ${changes.length} table(s): ${changes.slice(0, 4).map((c) => `${c.table} ${c.delta > 0 ? "+" : ""}${c.delta}`).join(", ")}${changes.length > 4 ? ", …" : ""}` : ""));
}

await client.end();

const leaking = results.filter((r) => r.changes.length);
const failing = results.filter((r) => r.status === "test-failed");

console.log(`\n${results.length} file(s) audited · ${results.length - leaking.length - failing.length} clean · ${leaking.length} leaving residue · ${failing.length} failing`);
if (leaking.length) {
  console.log("\nFiles that leave rows behind:");
  for (const r of leaking.sort((a, b) => b.changes.length - a.changes.length)) {
    const added = r.changes.reduce((sum, c) => sum + Math.max(0, c.delta), 0);
    const removed = r.changes.reduce((sum, c) => sum + Math.min(0, c.delta), 0);
    console.log(`  ${r.file}  (+${added} / ${removed}) across ${r.changes.length} table(s)`);
    for (const c of r.changes.slice(0, 8)) console.log(`      ${c.table}: ${c.was} → ${c.now}  (${c.kind})`);
    if (r.changes.length > 8) console.log(`      … and ${r.changes.length - 8} more`);
  }
  console.log("\nNote: a file whose delta is ZERO may still have mutated and restored, or have");
  console.log("UPDATEd rows in place. Counts are the cheap first line, not a proof of isolation.");
}

if (shouldRun) process.exit(leaking.length || failing.length ? 1 : 0);
