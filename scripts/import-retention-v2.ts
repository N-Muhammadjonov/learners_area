#!/usr/bin/env node
/**
 * Explicit, strictly gated, atomic FINAL V2 Retention import.
 *
 * Dry-run: node --import tsx scripts/import-retention-v2.ts
 * QA / production write (after recovery-tested backup and CI release):
 *   RETENTION_BANK_BACKUP_VERIFIED=yes node --import tsx scripts/import-retention-v2.ts --apply --confirm-empty-bank
 * Verify: node --import tsx scripts/import-retention-v2.ts --verify
 *
 * Import is NEVER triggered on build or server start. No delete/truncate/update
 * of existing Retention attempts, text versions or user information.
 */
import { createHash } from "node:crypto";
import { loadCalibratedRetentionV2 } from "./retention-v2/calibration";
import { evaluateRecall } from "../src/lib/retention/evaluator";
import { countWords } from "../src/lib/retention/word-count";
import { RETENTION_LEVELS, isWordCountInRange } from "../src/lib/retention/levels";

const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const CONFIRM = process.argv.includes("--confirm-empty-bank");
if (APPLY && VERIFY) throw Error("Choose --apply OR --verify");

const items = loadCalibratedRetentionV2();
for (const level of RETENTION_LEVELS) {
  const subset = items.filter(item => item.level === level);
  if (subset.length !== 15) throw Error(`Expected 15 ${level} texts; got ${subset.length}`);
  for (let index = 0; index < subset.length; index += 1) {
    const item = subset[index]!;
    if (item.sourceId !== `${level}-${String(index + 1).padStart(3, "0")}`) throw Error(`Invalid source label ${item.sourceId}`);
    const words = countWords(item.bodyText);
    if (!isWordCountInRange(level, words)) throw Error(`Wrong word range for ${item.sourceId}: ${words}`);
    const canonical = item.scoringStructure.claims.map(c => c.label).join("\n");
    if (evaluateRecall(canonical, item.scoringStructure).score !== 100 ||
        evaluateRecall(item.bodyText, item.scoringStructure).score !== 100 ||
        evaluateRecall("", item.scoringStructure).score !== 0)
      throw Error(`Calibrated scoring not ready for ${item.sourceId}`);
  }
}
const sourceHash = createHash("sha256").update(JSON.stringify(items)).digest("hex");
const identity = { release: "retention_final_v2_75_20261014", count: items.length, byLevel: 15, sourceHash };
if (!APPLY && !VERIFY) {
  console.log(JSON.stringify({ ok: true, mode: "dry-run", databaseTouched: false, ...identity }, null, 2));
} else {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required only for --apply/--verify");
  if (APPLY && (!CONFIRM || process.env.RETENTION_BANK_BACKUP_VERIFIED !== "yes"))
    throw Error("Import blocked: require --confirm-empty-bank and RETENTION_BANK_BACKUP_VERIFIED=yes after recovery-tested backup");
  const pg = await import("pg");
  const { Pool } = pg.default;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 8000 });
  const client = await pool.connect();
  const equivalent = (a: unknown, b: unknown): boolean => {
    const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) :
      v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([x],[y]) => x.localeCompare(y)).map(([k,x]) => [k,canonical(x)])) : v;
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  };
  const verifyCurrent = async (): Promise<boolean> => {
    const q = await client.query(`
      SELECT t.internal_label, t.level, t.active, t.current_version_id, v.version_number, v.body_text, v.word_count, v.scoring_structure
      FROM public.retention_texts t
      LEFT JOIN public.retention_text_versions v ON v.id = t.current_version_id
      ORDER BY t.level, t.sequence
    `);
    if (q.rows.length === 0) return false;
    if (q.rows.length !== 75) throw Error(`Existing bank has ${q.rows.length} rows; refuse any overwrite or partial import`);
    const expected = new Map(items.map(item => [item.sourceId, item]));
    for (const row of q.rows) {
      const item = expected.get(row.internal_label);
      if (!item || row.level !== item.level || !row.active || !row.current_version_id ||
          row.version_number !== 1 || row.body_text !== item.bodyText || Number(row.word_count) !== countWords(item.bodyText) ||
          !equivalent(row.scoring_structure, item.scoringStructure))
        throw Error(`Bank diverges at ${row.internal_label}; do not modify existing content`);
    }
    return true;
  };
  try {
    if (VERIFY) {
      if (!(await verifyCurrent())) throw Error("Retention bank empty; run an authorized --apply before site QA");
      console.log(JSON.stringify({ ok: true, mode: "verify", ...identity }));
    } else {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('retention.final.v2.atomic.import'))");
      const existing = await verifyCurrent();
      if (existing) {
        await client.query("ROLLBACK");
        console.log(JSON.stringify({ ok: true, mode: "already-imported", ...identity }));
      } else {
        for (const item of items) {
          const sequence = Number(item.sourceId.split("-")[1]);
          const created = await client.query<{id:string}>(`
            INSERT INTO public.retention_texts (level,internal_label,sequence,active)
            VALUES ($1,$2,$3,true) RETURNING id`,
            [item.level,item.sourceId,sequence]);
          const textId = created.rows[0]!.id;
          const version = await client.query<{id:string}>(`
            INSERT INTO public.retention_text_versions (retention_text_id,version_number,body_text,word_count,scoring_structure)
            VALUES ($1,1,$2,$3,$4::jsonb) RETURNING id`,
            [textId,item.bodyText,countWords(item.bodyText),JSON.stringify(item.scoringStructure)]);
          await client.query("UPDATE public.retention_texts SET current_version_id=$1 WHERE id=$2",
            [version.rows[0]!.id,textId]);
          await client.query(`
            INSERT INTO public.audit_log (actor_user_id,action,target_type,target_id,metadata)
            VALUES (NULL,'retention_text.created','retention_text',$1,$2::jsonb)`,
            [textId,JSON.stringify({ source: identity.release, sourceId: item.sourceId, version: 1 })]);
        }
        await client.query("COMMIT");
        if (!(await verifyCurrent())) throw Error("Post-import verification unexpectedly empty");
        console.log(JSON.stringify({ok:true,mode:"applied-and-verified",...identity}));
      }
    }
  } catch (error) {
    if (APPLY) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
