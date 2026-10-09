import "server-only";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getTableColumns, getTableName } from "drizzle-orm";
import * as schema from "@/db/schema";
import { PORTABILITY_TABLES, type PortableTable } from "./classification";
import { RIWI_CONVERSATION_OFFLINE_DAYS, RIWI_CONVERSATION_TTL_DAYS } from "@/lib/services/riwi/contracts";
import type { ExportSource, ImportDestination, ImportTransaction } from "./archive";
import type { ExportScope, PortableObject, PortableRow, RowFileManifest } from "./types";

type QueryResult = { rows: Record<string, unknown>[] };
type PgClient = { query(text: string, values?: unknown[]): Promise<QueryResult>; release?: () => void };
type PgPool = { connect(): Promise<PgClient> };
type TableMetadata = { sqlName: string; columns: Map<string, string>; primaryKeys: string[]; dependencies: string[] };
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
  const config = getTableConfig(table as Parameters<typeof getTableConfig>[0]);
  for (const key of config.primaryKeys) {
    for (const column of key.columns) {
      const property = [...mapped].find(([, name]) => name === column.name)?.[0];
      if (property && !primaryKeys.includes(property)) primaryKeys.push(property);
    }
  }
  const dependencies = config.foreignKeys
    .map((key) => getTableName(key.reference().foreignTable)).filter((name) => name !== tableName);
  metadata.set(tableName, { sqlName: tableName, columns: mapped, primaryKeys, dependencies });
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

function orderPostgresTables(tables: readonly RowFileManifest[]): readonly RowFileManifest[] {
  const populated = new Map(tables.filter((table) => table.rowCount !== 0).map((table) => [table.table, table]));
  const ordered: RowFileManifest[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (name: string) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`portable_foreign_key_cycle:${name}`);
    visiting.add(name);
    for (const dependency of tableMeta(name as PortableTable).dependencies) {
      if (populated.has(dependency)) visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(populated.get(name)!);
  };
  for (const name of [...populated.keys()].sort()) visit(name);
  // Empty table files still undergo the archive's checksum verification.
  return [...ordered, ...tables.filter((table) => table.rowCount === 0)];
}

/** Fresh-destination PostgreSQL adapter. Dynamic identifiers come only from the closed schema map. */
export function createPostgresImportDestination(pool: PgPool, copyObject?: (object: PortableObject, bytes: Uint8Array) => Promise<void>): ImportDestination {
  const forClient = (client: PgClient): ImportTransaction => ({
    async planRow(table, row, identityMap) {
      if (identityMap.size) throw new Error("portable_identity_map_unsupported");
      const meta = tableMeta(table);
      if (!meta.primaryKeys.length) return "create";
      const values = meta.primaryKeys.map((key) => row[key]);
      if (values.some((value) => value === undefined || value === null)) return "create";
      const where = meta.primaryKeys.map((key, index) => `${quote(meta.columns.get(key)!)} = $${index + 1}`).join(" and ");
      const result = await client.query(`select 1 as present from ${quote(meta.sqlName)} where ${where} limit 1`, values.map(decode));
      return result.rows.length ? "conflict" : "create";
    },
    async applyRow(table, row: PortableRow, identityMap) {
      if (identityMap.size) throw new Error("portable_identity_map_unsupported");
      const meta = tableMeta(table); const entries = Object.entries(row).filter(([property]) => meta.columns.has(property));
      if (!entries.length) throw new Error(`portable_row_empty:${table}`);
      const names = entries.map(([property]) => quote(meta.columns.get(property)!)).join(",");
      const parameters = entries.map((_, index) => `$${index + 1}`).join(",");
      await client.query(`insert into ${quote(meta.sqlName)} (${names}) values (${parameters})`, entries.map(([, value]) => decode(value)));
    },
    async copyObject(object, bytes) { if (!copyObject) throw new Error("portable_object_adapter_required"); await copyObject(object, bytes); },
  });
  return {
    orderTables: orderPostgresTables,
    async transaction<T>(work: (transaction: ImportTransaction) => Promise<T>) {
      const client = await pool.connect();
      try { await client.query("begin"); const value = await work(forClient(client)); await client.query("commit"); return value; }
      catch (error) { await client.query("rollback").catch(() => {}); throw error; }
      finally { client.release?.(); }
    },
  };
}


