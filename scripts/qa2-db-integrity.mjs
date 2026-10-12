/*
 * §03 — DISPOSABLE-DATABASE INTEGRITY SNAPSHOT AND DIFF.
 *
 * The existing residue guard (tests/support/qa2-residue.ts) counts rows, which catches leftover
 * synthetic fixtures but NOT mutation of seeded content: a run that deletes one seeded row and inserts a
 * different one reports the same count. §03 asks for baseline ROW-CONTENT integrity, so this hashes it.
 *
 * The hash is order-independent — md5 of the sorted per-row md5s — so a run that merely reorders or
 * resequences rows is not falsely accused, while any change to any column of any row is caught.
 *
 * It also audits what a green exit code can hide:
 *   - fault-injection triggers and QA-only functions left armed in the database
 *   - migration parity between drizzle/*.sql and the recorded migration ledger
 *   - marker-tagged synthetic rows from any probe family
 *
 * Usage:
 *   node scripts/qa2-db-integrity.mjs snapshot /tmp/base.json
 *   node scripts/qa2-db-integrity.mjs diff /tmp/base.json /tmp/run1.json
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || !/localhost|127\.0\.0\.1/.test(DATABASE_URL)) {
  console.error("refusing to run: DATABASE_URL must point at a LOCAL disposable database");
  process.exit(2);
}
/** Triggers that are part of the product, not probe residue. */
const LEGITIMATE_TRIGGERS = new Set([
  "dictionary_entries_immutable",
  "dictionary_registry_immutable",
  "dictionary_terms_immutable",
  "grammar_source_owner",
]);
/** Marker prefixes used by the QA probe families. */
const MARKERS = ["QA-REACH-", "QA-TOPIC-", "QA-AI-", "QA-BOUND-", "QA-JOURNEY-", "QA-SEC-", "QA2-", "B3-", "__qa_"];

const client = new pg.Client({ connectionString: DATABASE_URL });
client.on("error", () => {});
await client.connect();

async function snapshot() {
  const tables = (await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  )).rows.map((r) => r.table_name);

  const perTable = {};
  let totalRows = 0;
  for (const table of tables) {
    const count = (await client.query(`select count(*)::bigint n from "${table}"`)).rows[0].n;
    let hash = "";
    if (Number(count) > 0) {
      // Order-independent content hash: md5 of the sorted per-row md5s.
      const row = await client.query(
        `select md5(coalesce(string_agg(h, '' order by h), '')) h from (select md5(t::text) h from "${table}" t) x`,
      );
      hash = row.rows[0].h ?? "";
    }
    perTable[table] = { rows: Number(count), hash };
    totalRows += Number(count);
  }

  const triggers = (await client.query(
    `select distinct trigger_name from information_schema.triggers
      where trigger_schema = 'public' order by trigger_name`,
  )).rows.map((r) => r.trigger_name);

  const functions = (await client.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname ilike '%qa%' or p.proname ilike '%fault%' or p.proname ilike '%inject%')
      order by p.proname`,
  )).rows.map((r) => r.proname);

  const qaTables = tables.filter((t) => /^qa_|_qa$|^__qa|fault/i.test(t));

  // Migration parity: the recorded ledger against the migration files on disk.
  let ledger = null;
  try {
    ledger = Number((await client.query(`select count(*)::int n from drizzle.__drizzle_migrations`)).rows[0].n);
  } catch {
    ledger = null;
  }
  let files = null;
  try {
    files = readdirSync(new URL("../drizzle", import.meta.url).pathname).filter((f) => f.endsWith(".sql")).length;
  } catch {
    files = null;
  }

  const markers = {};
  for (const marker of MARKERS) {
    const hits = [];
    for (const table of ["speaking_prompts", "assignments", "assignment_targets", "users", "typing_texts", "grammar_exercises", "lessons", "units"]) {
      if (!tables.includes(table)) continue;
      const textColumns = (await client.query(
        `select column_name from information_schema.columns
          where table_schema='public' and table_name=$1 and data_type in ('text','character varying')`,
        [table],
      )).rows.map((r) => r.column_name);
      if (!textColumns.length) continue;
      /*
       * `_` is a single-character wildcard in LIKE, so an unescaped marker such as `__qa_` matches any
       * two characters plus "qa" plus one more — which flagged the legitimately seeded
       * qa2-owner@learners-qa.invalid accounts as residue at BASELINE, before any test had run. Escaping
       * underscores is what makes a residue check mean anything; a detector that cries wolf on a clean
       * database gets ignored, and then real residue goes unseen.
       */
      const escaped = marker.replace(/([_%])/g, "\\$1");
      const predicate = textColumns.map((c) => `"${c}" like $1 escape '\\'`).join(" or ");
      const found = await client.query(`select count(*)::int n from "${table}" where ${predicate}`, [`%${escaped}%`]);
      if (found.rows[0].n > 0) hits.push(`${table}=${found.rows[0].n}`);
    }
    if (hits.length) markers[marker] = hits;
  }

  return {
    capturedAt: new Date().toISOString(),
    tableCount: tables.length,
    totalRows,
    perTable,
    triggers,
    unexpectedTriggers: triggers.filter((t) => !LEGITIMATE_TRIGGERS.has(t)),
    functions,
    qaTables,
    migrations: { ledger, files },
    markers,
  };
}

function report(snap, label) {
  console.log(`# ${label}: ${snap.tableCount} base tables, ${snap.totalRows} total rows`);
  console.log(`#   triggers: ${snap.triggers.length} (${snap.unexpectedTriggers.length} unexpected${snap.unexpectedTriggers.length ? ": " + snap.unexpectedTriggers.join(", ") : ""})`);
  console.log(`#   qa/fault functions: ${snap.functions.length}${snap.functions.length ? " -> " + snap.functions.join(", ") : ""}`);
  console.log(`#   qa-named tables: ${snap.qaTables.length}${snap.qaTables.length ? " -> " + snap.qaTables.join(", ") : ""}`);
  console.log(`#   migrations: ledger=${snap.migrations.ledger} files=${snap.migrations.files}`);
  const markerKeys = Object.keys(snap.markers);
  console.log(`#   marker residue: ${markerKeys.length ? markerKeys.map((k) => `${k} ${snap.markers[k].join(",")}`).join("; ") : "none"}`);
}

