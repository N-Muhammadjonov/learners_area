import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export type SchemaRequirement = { table: string; column: string; migration: string };

/** A deployment mismatch is an unavailable service, never an empty catalogue. */
export class SchemaNotReadyError extends Error {
  readonly code = "SCHEMA_NOT_READY";
  constructor(readonly surface: string, readonly missing: readonly SchemaRequirement[], options?: ErrorOptions) {
    super(`Schema unavailable for ${surface}: ${missing.map((item) => `${item.table}.${item.column} (${item.migration})`).join(", ")}`, options);
    this.name = "SchemaNotReadyError";
  }
}

/** Read-only and scoped to public: another tenant/schema must not certify this query. */
export async function assertSchemaRequirements(surface: string, requirements: readonly SchemaRequirement[], database = db): Promise<void> {
  if (requirements.length === 0) return;
  const expected = JSON.stringify(requirements.map(({ table, column, migration }) => ({ table_name: table, column_name: column, migration })));
  const result = await database.execute(sql`
    select expected.table_name, expected.column_name, expected.migration
    from jsonb_to_recordset(${expected}::jsonb) as expected(table_name text, column_name text, migration text)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = expected.table_name
        and actual.column_name = expected.column_name
    )
  `);
  const missing = result.rows.map((row) => ({ table: String(row.table_name), column: String(row.column_name), migration: String(row.migration) }));
  if (missing.length > 0) throw new SchemaNotReadyError(surface, missing);
}
