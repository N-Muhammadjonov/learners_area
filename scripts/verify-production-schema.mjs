#!/usr/bin/env node
/**
 * Production schema verification — the checklist, run against a real database.
 *
 *   DATABASE_URL="postgres://…" node scripts/verify-production-schema.mjs
 *
 * Read-only. Every check is a query; nothing is inserted, updated or deleted.
 * The point is to answer, with evidence, the question "is the database the
 * application expects actually there?" — the question whose wrong answer
 * produced `relation "users" does not exist` in production.
 *
 * Exit code 0 only when every check passes.
 *
 * Where to run it: against the production database (`DATABASE_URL="postgres://…"`).
 * Against a local development database exactly one check is expected to fail —
 * "no demo/test fixtures in users" — because the local database is seeded with
 * demo accounts on purpose. That is a fact about the environment, not about the
 * schema; the other 41 checks must be green in both places.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/*
 * A6. There used to be a constant here:
 *
 *   const EXPECTED_MIGRATIONS = 19;   // "production was at 17 when the Reading library landed"
 *
 * The chain has since grown to 53, and the failure mode was the dangerous one. This is the script
 * that verifies a PRODUCTION schema, so a stale constant makes it reject a correctly migrated
 * database — and the tempting repairs are both worse than the bug: bumping the number by hand
 * leaves the next migration to break it again, while relaxing the check would let a PARTIALLY
 * migrated production database pass as complete.
 *
 * So the expectation is derived from the repository's own two sources of truth — the migration
 * files on disk and the drizzle journal. They must agree with each other, and the database must
 * have applied every entry the journal declares. Nothing is left to go stale, and a repository that
 * ships one more migration is verified against that migration automatically.
 */

const pass = (s) => `\u001b[32m${s}\u001b[0m`;
const failText = (s) => `\u001b[31m${s}\u001b[0m`;

const results = [];
const warnings = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? pass("PASS") : failText("FAIL")}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/**
 * A notice, not a verdict.
 *
 * Some facts about a production database are *expected* to be one way and would
 * be wrong another way, without meaning the schema is broken. A freshly migrated
 * database has no owner yet — that is the next documented step, not a migration
 * failure — so it is reported loudly and does not fail the run. A demo account is
 * the opposite: it fails.
 */