/** Export from one read-only, repeatable snapshot; release the connection even
 * when a sink or object inventory fails. Callers still own export authorization
 * and object-store lifecycle checks. No deployment credentials are read here. */
export async function withPostgresExportSource<T>(
  pool: PgPool,
  options: { snapshotAt: Date; objects: (scope: ExportScope) => AsyncIterable<PortableObject> },
  work: (source: ExportSource) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(options.snapshotAt.getTime())) throw new Error("portable_snapshot_invalid");
  const snapshotAt = new Date(options.snapshotAt);
  const offlineCutoff = new Date(snapshotAt.getTime() - RIWI_CONVERSATION_OFFLINE_DAYS * 86_400_000);
  const messageCutoff = new Date(snapshotAt.getTime() - RIWI_CONVERSATION_TTL_DAYS * 86_400_000);
  const client = await pool.connect();
  let cursorSequence = 0;
  let open = true;
  const requireOpen = () => { if (!open) throw new Error("portable_snapshot_closed"); };
  const activeParentSql = `c.deleted_at is null and c.expires_at > $1 and u.last_active_at >= $2`;
  const source: ExportSource = {
    snapshotAt: snapshotAt.toISOString(),
    // RIWI-only/site-only database projections require separate privacy and
    // identity reconciliation; this adapter accepts only full-system backup.
    scope: "full-system",
    async *rows(table, batchSize) {
      requireOpen();
      if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 5000) throw new Error("portable_batch_size_invalid");
      const meta = tableMeta(table);
      const columns = [...meta.columns].map(([property, column]) => `t.${quote(column)} as "${property}"`).join(",");
      let from = `${quote(meta.sqlName)} t`;
      let where = "";
      const values: unknown[] = [];
      if (table === "riwi_conversations") {
        from += " join riwi_conversations c on c.id = t.id join users u on u.id = c.user_id";
        where = ` where ${activeParentSql}`;
        values.push(snapshotAt, offlineCutoff);
      } else if (table === "riwi_conversation_messages") {
        from += " join riwi_conversations c on c.id = t.conversation_id join users u on u.id = c.user_id";
        where = ` where ${activeParentSql} and t.created_at >= $3`;
        values.push(snapshotAt, offlineCutoff, messageCutoff);
      }
      const cursor = quote(`portable_export_${++cursorSequence}`);
      const order = meta.primaryKeys.length
        ? meta.primaryKeys.map((property) => `t.${quote(meta.columns.get(property)!)}`).join(",")
        : "to_jsonb(t)::text";
      await client.query(`declare ${cursor} no scroll cursor for select ${columns} from ${from}${where} order by ${order}`, values);
      try {
        while (true) {
          requireOpen();
          const result = await client.query(`fetch forward ${batchSize} from ${cursor}`);
          if (!result.rows.length) break;
          yield result.rows;
        }
      } finally {
        // An error aborts the PostgreSQL transaction; closing a cursor must not
        // replace the original failure. The outer rollback closes it as well.
        if (open) await client.query(`close ${cursor}`).catch(() => {});
      }
    },
    async *objects(scope) {
      requireOpen();
      for await (const object of options.objects(scope)) { requireOpen(); yield object; }
    },
    async activeConversationIds(ids, at) {
      requireOpen();
      if (at.getTime() !== snapshotAt.getTime()) throw new Error("portable_snapshot_time_mismatch");
      if (ids.length > 5000 || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
        throw new Error("conversation_reference_invalid");
      }
      if (!ids.length) return [];
      const result = await client.query(`select c.id from riwi_conversations c join users u on u.id = c.user_id
        where ${activeParentSql} and c.id = any($3::uuid[])`, [snapshotAt, offlineCutoff, [...ids]]);
      return result.rows.map((row) => String(row.id));
    },
  };
  try {
    await client.query("begin isolation level repeatable read read only");
    const result = await work(source);
    open = false;
    await client.query("commit");
    return result;
  } catch (error) {
    open = false;
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    open = false;
    client.release?.();
  }
}
