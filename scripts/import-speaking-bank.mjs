#!/usr/bin/env node
/**
 * N11 — idempotent importer for the canonical speaking master bank (880 rows).
 *
 *   node scripts/import-speaking-bank.mjs --source <bank.jsonl>            # dry run, no DB
 *   node scripts/import-speaking-bank.mjs --source <bank.jsonl> --apply [--receipt <file>]   # write + receipt
 *   node scripts/import-speaking-bank.mjs --verify                         # read-only counts
 *
 * Rules:
 *   * Requires migration 0025 (speaking_prompts.external_id + partial unique index).
 *   * Insert-only: ON CONFLICT (external_id) DO NOTHING. Existing rows — and every
 *     speaking_attempts.prompt_id that points at them — are never updated or deleted.
 *   * Rows land as publication_state='draft'. Publishing is an owner decision.
 *   * Write targets: localhost/learners_qa2 by default. Any other database needs
 *     SPEAKING_IMPORT_CONFIRM_DATABASE=<exact database name>; never run it against
 *     Production without the owner's written approval.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { planSpeakingBank } from "./speaking-bank-dry-run.mjs";

const { Pool } = pg;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const TIMING = { 1: [5, 40], 2: [60, 120], 3: [10, 60] };

export function rowsFromBank(text) {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    const r = JSON.parse(line);
    const part = Number(r.part);
    return {
      externalId: r.id, part: `part${part}`, category: `part${part}`, promptText: r.question.trim(),
      cueCard: part === 2 ? r.cue_points.join("\n") : null, prep: TIMING[part][0], answer: TIMING[part][1],
      topic: r.topic ?? null, sourceClass: r.source_class ?? null,
      availableIn: Array.isArray(r.available_in) && r.available_in.length ? r.available_in : ["practice_alone"],
    };
  });
}

export function assertWriteTarget(url, env = process.env) {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  if (["localhost", "127.0.0.1"].includes(target.hostname) && name === "learners_qa2") return name;
  if (env.SPEAKING_IMPORT_CONFIRM_DATABASE && env.SPEAKING_IMPORT_CONFIRM_DATABASE === name) return name;
  throw new Error(`refusing to write to ${target.hostname}/${name}: set SPEAKING_IMPORT_CONFIRM_DATABASE=${name} only with explicit approval`);
}

export async function importRows(pool, rows) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('speaking-bank-import'))");
    let inserted = 0;
    for (const r of rows) {
      const res = await client.query(
        `insert into speaking_prompts (part, category, prompt_text, cue_card, prep_seconds, answer_seconds, external_id, topic, source_class, available_in, is_active, publication_state)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, true, 'draft')
         on conflict (external_id) where external_id is not null do nothing`,
        [r.part, r.category, r.promptText, r.cueCard, r.prep, r.answer, r.externalId, r.topic, r.sourceClass, JSON.stringify(r.availableIn)]
      );
      inserted += res.rowCount ?? 0;
    }
    await client.query("commit");
    return { inserted, skippedExisting: rows.length - inserted };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

/** Publication boundary counts for imported rows: drafts vs anything a learner could see. */
export async function publicationCounts(pool) {
  const { rows: [r] } = await pool.query(
    `select count(*) filter (where publication_state = 'draft')::int as draft,
            count(*) filter (where publication_state <> 'draft')::int as not_draft
       from speaking_prompts where external_id is not null`);
  return { draft: r.draft, notDraft: r.not_draft };
}

/** Receipt for an apply run: source hash, database NAME (never the URL), counts. */
export function importReceipt({ text, database, result, byPart, publication, at = new Date().toISOString() }) {
  return {
    at, mode: "apply", database,
    source: { sha256: createHash("sha256").update(text).digest("hex"), rows: text.split("\n").filter((l) => l.trim()).length },
    ...result, byPart, publication,
    boundary: "insert-only (ON CONFLICT DO NOTHING); rows land as draft; publishing is an owner action in Management",
  };
}

export async function verify(pool) {
  const { rows } = await pool.query(
    `select part, count(*)::int as n, count(distinct external_id)::int as ids from speaking_prompts where external_id is not null group by part order by part`
  );
  return Object.fromEntries(rows.map((r) => [r.part, { rows: r.n, uniqueIds: r.ids }]));
}

async function main() {
  if (flag("--verify")) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try { console.log(JSON.stringify({ mode: "verify", byPart: await verify(pool) }, null, 2)); } finally { await pool.end(); }
    return;
  }
  const source = value("--source");
  if (!source) throw new Error("--source <bank.jsonl> is required");
  const text = readFileSync(source, "utf8");
  const plan = planSpeakingBank(text);
  if (plan.errors.length) { console.log(JSON.stringify(plan, null, 2)); process.exit(1); }
  if (!flag("--apply")) { console.log(JSON.stringify({ mode: "dry-run", ...plan }, null, 2)); return; }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const database = assertWriteTarget(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const result = await importRows(pool, rowsFromBank(text));
    const receipt = importReceipt({ text, database, result, byPart: await verify(pool), publication: await publicationCounts(pool) });
    const file = value("--receipt") ?? `docs/receipts/N11-speaking-bank-import-${database}-${receipt.at.replace(/[:.]/g, "-")}.json`;
    mkdirSync(file.replace(/\/[^/]*$/, ""), { recursive: true });
    writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");
    console.log(JSON.stringify(receipt, null, 2));
    console.log(`receipt: ${file}`);
  } finally { await pool.end(); }
}

if (process.argv[1]?.endsWith("import-speaking-bank.mjs")) main().catch((e) => { console.error(`STOP ${e.message}`); process.exit(2); });
