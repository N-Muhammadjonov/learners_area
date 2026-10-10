#!/usr/bin/env node
/**
 * A3 — prove the probe-isolation contract under DELIBERATELY OVERLAPPING runs.
 *
 *   node scripts/verify-probe-isolation.mjs
 *
 * A sweeper attributes rows by difference from a baseline, so the question is not "does cleanup
 * work" but "can one probe delete another probe's fixtures while both are running". This answers it
 * four ways, because a single happy-path run cannot distinguish a real guarantee from luck:
 *
 *   1. THE HAZARD, demonstrated rather than described. One sweeper captures a baseline, a DIFFERENT
 *      session inserts a row, and the difference set that sweep() would delete is computed. It
 *      contains the foreign row. That is the defect: attribution by difference cannot tell whose
 *      row it is, so the only sound fix is to stop the windows overlapping.
 *   2. THE REFUSAL. While one sweeper holds the lock, a second sweeper's capture() must throw, and
 *      the message must name the backend holding it — an unnamed refusal is not actionable.
 *   3. CRASH SAFETY. A session killed while holding the lock must release it, or one crashed probe
 *      would wedge every later run. Proven by ending the connection and re-acquiring.
 *   4. TWO REAL PROCESSES, started together. Exactly one must complete and clean up; the other must
 *      refuse. Neither may delete the other's row, and the database must end with no residue.
 */
import { spawn } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(2);
}
const { assertMutableDatabase, createRowSweeper } = await import("./lib/fixture-safety.mjs");
assertMutableDatabase(DATABASE_URL, { probe: "verify-probe-isolation" });
const pg = (await import("pg")).default;
const { spawnSync } = await import("node:child_process");

const connect = async () => { const c = new pg.Client({ connectionString: DATABASE_URL }); await c.connect(); return c; };
let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** A row in a table real probes actually collide on. */
const insertEvent = async (client, userId, label) => {
  const { rows } = await client.query(
    `insert into activity_events (user_id, type, payload) values ($1,'READING_ATTEMPT_COMPLETED',$2::jsonb) returning id`,
    [userId, JSON.stringify({ isolationProbe: label })],
  );
  return rows[0].id;
};
const countLabelled = async (client) => Number((await client.query(
  "select count(*)::int n from activity_events where payload ? 'isolationProbe'")).rows[0].n);

const admin = await connect();
const userId = (await admin.query("select id from users where role='student' order by created_at limit 1")).rows[0]?.id;
if (!userId) { console.error("no student user to attribute fixture events to"); process.exit(2); }
const baselineEvents = Number((await admin.query("select count(*)::int n from activity_events")).rows[0].n);

