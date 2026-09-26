#!/usr/bin/env node
/**
 * Production database migration — inspect first, then apply.
 *
 *   node scripts/migrate-production.mjs                # inspect only (read-only)
 *   node scripts/migrate-production.mjs --apply        # inspect, then migrate
 *   node scripts/migrate-production.mjs --apply --yes  # same, without the prompt
 *
 * Why this exists instead of just running `npm run db:migrate`:
 *
 *   * the cloud database must be *looked at* before it is written to. The failure
 *     this repository actually hit in production was `relation "users" does not
 *     exist` — a database that had never been migrated. A blind migrate cannot
 *     tell "empty" apart from "someone else's database", and getting that wrong
 *     is not recoverable;
 *   * `drizzle` records what it applied in `drizzle.__drizzle_migrations`. If that
 *     table is missing while tables *do* exist, the schema was created by some
 *     other path and re-running the chain would record migrations as applied
 *     without executing them. This script stops in that case and says so;
 *   * nothing here drops, truncates, resets or recreates anything. The migration
 *     files themselves contain no destructive statement (`verifyChain` checks
 *     that on every run, so a future migration cannot quietly introduce one);
 *   * the connection string is never printed, never passed as an argument and
 *     never written to disk step by step — only a masked form reaches the log.
 *
 * Exit codes: 0 = inspection/report fine, 1 = refused or failed, 2 = applied.
 */

import { readFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRIZZLE_DIR = join(ROOT, "drizzle");
/*
 * The chain length is read from the journal, never hard-coded: a constant here
 * meant every new migration had to remember to update this file, and forgetting
 * turned a safety check into a false alarm. What matters is that the journal and
 * the files on disk agree — that is verified below.
 */

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const ASSUME_YES = args.has("--yes") || args.has("--apply-now");

const red = (s) => `\u001b[31m${s}\u001b[0m`;
const green = (s) => `\u001b[32m${s}\u001b[0m`;
const yellow = (s) => `\u001b[33m${s}\u001b[0m`;
const bold = (s) => `\u001b[1m${s}\u001b[0m`;

function fail(message, code = 1) {
  console.error(`\n${red("REFUSED")} ${message}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// 1. The migration chain as it exists on disk
// ---------------------------------------------------------------------------

function verifyChain() {
  const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8"));
  const files = readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql")).sort();

  if (files.length === 0) {
    fail(`no migration files found in ${DRIZZLE_DIR}`);
  }
  if (journal.entries.length !== files.length) {
    fail(
      `journal has ${journal.entries.length} entries but ${files.length} .sql files exist ` +
        `(a migration was edited or generated without its journal entry): ${files.join(", ")}`
    );
  }

  const entries = [];
  for (const entry of journal.entries) {
    const expectedName = `${entry.tag}.sql`;
    if (!files.includes(expectedName)) fail(`journal entry ${entry.idx} (${entry.tag}) has no file on disk`);
    if (entry.idx !== entries.length) fail(`journal is out of order at index ${entry.idx}`);
    const sql = readFileSync(join(DRIZZLE_DIR, expectedName), "utf8");
    for (const forbidden of DESTRUCTIVE) {
      if (forbidden.pattern.test(sql)) {
        fail(`${expectedName} contains a destructive statement (${forbidden.name}). Production migrations must be additive.`);
      }
    }
    for (const statement of sql.split(";")) {
      // Strip line comments first: drizzle marks each statement with
      // `--> statement-breakpoint`, which would otherwise sit in front of the
      // keyword we are looking for.
      const bare = statement
        .split("\n")
        .map((line) => line.replace(/--.*$/, ""))
        .join("\n")
        .trim();
      if (/^delete\s+from/i.test(bare) && !/\bwhere\b/i.test(bare)) {
        fail(`${expectedName} deletes rows with no WHERE clause — that would empty a table in production.`);
      }
    }
    entries.push({ idx: entry.idx, tag: entry.tag, when: entry.when, file: expectedName, sql });
  }
  return entries;
}

// A migration that drops or truncates is not automatically wrong for a local
// refresh, but it is never something this script may run unattended against the
// cloud database: `reset-db.mjs` exists precisely because that path is different.
//
// `DELETE` is not on this list when it carries a WHERE clause: 0005 deduplicates
// student vocabulary with `DELETE … USING … WHERE …`, which is a data repair that
// touches nothing on a fresh database. A DELETE *without* WHERE is checked
// separately below, because that one really would empty a table.
const DESTRUCTIVE = [
  { name: "DROP TABLE", pattern: /\bdrop\s+table\b/i },
  { name: "DROP SCHEMA", pattern: /\bdrop\s+schema\b/i },
  { name: "DROP DATABASE", pattern: /\bdrop\s+database\b/i },
  { name: "TRUNCATE", pattern: /\btruncate\b/i },
];

/** Every table the chain creates — used to tell our schema from a stranger's. */
function tablesCreatedBy(entries) {
  const names = new Set();
  for (const entry of entries) {
    /*
     * Both spellings occur in this chain: the hand-written early migrations say
     * `CREATE TABLE IF NOT EXISTS`, and everything drizzle-kit generates says
     * `CREATE TABLE`. Matching only the first made every table of the newer
     * migrations look like somebody else's — a false "unknown table" alarm on a
     * script whose whole job is to notice real surprises.
     */
    for (const match of entry.sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/gi)) {
      names.add(match[1]);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// 2. Talking to the database
// ---------------------------------------------------------------------------

function mask(url) {
  try {
    const parsed = new URL(url);
    const user = parsed.username ? `${parsed.username}:****@` : "";
    const query = parsed.search ? parsed.search.replace(/([?&](?:password|pwd)=)[^&]*/gi, "$1****") : "";
    return `${parsed.protocol}//${user}${parsed.host}${parsed.pathname}${query}`;
  } catch {
    return "<unparseable DATABASE_URL>";
  }
}

function poolFor(url) {
  const { Pool } = require("pg");
  const isLocal = /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\])/.test(url) || /@(localhost|127\.0\.0\.1)/.test(url);
  const options = { connectionString: url, max: 1, connectionTimeoutMillis: 15000 };
  if (!isLocal && !/sslmode=/i.test(url)) {
    // Supabase terminates TLS in front of the pooler. `pg` verifies against the
    // runtime's own CA store, which is not guaranteed in every container, so we
    // ask for encryption without pinning the issuer — the traffic is still TLS,
    // and `require("sslmode=verify-full")` in DATABASE_URL turns verification on
    // for anyone who wants it.
    options.ssl = { rejectUnauthorized: false };
  }
  return new Pool(options);
}

