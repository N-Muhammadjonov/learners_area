#!/usr/bin/env node
/**
 * PACKAGE G — before/after measurement for the typingStats() legacy-link read.
 *
 *   node scripts/measure-typing-stats.mjs [baseUrl] [--runs 2000]
 *
 * typingStats() feeds the /app/writing learner hub and GET /api/writing/typing, so it is a hot
 * path. Two of its three reads were already bounded (10 runs, 50 activity events) while the third —
 * the join that resolves each run's legacy text link — had no bound at all and read every
 * typing_run_texts row the learner had ever produced, to build a Map from which at most 10 keys are
 * ever read.
 *
 * Both shapes are measured here rather than one being inferred from the other:
 *   - the LIVE endpoint, through pg_stat_statements, with the fix built in;
 *   - the OLD unbounded SQL and the NEW bounded SQL directly, through EXPLAIN (ANALYZE, BUFFERS),
 *     against the same corpus, so the row counts are the planner's own and not an estimate.
 *
 * The corpus is built for one learner, tracked by id, and deleted afterwards; the probe reports the
 * remaining row counts so a silent leak cannot pass as a clean run.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const argv = process.argv.slice(2);
const BASE = argv.find((a) => !a.startsWith("--")) ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const RUNS = Number(flag("runs", "2000"));
const REPEATS = Number(flag("repeats", "5"));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || !/localhost|127\.0\.0\.1/.test(DATABASE_URL)) {
  console.error("Refusing to run: this builds a multi-thousand-row corpus. Pass a LOCAL DATABASE_URL.");
  process.exit(2);
}
const { assertMutableDatabase } = await import("./lib/fixture-safety.mjs");
const { loginActor } = await import("./lib/security-matrix.mjs");
const pg = (await import("pg")).default;
assertMutableDatabase(DATABASE_URL, { probe: "measure-typing-stats" });

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0] ?? null;
assert.ok((await one("select count(*)::int n from pg_extension where extname='pg_stat_statements'"))?.n,
  "pg_stat_statements must be installed and preloaded for query counts to mean anything");

const OLD_SQL = `select trt.run_id, trt.mistakes, trt.preset_seconds, wmt.title
  from typing_run_texts trt
  inner join typing_runs tr on tr.id = trt.run_id
  left join writing_model_texts wmt on wmt.id = trt.model_text_id
  where tr.user_id = $1`;
const NEW_SQL = `select trt.run_id, trt.mistakes, trt.preset_seconds, wmt.title
  from typing_run_texts trt
  inner join typing_runs tr on tr.id = trt.run_id
  left join writing_model_texts wmt on wmt.id = trt.model_text_id
  where tr.user_id = $1 and trt.run_id = any($2::uuid[])`;

/** Rows the planner actually read, from EXPLAIN ANALYZE — not an estimate, not EXPLAIN alone. */
async function analyse(sql, params) {
  const res = await db.query(`explain (analyze, buffers, format json) ${sql}`, params);
  const plan = res.rows[0]?.["QUERY PLAN"]?.[0];
  const text = JSON.stringify(plan);
  const actualRows = Number(plan?.["Plan"]?.["Actual Rows"] ?? 0);
  const execMs = Number(plan?.["Execution Time"] ?? 0);
  // Total rows touched across every node, which is what an unbounded join really costs.
  const nodeRows = [...text.matchAll(/"Actual Rows":\s*(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
  const sharedHit = [...text.matchAll(/"Shared Hit Blocks":\s*(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
  return { topLevelRows: actualRows, rowsAcrossAllNodes: nodeRows, execMs, sharedHitBlocks: sharedHit };
}

const runIds = [];
let modelTextId = null;
const userId = (await loginActor("STUDENT_A", BASE, "demo.student@learnersarea.uz", "Student12345!", {
  ip: "203.0.113.251", client: db,
})).identity.userId;

let defects = 0;
try {
  console.log(`building ${RUNS} typing runs + linked text rows for learner ${userId.slice(0, 8)} …`);
  // typing_run_texts enforces `model_text_id IS NOT NULL <> typing_text_id IS NOT NULL`, and the
  // query under test LEFT JOINs writing_model_texts for the title, so one tagged model text is
  // created and every link points at it. That exercises the join instead of measuring a query whose
  // outer join never matches anything.
  modelTextId = randomUUID();
  await db.query(
    `insert into writing_model_texts (id, title, task_type, topic, target_band, body, word_count, provenance, source_ref)
     values ($1,$2,'task2',$3,8.5,$4,280,'qa-measurement',$5)`,
    [modelTextId, `[scale-measure] Model text`, `[scale-measure] topic`, `[scale-measure] ${"body ".repeat(60)}`, "scale-measure"],
  );
  for (let start = 0; start < RUNS; start += 500) {
    const n = Math.min(500, RUNS - start);
    const runsValues = [], runsParams = [];
    for (let i = 0; i < n; i++) {
      const id = randomUUID();
      runIds.push(id);
      // $1 is the user id, so each row's own placeholders start at $2.
      runsValues.push(`($${runsParams.length + 2}::uuid,$1,600,590,60000,${40 + (i % 30)},${90 + (i % 9)},$${runsParams.length + 3}::timestamptz)`);
      runsParams.push(id, new Date(Date.now() - (start + i) * 60_000).toISOString());
    }
    await db.query(
      `insert into typing_runs (id, user_id, target_chars, typed_chars, duration_ms, wpm, accuracy, created_at)
       values ${runsValues.join(",")}`, [userId, ...runsParams]);
    const textValues = [], textParams = [];
    for (let i = 0; i < n; i++) {
      // $1 is the model text id, so each row's run_id placeholder starts at $2.
      textValues.push(`($${textParams.length + 2}::uuid,$1,${i % 7})`);
      textParams.push(runIds[start + i]);
    }
    await db.query(
      `insert into typing_run_texts (run_id, model_text_id, mistakes) values ${textValues.join(",")}`,
      [modelTextId, ...textParams]);
  }
  const built = Number((await one(`select count(*)::int n from typing_runs where id = any($1::uuid[])`, [runIds]))?.n ?? 0);
  assert.equal(built, RUNS, `the corpus must be exactly ${RUNS} runs before measuring`);
  const links = Number((await one(`select count(*)::int n from typing_run_texts where run_id = any($1::uuid[])`, [runIds]))?.n ?? 0);
  console.log(`corpus ready: ${built} runs, ${links} linked text rows\n`);

  // ---- the two query shapes, on the same corpus -------------------------------------------
  const recentTen = (await db.query(
    `select id from typing_runs where user_id=$1 order by created_at desc limit 10`, [userId])).rows.map((r) => r.id);
  const before = await analyse(OLD_SQL, [userId]);
  const after = await analyse(NEW_SQL, [userId, recentTen]);
  console.log("OLD (unbounded) :", JSON.stringify(before));
  console.log("NEW (bounded)   :", JSON.stringify(after));
  const unboundedReadsMore = before.rowsAcrossAllNodes > after.rowsAcrossAllNodes;
  console.log(`  rows across all plan nodes: ${before.rowsAcrossAllNodes} -> ${after.rowsAcrossAllNodes}` +
    ` (${unboundedReadsMore ? "reduction confirmed" : "NO REDUCTION — investigate"})`);
  if (!unboundedReadsMore) defects++;
  // The bounded query must still return the SAME 10 rows the map is built from, or the fix changed
  // behaviour rather than cost.
  const oldRows = (await db.query(OLD_SQL, [userId])).rows;
  const newRows = (await db.query(NEW_SQL, [userId, recentTen])).rows;
  const neededFromOld = oldRows.filter((r) => recentTen.includes(r.run_id));
  const sameContent = JSON.stringify(neededFromOld.map((r) => r.run_id).sort()) ===
    JSON.stringify(newRows.map((r) => r.run_id).sort());
  console.log(`  old query returned ${oldRows.length} rows, of which ${neededFromOld.length} are for the 10 runs actually used; new query returned ${newRows.length}`);
  console.log(`  the 10 rows the Map needs are identical in both: ${sameContent}`);
  if (!sameContent) defects++;
  if (oldRows.length > neededFromOld.length) {
    console.log(`  => the old read fetched ${oldRows.length - neededFromOld.length} row(s) that were discarded`);
  }

  // ---- the live endpoint, through pg_stat_statements ---------------------------------------
  const { actor } = await loginActor("STUDENT_A_HTTP", BASE, "demo.student@learnersarea.uz", "Student12345!", {
    ip: "203.0.113.251", client: db,
  });
  for (const path of ["/api/writing/typing", "/app/writing"]) {
    await db.query("select pg_stat_statements_reset()");
    const samples = [];
    let last = null;
    for (let i = 0; i < REPEATS; i++) {
      const t0 = performance.now();
      last = await actor.get(path);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const stats = (await db.query(
      `select calls, total_exec_time, rows, query from pg_stat_statements
        where query not ilike '%pg_stat_statements%' order by total_exec_time desc`)).rows;
    const calls = stats.reduce((n, r) => n + Number(r.calls), 0);
    const dbMs = stats.reduce((n, r) => n + Number(r.total_exec_time), 0);
    const rowsRead = stats.reduce((n, r) => n + Number(r.rows), 0);
    const typingLink = stats.filter((r) => /typing_run_texts/i.test(r.query))
      .map((r) => ({ calls: Number(r.calls), rows: Number(r.rows), ms: Number(Number(r.total_exec_time).toFixed(2)) }));
    console.log(`\n${path}`);
    console.log(`  HTTP ${last.status}, ${last.body.length} bytes, median ${samples[Math.floor(samples.length / 2)].toFixed(1)} ms over ${REPEATS} repeats`);
    console.log(`  query calls ${calls}, db time ${dbMs.toFixed(2)} ms, rows read ${rowsRead}`);
    console.log(`  typing_run_texts statements: ${JSON.stringify(typingLink)}`);
    const linkRows = typingLink.reduce((n, r) => n + r.rows, 0);
    if (path === "/api/writing/typing") {
      // Five repeats; each may read at most the 10 runs it returns. Anything materially above that
      // means the bound is not being applied.
      //
      // ZERO IS NOT A PASS. If no typing_run_texts statement was recorded at all then the endpoint
      // served these repeats without reaching the database — a cached response, or a code path that
      // did not run — and `0 <= bound` would be satisfied by measuring nothing. That is reported as
      // NOT OBSERVED rather than BOUNDED, and the query-level EXPLAIN ANALYZE above is the evidence
      // that carries the conclusion instead.
      if (!typingLink.length) {
        console.log(`  => legacy-link read NOT OBSERVED across ${REPEATS} requests: no typing_run_texts statement was recorded, so these repeats did not reach the database (cached response or a path that did not call typingStats). Not counted as evidence either way.`);
      } else {
        const bounded = linkRows <= REPEATS * 10;
        console.log(`  => legacy-link rows read across ${REPEATS} requests: ${linkRows} (bound ${REPEATS * 10}) ${bounded ? "BOUNDED" : "UNBOUNDED"}`);
        if (!bounded) defects++;
      }
      if (last.status !== 200) { console.log(`  => endpoint did not answer 200`); defects++; }
    }
  }
} catch (error) {
  console.error("\nMEASUREMENT ABORTED:", error?.message ?? error);
  if (error?.stack) console.error(error.stack.split("\n").slice(0, 5).join("\n"));
  defects++;
} finally {
  for (let i = 0; i < runIds.length; i += 2000) {
    const slice = runIds.slice(i, i + 2000);
    await db.query(`delete from typing_run_texts where run_id = any($1::uuid[])`, [slice]).catch(() => {});
    await db.query(`delete from typing_runs where id = any($1::uuid[])`, [slice]).catch(() => {});
  }
  if (modelTextId) {
    await db.query(`delete from writing_model_texts where id=$1 and source_ref='scale-measure'`, [modelTextId]).catch(() => {});
  }
  const leftR = Number((await one(`select count(*)::int n from typing_runs where id = any($1::uuid[])`, [runIds]))?.n ?? -1);
  const leftT = Number((await one(`select count(*)::int n from typing_run_texts where run_id = any($1::uuid[])`, [runIds]))?.n ?? -1);
  console.log(`\nteardown: typing_runs left=${leftR}, typing_run_texts left=${leftT}`);
  if (leftR !== 0 || leftT !== 0) { console.error("RESIDUE: tagged corpus survived teardown"); defects++; }
  await db.end().catch(() => {});
  console.log(defects ? `\n${defects} defect(s)` : "\nall measurements within bound");
}
process.exit(defects ? 1 : 0);
