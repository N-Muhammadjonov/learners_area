#!/usr/bin/env node
/**
 * PACKAGES B2 + G — real scale measurement against a running server and instrumented PostgreSQL.
 *
 *   node scripts/measure-scale.mjs [baseUrl] [--attempts 100,1000,10000] [--prompts 1000,10000]
 *
 * WHY THIS EXISTS. Scalability cannot be claimed from a unit test, and it cannot be claimed from
 * reading a query either: `findMany({ where, orderBy })` LOOKS bounded until someone puts 10 000
 * rows behind it. So this measures. Every number in docs/SCALE-MEASUREMENT.md is produced here.
 *
 * WHAT MAKES THE NUMBERS TRUSTWORTHY.
 *
 *   1. The datasets are isolated and tagged, built in the QA database and destroyed afterwards, so
 *      a measurement is of a known corpus rather than of whatever the last test run left behind.
 *   2. Query count and query time come from pg_stat_statements, reset immediately before each
 *      measured request and read immediately after. That is the server's own accounting of what it
 *      asked PostgreSQL to do — not an estimate, and not a count of the probe's own queries.
 *   3. Each size is measured as a series (100 -> 1 000 -> 10 000) so growth can be seen as growth.
 *      A single measurement cannot distinguish O(1) from O(n).
 *   4. Latency is the median of repeated requests, because one sample of a warm-cache read is noise.
 *
 * THE N+1 TEST. For the prompt bank the probe walks every page and compares the query count per
 * page across corpus sizes. If a page costs more queries when the bank is larger, something is
 * looping over rows; if the count is flat, the read is set-based. That comparison is the actual
 * evidence, and it is why the same walk is run at two sizes rather than one.
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
const ATTEMPT_SIZES = flag("attempts", "100,1000,10000").split(",").map(Number);
const PROMPT_SIZES = flag("prompts", "1000,10000").split(",").map(Number);
const REPEATS = Number(flag("repeats", "5"));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || !/localhost|127\.0\.0\.1/.test(DATABASE_URL)) {
  console.error("Refusing to run: this builds 10 000-row corpora. Pass a LOCAL disposable DATABASE_URL.");
  process.exit(2);
}

const { assertMutableDatabase, createRowSweeper, installSweepHandlers } = await import("./lib/fixture-safety.mjs");
const { destroyQaDatasetByTag } = await import("./lib/qa-dataset.mjs");
const { loginActor } = await import("./lib/security-matrix.mjs");
const pg = (await import("pg")).default;

assertMutableDatabase(DATABASE_URL, { probe: "measure-scale" });

const LOGIN_IP = "203.0.113.241";
const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await all(sql, params))[0] ?? null;

const sweeper = createRowSweeper({
  client: db, probe: "measure-scale",
  tables: ["speaking_attempts", "speaking_prompts", "activity_events", "evaluations", "upload_intents"],
});
const finalSweep = installSweepHandlers(sweeper, { probe: "measure-scale", onDone: () => db.end().catch(() => {}) });
await sweeper.capture();

/**
 * Reset pg_stat_statements, do exactly one thing, then read back what PostgreSQL was asked to do.
 *
 * The probe's own introspection is excluded by text, because reading pg_stat_statements is itself
 * a statement and would otherwise add one call to every measurement.
 */
async function instrument(fn) {
  await db.query("select pg_stat_statements_reset()");
  const started = performance.now();
  const result = await fn();
  const wallMs = performance.now() - started;
  const rows = await all(
    `select query, calls, total_exec_time, mean_exec_time, rows
       from pg_stat_statements
      where query not ilike '%pg_stat_statements%'
        and query not ilike '%deallocate%'`,
  );
  const calls = rows.reduce((n, r) => n + Number(r.calls), 0);
  const dbMs = rows.reduce((n, r) => n + Number(r.total_exec_time), 0);
  const rowsRead = rows.reduce((n, r) => n + Number(r.rows), 0);
  return {
    wallMs, calls, dbMs, rowsRead, result,
    distinctStatements: rows.length,
    slowest: rows.sort((a, b) => b.total_exec_time - a.total_exec_time).slice(0, 3)
      .map((r) => ({ ms: Number(r.total_exec_time.toFixed(2)), calls: Number(r.calls), rows: Number(r.rows), sql: r.query.replace(/\s+/g, " ").slice(0, 150) })),
  };
}

