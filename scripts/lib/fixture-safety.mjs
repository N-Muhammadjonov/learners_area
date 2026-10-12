/**
 * Safety rails for acceptance probes that WRITE to the database.
 *
 * A probe that inserts a graded attempt to prove a detector works is valuable; the
 * same probe leaving that attempt behind is a fabricated learner score. Three things
 * have to be true and none of them can be left to discipline:
 *
 *   1. the target database must be one we are allowed to mutate;
 *   2. every fixture must be uniquely tagged, so parallel runs cannot collide and a
 *      previous crash cannot be mistaken for this run's residue;
 *   3. cleanup must run even when an assertion throws.
 *
 * Used by any probe that creates rows. Import it rather than re-implementing the rules.
 */

/** Databases a probe may mutate. Anything else must be opted into explicitly. */
const ALLOWED_NAMES = [/^learners_qa\d*$/i, /^learners_area_test$/i, /_test$/i, /^test_/i];
const FORBIDDEN_HINTS = [/prod/i, /production/i, /live/i];

/**
 * Refuse to run destructive fixtures against anything that is not a disposable QA
 * database. Fails closed: an unparseable or unexpected URL is NOT mutable.
 */
export function assertMutableDatabase(connectionString) {
  if (!connectionString) throw new Error("fixture safety: DATABASE_URL is not set; refusing to create fixtures");

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("fixture safety: DATABASE_URL is not parseable; refusing to create fixtures");
  }

  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const host = url.hostname;

  for (const bad of FORBIDDEN_HINTS) {
    if (bad.test(name) || bad.test(host)) {
      throw new Error(`fixture safety: refusing to create fixtures on "${name}" at ${host} (looks like production)`);
    }
  }

  const localHost = ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host);
  const allowedName = ALLOWED_NAMES.some((re) => re.test(name));

  if (localHost && allowedName) return { name, host };

  if (process.env.QA_ALLOW_FIXTURE_MUTATION === "1") {
    console.warn(`  !! fixture safety OVERRIDDEN by QA_ALLOW_FIXTURE_MUTATION for "${name}" at ${host}`);
    return { name, host };
  }

  throw new Error(
    `fixture safety: "${name}" at ${host} is not a recognised disposable QA database. ` +
      `Point DATABASE_URL at learners_qa2, or set QA_ALLOW_FIXTURE_MUTATION=1 if you really mean it.`
  );
}

/**
 * A tag unique to this process run. Fixtures carry it so that cleanup can assert
 * residue for THIS run only, and so two concurrent runs never delete each other's rows.
 */
