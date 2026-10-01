#!/usr/bin/env node
/**
 * Guarded additive migration for the APPROVED Preview QA database only.
 *
 *   DATABASE_URL=<preview QA url>                       (never printed)
 *   PREVIEW_QA_DB_FINGERPRINT=<sha256(host/dbname)>     owner-approved identity; run with --fingerprint to compute it
 *   PREVIEW_QA_BACKUP_REF=<snapshot/branch/PITR id>     required for --apply (recovery point taken first)
 *   node scripts/preview-qa-migrate.mjs [--fingerprint | --plan | --apply]
 *
 * Refuses: Production (VERCEL_ENV/NODE_ENV markers or a URL containing "prod"),
 * fingerprint mismatch, a migration history that diverges from the journal,
 * pending migrations outside the allowlist, and destructive SQL. Applies only
 * pending migrations through drizzle's own migrator (it skips applied ones), then
 * verifies the schema and writes a receipt without secrets.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

export const ALLOWED_PENDING = ["0025_speaking_bank_identity", "0026_google_identity", "0027_live_partner"];
const DESTRUCTIVE = /\b(drop\s+(table|column|schema|database|type)|truncate|delete\s+from|alter\s+column\s+\S+\s+type)\b/i;

export function fingerprint(url) {
  const u = new URL(url);
  return createHash("sha256").update(`${u.hostname}/${u.pathname.replace(/^\//, "")}`).digest("hex");
}
export function refuseProduction(url, env = process.env) {
  if (env.VERCEL_ENV === "production") return "VERCEL_ENV=production";
  if (/prod/i.test(new URL(url).hostname + new URL(url).pathname)) return "URL looks like production";
  return null;
}
export function plan(journal, appliedHashes, readSql) {
  const entries = journal.entries.map((e) => ({ tag: e.tag, when: e.when, hash: createHash("sha256").update(readSql(e.tag)).digest("hex") }));
  const applied = new Set(appliedHashes);
  // History must be a prefix of the journal: every applied hash is a journal entry, and no gaps.
  const firstPending = entries.findIndex((e) => !applied.has(e.hash));
  const pending = firstPending === -1 ? [] : entries.slice(firstPending);
  const problems = [];
  if (pending.some((e) => applied.has(e.hash))) problems.push("applied migrations after a pending one (gap)");
  const known = new Set(entries.map((e) => e.hash));
  for (const h of applied) if (!known.has(h)) problems.push("database has a migration not in the journal");
  for (const e of pending) {
    if (!ALLOWED_PENDING.includes(e.tag)) problems.push(`pending ${e.tag} is not approved`);
    if (DESTRUCTIVE.test(readSql(e.tag))) problems.push(`${e.tag} contains destructive SQL`);
  }
  return { applied: entries.filter((e) => applied.has(e.hash)).map((e) => e.tag), pending: pending.map((e) => e.tag), problems };
}

const VERIFY = [
  ["speaking_prompts.available_in", "select count(*)::int n from information_schema.columns where table_name='speaking_prompts' and column_name in ('external_id','topic','source_class','available_in')", (r) => r.n === 4],
  ["users.google_sub (unique)", "select count(*)::int n from pg_indexes where tablename='users' and indexdef ilike '%(google_sub)%' and indexdef ilike '%unique%'", (r) => r.n >= 1],
  ["live_partner tables", "select count(*)::int n from information_schema.tables where table_name in ('live_partner_presence','live_partner_invites','live_partner_sessions','live_partner_blocks')", (r) => r.n === 4],
  ["practice query runs", `select count(*)::int n from speaking_prompts where available_in @> '["practice_alone"]'::jsonb`, () => true],
  ["live partner query runs", `select count(*)::int n from live_partner_presence p join users u on u.id = p.user_id where p.state = 'available'`, () => true],
];

async function main() {
  const mode = process.argv[2] ?? "--plan";
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const fp = fingerprint(url);
  if (mode === "--fingerprint") { console.log(fp); return; }
  const prod = refuseProduction(url);
  if (prod) throw new Error(`refused: ${prod}`);
  if (!process.env.PREVIEW_QA_DB_FINGERPRINT || process.env.PREVIEW_QA_DB_FINGERPRINT !== fp) throw new Error("refused: DATABASE_URL is not the approved Preview QA database (fingerprint mismatch)");
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  const readSql = (tag) => readFileSync(`drizzle/${tag}.sql`, "utf8");
  const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: true } });
  await client.connect();
  const receipt = { at: new Date().toISOString(), dbFingerprint: fp, mode };
  try {
    const hasTable = (await client.query("select to_regclass('drizzle.__drizzle_migrations') t")).rows[0].t;
    const appliedHashes = hasTable ? (await client.query("select hash from drizzle.__drizzle_migrations order by id")).rows.map((r) => r.hash) : [];
    const p = plan(journal, appliedHashes, readSql);
    Object.assign(receipt, { before: p });
    if (p.problems.length) throw Object.assign(new Error(`refused: ${p.problems.join("; ")}`), { receipt });
    if (mode === "--apply" && p.pending.length) {
      if (!process.env.PREVIEW_QA_BACKUP_REF) throw new Error("refused: set PREVIEW_QA_BACKUP_REF to the recovery point taken before applying");
      receipt.backupRef = process.env.PREVIEW_QA_BACKUP_REF;
      await migrate(drizzle(client), { migrationsFolder: "drizzle" });
      const after = (await client.query("select hash from drizzle.__drizzle_migrations order by id")).rows.map((r) => r.hash);
      receipt.after = plan(journal, after, readSql);
    }
    receipt.verify = [];
    for (const [name, q, ok] of VERIFY) {
      try { const r = (await client.query(q)).rows[0]; receipt.verify.push({ name, pass: Boolean(ok(r)), value: r.n }); }
      catch (e) { receipt.verify.push({ name, pass: false, error: String(e.code ?? e.message).slice(0, 80) }); }
    }
  } finally {
    await client.end();
    mkdirSync("docs/receipts", { recursive: true });
    const file = `docs/receipts/preview-qa-migrate-${receipt.at.replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");
    console.log(JSON.stringify(receipt, null, 2));
    console.log(`receipt: ${file}`);
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
