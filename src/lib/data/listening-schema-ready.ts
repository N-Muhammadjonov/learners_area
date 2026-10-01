import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
/** Readiness only, not a swallowed database failure. Legacy routes survive staged migrations. */
export async function listeningSchemaReady(database = db) {
  const result = await database.execute(
    sql`select to_regclass('public.listening_packages') is not null and to_regclass('public.listening_activity_runs') is not null and to_regclass('public.listening_drafts') is not null as ready`,
  );
  return result.rows[0]?.ready === true;
}