async function inspect(client, entries) {
  const ours = tablesCreatedBy(entries);
  const info = {};

  const who = await client.query(
    "select current_database() as db, current_user as usr, inet_server_addr()::text as host, version() as version"
  );
  info.db = who.rows[0].db;
  info.user = who.rows[0].usr;
  info.host = who.rows[0].host;
  info.version = who.rows[0].version.split(" ").slice(0, 2).join(" ");

  const tables = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`
  );
  info.tables = tables.rows.map((r) => r.table_name);
  info.ours = info.tables.filter((t) => ours.has(t));
  info.unknown = info.tables.filter((t) => !ours.has(t));

  const types = await client.query(
    `select t.typname from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typtype = 'e' order by t.typname`
  );
  info.enums = types.rows.map((r) => r.typname);

  // Drizzle's bookkeeping lives in its own schema; it is the only trustworthy
  // record of what has been applied.
  const hasHistory = await client.query(
    `select exists (
       select 1 from information_schema.tables
        where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
     ) as present`
  );
  info.historyExists = hasHistory.rows[0].present;
  info.historyRows = 0;
  info.historyTimestamps = [];
  if (info.historyExists) {
    const rows = await client.query("select created_at from drizzle.__drizzle_migrations order by created_at");
    info.historyRows = rows.rowCount;
    info.historyTimestamps = rows.rows.map((r) => Number(r.created_at));
  }

  info.hasUsers = info.tables.includes("users");
  info.usersProblem = null;
  if (info.hasUsers) {
    try {
      // Owners are counted the way the application counts them (role = owner AND
      // account_status = active), not by the historical `is_owner` boolean.
      const counts = await client.query(
        `select
           (select count(*) from users)::int as users,
           (select count(*) from users where role = 'owner' and account_status = 'active')::int as owners`
      );
      info.userRows = counts.rows[0].users;
      info.ownerRows = counts.rows[0].owners;
    } catch (error) {
      // A `users` table that does not even have `is_owner` is not this
      // application's table. That is a fact about the database worth reporting,
      // not a reason to abort the inspection.
      info.usersProblem = error.message;
    }
  }

  return info;
}

/**
 * What may we do, given what we found?
 *
 * "resume" is the only state in which the chain is executed, and it requires the
 * recorded history to be an exact prefix of this repository's journal — the same
 * migrations, in the same order, with the same timestamps.
 */
function decide(info, entries) {
  const expectedTimestamps = entries.map((e) => e.when);

  if (info.historyExists && info.historyRows > 0) {
    const recorded = info.historyTimestamps;
    const prefixMatches = recorded.every((ts, i) => ts === expectedTimestamps[i]);

    if (!prefixMatches) {
      return {
        verdict: "divergent",
        reason:
          "drizzle.__drizzle_migrations holds timestamps that do not match this repository's journal. " +
          "Migrating on top of an unknown schema is how data is lost. Compare the two before doing anything.",
        expected: expectedTimestamps,
        recorded,
      };
    }
    if (recorded.length === expectedTimestamps.length) {
      return { verdict: "up-to-date", reason: `all ${expectedTimestamps.length} migrations are already recorded as applied.` };
    }
    if (info.unknown.length > 0) {
      return {
        verdict: "divergent",
        reason: `history resumes at ${recorded.length}/${expectedTimestamps.length} but the database also holds ${info.unknown.length} table(s) this chain does not create: ${info.unknown.join(", ")}`,
      };
    }
    return {
      verdict: "resume",
      reason: `${recorded.length}/${expectedTimestamps.length} migrations are recorded; the remaining ${expectedTimestamps.length - recorded.length} would run next.`,
      from: recorded.length,
    };
  }

  if (info.tables.length === 0) {
    return { verdict: "empty", reason: "the public schema holds no tables and there is no migration history." };
  }

  // Assembled as sentences rather than string concatenation, because the two
  // facts that make a state partial are independent: the tables may be ours but
  // unusable, or they may not be ours at all.
  const sentences = [`there are ${info.tables.length} table(s) in the public schema but no migration history`];
  if (info.usersProblem) {
    sentences.push(`its users table is not this application's — ${info.usersProblem}`);
  }
  if (info.unknown.length > 0) {
    sentences.push(`${info.unknown.length} table(s) are not created by this chain: ${info.unknown.join(", ")}`);
  } else if (!info.usersProblem) {
    sentences.push("they do look like this application's tables, but nothing records the chain having run");
  }

  return {
    verdict: "partial",
    reason: `${sentences.join("; ")}.`,
  };
}