export function fixtureTag(prefix = "qa") {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${process.pid}-${Date.now().toString(36)}-${rand}`;
}

/**
 * Run `body`, then ALWAYS run `cleanup` — including when `body` throws — and let a
 * cleanup failure FAIL the run.
 *
 * THE BUG THIS FIXES. Cleanup used to be wrapped in its own try/catch that logged and
 * swallowed the error. A probe whose assertions all passed but whose cleanup failed
 * therefore exited 0, leaving fixture rows behind while reporting success. "Zero
 * residue" was being claimed by a function that could not detect residue it had
 * failed to remove. A cleanup failure is an acceptance failure.
 *
 * THE CONTRACT, all four cases:
 *   body ok   + cleanup ok   -> resolve with the body's value
 *   body FAIL + cleanup ok   -> throw the BODY error (what the operator must see)
 *   body ok   + cleanup FAIL -> throw the CLEANUP error (residue was left behind)
 *   body FAIL + cleanup FAIL -> throw AggregateError, BODY error first, both kept
 *
 * WHERE SETUP BELONGS. Everything that mutates must happen INSIDE `body`, not before
 * the call. Creating a row, then creating a second one that throws, then entering the
 * protected scope leaves the first row orphaned, because cleanup never started. Put
 * the inserts in `body`: cleanup then runs even when setup fails half way, and
 * `cleanup` must tolerate being called when nothing, or only part, was created.
 */
export async function withFixtures(body, cleanup) {
  let result;
  let bodyError;
  try {
    result = await body();
  } catch (error) {
    bodyError = error ?? new Error("fixture body threw a falsy value");
  }

  let cleanupError;
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error ?? new Error("fixture cleanup threw a falsy value");
    console.error(`  !! fixture cleanup FAILED: ${cleanupError?.message ?? cleanupError}`);
  }

  if (bodyError && cleanupError) {
    // Both are real and both matter: the body error is the diagnosis, the cleanup
    // error means the database was left dirty. Neither may be dropped, and the body
    // error stays first so the operator reads the cause before the consequence.
    throw new AggregateError(
      [bodyError, cleanupError],
      `fixture body failed AND cleanup failed — residue may remain: ${bodyError?.message ?? bodyError}`,
    );
  }
  if (bodyError) throw bodyError;
  if (cleanupError) throw cleanupError;
  return result;
}

/**
 * A row-level fixture sweeper for probes that create their data over HTTP.
 *
 * withFixtures() is the right tool when a probe knows what it created. Several probes
 * do not: they drive the real API, so rows appear in tables they never name, and there
 * is no single insertion point to tag. For those, the only honest cleanup is
 * differential — snapshot the owned tables BEFORE the first mutation, then remove
 * exactly the ids that appeared and re-query to prove they are gone.
 *
 * Why differential rather than "delete where email like 'qa%'": a tag only covers the
 * rows a probe creates deliberately. The rows the PRODUCT creates in response (the
 * notification, the audit entry, the activity event) carry no tag, and those are the
 * ones that quietly accumulate. An id absent from the baseline and present at the end
 * was created during this run, whoever inserted it.
 *
 * What it will not do: it never touches a row that existed before the run, so a probe
 * cannot destroy another suite's data or the seed.
 *
 * `tables` must be ordered children-before-parents; deletion follows that order so a
 * foreign key never blocks the sweep.
 */
/**
 * A3 — PROBE ISOLATION.
 *
 * A sweeper attributes rows by difference: any id that was not in the baseline it captured is
 * treated as this probe's fixture. That is sound only while nothing else is writing. Two probes
 * overlapping in the same database made the first one delete the second one's fixtures mid-run —
 * corrupting the second probe's results, and then reporting "no residue" while doing it.
 *
 * The smallest correct fix is to serialize the window in which the assumption has to hold. Every
 * probe that creates fixtures creates a sweeper, so the sweeper is the single place a lock can cover
 * all of them: a SESSION-level advisory lock is taken in capture() and held until sweep() finishes.
 * Session scope is what makes it safe to rely on — if a probe is killed, PostgreSQL drops the
 * connection and releases the lock, so one crashed run cannot wedge every later one.
 *
 * A probe that cannot take the lock REFUSES. It does not wait, because silently serializing a suite
 * that was written to run in parallel changes what its timeouts mean; and it does not sweep anyway,
 * because that is the defect being fixed. The refusal names the backend holding the lock so the
 * operator can see which run is still in flight.
 *
 * WHAT THIS DOES AND DOES NOT GUARANTEE — read this before trusting a "no residue" result.
 *
 * The lock is a COOPERATION PROTOCOL, not isolation. It guarantees that two probes which both use a
 * sweeper cannot have overlapping mutation windows. It guarantees nothing at all about a writer that
 * does not participate: such a writer never attempts the lock, so it is never refused, and its rows
 * land inside the difference set exactly like the probe's own.
 *
 * That is not a theoretical gap. scripts/verify-probe-isolation.mjs demonstrates it as its first
 * check, labelled HAZARD: with sweeper A holding the lock, a foreign session inserts one row, and
 * A's sweep() would delete two — its own plus the foreign one — because attribution by difference
 * cannot tell whose row is whose. The check passes by proving the hazard is real, not by preventing
 * it. No advisory lock, lease, or tagging scheme can close it while the rows are unattributable.
 *
 * The only sound isolation is therefore ownership of the database: one disposable database per probe
 * run. Until that exists, the enforceable rule is operational — never run two fixture-writing probes
 * against the same database at the same time, and never point a probe at a database that anything
 * else is writing to. `assertMutableDatabase()` is the guard that keeps that database disposable;
 * the lock is the guard that keeps cooperating probes out of each other's windows. Neither one makes
 * a shared database safe against a stranger.
 */
const SWEEPER_LOCK_CLASS = 0x51a2f3; // "row sweeper"
const SWEEPER_LOCK_OBJ = 1; // one lock for the database, not one per table set: probes overlap on activity_events

export function createRowSweeper({ client, tables: requestedTables, probe = "probe", optionalTables = [] }) {
  let tables = requestedTables;
  if (!client) throw new Error("createRowSweeper requires a connected pg client");
  if (!Array.isArray(tables) || tables.length === 0) {
    throw new Error("createRowSweeper requires a non-empty, child-first `tables` list");
  }

  const baseline = new Map();
  let captured = false;
  let swept = false;
  let lockHeld = false;

  /** Which backend holds the lock, so a refusal can name the run still in flight. */
  async function lockHolderPid() {
    const { rows } = await client.query(
      `select pid from pg_locks
        where locktype = 'advisory' and classid = $1 and objid = $2 and granted
        limit 1`,
      [SWEEPER_LOCK_CLASS, SWEEPER_LOCK_OBJ],
    ).catch(() => ({ rows: [] }));
    return rows[0]?.pid ?? null;
  }

  async function acquireIsolation() {
    const { rows } = await client.query("select pg_try_advisory_lock($1, $2) as ok", [
      SWEEPER_LOCK_CLASS, SWEEPER_LOCK_OBJ,
    ]);
    if (!rows[0]?.ok) {
      const holder = await lockHolderPid();
      throw new Error(
        `${probe}: another probe holds the fixture-isolation lock (backend pid ${holder ?? "unknown"}) — ` +
        `refusing to run concurrently, because rows that run creates would be attributed to this one and deleted. ` +
        `Wait for it to finish, or point this probe at its own disposable database.`,
      );
    }
    lockHeld = true;
  }

  /** Ownership is verified, not assumed: is the lock still granted to THIS backend? */
  async function isolationStillHeld() {
    const { rows } = await client.query(
      `select count(*)::int n from pg_locks
        where locktype = 'advisory' and classid = $1 and objid = $2
          and pid = pg_backend_pid() and granted`,
      [SWEEPER_LOCK_CLASS, SWEEPER_LOCK_OBJ],
    );
    return Number(rows[0]?.n ?? 0) === 1;
  }

  /*
   * A3. Release is verified, not assumed. This used to swallow every error from the unlock call, so
   * a sweeper could report a clean run while still holding the lock — and "cleanup succeeded" would
   * then be a claim about the rows only, with the next probe silently blocked. Two outcomes are
   * legitimate and one is not:
   *
   *   - the unlock returns true: we held it and no longer do;
   *   - the connection is gone: a closed session cannot hold a session-scoped lock, so the lock is
   *     released by definition, and saying so is accurate rather than optimistic;
   *   - the unlock fails or returns false while the session is alive: the lock may still be held, and
   *     that is reported as a failure instead of being hidden.
   */
  async function releaseIsolation() {
    if (!lockHeld) return { released: true, how: "not-held" };
    lockHeld = false;
    try {
      const { rows } = await client.query("select pg_advisory_unlock($1, $2) as unlocked", [
        SWEEPER_LOCK_CLASS, SWEEPER_LOCK_OBJ,
      ]);
      if (rows[0]?.unlocked === true) return { released: true, how: "unlocked" };
      // false means this session did not hold it — already released, or taken over by a reconnect.
      // Confirm against pg_locks rather than trusting the boolean alone.
      if (!(await isolationStillHeld())) return { released: true, how: "already-released" };
      throw new Error("pg_advisory_unlock returned false but pg_locks still grants it to this backend");
    } catch (error) {
      // A dead connection cannot hold a session-scoped lock. Anything else is a real failure.
      if (/connection|terminated|closed|ECONNRESET|EPIPE/i.test(String(error?.message ?? error))) {
        return { released: true, how: "session-ended" };
      }
      throw new Error(`${probe}: could not release the fixture-isolation lock: ${error?.message ?? error}`);
    }
  }

  async function idsOf(table) {
    const { rows } = await client.query(`select id from ${table}`);
    return rows.map((row) => row.id);
  }

  /**
   * Check the table list against the real schema BEFORE the first mutation.
   *
   * A sweeper that is handed a table which does not exist — or which has no `id` column —
   * throws a raw SQL error from inside `capture()`, which is easy to misread as a database
   * outage. Worse, the natural "fix" is to swallow it, and then the sweeper quietly stops
   * covering the tables that were mistyped. Reporting the exact unusable names up front makes
   * the mistake obvious and keeps the sweep honest about what it can and cannot reach.
   *
   * Returns the names that had to be dropped; the caller decides whether that is fatal.
   */
  async function validateTables() {
    const { rows } = await client.query(`
      select table_name,
             exists (
               select 1 from information_schema.columns c
               where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'id'
             ) as has_id
      from information_schema.tables t
      where t.table_schema = 'public'
    `);
    // FAIL CLOSED. An empty result here does not mean "every table is missing" — it means the
    // introspection itself did not answer (a role without information_schema access, a wrong
    // search_path, a driver that swallowed the statement). Treating that as "no tables to cover"
    // would drop the whole list, sweep nothing, and report zero residue: a green cleanup that
    // cleaned nothing. "I could not tell" must never be recorded as "there was nothing to do".
    if (rows.length === 0) {
      throw new Error(`${probe}: could not introspect the schema (information_schema returned no tables) — refusing to sweep blind`);
    }
    const have = new Map(rows.map((row) => [row.table_name, row.has_id]));
    const unusable = [];
    for (const table of tables) {
      if (!have.has(table)) unusable.push(`${table} (no such table)`);
      else if (!have.get(table)) unusable.push(`${table} (no "id" column)`);
    }
    if (unusable.length) {
      /*
       * A1. This used to warn and drop the unusable names, then carry on. That is the unsafe
       * direction: the caller asked for those tables to be cleaned, and a sweep that quietly covers
       * fewer tables than requested still reports "residue: none" — so a probe could leave rows
       * behind in a table it believed was covered, and the run would look clean. Coverage that was
       * asked for and not delivered is a failure, not a warning.
       *
       * A table may legitimately be absent — an optional feature table, or one that only exists
       * after a later migration — but that is the CALLER's claim to make, by naming it in
       * `optionalTables` where the reason is written down. Anything not declared is fatal, and it is
       * fatal here, before the first mutation, so nothing is written that cannot be cleaned up.
       */
      // A table the caller declared optional is dropped from coverage here, loudly, so the run
      // states what it is not cleaning. Everything else is reported and left for capture() to
      // enforce: this function answers a question, it does not decide whether the run may proceed.
      const declared = unusable.filter((entry) => optionalTables.includes(entry.split(" ")[0]));
      for (const entry of declared) {
        console.warn(`  !! ${probe}: optional table not swept (declared by the caller): ${entry}`);
        tables = tables.filter((table) => table !== entry.split(" ")[0]);
      }
    }
    return unusable;
  }

  return {
    get swept() {
      return swept;
    },

    validateTables,

    /** Must be called before the first mutation; a later baseline would adopt fixtures as pre-existing. */
    async capture() {
      // Lock first: a baseline taken outside isolation could adopt rows another probe is about to
      // delete, and would then attribute that probe's next inserts to this run.
      await acquireIsolation();
      /*
       * A2. Everything after the lock can throw — validateTables() deliberately throws when the
       * schema cannot be introspected or when a requested table cannot be swept, and any SELECT can
       * fail on a dropped connection. If it did, capture() exited with the lock held and
       * `captured` still false, so sweep() refused with "called without capture" and
       * releaseIsolation() was never reached. The session then sat on the lock: every later probe
       * sharing that connection was refused, and a caller that caught the error and kept going held
       * it for the rest of the process. A failed capture must leave no lock behind.
       */
      try {
        // Validating here rather than only on demand: a probe that forgets to call
        // validateTables() still gets an accurate baseline instead of a raw SQL throw.
        const unusable = await validateTables();
        // A1. Enforced at the mutation gate, before a single baseline read: a table the caller asked
        // to have cleaned and that cannot be cleaned is a failure, not a warning to carry on from.
        const undeclared = unusable.filter((entry) => !optionalTables.includes(entry.split(" ")[0]));
        if (undeclared.length) {
          throw new Error(
            `${probe}: refusing to mutate — the sweeper cannot cover ${undeclared.join(", ")}. ` +
            `Fix the table name, or declare it in optionalTables with the reason, so that cleanup ` +
            `coverage is a stated contract rather than a silent reduction.`,
          );
        }
        for (const table of tables) baseline.set(table, new Set(await idsOf(table)));
        captured = true;
      } catch (error) {
        // Give the lock back, but never let the release hide the cause. A caller that sees only
        // "could not release the lock" would go looking in the wrong place; a caller that sees only
        // the original error would not know the session is still holding the lock. Both matter.
        let releaseError = null;
        try { await releaseIsolation(); } catch (e) { releaseError = e; }
        baseline.clear();
        if (releaseError) {
          throw new Error(
            `${probe}: capture() failed — ${error?.message ?? error} — AND the isolation lock could ` +
            `not be released: ${releaseError?.message ?? releaseError}. This session may still hold it.`,
          );
        }
        throw error;
      }
    },

    /** Remove this run's rows and VERIFY. Cleanup that is not checked proves nothing. */
    async sweep() {
      if (!captured) {
        throw new Error(`${probe}: sweep() called without capture() — no baseline, so nothing can be swept safely`);
      }
      if (!(await isolationStillHeld())) {
        // Without the lock the difference set is not attributable to this run, and deleting it
        // would destroy another probe's fixtures while reporting a clean sweep.
        throw new Error(
          `${probe}: this session no longer holds the fixture-isolation lock — refusing to sweep rows that cannot be attributed to this run`,
        );
      }
      swept = true;
      try {
        const removed = [];
        for (const table of tables) {
          const before = baseline.get(table) ?? new Set();
          const created = (await idsOf(table)).filter((id) => !before.has(id));
          if (created.length === 0) continue;
          removed.push(`${table}: ${created.length}`);
          await client.query(`delete from ${table} where id = any($1)`, [created]);
        }
        const residue = [];
        for (const table of tables) {
          const before = baseline.get(table) ?? new Set();
          const remaining = (await idsOf(table)).filter((id) => !before.has(id));
          if (remaining.length) residue.push(`${table}: ${remaining.length}`);
        }
        // A3: a release failure is a cleanup failure. It must not be masked by a successful delete,
        // and it must not be reported as though the run were clean.
        const release = await releaseIsolation();
        if (!release.released) {
          throw new Error(`${probe}: rows were removed but the isolation lock was not released (${release.how})`);
        }
        return { removed, residue, lockReleased: release.how };
      } catch (error) {
        // The delete path failed: still give the lock back, then let the original error propagate so
        // the caller sees the real cause rather than a cleanup message. A release failure is
        // reported alongside it rather than swallowing either one.
        let releaseError = null;
        try { await releaseIsolation(); } catch (e) { releaseError = e; }
        if (releaseError) {
          throw new Error(
            `${probe}: sweep() failed — ${error?.message ?? error} — AND the isolation lock could ` +
            `not be released: ${releaseError?.message ?? releaseError}. This session may still hold it.`,
          );
        }
        throw error;
      }
    },
  };
}

/**
 * Install the sweeper on every exit path a probe actually takes.
 *
 * A tail-of-script sweep covers the happy path only. These probes also die on a throw,
 * and most of them end with process.exit(), which does NOT run `beforeExit`. Residue is
 * an acceptance failure, so a cleanup failure or any surviving row sets a non-zero exit
 * code even when every assertion passed.
 *
 * Returns `finalSweep(reason)`, which is idempotent: call it on the normal path too.
 */
export function installSweepHandlers(sweeper, { probe = "probe", onDone } = {}) {
  let done = false;

  async function finalSweep(reason) {
    if (done || sweeper.swept) return;
    done = true;
    try {
      const { removed, residue } = await sweeper.sweep();
      if (removed.length) console.log(`\n  fixture sweep (${reason}) removed — ${removed.join(", ")}`);
      if (residue.length) {
        console.error(`  !! ${probe}: fixture residue remains — ${residue.join(", ")}`);
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(`  !! ${probe}: fixture sweep FAILED (${reason}): ${error?.message ?? error}`);
      process.exitCode = 1;
    }
    if (onDone) await onDone();
  }

  process.on("beforeExit", () => void finalSweep("beforeExit"));
  for (const fatal of ["uncaughtException", "unhandledRejection"]) {
    process.on(fatal, async (error) => {
      console.error(`  !! ${probe}: ${fatal} — ${error?.message ?? error}`);
      await finalSweep(fatal);
      process.exit(1);
    });
  }
  return finalSweep;
}

/**
 * Borrow rows a probe needs to clear, and give them back.
 *
 * Several probes delete pre-existing rows as SETUP — "clear this student's progress so
 * the state machine can be walked from the start". Those rows are seed data, not
 * fixtures. Deleting them makes the probe net-destructive: the database ends each run
 * poorer than it started, and the loss is invisible because a differential sweep only
 * looks for rows that APPEARED.
 *
 * A probe may borrow state. It must put it back, with the original ids, so anything
 * referencing those rows still resolves.
 */
export function createRowBorrower({ client, table, probe = "probe" }) {
  if (!client) throw new Error("createRowBorrower requires a connected pg client");
  if (!table) throw new Error("createRowBorrower requires a table");
  const held = [];

  return {
    /** Save the rows matching `where` before the probe deletes them. Returns the count. */
    async borrow(where, params = []) {
      const { rows } = await client.query(`select * from ${table} where ${where}`, params);
      held.push(...rows);
      return rows.length;
    },

    /**
     * Put them back, and PROVE they came back.
     *
     * A4. This used to be `on conflict (id) do nothing` followed by a count of the rows it had
     * tried to write. Both halves were wrong in the same direction: if a row with that id already
     * existed carrying DIFFERENT values — a partial delete, a trigger that re-inserted a default,
     * another probe recreating the id — the insert was skipped and restore() still announced
     * "restored N borrowed rows". A zero row-count delta then hid a row whose content had been
     * quietly changed, which is a destructive change to pre-existing data reported as a clean run.
     *
     * So: upsert every column back to the borrowed value, then re-read the rows and compare them
     * column by column. The count returned is the number VERIFIED, and a mismatch throws rather
     * than being logged, because a borrower that cannot put data back exactly as it found it has
     * damaged something that was not its to change.
     */
    async restore() {
      if (held.length === 0) return 0;
      for (const row of held) {
        const columns = Object.keys(row);
        const placeholders = columns.map((_, index) => `$${index + 1}`);
        const others = columns.filter((column) => column !== "id");
        // A table whose only column is its key has nothing to update, and `do update set` with an
        // empty list is a syntax error rather than a no-op.
        const conflict = others.length
          ? `do update set ${others.map((column) => `"${column}" = excluded."${column}"`).join(", ")}`
          : "do nothing";
        await client.query(
          `insert into ${table} (${columns.map((c) => `"${c}"`).join(", ")})
           values (${placeholders.join(", ")}) on conflict (id) ${conflict}`,
          columns.map((c) => row[c]),
        );
      }

      const ids = held.map((row) => row.id);
      const { rows } = await client.query(`select * from ${table} where id = any($1)`, [ids]);
      const found = new Map(rows.map((row) => [row.id, row]));
      const format = (value) =>
        value === null || value === undefined ? String(value)
        : value instanceof Date ? value.toISOString()
        : typeof value === "object" ? JSON.stringify(value)
        : String(value);
      const mismatched = [];
      for (const row of held) {
        const back = found.get(row.id);
        if (!back) { mismatched.push(`${row.id}: row is missing after restore`); continue; }
        for (const column of Object.keys(row)) {
          if (format(back[column]) !== format(row[column])) {
            mismatched.push(`${row.id}.${column}: borrowed ${format(row[column])}, found ${format(back[column])}`);
          }
        }
      }
      if (mismatched.length) {
        // held is deliberately NOT cleared: the caller may retry, and the evidence must survive.
        throw new Error(
          `${probe}: restore did not put ${table} back exactly as borrowed — ${mismatched.join("; ")}`,
        );
      }
      const count = held.length;
      held.length = 0;
      console.log(`  ${probe}: restored and verified ${count} borrowed ${table} row(s)`);
      return count;
    },
  };
}
