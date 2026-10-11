import pg from "pg";
import assert from "node:assert/strict";

/*
 * QA2 RESIDUE GUARD — differential, exception-safe cleanup for tests that mutate the disposable QA
 * database.
 *
 * WHY THIS EXISTS. Eight QA2 test files created fixtures and never removed them: measured against a
 * freshly seeded database they left 1153 rows behind (general-reading-qa2 alone leaked 786 rows across
 * 19 tables, vocabulary-architecture-qa2 281 across 19). The consequence was not tidiness: the residue
 * changed what later tests observed, and retention-db.test.ts failed outright — 0 pass, 6 fail — once
 * the database had been polluted by the files that ran before it.
 *
 * WHY DIFFERENTIAL, NOT TRUNCATE. These tests run against the SAME seeded database as every other QA2
 * test. Truncating would destroy legitimate seed records and manufacture a clean result, so the guard
 * snapshots the primary key of every row that exists BEFORE the test and deletes only rows whose key
 * was not in that snapshot. Seed data is provably untouched: a row that existed before cannot be
 * deleted, whatever the test did to it.
 *
 * WHY NOT THE EXISTING SWEEPER. scripts/lib/fixture-safety.mjs already does this for probes and is
 * mutation-tested, but it requires every declared table to have an `id` column and it acquires its
 * advisory lock with pg_try_advisory_lock, REFUSING when another holder has it. Thirteen tables in this
 * schema have no `id` (composite keys: listening_packages, reading_assessments, user_profile_photos,
 * live_partner_blocks, dictionary_entries and others), and `npm test` runs test FILES IN PARALLEL, so a
 * refusing lock would fail whichever file lost the race. Both properties are correct for a probe and
 * wrong here, so this guard differs in exactly two ways and reuses the sweeper's lock identity so the
 * two still cooperate:
 *
 *   - keys come from each table's real primary key, composite included, read from the catalog rather
 *     than assumed to be `id`;
 *   - the lock is BLOCKING (pg_advisory_lock), so parallel files queue instead of failing.
 *
 * The lock class and object are the sweeper's, deliberately: a test and a probe touching the same
 * database must not sweep concurrently, and one shared identity is what makes that true. A lock is a
 * cooperation protocol, not isolation — it only works because every writer here takes it.
 *
 * DELETION ORDER. Children before parents, derived from the catalog's foreign keys rather than a
 * hand-maintained list, so a table added by a later migration is still swept correctly.
 */

/** The sweeper's lock identity, shared on purpose — see above. */
const LOCK_CLASS = 0x51a2f3;
const LOCK_OBJ = 1;

type TableKey = { table: string; keyColumns: string[] };

export type SweepResult = {
  removed: Record<string, number>;
  residue: string[];
  lockReleased: boolean;
  uncovered: string[];
};

export type ResidueGuard = {
  capture(): Promise<void>;
  sweep(): Promise<SweepResult>;
  end(): Promise<void>;
};

/** Refuse to mutate anything that is not the local disposable QA database. */
function assertDisposable(connectionString: string, probe: string): void {
  const url = new URL(connectionString);
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!localHost || url.pathname !== "/learners_qa2") {
    throw new Error(
      `${probe}: refusing to delete rows from ${url.hostname}${url.pathname} — this guard only runs ` +
      `against a local disposable learners_qa2 database.`,
    );
  }
}