/** A diff that distinguishes row-count change from CONTENT change — the two are different defects. */
function diff(before, after, label) {
  const problems = [];
  const tables = new Set([...Object.keys(before.perTable), ...Object.keys(after.perTable)]);
  const changed = [];
  for (const table of [...tables].sort()) {
    const b = before.perTable[table] ?? { rows: 0, hash: "" };
    const a = after.perTable[table] ?? { rows: 0, hash: "" };
    if (b.rows !== a.rows) changed.push(`${table}: rows ${b.rows} -> ${a.rows}`);
    else if (b.hash !== a.hash) changed.push(`${table}: CONTENT CHANGED at ${a.rows} rows (hash ${b.hash?.slice(0, 8)} -> ${a.hash?.slice(0, 8)})`);
  }
  if (changed.length) problems.push(...changed);
  if (before.tableCount !== after.tableCount) problems.push(`base table count ${before.tableCount} -> ${after.tableCount}`);
  for (const trigger of after.unexpectedTriggers) problems.push(`unexpected trigger present: ${trigger}`);
  for (const fn of after.functions) problems.push(`qa/fault function present: ${fn}`);
  for (const table of after.qaTables) problems.push(`qa-named table present: ${table}`);
  const markerKeys = Object.keys(after.markers);
  for (const key of markerKeys) problems.push(`marker residue ${key}: ${after.markers[key].join(",")}`);
  if (after.migrations.ledger !== before.migrations.ledger) problems.push(`migration ledger changed ${before.migrations.ledger} -> ${after.migrations.ledger}`);
  if (after.migrations.files !== null && after.migrations.ledger !== null && after.migrations.files !== after.migrations.ledger) {
    problems.push(`migration parity: ${after.migrations.files} files but ${after.migrations.ledger} recorded`);
  }

  console.log(`\n# DIFF ${label}: ${problems.length === 0 ? "IDENTICAL" : `${problems.length} difference(s)`}`);
  for (const problem of problems) console.log(`#   - ${problem}`);
  return problems;
}

const [command, arg1, arg2] = process.argv.slice(2);
let exitCode = 0;
try {
  if (command === "snapshot") {
    const snap = await snapshot();
    writeFileSync(arg1, JSON.stringify(snap, null, 2));
    report(snap, `snapshot -> ${arg1}`);
  } else if (command === "diff") {
    const before = JSON.parse(readFileSync(arg1, "utf8"));
    const after = JSON.parse(readFileSync(arg2, "utf8"));
    report(after, `after (${arg2})`);
    const problems = diff(before, after, `${arg1} -> ${arg2}`);
    exitCode = problems.length === 0 ? 0 : 1;
  } else {
    console.error("usage: qa2-db-integrity.mjs snapshot <out.json> | diff <before.json> <after.json>");
    exitCode = 2;
  }
} finally {
  await client.end().catch(() => {});
}
process.exit(exitCode);