try {
  /* ---------------------------------------------- 1. the hazard, demonstrated */
  {
    const a = await connect();
    const foreign = await connect();
    const sweeperA = createRowSweeper({ client: a, probe: "HAZARD-A", tables: ["activity_events"] });
    // The ids present at capture time — this IS the baseline sweep() differences against.
    const atCapture = new Set((await a.query("select id from activity_events")).rows.map((r) => r.id));
    await sweeperA.capture();
    const own = await insertEvent(a, userId, "hazard-own");
    // A different session, which is exactly what a second concurrent probe is.
    const theirs = await insertEvent(foreign, userId, "hazard-foreign");

    // Recompute the delete set the way sweep() does, without deleting: every id not in the baseline.
    const now = (await a.query("select id from activity_events")).rows.map((r) => r.id);
    const wouldDelete = now.filter((id) => !atCapture.has(id));
    check("HAZARD: a foreign session's row lands inside the difference set A would delete",
      wouldDelete.includes(theirs) && wouldDelete.includes(own),
      `A created 1 row; sweep() would delete ${wouldDelete.length}, including ${String(theirs).slice(0, 8)} which belongs to the other session. Attribution by difference cannot tell whose row it is — which is why the windows must not overlap at all.`,
    );

    // Clean up both rows explicitly — this section must not leave the foreign row behind.
    await a.query("delete from activity_events where id = any($1)", [[own, theirs]]);
    await sweeperA.sweep();
    await foreign.end(); await a.end();
  }

  /* --------------------------------------------------- 2. the refusal + naming */
  {
    const a = await connect();
    const b = await connect();
    const sweeperA = createRowSweeper({ client: a, probe: "HOLDER", tables: ["activity_events"] });
    await sweeperA.capture();
    const aPid = (await a.query("select pg_backend_pid()::int pid")).rows[0].pid;

    const sweeperB = createRowSweeper({ client: b, probe: "INTRUDER", tables: ["activity_events"] });
    let error = null;
    try { await sweeperB.capture(); } catch (e) { error = e; }
    check("a second sweeper is refused while the first holds the lock",
      Boolean(error) && /isolation lock/i.test(error.message),
      error ? error.message.slice(0, 150) : "capture() succeeded — the windows overlapped",
    );
    check("the refusal names the backend holding the lock, so it is actionable",
      Boolean(error) && error.message.includes(String(aPid)),
      `holder pid=${aPid}; message mentions it=${Boolean(error) && error.message.includes(String(aPid))}`,
    );

    // The holder is unaffected and still owns its window.
    const own = await insertEvent(a, userId, "holder-own");
    const { removed, residue } = await sweeperA.sweep();
    check("the holder still sweeps exactly its own row and releases cleanly",
      removed.join() === "activity_events: 1" && residue.length === 0,
      `removed=${removed.join(",") || "nothing"}; residue=${residue.join(",") || "none"}`,
    );

    // And the lock is reusable: B can now take it, so a completed run does not wedge the next one.
    let secondError = null;
    try { await sweeperB.capture(); } catch (e) { secondError = e; }
    check("after the holder releases, the refused probe can acquire the lock (no wedge)",
      secondError === null,
      secondError ? secondError.message.slice(0, 120) : "acquired on the second attempt",
    );
    await sweeperB.sweep();
    await b.end(); await a.end();
    void own;
  }

  /* ------------------------------------------------------ 3. crash safety */
  {
    const crasher = await connect();
    const sweeper = createRowSweeper({ client: crasher, probe: "CRASHER", tables: ["activity_events"] });
    await sweeper.capture();
    // Simulate a killed probe: the session dies holding the lock, without sweeping.
    await crasher.end();
    const survivor = await connect();
    const sweeper2 = createRowSweeper({ client: survivor, probe: "SURVIVOR", tables: ["activity_events"] });
    let error = null;
    try { await sweeper2.capture(); } catch (e) { error = e; }
    check("a session killed while holding the lock releases it (session scope, not a wedge)",
      error === null,
      error ? `still refused: ${error.message.slice(0, 120)}` : "the next probe acquired it immediately",
    );
    await sweeper2.sweep();
    await survivor.end();
  }

  /* ------------------------------------- 4. two real processes, started together */
  const child = (label) => new Promise((resolve) => {
    const code = `
      const DATABASE_URL = ${JSON.stringify(DATABASE_URL)};
      const { assertMutableDatabase, createRowSweeper } = await import(${JSON.stringify(new URL("./lib/fixture-safety.mjs", import.meta.url).href)});
      assertMutableDatabase(DATABASE_URL, { probe: ${JSON.stringify(label)} });
      const pg = (await import("pg")).default;
      const c = new pg.Client({ connectionString: DATABASE_URL }); await c.connect();
      const user = (await c.query("select id from users where role='student' order by created_at limit 1")).rows[0].id;
      const s = createRowSweeper({ client: c, probe: ${JSON.stringify(label)}, tables: ["activity_events"] });
      await s.capture();
      await c.query("insert into activity_events (user_id,type,payload) values ($1,'READING_ATTEMPT_COMPLETED',$2::jsonb)", [user, JSON.stringify({ isolationProbe: ${JSON.stringify(label)} })]);
      await new Promise((r) => setTimeout(r, 2500));
      const out = await s.sweep();
      console.log(JSON.stringify({ label: ${JSON.stringify(label)}, removed: out.removed, residue: out.residue }));
      await c.end();
    `;
    const proc = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("close", (exitCode) => resolve({ label, exitCode, stdout, stderr }));
  });

  const [r1, r2] = await Promise.all([child("CONCURRENT-1"), child("CONCURRENT-2")]);
  const outcomes = [r1, r2];
  const completed = outcomes.filter((r) => r.exitCode === 0);
  const refused = outcomes.filter((r) => r.exitCode !== 0 && /isolation lock/i.test(r.stderr));
  check("two overlapping probe processes: exactly one completes",
    completed.length === 1,
    outcomes.map((o) => `${o.label} exit=${o.exitCode}`).join(" · "),
  );
  check("and exactly one is refused by the isolation lock, naming it",
    refused.length === 1,
    refused[0] ? `${refused[0].label}: ${refused[0].stderr.split("\n").find((l) => /isolation lock/i.test(l))?.slice(0, 130)}` : `refusals=${refused.length}`,
  );
  const completedClean = completed[0] ? /"residue":\[\]/.test(completed[0].stdout) : false;
  check("the completing process cleaned up its own row and reported no residue",
    completedClean,
    completed[0]?.stdout.trim().slice(0, 160) ?? "no completing process",
  );

  /* =======================================================================
   * FAILURE PATHS. Everything above proves the lock works when capture() succeeds. A lock taken and
   * never given back is worse than no lock: it wedges every other probe that shares the database.
   * So the interesting cases are the ones where capture() cannot finish.
   * ======================================================================= */

  /* ---- A1: coverage that was asked for and not delivered is a failure, not a warning ---- */
  {
    const client = await connect();
    const before = await countLabelled(admin);
    const strict = createRowSweeper({ client, tables: ["users", "no_such_table_a1"], probe: "A1-strict" });
    let threw = null;
    try { await strict.capture(); } catch (e) { threw = e.message; }
    check("A1: an unusable requested table is fatal, so cleanup coverage cannot shrink silently",
      threw !== null && /refusing to mutate/i.test(threw ?? ""), threw ? threw.slice(0, 70) : "capture() succeeded on a table that does not exist");
    const afterThrow = await countLabelled(admin);
    check("A1: it is fatal BEFORE the first mutation, so nothing is written that cannot be cleaned",
      afterThrow === before, `labelled rows ${before} → ${afterThrow}`);

    // A genuinely optional table is the caller's claim to make, in writing, at the call site.
    const lenient = createRowSweeper({
      client, tables: ["users", "no_such_table_a1"], probe: "A1-optional",
      optionalTables: ["no_such_table_a1"], // declared absent: no migration creates it in this suite
    });
    let lenientErr = null;
    try { await lenient.capture(); await lenient.sweep(); } catch (e) { lenientErr = e.message; }
    check("A1: a table the caller explicitly declared optional does not block the run",
      lenientErr === null, lenientErr ?? "captured and swept with the optional table excluded");
    await client.end();
  }

  /* ---- A2: a capture that fails must not leave the session holding the lock ---- */
  {
    const client = await connect();
    const holderPid = Number((await client.query("select pg_backend_pid()::int pid")).rows[0].pid);
    const leaky = createRowSweeper({ client, tables: ["users", "no_such_table_a2"], probe: "A2-leaky" });
    try { await leaky.capture(); } catch { /* a probe reports the failure instead of crashing — and keeps its connection */ }

    const still = await admin.query(
      "select pid from pg_locks where locktype='advisory' and classid=$1 and objid=$2", [0x51a2f3, 1]);
    check("A2: pg_locks shows no isolation lock left behind by the failed capture",
      still.rows.length === 0, still.rows.length ? `still held by pid ${still.rows[0].pid}` : "none held");

    // The victim is not this connection — pg_advisory_lock is re-entrant inside a session, so a
    // same-connection retry would pass and hide the leak. The victim is any OTHER process.
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import pg from "pg";
      const { createRowSweeper } = await import(${JSON.stringify(new URL("./lib/fixture-safety.mjs", import.meta.url).href)});
      const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      const s = createRowSweeper({ client: c, tables: ["users"], probe: "A2-other-process" });
      try { await s.capture(); await s.sweep(); } catch (e) { console.log("REFUSED " + e.message); process.exit(3); }
      await c.end();
    `], { encoding: "utf8", env: { ...process.env, DATABASE_URL }, timeout: 60_000 });
    check("A2: an unrelated process is not wedged by a capture that failed on another connection",
      child.status === 0 && !/REFUSED/.test(child.stdout + child.stderr),
      child.status === 0 ? "the other process captured and swept normally"
        : `exit=${child.status} ${(child.stdout + child.stderr).trim().slice(0, 110)}`);
    const samePid = Number((await client.query("select pg_backend_pid()::int pid")).rows[0].pid);
    check("A2: the connection whose capture failed is still alive and unchanged",
      samePid === holderPid, `pid ${holderPid} → ${samePid}`);
    await client.end();
  }

  /* ---- A3: release is verified against the database, not assumed ---- */
  {
    const client = await connect();
    const ok = createRowSweeper({ client, tables: ["activity_events"], probe: "A3-release" });
    await ok.capture();
    const duringLock = await admin.query(
      "select pid from pg_locks where locktype='advisory' and classid=$1 and objid=$2", [0x51a2f3, 1]);
    check("A3: the lock is really held while the sweeper is working", duringLock.rows.length === 1,
      `holders=${duringLock.rows.length}`);
    const result = await ok.sweep();
    check("A3: sweep() reports how the lock was released rather than saying nothing",
      result.lockReleased === "unlocked", `lockReleased=${result.lockReleased ?? "absent"}`);
    const after = await admin.query(
      "select pid from pg_locks where locktype='advisory' and classid=$1 and objid=$2", [0x51a2f3, 1]);
    check("A3: pg_locks confirms the release — no holder remains", after.rows.length === 0,
      after.rows.length ? `still held by pid ${after.rows[0].pid}` : "none held");

    // A dead session cannot hold a session-scoped lock; the sweeper must say so accurately
    // instead of throwing a misleading cleanup error at a connection that is already gone.
    const dying = await connect();
    const s2 = createRowSweeper({ client: dying, tables: ["activity_events"], probe: "A3-dead-session" });
    await s2.capture();
    const pid = Number((await dying.query("select pg_backend_pid()::int pid")).rows[0].pid);
    // A server-side termination makes pg emit an async 'error' on the client. That error is the
    // expected outcome of this check, so it is listened for; the query promise still rejects and is
    // what gets judged below. Without a listener the process would die before any assertion ran.
    dying.on("error", () => {});
    await admin.query("select pg_terminate_backend($1)", [pid]);
    await new Promise((r) => setTimeout(r, 500));
    let deadErr = null;
    try { await s2.sweep(); } catch (e) { deadErr = e.message; }
    check("A3: a terminated session is not misreported as a stuck lock",
      deadErr === null || /session-ended|connection|terminated|closed/i.test(deadErr ?? ""),
      deadErr ?? "sweep recognised the session had ended");
    const afterKill = await admin.query(
      "select pid from pg_locks where locktype='advisory' and classid=$1 and objid=$2", [0x51a2f3, 1]);
    check("A3: once the session dies the database holds no lock for it", afterKill.rows.length === 0,
      afterKill.rows.length ? `holder pid ${afterKill.rows[0].pid}` : "none held");
    await dying.end().catch(() => {});
    await client.end();
  }

  /* ------------------------------------------------------- final state */
  const leftLabelled = await countLabelled(admin);
  const finalEvents = Number((await admin.query("select count(*)::int n from activity_events")).rows[0].n);
  check("no probe's fixture rows survive the overlapping runs",
    leftLabelled === 0 && finalEvents === baselineEvents,
    `labelled rows left=${leftLabelled}; activity_events=${finalEvents} vs baseline ${baselineEvents}`,
  );
} catch (error) {
  console.error("\nISOLATION PROOF ABORTED:", error?.message ?? error);
  failures.push("aborted");
} finally {
  await admin.query("delete from activity_events where payload ? 'isolationProbe'").catch(() => {});
  const left = await countLabelled(admin).catch(() => -1);
  console.log(`\n  cleanup: labelled rows left=${left}`);
  if (left !== 0) failures.push("cleanup left rows");
  await admin.end().catch(() => {});
  console.log(`\n${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
