import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Readiness, not a swallowed failure — the same rule the Listening and General
 * Reading schemas already follow. Migration 0040 adds the canonical ingest
 * ledger; until it is applied, canonical imports report a truthful code that the
 * staff UI can localize instead of surfacing a database error.
 */

let ready = false;

export async function contentImportSchemaReady(database = db): Promise<boolean> {
  if (ready) return true;
  try {
    const result = await database.execute(sql`select to_regclass('public.content_imports') is not null as ready`);
    ready = result.rows[0]?.ready === true;
  } catch {
    ready = false;
  }
  return ready;
}

/** Test seam: lets a QA process re-check after a migration. */
export function resetContentImportReadinessForTests(): void {
  ready = false;
}