// ---------------------------------------------------------------------------
// 3. Running the documented migration command
// ---------------------------------------------------------------------------

function runMigrations(url) {
  return new Promise((resolve) => {
    // The repository's documented command is `npm run db:migrate` (drizzle-kit
    // migrate). The URL is passed through the environment, never argv: process
    // arguments are visible to every other process on the host and land in logs.
    const child = spawn(process.execPath, [join(ROOT, "node_modules", "drizzle-kit", "bin.cjs"), "migrate"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: url, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const redact = (chunk) => chunk.toString().split(url).join(mask(url));
    let output = "";
    child.stdout.on("data", (c) => {
      output += redact(c);
      process.stdout.write(redact(c));
    });
    child.stderr.on("data", (c) => {
      output += redact(c);
      process.stderr.write(redact(c));
    });
    child.on("close", (code) => resolve({ code, output }));
  });
}

// ---------------------------------------------------------------------------

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    fail("DATABASE_URL is not set. Export the production connection string in this shell (never in a file that is committed).");
  }
  if (/^postgres(ql)?:\/\/[^@]*@?(localhost|127\.0\.0\.1)/.test(url) && process.env.ALLOW_LOCAL_MIGRATION !== "1") {
    fail("DATABASE_URL points at localhost. This script is for the cloud database; set ALLOW_LOCAL_MIGRATION=1 to test it against a scratch database.");
  }

  /**
   * A transaction pooler is not a place to run migrations.
   *
   * Supabase exposes three ways in, and they are not interchangeable for DDL:
   *
   *   db.<ref>.supabase.co:5432          direct (IPv6-only on newer projects)
   *   <region>.pooler.supabase.com:5432  session pooler   — migrations work
   *   <region>.pooler.supabase.com:6543  transaction pooler — migrations do NOT
   *
   * Port 6543 multiplexes statements across backends, so statements do not share
   * a session. Migration SQL that needs one (advisory locks, session settings)
   * behaves unpredictably, and a failure part-way through leaves a half-applied
   * migration. The application may well use the transaction pooler at runtime —
   * that is where it belongs — but not this command.
   */
  try {
    const parsed = new URL(url);
    const port = parsed.port || "5432";
    const isSupabasePooler = /pooler\.supabase\.com$/i.test(parsed.hostname);
    if (port === "6543" || (isSupabasePooler && port === "6543")) {
      fail(
        `DATABASE_URL uses port ${port}, which is the transaction pooler. Migrations need a session: ` +
          "use the session pooler (same host, port 5432) or the direct host (db.<ref>.supabase.co:5432) for this command only. " +
          "The application itself can keep using the transaction pooler."
      );
    }
  } catch {
    fail("DATABASE_URL could not be parsed as a URL.");
  }

  console.log(bold("\nMigration chain"));
  const entries = verifyChain();
  console.log(green(`  ok  ${entries.length} migrations, in order: ${entries[0].tag} … ${entries[entries.length - 1].tag}`));
  console.log(green("  ok  no DROP TABLE / DROP SCHEMA / TRUNCATE, and no DELETE without WHERE"));
  console.log(`  ${yellow("target")} ${mask(url)}`);

  const pool = poolFor(url);
  let info;
  let client;
  try {
    client = await pool.connect();
    await client.query("select 1");
  } catch (error) {
    console.error(red(`\nConnection failed: ${error.message}`));
    console.error("Nothing was written. Check the host, the password and whether the project is paused.");
    if (/supabase/i.test(url) || error.code === "ENETUNREACH" || error.code === "ENOTFOUND") {
      console.error(
        "  Supabase note: the direct host (db.<ref>.supabase.co) is IPv6-only on newer projects.\n" +
          "  From an IPv4-only machine, use the session pooler instead — <region>.pooler.supabase.com:5432.\n"
      );
    } else {
      console.error("");
    }
    await pool.end();
    process.exit(1);
  }

  try {
    info = await inspect(client, entries);
  } catch (error) {
    console.error(red(`\nInspection failed: ${error.message}`));
    console.error("Nothing was written. The database accepted the connection but the inspection query failed.\n");
    client.release();
    await pool.end();
    process.exit(1);
  } finally {
    if (client) client.release();
  }

  console.log(bold("\nCurrent state"));
  console.log(`  database      ${info.db} on ${info.host} (${info.version})`);
  console.log(`  tables        ${info.tables.length} (ours: ${info.ours.length}, unknown: ${info.unknown.length})`);
  if (info.unknown.length > 0) console.log(`  ${yellow("unknown")}       ${info.unknown.join(", ")}`);
  console.log(`  enums         ${info.enums.length ? info.enums.join(", ") : "none"}`);
  console.log(
    `  history       ${
      info.historyExists ? `drizzle.__drizzle_migrations, ${info.historyRows} row(s)` : "missing (nothing has ever been applied by drizzle-kit)"
    }`
  );
  console.log(
    `  users table   ${
      !info.hasUsers
        ? red("absent")
        : info.usersProblem
          ? red(`present but unreadable: ${info.usersProblem}`)
          : `present, ${info.userRows} row(s), ${info.ownerRows} owner(s)`
    }`
  );

  const decision = decide(info, entries);
  console.log(bold("\nVerdict"));
  switch (decision.verdict) {
    case "empty":
      console.log(green(`  empty       ${decision.reason}`));
      console.log(`              The ${entries.length} migrations can be applied from 0000.`);
      break;
    case "up-to-date":
      console.log(green(`  up-to-date  ${decision.reason}`));
      break;
    case "resume":
      console.log(yellow(`  resume      ${decision.reason}`));
      break;
    case "partial":
      console.log(red(`  partial     ${decision.reason}`));
      console.log("              Refusing: with no history, re-running the chain would record migrations");
      console.log("              as applied without executing them, leaving the schema half-created.");
      console.log("              A human has to decide: reconcile by hand, or point at a clean database.");
      break;
    case "divergent":
      console.log(red(`  divergent   ${decision.reason}`));
      if (decision.expected) {
        console.log(`              expected: ${decision.expected.slice(0, 4).join(", ")}…`);
        console.log(`              recorded: ${decision.recorded.slice(0, 4).join(", ")}…`);
      }
      break;
  }

  const applicable = decision.verdict === "empty" || decision.verdict === "resume";

  if (!APPLY) {
    if (decision.verdict === "up-to-date") {
      console.log(`\n${bold("Nothing to do.")} This database is already at the head of the chain.\n`);
      await pool.end();
      process.exit(0);
    }
    console.log(
      `\n${bold("Nothing was written.")} Re-run with ${bold("--apply")} to ${
        applicable ? "execute the migrations" : "see the refusal again"
      }.\n`
    );
    await pool.end();
    process.exit(applicable ? 0 : 1);
  }

  if (decision.verdict === "up-to-date") {
    // Re-running a migration command in a deploy script must be a no-op, not a
    // failure: the second deploy of an already-migrated database is normal.
    console.log(`\n${bold("Nothing to do.")} This database is already at the head of the chain.\n`);
    await pool.end();
    process.exit(0);
  }

  if (!applicable) {
    await pool.end();
    fail(`the database is in a "${decision.verdict}" state — not migrating.`);
  }

  if (!ASSUME_YES) {
    const confirmation = await prompt(
      `About to run ${decision.verdict === "empty" ? `all ${entries.length}` : `the remaining ${entries.length - (decision.from ?? 0)}`} migration(s) against ${info.db} on ${info.host}.\nType the database name to continue: `
    );
    if (confirmation.trim() !== info.db) {
      await pool.end();
      fail("confirmation did not match — nothing was written.");
    }
  }

  console.log(bold("\nApplying"));
  const result = await runMigrations(url);
  if (result.code !== 0) {
    console.error(red(`\ndrizzle-kit migrate exited with ${result.code}. Nothing further was attempted.`));
    console.error("The schema may be partially migrated; re-run the inspection to see exactly where it stopped.\n");
    await pool.end();
    process.exit(1);
  }

  console.log(bold("\nAfter"));
  const afterClient = await pool.connect();
  let after;
  try {
    after = await inspect(afterClient, entries);
  } finally {
    afterClient.release();
  }
  await pool.end();

  console.log(`  history       ${after.historyRows}/${entries.length} recorded`);
  console.log(`  tables        ${after.tables.length}`);
  console.log(
    `  users table   ${
      after.hasUsers
        ? `present, ${after.userRows} row(s), ${after.ownerRows} owner(s)`
        : red("absent")
    }`
  );

  if (after.historyRows !== entries.length || !after.hasUsers) {
    console.error(red("\nThe migration ran but the result is not what it should be. Verify before using the application.\n"));
    process.exit(1);
  }
  console.log(green(`\nApplied. ${after.unknown.length === 0 ? "No unexpected tables." : `Unexpected tables: ${after.unknown.join(", ")}`}`));
  console.log("No application data was inserted: migrations create structure only, and the owner account is created by scripts/bootstrap-owner.mjs.\n");
  process.exit(2);
}

async function prompt(question) {
  process.stdout.write(`\n${question}`);
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => resolve(String(data)));
    process.stdin.resume();
  });
}

main().catch((error) => {
  fail(`unexpected error: ${error?.message ?? error}`);
});