export async function createResidueGuard(probe: string): Promise<ResidueGuard> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error(`${probe}: DATABASE_URL is required`);
  assertDisposable(connectionString, probe);

  const client = new pg.Client({ connectionString });
  await client.connect();
  // A sweep failure must never take the process down before the test's own error is reported.
  client.on("error", () => {});

  let locked = false;
  let captured = false;
  const baseline = new Map<string, Set<string>>();
  let keyMap: TableKey[] = [];
  let order: string[] = [];
  let uncovered: string[] = [];

  /** Serialize a row's key columns into one comparable string. */
  const keyOf = (columns: string[], row: Record<string, unknown>) =>
    columns.map((column) => String(row[column])).join("\u0000");

  async function primaryKeyColumns(table: string): Promise<string[]> {
    const { rows } = await client.query(
      `select kcu.column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name
          and kcu.table_schema = tc.table_schema
         where tc.constraint_type = 'PRIMARY KEY'
           and tc.table_schema = 'public'
           and tc.table_name = $1
         order by kcu.ordinal_position`,
      [table],
    );
    return rows.map((row) => row.column_name as string);
  }

  /** Tables ordered so that a table referencing another is deleted first. */
  async function deletionOrder(tables: string[]): Promise<string[]> {
    const { rows } = await client.query(
      `select tc.table_name as child, ccu.table_name as parent
         from information_schema.table_constraints tc
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name
          and ccu.table_schema = tc.table_schema
         where tc.constraint_type = 'FOREIGN KEY'
           and tc.table_schema = 'public'`,
    );
    const inSet = new Set(tables);
    // parent -> the children that must be cleared before it
    const dependents = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!inSet.has(row.child) || !inSet.has(row.parent) || row.child === row.parent) continue;
      const set = dependents.get(row.parent) ?? new Set<string>();
      set.add(row.child);
      dependents.set(row.parent, set);
    }
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (table: string) => {
      if (visited.has(table)) return;
      if (visiting.has(table)) return; // a cycle: break it rather than hanging
      visiting.add(table);
      for (const child of dependents.get(table) ?? []) visit(child);
      visiting.delete(table);
      visited.add(table);
      sorted.push(table);
    };
    // Visiting parents first pushes their children ahead of them in `sorted`.
    for (const table of tables) if (dependents.has(table)) visit(table);
    for (const table of tables) visit(table);
    return sorted;
  }

  return {
    async capture() {
      if (captured) throw new Error(`${probe}: capture() called twice`);
      // Blocking, unlike the probe sweeper: test files run in parallel and must queue, not fail.
      await client.query("select pg_advisory_lock($1, $2)", [LOCK_CLASS, LOCK_OBJ]);
      locked = true;
      try {
        const { rows } = await client.query(
          `select table_name from information_schema.tables
            where table_schema = 'public' and table_type = 'BASE TABLE'
            order by table_name`,
        );
        // Fail closed: an empty catalog answer means introspection did not work, not that there is
        // nothing to clean. Recording that as "no residue" would be a green cleanup that cleaned nothing.
        if (rows.length === 0) {
          throw new Error(`${probe}: could not introspect the schema — refusing to sweep blind`);
        }
        const tables = rows.map((row) => row.table_name as string);
        keyMap = [];
        uncovered = [];
        for (const table of tables) {
          const keyColumns = await primaryKeyColumns(table);
          if (keyColumns.length === 0) {
            // No primary key means no stable row identity, so residue in that table cannot be
            // attributed. Reported loudly rather than silently skipped.
            uncovered.push(table);
            continue;
          }
          keyMap.push({ table, keyColumns });
        }
        order = await deletionOrder(keyMap.map((entry) => entry.table));
        baseline.clear();
        for (const { table, keyColumns } of keyMap) {
          const { rows: rowRows } = await client.query(
            `select ${keyColumns.map((column) => `"${column}"`).join(", ")} from "${table}"`,
          );
          baseline.set(table, new Set(rowRows.map((row) => keyOf(keyColumns, row))));
        }
        captured = true;
      } catch (error) {
        // A failed capture must not leave the lock held: the session would sit on it and every other
        // writer would queue behind a snapshot that never happened.
        if (locked) {
          const releaseError = await client
            .query("select pg_advisory_unlock($1, $2) as unlocked", [LOCK_CLASS, LOCK_OBJ])
            .then(() => null)
            .catch((releaseCause: unknown) => releaseCause);
          locked = false;
          if (releaseError) {
            throw new Error(
              `${probe}: capture() failed — ${String((error as Error)?.message ?? error)} — AND the ` +
              `isolation lock could not be released: ${String((releaseError as Error)?.message ?? releaseError)}`,
            );
          }
        }
        baseline.clear();
        throw error;
      }
    },

    async sweep(): Promise<SweepResult> {
      if (!captured) throw new Error(`${probe}: sweep() called without a successful capture()`);
      const removed: Record<string, number> = {};
      const residue: string[] = [];
      let releaseError: unknown = null;
      try {
        for (const table of order) {
          const entry = keyMap.find((candidate) => candidate.table === table);
          if (!entry) continue;
          const before = baseline.get(table);
          if (!before) continue;
          const { rows } = await client.query(
            `select ${entry.keyColumns.map((column) => `"${column}"`).join(", ")} from "${table}"`,
          );
          const fresh = rows
            .map((row) => row as Record<string, unknown>)
            .filter((row) => !before.has(keyOf(entry.keyColumns, row)));
          if (fresh.length === 0) continue;
          // Delete by the row's own key, never by a range or a timestamp: only rows that did not exist
          // at capture time can be named here, so seeded rows are unreachable by construction.
          if (entry.keyColumns.length === 1) {
            const column = entry.keyColumns[0]!;
            const values = fresh.map((row) => row[column]);
            /*
             * Cast the COLUMN, not the parameter. `where "id" = any($1::text[])` fails on a uuid or
             * integer key with "operator does not exist: uuid = text", and that failure is what turned
             * a cleanup into a thrown sweep — so the fixture stayed behind AND the file reported an
             * error. Comparing both sides as text is type-agnostic and still exact: primary keys are
             * unique as text exactly when they are unique as values.
             */
            await client.query(`delete from "${table}" where "${column}"::text = any($1::text[])`, [
              values.map((value) => String(value)),
            ]);
          } else {
            for (const row of fresh) {
              const conditions = entry.keyColumns
                .map((column, index) => `"${column}" = $${index + 1}`)
                .join(" and ");
              await client.query(`delete from "${table}" where ${conditions}`,
                entry.keyColumns.map((column) => row[column]));
            }
          }
          removed[table] = (removed[table] ?? 0) + fresh.length;
        }
        // Verify rather than assume: re-read and confirm nothing new is left.
        for (const { table, keyColumns } of keyMap) {
          const before = baseline.get(table);
          if (!before) continue;
          const { rows } = await client.query(
            `select ${keyColumns.map((column) => `"${column}"`).join(", ")} from "${table}"`,
          );
          const left = rows.filter((row) => !before.has(keyOf(keyColumns, row as Record<string, unknown>)));
          if (left.length > 0) residue.push(`${table}: ${left.length} row(s) survived cleanup`);
        }
      } catch (error) {
        // Report the sweep failure and the lock state together; neither may mask the other.
        releaseError = error;
      } finally {
        if (locked) {
          try {
            await client.query("select pg_advisory_unlock($1, $2)", [LOCK_CLASS, LOCK_OBJ]);
            locked = false;
          } catch (error) {
            releaseError = releaseError ?? error;
          }
        }
        captured = false;
      }
      if (releaseError) {
        throw new Error(`${probe}: sweep() failed — ${String((releaseError as Error)?.message ?? releaseError)}`);
      }
      return { removed, residue, lockReleased: !locked, uncovered };
    },

    async end() {
      await client.end().catch(() => {});
    },
  };
}