const timings = [];
async function medianFetch(actor, path, repeats = REPEATS) {
  const samples = [];
  let last = null;
  for (let i = 0; i < repeats; i++) {
    const t0 = performance.now();
    const res = await actor.get(path);
    samples.push(performance.now() - t0);
    last = res;
  }
  samples.sort((a, b) => a - b);
  timings.push(...samples);
  return { ms: samples[Math.floor(samples.length / 2)], min: samples[0], max: samples[samples.length - 1], res: last };
}

const results = [];
/** Every attempt id this probe creates. speaking_attempts has no tag column, so cleanup is by id. */
const tagAttemptIds = [];
function record(section, subject, data) {
  results.push({ section, subject, ...data });
  console.log(`  [${section}] ${subject}`);
  for (const [k, v] of Object.entries(data)) {
    if (k === "verdict" || k === "note") continue;
    console.log(`      ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  }
  if (data.note) console.log(`      note: ${data.note}`);
  if (data.verdict) console.log(`      => ${data.verdict}`);
}

const tag = `scale-${randomUUID().slice(0, 8)}`;
let actors = {};
let defects = 0;

try {
  const haveExtension = await one("select count(*)::int n from pg_extension where extname='pg_stat_statements'");
  assert.ok(haveExtension?.n, "pg_stat_statements must be installed: query counts are the point of this probe");
  const preloaded = await one("show shared_preload_libraries");
  assert.ok(/pg_stat_statements/.test(preloaded?.shared_preload_libraries ?? ""), "pg_stat_statements must be preloaded, or its view cannot be read");
  console.log(`pg_stat_statements live (shared_preload_libraries=${preloaded.shared_preload_libraries})`);

  for (const [name, email, password] of [
    ["STUDENT_A", "demo.student@learnersarea.uz", "Student12345!"],
    ["STUDENT_B", "new.student@learnersarea.uz", "Student12345!"],
    ["TEACHER", "teacher@learnersarea.uz", "Teacher12345!"],
  ]) {
    const { actor, identity } = await loginActor(name, BASE, email, password, { ip: LOGIN_IP, client: db });
    actors[name] = actor;
    actors[`${name}_ID`] = identity.userId;
  }

  /* =====================================================================
   * SECTION 1 — ATTEMPT HISTORY AT 100 / 1 000 / 10 000.
   *
   * Two surfaces are measured at every size, because they are not the same code:
   *   GET /api/speaking/attempts          — the API surface
   *   GET /app/speaking/history           — the page learners actually use (listAttempts)
   * Measuring only one would let a bounded page hide an unbounded API, which is exactly what was
   * found here.
   */
  console.log(`\nSECTION 1 — attempt history at ${ATTEMPT_SIZES.join(" / ")} attempts (learner ${actors.STUDENT_A_ID.slice(0, 8)})`);
  for (const size of ATTEMPT_SIZES) {
    // Grow to the next size rather than rebuilding, so the series is cumulative and the delta in
    // cost is attributable to the rows added.
    //
    // speaking_attempts has no source_ref column and its status enum is recording/submitted/
    // reviewed, so the corpus is tracked by its own ids rather than by a tag column.
    const countMine = async () => Number((await one(
      `select count(*)::int n from speaking_attempts where id = any($1::uuid[])`, [tagAttemptIds],
    ))?.n ?? 0);
    const have = await countMine();
    const need = size - have;
    if (need > 0) {
      // Batched so building 10 000 rows is not itself the slowest thing measured. started_at is
      // spread one minute apart: identical timestamps would make the ordering assertion
      // meaningless and hide an unstable sort.
      for (let start = 0; start < need; start += 1000) {
        const n = Math.min(1000, need - start);
        const values = [];
        const params = [];
        for (let i = 0; i < n; i++) {
          const id = randomUUID();
          tagAttemptIds.push(id);
          values.push(`($${params.length + 2}::uuid,$1,'part1','submitted',$${params.length + 3}::timestamptz)`);
          params.push(id, new Date(Date.now() - (have + start + i) * 60_000).toISOString());
        }
        await db.query(
          `insert into speaking_attempts (id, user_id, part, status, started_at) values ${values.join(",")}`,
          [actors.STUDENT_A_ID, ...params],
        );
      }
    }
    const actual = await countMine();
    assert.equal(actual, size, `the corpus must be exactly ${size} attempts before measuring it`);

    const api = await instrument(async () => {
      const { ms, res } = await medianFetch(actors.STUDENT_A, "/api/speaking/attempts");
      return { ms, status: res.status, bytes: res.body.length, attempts: res.json?.attempts?.length ?? 0 };
    });
    const bounded = api.result.attempts <= 200;
    record("S1", `GET /api/speaking/attempts with ${size} attempts in the corpus`, {
      httpStatus: api.result.status,
      returnedAttempts: api.result.attempts,
      responseBytes: api.result.bytes,
      medianLatencyMs: Number(api.result.ms.toFixed(1)),
      queryCalls: api.calls,
      dbTimeMs: Number(api.dbMs.toFixed(2)),
      rowsReadByPostgres: api.rowsRead,
      boundedRead: bounded,
      verdict: bounded ? "BOUNDED" : "UNBOUNDED — returns the whole history and the payload grows with it",
    });
    if (!bounded) defects++;

    const page = await instrument(async () => {
      const { ms, res } = await medianFetch(actors.STUDENT_A, "/app/speaking/history");
      return { ms, status: res.status, bytes: res.body.length };
    });
    record("S1", `GET /app/speaking/history (the page learners use) with ${size} attempts`, {
      httpStatus: page.result.status,
      responseBytes: page.result.bytes,
      medianLatencyMs: Number(page.result.ms.toFixed(1)),
      queryCalls: page.calls,
      dbTimeMs: Number(page.dbMs.toFixed(2)),
      rowsReadByPostgres: page.rowsRead,
      note: "listAttempts() bounds this at 100 and resolves prompts in one query restricted to the referenced ids",
    });

    // Authorization and isolation must hold AT SCALE, not only on a small fixture: a bounded read
    // that leaks is worse than an unbounded one that does not.
    const asB = await actors.STUDENT_B.get("/api/speaking/attempts");
    const bIds = (asB.json?.attempts ?? []).map((r) => r.userId);
    record("S1", `learner isolation at ${size} attempts (student B reads the same endpoint)`, {
      httpStatus: asB.status,
      attemptsReturnedToB: (asB.json?.attempts ?? []).length,
      anyOfAsAttemptsVisibleToB: bIds.includes(actors.STUDENT_A_ID),
      verdict: bIds.includes(actors.STUDENT_A_ID) ? "LEAK" : "ISOLATED",
    });
    if (bIds.includes(actors.STUDENT_A_ID)) defects++;

    const asTeacher = await actors.TEACHER.get("/api/speaking/attempts");
    record("S1", `reviewer scope at ${size} attempts (teacher reads the same endpoint)`, {
      httpStatus: asTeacher.status,
      attemptsReturned: (asTeacher.json?.attempts ?? []).length,
      distinctUsers: new Set((asTeacher.json?.attempts ?? []).map((r) => r.userId)).size,
      note: "documented behaviour is that staff see attempts for review; what matters is whether that read is bounded",
    });
  }

  // The boundedness test, computed rather than asserted: compare the smallest and largest attempt
  // corpus and require the payload and the rows PostgreSQL read to stay flat. A single measurement
  // cannot distinguish a bounded read from an unbounded one that happens to be small.
  const s1api = results.filter((r) => r.subject.startsWith("GET /api/speaking/attempts with"));
  if (s1api.length >= 2) {
    const small = s1api[0], large = s1api[s1api.length - 1];
    const byteGrowth = large.responseBytes / (small.responseBytes || 1);
    const rowGrowth = large.rowsReadByPostgres / (small.rowsReadByPostgres || 1);
    const bounded = byteGrowth < 1.5 && rowGrowth < 1.5 && large.boundedRead && small.boundedRead;
    record("S1", "boundedness of GET /api/speaking/attempts as the history grows", {
      smallestCorpus: `${small.returnedAttempts} returned / ${small.responseBytes} B / ${small.rowsReadByPostgres} rows read`,
      largestCorpus: `${large.returnedAttempts} returned / ${large.responseBytes} B / ${large.rowsReadByPostgres} rows read`,
      payloadGrowthFactor: Number(byteGrowth.toFixed(3)),
      rowsReadGrowthFactor: Number(rowGrowth.toFixed(3)),
      verdict: bounded
        ? "BOUNDED — payload and rows read are flat across the corpus series"
        : "UNBOUNDED — the response grows with the learner's history",
    });
    if (!bounded) defects++;
  }

  // Attempt identity and prompt association at scale, plus the deleted-prompt case B2 names.
  const identity = await instrument(async () => {
    const res = await actors.STUDENT_A.get("/api/speaking/attempts");
    const rows = res.json?.attempts ?? [];
    return {
      count: rows.length,
      uniqueIds: new Set(rows.map((r) => r.id)).size,
      allHaveStartedAt: rows.every((r) => Boolean(r.startedAt ?? r.started_at)),
      descending: rows.every((r, i) => i === 0 || new Date(rows[i - 1].startedAt ?? rows[i - 1].started_at) >= new Date(r.startedAt ?? r.started_at)),
    };
  });
  record("S1", "attempt identity, ordering and uniqueness on the returned page", {
    returned: identity.result.count,
    uniqueIds: identity.result.uniqueIds,
    everyRowHasStartedAt: identity.result.allHaveStartedAt,
    orderingIsDescendingByStartedAt: identity.result.descending,
    queryCalls: identity.calls,
    verdict: identity.result.uniqueIds === identity.result.count && identity.result.descending ? "OK" : "DEFECT",
  });
  if (!(identity.result.uniqueIds === identity.result.count && identity.result.descending)) defects++;

  // A deleted prompt must not break the history read: attempts whose prompt row is gone still list.
  // A prompt from THIS probe's own tagged corpus. Deleting a seeded prompt would make the
  // measurement destructive to the shared QA baseline, which is exactly what a probe must not do.
  const withPrompt = await one(
    `select id from speaking_prompts where prompt_text like $1 and publication_state='published' limit 1`,
    [`%[${tag}]%`],
  );
  if (withPrompt) {
    const attemptId = randomUUID();
    await db.query(
      `insert into speaking_attempts (id, user_id, prompt_id, part, status, started_at)
       values ($1,$2,$3,'part1','submitted',now())`,
      [attemptId, actors.STUDENT_A_ID, withPrompt.id],
    );
    tagAttemptIds.push(attemptId);
    const before = await actors.STUDENT_A.get("/api/speaking/attempts");
    const presentBefore = (before.json?.attempts ?? []).some((r) => r.id === attemptId);
    await db.query(`delete from speaking_prompts where id=$1`, [withPrompt.id]);
    const after = await actors.STUDENT_A.get("/api/speaking/attempts");
    const stillListed = (after.json?.attempts ?? []).some((r) => r.id === attemptId);
    record("S1", "a deleted prompt does not break or hide the attempt (B2 missing/deleted-prompt behaviour)", {
      statusBefore: before.status,
      attemptListedBeforeDeletion: presentBefore,
      statusAfterDeletion: after.status,
      attemptStillListedAfterDeletion: stillListed,
      note: "deletes one prompt from this probe's own tagged corpus; the attempt must survive it",
      verdict: after.status === 200 && stillListed ? "OK — history survives a deleted prompt" : "DEFECT",
    });
    if (!(after.status === 200 && stillListed)) defects++;
  }

  /* =====================================================================
   * SECTION 2 — PROMPT BANK AT 1 000 / 10 000: traversal cost and N+1.
   */
  console.log(`\nSECTION 2 — live-partner prompt bank at ${PROMPT_SIZES.join(" / ")} prompts`);
  for (const size of PROMPT_SIZES) {
    const have = Number((await one(`select count(*)::int n from speaking_prompts where prompt_text like $1`, [`%[${tag}]%`]))?.n ?? 0);
    const need = size - have;
    if (need > 0) {
      for (let start = 0; start < need; start += 1000) {
        const n = Math.min(1000, need - start);
        const values = [];
        const params = [];
        for (let i = 0; i < n; i++) {
          // category is NOT NULL and available_in defaults to ["practice_alone"], which the
          // live-partner query accepts, so neither needs to be spelled out per row.
          values.push(`($${params.length + 1}::uuid,'part1','part1',$${params.length + 2},'published',true,$${params.length + 3}::timestamptz)`);
          params.push(
            randomUUID(),
            `[${tag}] Scale prompt ${have + start + i} — describe a place you know well and explain why it matters to you`,
            new Date(Date.now() - (have + start + i) * 1000).toISOString(),
          );
        }
        await db.query(
          `insert into speaking_prompts (id, part, category, prompt_text, publication_state, is_active, created_at)
           values ${values.join(",")}`,
          params,
        );
      }
    }
    const actual = Number((await one(`select count(*)::int n from speaking_prompts where prompt_text like $1`, [`%[${tag}]%`]))?.n ?? 0);
    assert.equal(actual, size, `the prompt bank must be exactly ${size} before measuring it`);

    // Full cursor traversal: cost of reaching every prompt, and the per-page query count that
    // reveals an N+1.
    const walk = await instrument(async () => {
      const q = encodeURIComponent(`[${tag}]`);
      let cursor = null, pages = 0, collected = 0;
      const perPage = [];
      const t0 = performance.now();
      do {
        const pt = performance.now();
        const url = `/api/speaking/live-partner/questions?q=${q}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const res = await actors.STUDENT_A.get(url);
        if (res.status !== 200) return { error: `HTTP ${res.status}`, pages, collected };
        perPage.push(performance.now() - pt);
        collected += (res.json?.questions ?? []).length;
        cursor = res.json?.nextCursor ?? null;
        pages++;
        if (pages > 200) return { error: "walk exceeded 200 pages", pages, collected };
      } while (cursor);
      return { pages, collected, totalMs: performance.now() - t0, perPageMs: perPage.map((n) => Number(n.toFixed(1))) };
    });
    const perPageQueries = walk.calls / Math.max(1, walk.result.pages ?? 1);
    record("S2", `full cursor traversal of a ${size}-prompt bank`, {
      promptsInBank: size,
      pagesWalked: walk.result.pages,
      promptsCollected: walk.result.collected,
      traversalMs: Number((walk.result.totalMs ?? 0).toFixed(1)),
      queryCallsTotal: walk.calls,
      queryCallsPerPage: Number(perPageQueries.toFixed(2)),
      dbTimeMsTotal: Number(walk.dbMs.toFixed(2)),
      firstPageMs: walk.result.perPageMs?.[0],
      lastPageMs: walk.result.perPageMs?.[walk.result.perPageMs.length - 1],
      complete: walk.result.collected === size,
      verdict: walk.result.collected === size && !walk.result.error ? (perPageQueries < 6 ? "OK — set-based, no N+1" : "SUSPECT — per-page query count is high") : `DEFECT — ${walk.result.error ?? "incomplete traversal"}`,
    });
    if (walk.result.collected !== size || walk.result.error) defects++;

    // A single page must not get slower as the bank grows: that is the difference between a
    // keyset seek and a scan-and-discard offset.
    const single = await instrument(async () => {
      const { ms, res } = await medianFetch(actors.STUDENT_A, `/api/speaking/live-partner/questions?q=${encodeURIComponent(`[${tag}]`)}`);
      return { ms, status: res.status, questions: res.json?.questions?.length ?? 0, matching: res.json?.matching ?? 0, bytes: res.body.length };
    });
    record("S2", `first page of a ${size}-prompt bank`, {
      httpStatus: single.result.status,
      questionsReturned: single.result.questions,
      matchingReported: single.result.matching,
      responseBytes: single.result.bytes,
      medianLatencyMs: Number(single.result.ms.toFixed(1)),
      queryCalls: single.calls,
      dbTimeMs: Number(single.dbMs.toFixed(2)),
      slowestStatements: single.slowest,
    });
  }

  // The same walk at both sizes: flat per-page cost is the evidence that paging is a seek.
  const s2pages = results.filter((r) => r.subject.startsWith("full cursor traversal"));
  if (s2pages.length >= 2) {
    const first = s2pages[0], last = s2pages[s2pages.length - 1];
    const growth = last.promptsInBank / first.promptsInBank;
    const costGrowth = last.queryCallsPerPage / (first.queryCallsPerPage || 1);
    record("S2", "per-page query cost as the bank grows (the N+1 test)", {
      corpusGrowthFactor: growth,
      perPageQueryGrowthFactor: Number(costGrowth.toFixed(3)),
      from: `${first.promptsInBank} prompts @ ${first.queryCallsPerPage} queries/page`,
      to: `${last.promptsInBank} prompts @ ${last.queryCallsPerPage} queries/page`,
      verdict: costGrowth < 1.2 ? "FLAT — no N+1; per-page cost does not grow with the corpus" : "GROWS — investigate for a per-row query",
    });
    if (costGrowth >= 1.2) defects++;
  }
} catch (error) {
  console.error("\nMEASUREMENT ABORTED:", error?.message ?? error);
  if (error?.stack) console.error(error.stack.split("\n").slice(0, 6).join("\n"));
  defects++;
} finally {
  // The corpus is tagged, so teardown is by tag and does not depend on remembering every id.
  try {
    for (let i = 0; i < tagAttemptIds.length; i += 2000) {
      await db.query(`delete from speaking_attempts where id = any($1::uuid[])`, [tagAttemptIds.slice(i, i + 2000)]);
    }
    await db.query(`delete from speaking_prompts where prompt_text like $1`, [`%[${tag}]%`]);
    const leftA = Number((await one(`select count(*)::int n from speaking_attempts where id = any($1::uuid[])`, [tagAttemptIds]))?.n ?? -1);
    const leftP = Number((await one(`select count(*)::int n from speaking_prompts where prompt_text like $1`, [`%[${tag}]%`]))?.n ?? -1);
    console.log(`\n  tagged corpus removed: attempts left=${leftA}, prompts left=${leftP}`);
    if (leftA !== 0 || leftP !== 0) { console.error("  RESIDUE: tagged rows survived teardown"); defects++; }
  } catch (error) {
    console.error("  teardown failed:", error.message);
    defects++;
  }
  try {
    const sweep = await sweeper.sweep();
    if (sweep.removed.length) console.log("  sweeper removed:", sweep.removed.join(", "));
    if (sweep.residue.length) { console.error("  RESIDUE:", sweep.residue.join(", ")); defects++; }
  } catch (error) { console.error("  sweeper failed:", error.message); defects++; }
  await finalSweep("end of run");

  const lines = [
    "# Scale measurement (Packages B2 and G)",
    "",
    `Measured against \`${BASE}\` and a local PostgreSQL 18 with \`pg_stat_statements\` preloaded, so`,
    "`queryCalls` and `dbTimeMs` are PostgreSQL's own accounting of what the server asked it to do",
    "during one measured request — not estimates. Latency is the median of " + REPEATS + " repeats.",
    "Corpora are tagged, asserted to be exactly the intended size before each measurement, and",
    "removed afterwards; the removed-row counts are reported at the end of the run.",
    "",
    `**${results.length} measurements · ${defects} defect(s).**`,
    "",
    "| # | section | subject | measurement |",
    "| --- | --- | --- | --- |",
    ...results.map((r, i) => `| ${i + 1} | ${r.section} | ${r.subject} | ${Object.entries(r).filter(([k]) => !["section", "subject", "slowestStatements"].includes(k)).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")} |`),
    "",
    "## Slowest statements",
    "",
    ...results.filter((r) => r.slowestStatements?.length).flatMap((r) => [
      `**${r.subject}**`,
      "",
      ...r.slowestStatements.map((s) => `- ${s.ms} ms over ${s.calls} call(s), ${s.rows} row(s): \`${s.sql}\``),
      "",
    ]),
    defects
      ? `## Defects\n\n${defects} measurement(s) crossed a threshold. Each is named in the table above with its verdict.`
      : "## Defects\n\nNone. Every measured surface stayed within its bound and no per-page cost grew with corpus size.",
    "",
  ];
  writeFileSync("docs/SCALE-MEASUREMENT.md", `${lines.join("\n")}\n`);
  console.log(`\n${results.length} measurements recorded · ${defects} defect(s) · docs/SCALE-MEASUREMENT.md`);
}

process.exit(defects ? 1 : 0);
