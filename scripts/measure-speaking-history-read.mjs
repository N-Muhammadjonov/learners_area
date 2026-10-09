#!/usr/bin/env node
/**
 * MEASUREMENT, not an assertion: what the Speaking history page actually reads.
 *
 * listAttempts() resolved prompt references with `where: undefined`, i.e. it selected
 * the ENTIRE speaking_prompts table in order to label at most 100 attempts. This
 * script measures both forms against the real QA Postgres with EXPLAIN ANALYZE on a
 * representative bank, so the claim rests on measured rows and milliseconds rather
 * than on reasoning about the code.
 *
 * It mutates fixtures, so it goes through the shared safety rails and cleans up.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const { assertMutableDatabase, fixtureTag } = await import("./lib/fixture-safety.mjs");
assertMutableDatabase(DATABASE_URL);
const TAG = fixtureTag("speaking-read");

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

const BANK = 2000;      // a realistic grown prompt bank
const REFERENCED = 12;  // prompts this learner's history actually references

const plan = async (label, sql, params) => {
  const { rows } = await db.query(`explain (analyze, format json) ${sql}`, params);
  const node = rows[0]["QUERY PLAN"][0];
  return {
    label,
    rows: node.Plan["Actual Rows"],
    ms: Number(node["Execution Time"].toFixed(2)),
    node: node.Plan["Node Type"],
  };
};

try {
  // Build the bank.
  const values = [];
  const params = [];
  for (let i = 0; i < BANK; i += 1) {
    const base = i * 2;
    values.push(`('part1','general',$${base + 1},$${base + 2},'published','["live_partner"]'::jsonb)`);
    params.push(`Prompt ${String(i).padStart(5, "0")} ${TAG}`, `Topic ${String(i).padStart(5, "0")} ${TAG}`);
  }
  await db.query(
    `insert into speaking_prompts (part, category, prompt_text, topic, publication_state, available_in) values ${values.join(",")}`,
    params,
  );
  const { rows: picked } = await db.query(
    "select id from speaking_prompts where prompt_text like $1 order by prompt_text limit $2",
    [`%${TAG}%`, REFERENCED],
  );
  const ids = picked.map((r) => r.id);

  const { rows: [{ n: bankSize }] } = await db.query("select count(*)::int n from speaking_prompts");

  const before = await plan("BEFORE  where: undefined (whole table)", "select * from speaking_prompts", []);
  const after = await plan("AFTER   where id = any($1) (referenced only)", "select * from speaking_prompts where id = any($1)", [ids]);

  console.log(`\nSpeaking history prompt resolution — bank of ${bankSize} prompts, history referencing ${ids.length}\n`);
  for (const result of [before, after]) {
    console.log(`  ${result.label}`);
    console.log(`      rows read: ${result.rows}   execution: ${result.ms} ms   plan: ${result.node}`);
  }
  const ratio = before.rows / Math.max(after.rows, 1);
  console.log(`\n  rows read reduced ${before.rows} -> ${after.rows} (${ratio.toFixed(0)}x fewer) on this bank.`);
  console.log("  The BEFORE cost grows with the prompt bank; the AFTER cost grows with the learner's history,");
  console.log("  which is already bounded at 100 attempts.\n");
} finally {
  await db.query("delete from speaking_prompts where prompt_text like $1 or topic like $1", [`%${TAG}%`]);
  const { rows } = await db.query(
    "select count(*)::int n from speaking_prompts where prompt_text like $1 or topic like $1",
    [`%${TAG}%`],
  );
  if (rows[0].n !== 0) throw new Error(`fixture residue for ${TAG}: ${rows[0].n} rows`);
  await db.end();
}
