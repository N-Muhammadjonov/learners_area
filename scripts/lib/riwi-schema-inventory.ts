import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export const SCHEMA_OBJECT_QUERIES = {
  schemas: "select nspname as name from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1",
  tables: "select c.relname as name, c.relkind as kind, c.relrowsecurity as rls, pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by 1",
  columns: "select c.relname as table_name, a.attname as name, format_type(a.atttypid,a.atttypmod) as type, a.attnotnull as not_null, a.attidentity as identity, a.attgenerated as generated, pg_get_expr(d.adbin,d.adrelid) as default_expression, coll.collname as collation from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum left join pg_collation coll on coll.oid=a.attcollation where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped order by 1,a.attnum",
  enums: "select t.typname as name, e.enumlabel as label, e.enumsortorder as sort_order from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' order by 1,3",
  constraints: "select c.conrelid::regclass::text as table_name, c.conname as name, c.contype as kind, c.condeferrable as deferrable, c.convalidated as validated, pg_get_constraintdef(c.oid,true) as definition from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' order by 1,2",
  indexes: "select tablename as table_name, indexname as name, indexdef as definition from pg_indexes where schemaname='public' order by 1,2",
  sequences: "select sequencename as name, data_type, start_value, min_value, max_value, increment_by, cycle, last_value from pg_sequences where schemaname='public' order by 1",
  views: "select viewname as name, definition from pg_views where schemaname='public' order by 1",
  materialized_views: "select matviewname as name, definition, ispopulated from pg_matviews where schemaname='public' order by 1",
  functions_procedures: "select p.proname as name, p.prokind as kind, pg_get_function_identity_arguments(p.oid) as arguments, pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') order by 1,3",
  triggers: "select c.relname as table_name, t.tgname as name, pg_get_triggerdef(t.oid,true) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by 1,2",
  rls_policies: "select schemaname, tablename as table_name, policyname as name, permissive, roles, cmd, qual, with_check from pg_policies where schemaname='public' order by 2,3",
  grants: "select table_name, grantee, privilege_type, is_grantable from information_schema.table_privileges where table_schema='public' order by 1,2,3",
  extensions: "select extname as name, extversion as version from pg_extension order by 1",
  environment: "select current_setting('server_version') as engine_version, current_setting('TimeZone') as timezone, datcollate as collation, datctype as character_class from pg_database where datname=current_database()",
} as const;

export type MigrationInput = { path: string; sql: string; sha256: string };
export function canonicalMigrationInputs(root: string): MigrationInput[] {
  const directory = join(root, "drizzle");
  const journal = JSON.parse(readFileSync(join(directory, "meta/_journal.json"), "utf8"));
  const files = readdirSync(directory).filter(p => p.endsWith(".sql"));
  if (files.length !== journal.entries.length) throw new Error("inventory_migration_count_mismatch");
  return journal.entries.map((entry: { idx: number; tag: string }, index: number) => {
    if (entry.idx !== index || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag)) throw new Error("inventory_journal_invalid");
    const path = `drizzle/${entry.tag}.sql`, sql = readFileSync(join(root, path), "utf8");
    return { path, sql, sha256: createHash("sha256").update(sql).digest("hex") };
  });
}

/** No URLs, credentials or external connections. This inventories canonical DDL,
 * not a deployed database or provider capabilities. Empty classes prove absence
 * only in this freshly migrated isolated engine. */
export async function inspectCanonicalSchema(migrations: MigrationInput[]) {
  const client = new PGlite();
  try {
    for (const migration of migrations) {
      if (createHash("sha256").update(migration.sql).digest("hex") !== migration.sha256) throw new Error("inventory_sql_hash_mismatch");
      for (const statement of migration.sql.split("--> statement-breakpoint").filter(s => s.trim())) await client.exec(statement);
    }
    const objects: Record<string, Record<string, unknown>[]> = {};
    for (const [name, query] of Object.entries(SCHEMA_OBJECT_QUERIES)) objects[name] = (await client.query<Record<string, unknown>>(query)).rows;
    const summary = Object.fromEntries(Object.entries(objects).map(([name, rows]) => [name, { count: rows.length, status: rows.length ? "PRESENT_CANONICAL_LOCAL" : "ABSENT_CANONICAL_LOCAL", query: SCHEMA_OBJECT_QUERIES[name as keyof typeof SCHEMA_OBJECT_QUERIES] }]));
    return { engine: "isolated PGlite; canonical migration rehearsal only", deployment: "UNVERIFIED", migrations: migrations.map(({ path, sha256 }) => ({ path, sha256 })), summary, objects };
  } finally { await client.close(); }
}
