import "server-only";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { getTableColumns, getTableName } from "drizzle-orm";
import * as schema from "@/db/schema";
import { PORTABILITY_TABLES, tablesForScope, type PortableTable } from "./classification";
import { RIWI_CONVERSATION_OFFLINE_DAYS, RIWI_CONVERSATION_TTL_DAYS } from "@/lib/services/riwi/contracts";
import type { ExportSource, ImportDestination, ImportTransaction } from "./archive";
import type { ExportScope, PortableObject, PortableRow, RowFileManifest } from "./types";
import { stableJson } from "./archive";

type QueryResult = { rows: Record<string, unknown>[] };
type PgClient = { query(text: string, values?: unknown[]): Promise<QueryResult>; release?: (error?: Error | boolean) => void };
export type PgPool = { connect(): Promise<PgClient> };
type ForeignReference = { table: PortableTable; fields: string[]; targetFields: string[]; nullableFields: string[]; deferred: boolean };
type UniqueTuple = { fields: string[]; nullsNotDistinct: boolean; predicate?: { sql: string; params: unknown[] } };
type TableMetadata = { jsonColumns: Set<string>; sqlName: string; columns: Map<string, string>; defaults: Record<string, unknown>; uniqueTuples: UniqueTuple[]; primaryKeys: string[]; dependencies: string[]; actorFields: string[]; references: ForeignReference[] };
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
  const defaults = Object.fromEntries(Object.entries(columns).filter(([, column]) => ["string", "number", "boolean"].includes(typeof column.default)).map(([field, column]) => [field, column.default]));
  const uniqueTuples: UniqueTuple[] = Object.entries(columns).filter(([, column]) => column.isUnique).map(([field, column]) => ({ fields: [field], nullsNotDistinct: column.uniqueType === "not distinct" }));
  const propertyFor = (name: string) => [...mapped].find(([, column]) => column === name)?.[0];
  for (const constraint of config.uniqueConstraints) {
    uniqueTuples.push({ fields: constraint.columns.map(column => propertyFor(column.name)!), nullsNotDistinct: constraint.nullsNotDistinct });
  }
  for (const index of config.indexes.filter(index => index.config.unique)) {
    const fields = index.config.columns.map(column => "name" in column && column.name ? propertyFor(column.name) : undefined);
    // Never silently drop a future expression index from dry-run validation.
    if (fields.some(field => !field)) throw new Error(`portable_unique_expression_unsupported:${tableName}`);
    uniqueTuples.push({ fields: fields as string[], nullsNotDistinct: false,
      ...(index.config.where ? { predicate: new PgDialect().sqlToQuery(index.config.where) } : {}) });
  }
  for (const key of config.primaryKeys) {
    for (const column of key.columns) {
      const property = [...mapped].find(([, name]) => name === column.name)?.[0];
      if (property && !primaryKeys.includes(property)) primaryKeys.push(property);
    }
  }
  const dependencies = config.foreignKeys
    .map((key) => getTableName(key.reference().foreignTable)).filter((name) => name !== tableName);
  const actorFields = config.foreignKeys.flatMap(key => {
    const reference = key.reference();
    return getTableName(reference.foreignTable) === "users"
      ? reference.columns.map(column => [...mapped].find(([, name]) => name === column.name)![0]) : [];
  });
  const references = config.foreignKeys.map(key => {
    const ref = key.reference(); const targetColumns = getTableColumns(ref.foreignTable);
    return { table: getTableName(ref.foreignTable) as PortableTable,
      fields: ref.columns.map(column => [...mapped].find(([, name]) => name === column.name)![0]),
      targetFields: ref.foreignColumns.map(column => Object.entries(targetColumns).find(([, c]) => c.name === column.name)![0]),
      nullableFields: ref.columns.filter(column => !column.notNull).map(column => [...mapped].find(([, name]) => name === column.name)![0]), deferred: false };
  });
  // node-postgres turns JS arrays into Postgres array literals, which json/jsonb reject: send those as JSON text.
  const jsonColumns = new Set(Object.entries(columns).filter(([, column]) => column.columnType === "PgJsonb" || column.columnType === "PgJson").map(([property]) => property));
  metadata.set(tableName, { jsonColumns, sqlName: tableName, columns: mapped, defaults, uniqueTuples, primaryKeys, dependencies, actorFields, references });
}
function reaches(from: PortableTable, to: PortableTable, seen = new Set<string>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return metadata.get(from)?.references.some(ref => reaches(ref.table, to, seen)) ?? false;
}
for (const [table, meta] of metadata) {
  for (const ref of meta.references) ref.deferred = ref.nullableFields.length > 0 && reaches(ref.table, table);
  meta.dependencies = meta.references.filter(ref => !ref.deferred).map(ref => ref.table);
}
const incoming = new Map<PortableTable, string[][]>();
for (const meta of metadata.values()) for (const ref of meta.references) {
  const tuples = incoming.get(ref.table) ?? [];
  if (!tuples.some(fields => stableJson(fields) === stableJson(ref.targetFields))) tuples.push(ref.targetFields);
  incoming.set(ref.table, tuples);
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
export function createPostgresImportDestination(pool: PgPool, copyObject?: (object: PortableObject, bytes: Uint8Array) => Promise<void>, authorization?: { ownerId: string; dryRun: boolean; scope: ExportScope; identityMap?: ReadonlyMap<string, string> }): ImportDestination {
  // Existing bootstrap credentials stay authoritative. Extra owners are allowed
  // only as explicit mapping targets, checked against active persisted owners.
  const retainedOwnerIds = new Set(authorization ? [authorization.ownerId.toLowerCase(), ...[...authorization.identityMap?.values() ?? []].map(id => id.toLowerCase())] : []);
  const forClient = (client: PgClient, usedIdentities: Set<string>): ImportTransaction => {
    const seen = new Set<string>();
    const uniqueSeen = new Set<string>();
    const parents = new Set<string>();
    const references: Array<{ ref: ForeignReference; values: unknown[] }> = [];
    const deferred: Array<{ table: PortableTable; keys: unknown[]; links: Record<string, unknown> }> = [];
    const referenceKey = (table: PortableTable, fields: string[], values: unknown[]) => `${table}:${stableJson(fields)}:${stableJson(values)}`;
    const checkedActors = new Set<string>();
    const project = async (table: PortableTable, row: PortableRow, identityMap: ReadonlyMap<string, string>) => {
      if (authorization?.scope !== "riwi") {
        // A/C reconcile explicit pre-provisioned owners. Each mapped source
        // must itself contain an active owner row; a foreign-key claim alone
        // cannot prove the source identity's authority.
        if (!identityMap.size) return row;
        if (!authorization) throw new Error("portable_identity_map_unsupported");
        if ([...identityMap.values()].some(id => !retainedOwnerIds.has(id.toLowerCase()))) throw new Error("portable_bootstrap_owner_mapping_required");
        const mapped = { ...row };
        if (table === "users" && typeof row.id === "string") {
          const sourceId = row.id.toLowerCase();
          const target = identityMap.get(sourceId);
          if (target) {
            if (row.role !== "owner" || row.accountStatus !== "active") throw new Error("portable_identity_source_owner_required");
            mapped.id = target;
            usedIdentities.add(sourceId);
          }
        }
        for (const field of tableMeta(table).actorFields) {
          if (typeof mapped[field] === "string") mapped[field] = identityMap.get((mapped[field] as string).toLowerCase()) ?? mapped[field];
        }
        return mapped;
      }
      if (!tablesForScope("riwi").includes(table)) throw new Error("portable_table_scope_mismatch");
      if (table === "riwi_knowledge_sources" && (row.scope !== "global" && row.scope !== "role" || row.scopeUserId != null)) throw new Error("portable_riwi_private_source");
      const mapped = { ...row };
      for (const field of tableMeta(table).actorFields) {
        if (mapped[field] == null) continue;
        if (typeof mapped[field] !== "string") throw new Error("portable_identity_reference_invalid");
        const sourceId = (mapped[field] as string).toLowerCase();
        const target = identityMap.get(sourceId);
        if (!target) throw new Error("portable_identity_mapping_required");
        usedIdentities.add(sourceId);
        if (!checkedActors.has(target)) {
          const actor = await client.query("select id from users where id=$1 and role='owner' and account_status='active' for share", [target]);
          if (!actor.rows.length) throw new Error("portable_identity_target_owner_required");
          checkedActors.add(target);
        }
        mapped[field] = target;
      }
      // Source approvals do not authorize execution on a different site.
      if (table === "riwi_knowledge_sources") {
        if (mapped.state === "active" || mapped.state === "approved") mapped.state = "candidate";
        for (const field of ["approvedAt", "activatedAt", "reviewedByUserId", "regressionFixtureId", "regressionEvidenceHash", "regressionPassedAt"]) mapped[field] = null;
      } else if (table === "riwi_assessment_policies") {
        mapped.activeVersion = null;
      } else if (table === "riwi_assessment_policy_versions") {
        if (mapped.state === "approved") mapped.state = "candidate";
        for (const field of ["approvedAt", "reviewedByUserId", "regressionFixtureId", "regressionEvidenceHash", "regressionPassedAt"]) mapped[field] = null;
      } else if (table === "riwi_security_signals") {
        if (mapped.state === "approved_regression") mapped.state = "candidate";
        for (const field of ["reviewedAt", "reviewedByUserId", "regressionFixtureId", "regressionEvidenceHash"]) mapped[field] = null;
      } else if (table === "riwi_knowledge_conflicts") {
        if (mapped.state === "accepted" || mapped.state === "resolved") mapped.state = "open";
        for (const field of ["resolvedAt", "resolvedByUserId", "resolutionNote"]) mapped[field] = null;
      }
      return mapped;
    };
    return {
    async planRow(table, row, identityMap) {
      const checked = tableMeta(table);
      if (!row || typeof row !== "object" || Array.isArray(row) || !Object.keys(row).length || Object.keys(row).some(key => !checked.columns.has(key))) throw new Error("portable_row_fields_invalid");
      row = await project(table, row, identityMap);
      const meta = tableMeta(table);
      if (!meta.primaryKeys.length) return "create";
      // Let PostgreSQL normalize UUIDs, numbers, timestamps and partial-index
      // predicates without inserting anything. Archive spelling is not SQL
      // identity, and dry-run must detect secondary/composite unique conflicts.
      const effective = { ...meta.defaults, ...row };
      const parameters: unknown[] = [JSON.stringify(Object.fromEntries(Object.entries(effective).map(([field, value]) => [meta.columns.get(field)!, decode(value)])))];
      const predicates = meta.uniqueTuples.map((tuple, i) => {
        if (!tuple.predicate) return `true as "eligible_${i}"`;
        const offset = parameters.length;
        const sql = tuple.predicate.sql.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + offset}`);
        parameters.push(...tuple.predicate.params);
        return `(${sql}) is true as "eligible_${i}"`;
      });
      const normalized = (await client.query(`select to_jsonb(${quote(table)}) as candidate${predicates.length ? "," + predicates.join(",") : ""} from jsonb_populate_record(null::${quote(table)},$1::jsonb) as ${quote(table)}`, parameters)).rows[0];
      if (!normalized?.candidate || typeof normalized.candidate !== "object") throw new Error("portable_row_normalization_failed");
      const candidate = normalized.candidate as Record<string, unknown>;
      row = Object.fromEntries(Object.keys(row).map(field => [field, candidate[meta.columns.get(field)!]]));
      const values = meta.primaryKeys.map((key) => row[key]);
      if (values.some((value) => value === undefined || value === null)) throw new Error("portable_primary_key_required");
      const identity = `${table}:${stableJson(values)}`;
      if (seen.has(identity)) return "conflict";
      seen.add(identity);
      for (const fields of incoming.get(table) ?? []) {
        const values = fields.map(field => row[field]);
        if (values.every(value => value != null)) parents.add(referenceKey(table, fields, values));
      }
      for (const ref of meta.references) {
        const values = ref.fields.map(field => row[field]);
        // PostgreSQL MATCH SIMPLE: any NULL releases this FK check.
        if (values.every(value => value != null)) references.push({ ref, values });
      }
      if (authorization && table === "users" && row.role === "owner") {
        if (typeof row.id !== "string" || !retainedOwnerIds.has(row.id.toLowerCase())) throw new Error("portable_owner_identity_reconciliation_required");
        return "skip";
      }
      const comparisons = [meta.primaryKeys.map((key, index) => `${quote(meta.columns.get(key)!)} = $${index + 1}`).join(" and ")];
      const comparedValues = values.map(decode);
      for (const [index, tuple] of meta.uniqueTuples.entries()) {
        const tupleValues = tuple.fields.map(field => candidate[meta.columns.get(field)!]);
        if (!normalized[`eligible_${index}`] || !tuple.nullsNotDistinct && tupleValues.some(value => value == null)) continue;
        const identity = `${table}:${index}:${stableJson(tupleValues)}`;
        if (uniqueSeen.has(identity)) return "conflict";
        uniqueSeen.add(identity);
        let comparison = tuple.fields.map((field, i) => `${quote(meta.columns.get(field)!)} ${tuple.nullsNotDistinct ? "is not distinct from" : "="} $${comparedValues.length + i + 1}`).join(" and ");
        comparedValues.push(...tupleValues.map(decode));
        if (tuple.predicate) {
          const offset = comparedValues.length;
          comparison += ` and (${tuple.predicate.sql.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + offset}`)})`;
          comparedValues.push(...tuple.predicate.params);
        }
        comparisons.push(comparison);
      }
      const result = await client.query(`select 1 as present from ${quote(meta.sqlName)} where ${comparisons.map(comparison => `(${comparison})`).join(" or ")} limit 1`, comparedValues);
      return result.rows.length ? "conflict" : "create";
    },
    async applyRow(table, row: PortableRow, identityMap) {
      row = await project(table, row, identityMap);
      const meta = tableMeta(table);
      if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(key => !meta.columns.has(key))) throw new Error("portable_row_fields_invalid");
      const staged = { ...row }; const links: Record<string, unknown> = {};
      for (const ref of meta.references) if (ref.deferred && ref.fields.every(field => row[field] != null)) {
        for (const field of ref.nullableFields) { links[field] = row[field]; staged[field] = null; }
      }
      if (Object.keys(links).length) deferred.push({ table, keys: meta.primaryKeys.map(key => row[key]), links });
      const entries = Object.entries(staged);
      if (!entries.length) throw new Error(`portable_row_empty:${table}`);
      const names = entries.map(([property]) => quote(meta.columns.get(property)!)).join(",");
      const parameters = entries.map((_, index) => `$${index + 1}`).join(",");
      await client.query(`insert into ${quote(meta.sqlName)} (${names}) values (${parameters})`, entries.map(([property, value]) => meta.jsonColumns.has(property) && value !== null && value !== undefined ? JSON.stringify(decode(value)) : decode(value)));
    },
    async copyObject(object, bytes) { if (!copyObject) throw new Error("portable_object_adapter_required"); await copyObject(object, bytes); },
    async finalize(dryRun) {
      for (const { ref, values } of references) {
        if (parents.has(referenceKey(ref.table, ref.targetFields, values))) continue;
        const target = tableMeta(ref.table);
        const where = ref.targetFields.map((field, i) => `${quote(target.columns.get(field)!)} = $${i + 1}`).join(" and ");
        const found = await client.query(`select 1 from ${quote(target.sqlName)} where ${where} limit 1`, values.map(decode));
        if (!found.rows.length) throw new Error("portable_foreign_reference_missing");
      }
      if (dryRun) return;
      for (const item of deferred) {
        const meta = tableMeta(item.table); const entries = Object.entries(item.links);
        const set = entries.map(([field], i) => `${quote(meta.columns.get(field)!)} = $${i + 1}`).join(",");
        const where = meta.primaryKeys.map((field, i) => `${quote(meta.columns.get(field)!)} = $${entries.length + i + 1}`).join(" and ");
        const updated = await client.query(`update ${quote(meta.sqlName)} set ${set} where ${where} returning ${quote(meta.columns.get(meta.primaryKeys[0]!)!)}`, [...entries.map(([, value]) => decode(value)), ...item.keys.map(decode)]);
        if (updated.rows.length !== 1) throw new Error("portable_deferred_reference_update_failed");
      }
    },
    };
  };
  return {
    orderTables: orderPostgresTables,
    async transaction<T>(work: (transaction: ImportTransaction) => Promise<T>) {
      const client = await pool.connect();
      let commitAttempted = false;
      let discardConnection: Error | undefined;
      try {
        await client.query("begin");
        if (authorization) {
          // Fence ordinary writes as well as other restores until validation and
          // commit finish. A single anchor cannot protect the other empty tables.
          // Shared scopes acquire every relation in the same global order.
          const relations = [...tablesForScope(authorization.scope)].sort();
          await client.query(`lock table ${relations.map(quote).join(",")} in share row exclusive mode`);
          const owner = await client.query("select id from users where id=$1 and role='owner' and account_status='active' for share", [authorization.ownerId]);
          if (!owner.rows.length) throw new Error("portable_owner_required");
          for (const target of new Set(authorization.identityMap?.values())) {
            const actor = await client.query("select id from users where id=$1 and role='owner' and account_status='active' for share", [target]);
            if (!actor.rows.length) throw new Error("portable_identity_target_owner_required");
          }
          for (const table of tablesForScope(authorization.scope)) {
            const populated = table === "users"
              ? await client.query("select 1 from users where not (id = any($1::uuid[])) limit 1", [[...retainedOwnerIds]])
              : await client.query(`select 1 from ${quote(table)} limit 1`);
            if (populated.rows.length) throw new Error("portable_fresh_destination_required");
          }
        }
        const usedIdentities = new Set<string>();
        const value = await work(forClient(client, usedIdentities));
        if ([...authorization?.identityMap?.keys() ?? []].some(id => !usedIdentities.has(id))) throw new Error("portable_identity_mapping_unused");
        commitAttempted = !authorization?.dryRun;
        await client.query(authorization?.dryRun ? "rollback" : "commit");
        return value;
      }
      catch (error) {
        try { await client.query("rollback"); }
        catch (rollbackError) {
          discardConnection = rollbackError instanceof Error ? rollbackError : new Error("portable_import_rollback_failed", { cause: rollbackError });
        }
        if (commitAttempted) {
          // A lost COMMIT response cannot be repaired by retrying the archive or
          // by returning this session to the pool, even if ROLLBACK responds.
          discardConnection = new Error("portable_import_commit_uncertain", { cause: error });
          throw discardConnection;
        }
        throw error;
      }
      finally { client.release?.(discardConnection); }
    },
  };
}