/**
 * Wire the guard into a test file with two hooks, so cleanup runs even when a test fails or throws.
 * Returns a no-op pair when the QA2 gate is off, because there is then nothing to guard.
 */
export function residueGuardHooks(probe: string): {
  enabled: boolean;
  guard: () => Promise<ResidueGuard>;
} {
  const enabled = process.env.QA2_DATABASE_TESTS === "1";
  let instance: ResidueGuard | null = null;
  return {
    enabled,
    guard: async () => {
      if (!instance) instance = await createResidueGuard(probe);
      return instance;
    },
  };
}

/**
 * Assert a sweep left nothing behind and release the connection. Call from an `after` hook so a leak
 * fails the file loudly instead of being carried into the next one.
 */
export async function finishResidueGuard(probe: string, guard: ResidueGuard): Promise<SweepResult> {
  let result: SweepResult;
  try {
    result = await guard.sweep();
  } finally {
    /*
     * Always close the connection, including when the sweep itself failed. An open pg.Client keeps the
     * event loop alive, so a thrown sweep did not just report an error — it stopped `node --test` from
     * ever exiting, and the run hung instead of finishing. The connection is closed before the
     * assertion below so that a residue failure still terminates the process.
     */
    await guard.end();
  }
  assert.deepEqual(
    result.residue,
    [],
    `${probe}: cleanup left residue — ${result.residue.join("; ")}`,
  );
  if (result.uncovered.length > 0) {
    // Not a failure: a table with no primary key has no stable row identity to diff. Recorded so the
    // gap is visible rather than hidden behind a clean result.
    console.log(`  NOTE ${probe}: ${result.uncovered.length} table(s) have no primary key and cannot be diffed: ${result.uncovered.join(", ")}`);
  }
  const total = Object.values(result.removed).reduce((sum, n) => sum + n, 0);
  if (total > 0) console.log(`  ${probe}: removed ${total} fixture row(s) across ${Object.keys(result.removed).length} table(s)`);
  return result;
}
