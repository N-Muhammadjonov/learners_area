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
export function createRowSweeper({ client, tables: requestedTables, probe = "probe" }) {
  let tables = requestedTables;
  if (!client) throw new Error("createRowSweeper requires a connected pg client");
  if (!Array.isArray(tables) || tables.length === 0) {
    throw new Error("createRowSweeper requires a non-empty, child-first `tables` list");
  }

  const baseline = new Map();
  let captured = false;
  let swept = false;

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
      console.warn(`  !! ${probe}: sweeper cannot cover: ${unusable.join(", ")}`);
      for (const entry of unusable) {
        const name = entry.split(" ")[0];
        tables = tables.filter((table) => table !== name);
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
      // Validating here rather than only on demand: a probe that forgets to call
      // validateTables() still gets an accurate baseline instead of a raw SQL throw.
      await validateTables();
      for (const table of tables) baseline.set(table, new Set(await idsOf(table)));
      captured = true;
    },

    /** Remove this run's rows and VERIFY. Cleanup that is not checked proves nothing. */
    async sweep() {
      if (!captured) {
        throw new Error(`${probe}: sweep() called without capture() — no baseline, so nothing can be swept safely`);
      }
      swept = true;
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
      return { removed, residue };
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

    /** Put them back. Idempotent, and safe to call when nothing was borrowed. */
    async restore() {
      if (held.length === 0) return 0;
      for (const row of held) {
        const columns = Object.keys(row);
        const placeholders = columns.map((_, index) => `$${index + 1}`);
        await client.query(
          `insert into ${table} (${columns.map((c) => `"${c}"`).join(", ")})
           values (${placeholders.join(", ")}) on conflict (id) do nothing`,
          columns.map((c) => row[c]),
        );
      }
      const count = held.length;
      held.length = 0;
      console.log(`  ${probe}: restored ${count} borrowed ${table} row(s)`);
      return count;
    },
  };
}
