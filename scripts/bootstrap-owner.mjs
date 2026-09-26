#!/usr/bin/env node
/**
 * First-owner bootstrap — the only sanctioned way to create an OWNER outside the
 * transfer workflow.
 *
 * A fresh production database has no accounts at all. The demo seed creates one
 * for development, but a real centre must not ship a known password, so this
 * command is the documented path:
 *
 *   DATABASE_URL=... node scripts/bootstrap-owner.mjs --email owner@centre.uz
 *
 * The password is never taken from an argument that lands in shell history if
 * you prefer not to: read it from OWNER_PASSWORD, or let the script prompt.
 *
 * Guarantees:
 *   - refuses to run when a live owner already exists (so it cannot be used to
 *     quietly add a second owner to someone else's centre); re-running it for
 *     the same account is a no-op, which makes it safe in a deploy script;
 *   - hashes the password with the same bcrypt cost the app uses;
 *   - the new account is ACTIVE and fully onboarded, because an owner who cannot
 *     sign in is not an owner;
 *   - writes one audit row naming the action, never the secret;
 *   - prints no password and no hash.
 *
 * Usage:
 *   node scripts/bootstrap-owner.mjs --email <address> [--name "Full name"]
 *                                    [--promote]      -- allow re-running for an
 *                                                        account that already
 *                                                        exists (no-op if it is
 *                                                        already the owner)
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, exit } from "node:process";
import pg from "pg";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

function readEnvFile() {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../.env", import.meta.url), "utf8")
        .split("\n")
        .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
        })
    );
  } catch {
    return {};
  }
}

function arg(name) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

const env = { ...readEnvFile(), ...process.env };
const connectionString = env.DATABASE_URL;
const email = (arg("email") ?? "").trim().toLowerCase();
const name = arg("name") ?? "Centre owner";
const promote = argv.includes("--promote");

function fail(message) {
  console.error(`bootstrap-owner: ${message}`);
  exit(1);
}

if (!connectionString) fail("DATABASE_URL is not set (and .env has no DATABASE_URL).");
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("--email must be a valid address.");

const client = new pg.Client({ connectionString });
await client.connect();

const { rows: owners } = await client.query(
  "select id, email from users where role = 'owner' and account_status = 'active'"
);
const { rows: existing } = await client.query(
  "select id, role, account_status from users where lower(email) = $1",
  [email]
);
const target = existing[0];

// Idempotence first: re-running for the account that is already the owner is a
// no-op, so a deploy script can call this every time.
if (target?.role === "owner" && target.account_status === "active") {
  console.log(`bootstrap-owner: ${email} is already the active owner — nothing to do.`);
  await client.end();
  exit(0);
}

if (owners.length > 0) {
  fail(
    `an active owner already exists (${owners.map((o) => o.email).join(", ")}). ` +
      "Ownership is handed over from inside the app (Owner → Transfer), not from this script."
  );
}
if (target && !promote) {
  fail(
    `${email} already exists as ${target.role}/${target.account_status}. ` +
      "Re-run with --promote to make that existing account the owner."
  );
}

let password = env.OWNER_PASSWORD?.trim();
if (!password) {
  if (!stdin.isTTY) fail("no OWNER_PASSWORD set and no terminal to prompt on.");
  const rl = createInterface({ input: stdin, output: stdout });
  password = (await rl.question("New owner password (input is visible; use OWNER_PASSWORD to avoid this): ")).trim();
  rl.close();
}
if (password.length < 10) fail("the password must be at least 10 characters.");

const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

await client.query("begin");
try {
  if (target) {
    await client.query(
      `update users
          set role = 'owner',
              account_status = 'active',
              status_updated_at = now(),
              status_reason = null,
              onboarding_completed_at = coalesce(onboarding_completed_at, now())
        where id = $1`,
      [target.id]
    );
  } else {
    await client.query(
      `insert into users (email, name, role, account_status, password_hash, onboarding_completed_at)
       values ($1, $2, 'owner', 'active', $3, now())`,
      [email, name, passwordHash]
    );
  }

  await client.query(
    `insert into audit_log (actor_user_id, action, target_type, target_id, metadata)
     values (null, $1, 'user', $2, $3::jsonb)`,
    [
      target ? "owner.bootstrapped_existing" : "owner.bootstrapped",
      email,
      JSON.stringify({ via: "scripts/bootstrap-owner.mjs", promoted: Boolean(target) }),
    ]
  );
  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  await client.end();
  fail(`could not create the owner: ${error.message}`);
}

const { rows: check } = await client.query(
  "select count(*)::int as owners from users where role = 'owner' and account_status = 'active'"
);
console.log(
  `bootstrap-owner: ${email} is now the owner. Active owners: ${check[0].owners}. ` +
    "No password or hash was printed."
);
await client.end();
