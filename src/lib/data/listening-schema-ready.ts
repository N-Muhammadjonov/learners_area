import "server-only";
import { assertSchemaRequirements } from "./schema-requirements";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
/** Readiness only, not a swallowed database failure. Legacy routes survive staged migrations. */
export async function listeningSchemaReady(database = db) {
  const result = await database.execute(
    sql`select to_regclass('public.listening_packages') is not null and to_regclass('public.listening_activity_runs') is not null and to_regclass('public.listening_drafts') is not null as ready`,
  );
  if (result.rows[0]?.ready !== true) return false;
  await assertSchemaRequirements("listening", LISTENING_LIBRARY_REQUIREMENTS, database);
  return true;
}

/** The current library SQL also needs additive schema after the original 0028 tables. */
export const LISTENING_LIBRARY_REQUIREMENTS = [
  { table: "listening_tests", column: "program_ref", migration: "0052_listening_mcq_program_days" },
  { table: "listening_activity_runs", column: "speed_rate", migration: "0028_full_listening" },
  { table: "listening_mcq_sessions", column: "stage", migration: "0007_listening_mcq_mastery" },
  { table: "listening_tests", column: "program_ordinal", migration: "0052_listening_mcq_program_days" },
  { table: "listening_questions", column: "content_version_id", migration: "0051_listening_question_revision" },
  { table: "listening_attempts", column: "content_version_id", migration: "0041_content_versions" },
  { table: "listening_tests", column: "source_ref", migration: "0043_authoring_identity" },
] as const;
