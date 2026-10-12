import type { db } from "@/db/client";

/**
 * Dry run: the real importer runs inside a transaction that is ALWAYS rolled
 * back, so every query, constraint, unique index and foreign key participates.
 * A dry run reports what would be created or updated — it can never publish and
 * can never mutate canonical data.
 *
 * Reading already proved this pattern (`/api/admin/reading/import`); this is the
 * shared version so Listening, Reading and every later module behave identically.
 */

export type ImportTransaction = Pick<typeof db, "select" | "insert" | "update" | "delete" | "query" | "execute">;
export type TransactionalDatabase = Pick<typeof db, "transaction">;

class DryRunRollback<T> extends Error {
  constructor(readonly outcome: T) {
    super("dry_run_rollback");
    this.name = "DryRunRollback";
  }
}

export async function runWithDryRun<T>(
  database: TransactionalDatabase,
  dryRun: boolean,
  work: (tx: ImportTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await database.transaction(async (tx) => {
      const outcome = await work(tx as unknown as ImportTransaction);
      if (dryRun) throw new DryRunRollback(outcome);
      return outcome;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.outcome as T;
    throw error;
  }
}

/** True when the error is the internal rollback signal (never surfaced to users). */
export function isDryRunRollback(error: unknown): boolean {
  return error instanceof DryRunRollback;
}