/** Export from one read-only, repeatable snapshot; release the connection even
 * when a sink or object inventory fails. Callers still own export authorization
 * and object-store lifecycle checks. No deployment credentials are read here. */
export async function withPostgresExportSource<T>(
  pool: PgPool,
  options: { snapshotAt: Date; scope?: ExportScope; ownerId?: string; objects: (scope: ExportScope) => AsyncIterable<PortableObject> },
  work: (source: ExportSource) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(options.snapshotAt.getTime())) throw new Error("portable_snapshot_invalid");
  const snapshotAt = new Date(options.snapshotAt);
  const scope = options.scope ?? "full-system";
  if (!tablesForScope(scope).length) throw new Error("portable_scope_invalid");
  const offlineCutoff = new Date(snapshotAt.getTime() - RIWI_CONVERSATION_OFFLINE_DAYS * 86_400_000);
  const messageCutoff = new Date(snapshotAt.getTime() - RIWI_CONVERSATION_TTL_DAYS * 86_400_000);
  const client = await pool.connect();
  let cursorSequence = 0;
  let open = true;
  const requireOpen = () => { if (!open) throw new Error("portable_snapshot_closed"); };
  const activeParentSql = `c.deleted_at is null and c.expires_at > $1 and u.last_active_at >= $2`;
  const source: ExportSource = {
    snapshotAt: snapshotAt.toISOString(),
    scope,
    async *rows(table, batchSize) {
      requireOpen();
      if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 5000) throw new Error("portable_batch_size_invalid");
      if (!tablesForScope(scope).includes(table)) throw new Error("portable_table_scope_mismatch");
      const meta = tableMeta(table);
      const columns = [...meta.columns].map(([property, column]) => {
        if (scope === "riwi" && table === "riwi_knowledge_sources" && property === "supersedesSourceId") {
          return `case when exists (select 1 from riwi_knowledge_sources previous where previous.id=t.${quote(column)} and previous.scope in ('global','role') and previous.scope_user_id is null) then t.${quote(column)} else null end as "${property}"`;
        }
        return `t.${quote(column)} as "${property}"`;
      }).join(",");
      let from = `${quote(meta.sqlName)} t`;
      let where = "";
      const values: unknown[] = [];
      if (scope === "riwi" && table === "riwi_knowledge_sources") {
        where = " where t.scope in ('global','role') and t.scope_user_id is null";
      } else if (scope === "riwi" && table === "riwi_knowledge_units") {
        from += " join riwi_knowledge_sources ks on ks.id = t.source_id";
        where = " where ks.scope in ('global','role') and ks.scope_user_id is null";
      } else if (scope === "riwi" && table === "riwi_knowledge_conflicts") {
        from += " join riwi_knowledge_sources ks on ks.id = t.candidate_source_id join riwi_knowledge_sources ka on ka.id = t.active_source_id";
        where = " where ks.scope in ('global','role') and ks.scope_user_id is null and ka.scope in ('global','role') and ka.scope_user_id is null";
      } else if (table === "riwi_conversations") {
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
    async *objects(requestedScope) {
      requireOpen();
      if (requestedScope !== scope) throw new Error("portable_source_scope_mismatch");
      for await (const object of options.objects(scope)) {
        requireOpen();
        if (scope === "riwi") {
          if (object.objectClass !== "riwi-knowledge-source" || object.scope === "user" || object.ownerId != null) throw new Error("portable_riwi_private_object");
          const source = await client.query("select id from riwi_knowledge_sources where source_object_key=$1 and scope in ('global','role') and scope_user_id is null and state <> 'rejected' limit 1", [object.sourceKey]);
          if (!source.rows.length) throw new Error("portable_object_source_required");
        }
        yield object;
      }
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
    if (options.ownerId) {
      const owner = await client.query("select id from users where id=$1 and role='owner' and account_status='active'", [options.ownerId]);
      if (!owner.rows.length) throw new Error("portable_owner_required");
    }
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