function notice(name, ok, detail = "") {
  warnings.push({ name, ok, detail });
  console.log(`  ${ok ? pass("PASS") : "\u001b[33mNOTE\u001b[0m"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function mask(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username ? `${parsed.username}:****@` : ""}${parsed.host}${parsed.pathname}`;
  } catch {
    return "<unparseable>";
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  console.log(`\nProduction schema verification — ${mask(url)}\n`);

  const { Pool } = require("pg");
  const local = /(localhost|127\.0\.0\.1)/.test(url);
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 15000,
    ...(local || /sslmode=/i.test(url) ? {} : { ssl: { rejectUnauthorized: false } }),
  });

  const q = async (text, params) => (await pool.query(text, params)).rows;

  const tables = new Set((await q("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")).map((r) => r.table_name));
  const columnsOf = async (table) =>
    new Set((await q("select column_name from information_schema.columns where table_schema='public' and table_name=$1", [table])).map((r) => r.column_name));
  const hasIndex = async (name) => (await q("select 1 from pg_indexes where schemaname='public' and indexname=$1", [name])).length > 0;

  // --- 1. migrations recorded -------------------------------------------------
  const historyExists = (
    await q("select 1 from information_schema.tables where table_schema='drizzle' and table_name='__drizzle_migrations'")
  ).length > 0;
  check("drizzle migration history table exists", historyExists, historyExists ? "" : "drizzle.__drizzle_migrations missing");

  let recorded = 0;
  let timestamps = [];
  if (historyExists) {
    const rows = await q("select created_at from drizzle.__drizzle_migrations order by created_at");
    recorded = rows.length;
    timestamps = rows.map((r) => Number(r.created_at));
  }
  const journal = JSON.parse(readFileSync(join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"));
  const localFiles = readdirSync(join(ROOT, "drizzle")).filter((f) => f.endsWith(".sql"));
  // Derived, not hardcoded — and guarded against deriving nothing. If both sources were empty the
  // equality would hold and a database with no migrations at all would look complete.
  const declared = journal.entries.length;
  check("the chain on disk is complete and ordered",
    localFiles.length > 0 && declared > 0 && localFiles.length === declared,
    `${localFiles.length} files, ${declared} journal entries`);
  check(`all ${declared} migrations are recorded as applied`,
    declared > 0 && recorded === declared, `recorded ${recorded} of ${declared} declared`);
  check(
    "the recorded migrations are this repository's chain, in order",
    recorded > 0 && timestamps.every((ts, i) => ts === journal.entries[i].when),
    recorded === 0 ? "nothing recorded" : `first ${timestamps[0]}, last ${timestamps[timestamps.length - 1]}`
  );

  // --- 2. the users table and the auth columns --------------------------------
  check("users table exists", tables.has("users"));
  if (tables.has("users")) {
    const cols = await columnsOf("users");
    const required = [
      ["id", "primary key"],
      ["email", "login identity"],
      ["password_hash", "credential"],
      ["name", "display name"],
      ["role", "authority"],
      ["is_owner", "ownership flag"],
      ["locale", "language"],
      ["account_status", "admission state"],
      ["created_at", "audit"],
    ];
    for (const [column, why] of required) check(`users.${column} exists (${why})`, cols.has(column));

    const statusCol = await q(
      "select udt_name, column_default, is_nullable from information_schema.columns where table_schema='public' and table_name='users' and column_name='account_status'"
    );
    check("users.account_status is the account_status enum, defaulting to pending",
      statusCol[0]?.udt_name === "account_status" && /pending/.test(statusCol[0]?.column_default ?? ""),
      `${statusCol[0]?.udt_name} default ${statusCol[0]?.column_default}`);

    const roleCol = await q(
      "select udt_name from information_schema.columns where table_schema='public' and table_name='users' and column_name='role'"
    );
    check("users.role is an enum, not free text", roleCol[0]?.udt_name === "role", `type ${roleCol[0]?.udt_name}`);

    const emailUnique = await q(
      `select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid
        where t.relname='users' and c.contype in ('u','p') and pg_get_constraintdef(c.oid) ilike '%(email)%'`
    );
    check("email uniqueness is enforced by the database", emailUnique.length > 0);
  }

  // --- 3. enums the application branches on -----------------------------------
  const enums = new Set((await q("select t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'")).map((r) => r.typname));
  check("account_status enum exists", enums.has("account_status"));
  check("publication_state enum exists (CMS publishing)", enums.has("publication_state"));
  if (enums.has("account_status")) {
    const values = (await q("select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='account_status' order by e.enumsortorder")).map((r) => r.enumlabel);
    check("account_status covers pending/active/rejected/suspended",
      ["pending", "active", "rejected", "suspended"].every((v) => values.includes(v)), values.join(", "));
  }

  // --- 4. admission / retention schema ---------------------------------------
  check("access_requests table exists (admission queue)", tables.has("access_requests"));
  check("access_entitlements table exists", tables.has("access_entitlements"));
  check("audit_log table exists", tables.has("audit_log"));
  check("ownership_transfers table exists", tables.has("ownership_transfers"));
  if (tables.has("users")) {
    const cols = await columnsOf("users");
    check("users.last_meaningful_activity_at exists (retention keeps real activity)", cols.has("last_meaningful_activity_at"));
  }

  // --- 5. CMS publication schema ---------------------------------------------
  for (const table of ["courses", "reading_passages", "listening_tests", "speaking_materials", "speaking_prompts", "video_lessons", "writing_prompts"]) {
    if (!tables.has(table)) {
      check(`${table} exists`, false);
      continue;
    }
    const cols = await columnsOf(table);
    check(`${table}.publication_state exists`, cols.has("publication_state"));
  }

  // --- 6. vocabulary / lexical schema ----------------------------------------
  for (const table of ["lexemes", "user_vocabulary", "vocabulary_usages", "vocab_point_events", "vocab_folders"]) {
    check(`${table} exists (vocabulary engine)`, tables.has(table));
  }
  if (tables.has("lexemes")) {
    const cols = await columnsOf("lexemes");
    check("lexemes.sense_key exists (one sense per row)", cols.has("sense_key"));
    check("lexemes term index exists", await hasIndex("lexemes_sense_key_idx"));
  }
  if (tables.has("user_vocabulary")) {
    const cols = await columnsOf("user_vocabulary");
    check("user_vocabulary carries the SRS schedule", cols.has("due_at") || cols.has("next_review_at") || cols.has("interval_index"),
      [...cols].filter((c) => /due|review|interval|streak|step/.test(c)).join(", "));
  }

  // --- 7. critical indexes ----------------------------------------------------
  check("users_account_status_idx exists (admission queries)", await hasIndex("users_account_status_idx"));

  // --- 8. seeding -------------------------------------------------------------
  // The production database must hold real accounts only. This check is a
  // statement about the database, not a requirement that it be empty: an
  // operator who has already bootstrapped the owner will see exactly that.
  if (tables.has("users")) {
    // Authority is the `role` column: `is_owner` is a historical boolean that the
    // application neither reads nor writes (see src/lib/auth/roles.ts and
    // countActiveOwnersIn). An "owner" is therefore the same thing the owner
    // invariant counts: role = owner AND account_status = active.
    const owners = await q("select count(*)::int as n from users where role = 'owner' and account_status = 'active'");
    const total = await q("select count(*)::int as n from users");
    const demo = await q("select count(*)::int as n from users where email like '%@learnersarea.uz' or email like 'demo.%' or email like 'test.%'");
    check("no demo/test fixtures in users", demo[0].n === 0, `demo-like rows: ${demo[0].n}`);
    notice(
      "an active OWNER account exists (the centre can administer itself)",
      owners[0].n >= 1,
      owners[0].n >= 1
        ? `owners: ${owners[0].n}, users: ${total[0].n}`
        : `owners: 0, users: ${total[0].n} — run: node scripts/bootstrap-owner.mjs --email <real address>, then re-run this script`
    );
    console.log(`         note: ${total[0].n} user row(s) total — migrations insert none, so any content here came from a real signup or the owner bootstrap.`);
  }
  if (tables.has("courses")) {
    const courses = await q("select count(*)::int as n from courses");
    console.log(`         note: ${courses[0].n} course row(s) — course content is created by the centre, never by the migration.`);
  }

  await pool.end();

  const failed = results.filter((r) => !r.ok);
  const pending = warnings.filter((w) => !w.ok);
  console.log(`\n${failed.length === 0 ? pass("ALL CHECKS PASSED") : failText(`${failed.length} CHECK(S) FAILED`)} — ${results.length - failed.length}/${results.length}`);
  for (const f of failed) console.log(`  ${failText("✗")} ${f.name}`);
  if (pending.length > 0) {
    console.log("\nNext steps (not schema defects):");
    for (const w of pending) console.log(`  • ${w.name} — ${w.detail}`);
  }
  console.log();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(`\n${failText("Verification could not run")}: ${error?.message ?? error}\n`);
  process.exit(1);
});
