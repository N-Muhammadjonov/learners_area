#!/usr/bin/env node
/**
 * §10 — measure the two remaining LEARNER-FACING unbounded reads, then judge them on the numbers.
 *
 *   node scripts/measure-unbounded-reads.mjs [baseUrl] [--sizes 100,1000,10000]
 *
 * `listActivePrompts(channel)` in src/lib/data/speaking-practice.ts is
 * `findMany({ where, orderBy })` with no limit, and both of its callers pass the whole result
 * straight into a CLIENT component:
 *
 *   /app/speaking/practice  ->  <PracticeStudio prompts={prompts} />
 *   /app/speaking/ai        ->  the same shape for the AI channel
 *
 * So every published prompt in the bank is read from PostgreSQL and then serialised into the page
 * payload on every request. That is a claim about growth, and growth cannot be claimed from reading
 * the query or from a unit test — `findMany({ where, orderBy })` looks perfectly reasonable until
 * somebody puts 10 000 rows behind it. This measures it at three corpus sizes so growth shows up as
 * growth rather than as a single uninterpretable number.
 *
 * WHAT IS MEASURED, per surface per size:
 *   - query count, rows read and execution time from pg_stat_statements, reset immediately before
 *     the request and read immediately after, so it is the server's own accounting of what it asked
 *     PostgreSQL to do (the probe's own introspection is excluded by text);
 *   - median wall time over repeated requests, because one warm-cache sample is noise;
 *   - response bytes;
 *   - how many prompts actually reached the browser, counted by the tag marker embedded in each
 *     fixture's prompt_text. This is the number that matters: a page can read 10 000 rows and still
 *     render 20, and a page can read 20 and render 20 — only counting the marker distinguishes them.
 *
 * The writing-side reads named in earlier notes (`writing.listActivePrompts`, `listAllPrompts`,
 * `listActivePromptsWithResources`) have no caller anywhere in src/app or src/components, so there
 * is no request that exercises them and nothing to measure. That is reported as NOT OBSERVED rather
 * than being padded out with a synthetic call.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const BASE = argv.find((a) => !a.startsWith("--")) ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const SIZES = flag("sizes", "100,1000,10000").split(",").map(Number);
const REPEATS = Number(flag("repeats", "5"));
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || !/localhost|127\.0\.0\.1/.test(DATABASE_URL)) {
  console.error("Refusing to run: this builds a 10 000-row corpus. Pass a LOCAL disposable DATABASE_URL.");
  process.exit(2);
}

const { assertMutableDatabase, createRowSweeper, installSweepHandlers } = await import("./lib/fixture-safety.mjs");
const { loginActor } = await import("./lib/security-matrix.mjs");
const pg = (await import("pg")).default;
assertMutableDatabase(DATABASE_URL, { probe: "measure-unbounded-reads" });

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const all = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p = []) => (await all(sql, p))[0] ?? null;

const sweeper = createRowSweeper({
  client: db, probe: "measure-unbounded-reads",
  tables: ["speaking_attempts", "speaking_prompts", "activity_events"],
});
const finalSweep = installSweepHandlers(sweeper, { probe: "measure-unbounded-reads", onDone: () => db.end().catch(() => {}) });
await sweeper.capture();

async function instrument(fn) {
  await db.query("select pg_stat_statements_reset()");
  const started = performance.now();
  const result = await fn();
  const wallMs = performance.now() - started;
  const rows = await all(
    `select query, calls, total_exec_time, rows from pg_stat_statements
      where query not ilike '%pg_stat_statements%' and query not ilike '%deallocate%'`,
  );
  return {
    wallMs, result,
    calls: rows.reduce((n, r) => n + Number(r.calls), 0),
    rowsRead: rows.reduce((n, r) => n + Number(r.rows), 0),
    dbMs: Number(rows.reduce((n, r) => n + Number(r.total_exec_time), 0).toFixed(2)),
    slowest: rows.sort((a, b) => b.total_exec_time - a.total_exec_time).slice(0, 2)
      .map((r) => ({ ms: Number(r.total_exec_time.toFixed(2)), calls: Number(r.calls), rows: Number(r.rows), sql: r.query.replace(/\s+/g, " ").slice(0, 130) })),
  };
}

const tag = `unbounded-${randomUUID().slice(0, 8)}`;
const marker = `[${tag}]`;
const SURFACES = [
  { path: "/app/speaking/practice", label: "Speaking Practice", channel: "practice_alone" },
  { path: "/app/speaking/ai", label: "Speaking AI", channel: "ai" },
];
const measurements = [];
const growth = [];
let defects = 0;

try {
  const ext = await one("select count(*)::int n from pg_extension where extname='pg_stat_statements'");
  assert.ok(ext?.n, "pg_stat_statements must be installed: query counts are the point of this probe");

  const { actor: student } = await loginActor("STUDENT", BASE, "demo.student@learnersarea.uz", "Student12345!", { ip: "203.0.113.242", client: db });

  for (const size of SIZES) {
    const have = Number((await one("select count(*)::int n from speaking_prompts where prompt_text like $1", [`%${marker}%`]))?.n ?? 0);
    const need = size - have;
    for (let start = 0; start < need; start += 1000) {
      const n = Math.min(1000, need - start);
      const values = [];
      const params = [];
      for (let i = 0; i < n; i++) {
        // available_in defaults to ["practice_alone"], which BOTH channels accept: the ai query is
        // `@> '["ai"]' OR @> '["practice_alone"]'`, so one corpus measures both surfaces honestly.
        values.push(`($${params.length + 1}::uuid,'part1','part1',$${params.length + 2},'published',true,$${params.length + 3}::timestamptz)`);
        params.push(
          randomUUID(),
          `${marker} Prompt ${have + start + i} — describe a place you know well and explain why it matters`,
          new Date(Date.now() - (have + start + i) * 1000).toISOString(),
        );
      }
      await db.query(`insert into speaking_prompts (id, part, category, prompt_text, publication_state, is_active, created_at) values ${values.join(",")}`, params);
    }
    const actual = Number((await one("select count(*)::int n from speaking_prompts where prompt_text like $1", [`%${marker}%`]))?.n ?? 0);
    assert.equal(actual, size, `the tagged corpus must be exactly ${size} before measuring it`);
    const bank = Number((await one("select count(*)::int n from speaking_prompts where publication_state='published' and is_active"))?.n);

    for (const surface of SURFACES) {
      const single = await instrument(() => student.get(surface.path));
      const samples = [];
      let last = null;
      for (let i = 0; i < REPEATS; i++) {
        const t0 = performance.now();
        last = await student.get(surface.path);
        samples.push(performance.now() - t0);
      }
      samples.sort((x, y) => x - y);
      // createActor's get() resolves to {status, body, json, ...} with the body already read.
      const body = last.body ?? "";
      const rendered = (body.match(new RegExp(marker.replace(/[[\]]/g, "\\$&"), "g")) ?? []).length;
      measurements.push({
        surface: surface.label, path: surface.path, corpus: size, publishedBank: bank,
        queries: single.calls, rowsRead: single.rowsRead, dbMs: single.dbMs,
        medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(1)),
        bytes: body.length, renderedPrompts: rendered, status: last.status,
        slowest: single.slowest,
      });
      console.log(`  [${surface.label}] corpus=${size} bank=${bank} → HTTP ${last.status} queries=${single.calls} rowsRead=${single.rowsRead} dbMs=${single.dbMs} medianMs=${samples[Math.floor(samples.length / 2)].toFixed(1)} bytes=${body.length} renderedPrompts=${rendered}`);
    }
  }

  /* ------------------------------------------------- growth, judged per surface */
  console.log("\nGROWTH");
  for (const surface of SURFACES) {
    const series = measurements.filter((m) => m.path === surface.path);
    const first = series[0];
    const lastRow = series[series.length - 1];
    const factor = (a, b) => (Number(a) === 0 ? null : Number((Number(b) / Number(a)).toFixed(3)));
    const g = {
      surface: surface.label,
      corpus: `${first.corpus}→${lastRow.corpus}`,
      rowsRead: `${first.rowsRead}→${lastRow.rowsRead} (×${factor(first.rowsRead, lastRow.rowsRead) ?? "n/a"})`,
      bytes: `${first.bytes}→${lastRow.bytes} (×${factor(first.bytes, lastRow.bytes) ?? "n/a"})`,
      rendered: `${first.renderedPrompts}→${lastRow.renderedPrompts} (×${factor(first.renderedPrompts, lastRow.renderedPrompts) ?? "n/a"})`,
      medianMs: `${first.medianMs}→${lastRow.medianMs} (×${factor(first.medianMs, lastRow.medianMs) ?? "n/a"})`,
      queries: `${first.queries}→${lastRow.queries}`,
    };
    /*
     * A read is BOUNDED only when what it FETCHES and what it RENDERS stop growing as the bank
     * grows. Byte growth is a weaker signal and must not veto the verdict: the page shell is a fixed
     * cost, so shipping 10 000 prompts inside a 270 KB shell yields a bytes factor of ~22 even
     * though the prompt count grew exactly ×100. An earlier revision ANDed a bytes threshold into
     * this rule and reported BOUNDED for a page that rendered 10 000 of 10 000 prompts, read 10 007
     * rows and shipped 6.1 MB — a false PASS on the one number the probe exists to catch.
     *
     * The test is therefore proportionality to the bank, not a ratio between ratios: if the page
     * reads or renders on the order of the whole corpus at the largest size, and that quantity grew
     * by more than 2x across the series, the read is unbounded.
     */
    const rowsFactor = first.rowsRead ? lastRow.rowsRead / first.rowsRead : Infinity;
    const renderedFactor = first.renderedPrompts ? lastRow.renderedPrompts / first.renderedPrompts : Infinity;
    const bytesFactor = first.bytes ? lastRow.bytes / first.bytes : Infinity;
    const readsWholeBank = lastRow.rowsRead >= 0.5 * lastRow.corpus;
    const rendersWholeBank = lastRow.renderedPrompts >= 0.5 * lastRow.corpus;
    g.rowsFactor = Number(rowsFactor.toFixed(2));
    g.renderedFactor = Number(renderedFactor.toFixed(2));
    g.bytesFactor = Number(bytesFactor.toFixed(2));
    g.unboundedBecause = [
      rowsFactor > 2 && readsWholeBank ? `rows read scale with the bank (${lastRow.rowsRead} rows at a ${lastRow.corpus}-prompt corpus)` : null,
      renderedFactor > 2 && rendersWholeBank ? `prompts rendered scale with the bank (${lastRow.renderedPrompts} of ${lastRow.corpus} reached the browser)` : null,
    ].filter(Boolean).join("; ") || "rows read and items rendered stay flat as the bank grows";
    g.verdict = g.unboundedBecause.includes("scale with the bank") ? "UNBOUNDED" : "BOUNDED";
    growth.push(g);
    if (g.verdict === "UNBOUNDED") defects++;
    console.log(`  ${surface.label}: ${g.verdict}`);
    for (const [k, v] of Object.entries(g)) if (k !== "surface" && k !== "verdict") console.log(`      ${k}: ${v}`);
  }

  // The writing-side reads named in earlier notes have no caller in the app, so no request can
  // exercise them. Reporting a number for them would mean inventing a call the product never makes.
  growth.push({
    surface: "writing.listActivePrompts / listAllPrompts / listActivePromptsWithResources",
    corpus: "n/a", rowsRead: "NOT OBSERVED", bytes: "NOT OBSERVED", rendered: "NOT OBSERVED",
    medianMs: "NOT OBSERVED", queries: "NOT OBSERVED",
    verdict: "NOT OBSERVED — no caller in src/app or src/components, so no request exercises them",
  });
} catch (error) {
  console.error("\nMEASUREMENT ABORTED:", error?.message ?? error);
  if (error?.stack) console.error(error.stack.split("\n").slice(0, 5).join("\n"));
  defects++;
} finally {
  await db.query("delete from speaking_prompts where prompt_text like $1", [`%${marker}%`]).catch(() => {});
  const left = Number((await one("select count(*)::int n from speaking_prompts where prompt_text like $1", [`%${marker}%`]).catch(() => ({ n: -1 })))?.n ?? -1);
  console.log(`\n  tagged corpus deleted; rows left=${left}`);
  if (left !== 0) defects++;
  try {
    const sweep = await sweeper.sweep();
    if (sweep.removed.length) console.log(`  sweeper removed: ${sweep.removed.join(", ")}`);
    if (sweep.residue.length) { console.error(`  RESIDUE: ${sweep.residue.join(", ")}`); defects++; }
    else console.log("  residue: none");
  } catch (error) { console.error("  sweeper failed:", error.message); defects++; }
  await finalSweep("end of run");

  const lines = [
    "# §10 Unbounded learner-facing reads — measured",
    "",
    "`listActivePrompts(channel)` in `src/lib/data/speaking-practice.ts` is `findMany({ where, orderBy })`",
    "with no limit, and both callers hand the whole result to a client component, so every published",
    "prompt is read and serialised into the page on every request. Measured against a running server",
    "and instrumented PostgreSQL with a tagged corpus built and destroyed by this probe.",
    "",
    "## Raw measurements",
    "",
    "| surface | corpus | published bank | HTTP | queries | rows read | db ms | median ms | bytes | prompts rendered |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...measurements.map((m) => `| ${m.surface} | ${m.corpus} | ${m.publishedBank} | ${m.status} | ${m.queries} | ${m.rowsRead} | ${m.dbMs} | ${m.medianMs} | ${m.bytes} | ${m.renderedPrompts} |`),
    "",
    "## Growth and verdict",
    "",
    "| surface | corpus | rows read | bytes | prompts rendered | median ms | queries | verdict |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...growth.map((g) => `| ${g.surface} | ${g.corpus} | ${g.rowsRead} | ${g.bytes} | ${g.rendered} | ${g.medianMs} | ${g.queries} | ${g.verdict} |`),
    "",
    "A read is called BOUNDED only when the rows it fetches and the bytes it ships stop growing with",
    "the bank. A factor near the corpus ratio is linear growth, which is what this probe exists to",
    "catch — and why the same walk is run at three sizes rather than one.",
    "",
    "## Why this is not fixed by adding a limit",
    "",
    "`PracticeStudio` takes `prompts: typeof speakingPrompts.$inferSelect[]` — whole rows — and does",
    "the browsing itself in the browser: `partCounts(prompts)` for the Part step, `groupByTopic()` for",
    "the Topic step, and a client-side search box. Bounding the read to a page would therefore strand",
    "every prompt past the page and make the Part counts wrong, which is precisely the failure the",
    "same file already documents for Live Partner: \"the room used to ship the whole bank to the",
    "browser and filter it there, so prompts past the limit could never be found\", fixed there by",
    "moving narrowing server-side behind a keyset cursor with `hasMore` / `nextCursor`.",
    "",
    "Projecting fewer columns is not a safe substitute either: the panels render `study_support` and",
    "the recorder uses `follow_ups`, so the large fields are the ones in use.",
    "",
    "The equivalent fix here is to move Part/Topic grouping server-side and page it the way",
    "`listLivePartnerQuestions` already does. That changes what a learner-facing surface requests and",
    "renders, so it is recorded as OWNER_DECISION_REQUIRED with its measured cost attached rather",
    "than applied inside a measurement probe, and rather than papered over with an arbitrary limit",
    "that would silently hide content. The cost of doing nothing is the table above: at a 10 000-prompt",
    "bank every visit to either page reads the whole bank and ships several megabytes to the browser.",
    "",
    "## Slowest statements observed",
    "",
    ...measurements.flatMap((m) => m.slowest.map((s) => `- ${m.surface} @${m.corpus}: ${s.ms} ms over ${s.calls} call(s), ${s.rows} rows — \`${s.sql}\``)),
    "",
  ];
  writeFileSync("docs/UNBOUNDED-READS.md", `${lines.join("\n")}\n`);
  console.log(`\n${measurements.length} measurements · ${defects} unbounded/defect(s) · docs/UNBOUNDED-READS.md`);
}
process.exit(defects ? 1 : 0);
