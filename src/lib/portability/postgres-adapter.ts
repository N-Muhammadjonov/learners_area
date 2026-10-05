import "server-only";
import { getTableColumns, getTableName } from "drizzle-orm";
import * as schema from "@/db/schema";
import { PORTABILITY_TABLES, type PortableTable } from "./classification";
import type { ImportDestination, ImportTransaction } from "./archive";
import type { PortableObject, PortableRow } from "./types";

type QueryResult = { rows: Record<string, unknown>[] };
type PgClient = { query(text: string, values?: unknown[]): Promise<QueryResult>; release?: () => void };
type PgPool = { connect(): Promise<PgClient> };
type TableMetadata = { sqlName: string; columns: Map<string, string>; primaryKeys: string[] };
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const metadata = new Map<PortableTable, TableMetadata>();
const schemaTables = new Map<string, Parameters<typeof getTableColumns>[0]>();
for (const candidate of Object.values(schema)) {
  if (!candidate || typeof candidate !== "object") continue;
  try { schemaTables.set(getTableName(candidate as Parameters<typeof getTableColumns>[0]), candidate as Parameters<typeof getTableColumns>[0]); } catch { /* enum/index export */ }
}
for (const tableName of Object.keys(PORTABILITY_TABLES) as PortableTable[]) {
  const table = schemaTables.get(tableName);
  if (!table) throw new Error(`portable_schema_table_missing:${tableName}`);
  const columns = getTableColumns(table);
  const mapped = new Map<string, string>(); const primaryKeys: string[] = [];
  for (const [property, column] of Object.entries(columns)) {
    if (!IDENTIFIER.test(column.name)) throw new Error(`portable_column_invalid:${tableName}`);
    mapped.set(property, column.name); if (column.primary) primaryKeys.push(property);
  }
  metadata.set(tableName, { sqlName: tableName, columns: mapped, primaryKeys });
}
function quote(identifier: string) { if (!IDENTIFIER.test(identifier)) throw new Error("portable_identifier_invalid"); return `"${identifier}"`; }
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record.$bytes === "string") return Buffer.from(record.$bytes, "base64");
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decode(item)]));
  }
  return value;
}
function tableMeta(table: PortableTable): TableMetadata { const result = metadata.get(table); if (!result) throw new Error(`portable_table_not_allowed:${table}`); return result; }

/** Fresh-destination PostgreSQL adapter. Dynamic identifiers come only from the closed schema map. */
export function createPostgresImportDestination(pool: PgPool, copyObject?: (object: PortableObject, bytes: Uint8Array) => Promise<void>): ImportDestination {
  const forClient = (client: PgClient): ImportTransaction => ({
    async planRow(table, row) {
      const meta = tableMeta(table);
      if (!meta.primaryKeys.length) return "create";
      const values = meta.primaryKeys.map((key) => row[key]);
      if (values.some((value) => value === undefined || value === null)) return "create";
      const where = meta.primaryKeys.map((key, index) => `${quote(meta.columns.get(key)!)} = $${index + 1}`).join(" and ");
      const result = await client.query(`select 1 as present from ${quote(meta.sqlName)} where ${where} limit 1`, values.map(decode));
      return result.rows.length ? "conflict" : "create";
    },
    async applyRow(table, row: PortableRow) {
      const meta = tableMeta(table); const entries = Object.entries(row).filter(([property]) => meta.columns.has(property));
      if (!entries.length) throw new Error(`portable_row_empty:${table}`);
      const names = entries.map(([property]) => quote(meta.columns.get(property)!)).join(",");
      const parameters = entries.map((_, index) => `$${index + 1}`).join(",");
      await client.query(`insert into ${quote(meta.sqlName)} (${names}) values (${parameters})`, entries.map(([, value]) => decode(value)));
    },
    async copyObject(object, bytes) { if (!copyObject) throw new Error("portable_object_adapter_required"); await copyObject(object, bytes); },
  });
  return {
    async transaction<T>(work: (transaction: ImportTransaction) => Promise<T>) {
      const client = await pool.connect();
      try { await client.query("begin"); const value = await work(forClient(client)); await client.query("commit"); return value; }
      catch (error) { await client.query("rollback"); throw error; }
      finally { client.release?.(); }
    },
  };
}
