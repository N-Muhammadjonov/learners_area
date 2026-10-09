import { createHash } from "node:crypto";
import {
  ASSESSMENT_CONTRACT_SCHEMA_VERSION,
  ASSESSMENT_POLICY_SCHEMA_VERSION,
  PORTABLE_SCHEMA_VERSION,
  RIWI_CORE_VERSION,
  SPEAKING_DATA_SCHEMA_VERSION,
  type ExportScope,
  type ImportPlan,
  type ObjectMode,
  type PortableManifest,
  type PortableObject,
  type PortableRow,
  type RowFileManifest,
} from "./types";
import { assertPortableFields, shouldExportPrivateRow, tablesForScope, type PortableTable } from "./classification";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value instanceof Uint8Array) return JSON.stringify(Buffer.from(value).toString("base64"));
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

export type ExportSink = {
  beginFile(path: string): Promise<void>;
  write(chunk: string): Promise<void>;
  endFile(): Promise<void>;
};
export type ExportSource = {
  rows(table: PortableTable, batchSize: number): AsyncIterable<readonly PortableRow[]>;
  objects(scope: ExportScope): AsyncIterable<PortableObject>;
  /** Resolve this bounded batch against authorized, non-deleted parent
   * conversations whose expiry is strictly after the export snapshot.
   * Required whenever private conversation messages are exported. */
  activeConversationIds?(ids: readonly string[], at: Date): Promise<readonly string[]>;
};

export async function exportPortableArchive(input: {
  scope: ExportScope;
  objectMode: ObjectMode;
  sourceFingerprint: string;
  source: ExportSource;
  sink: ExportSink;
  createdAt?: Date;
  batchSize?: number;
}): Promise<PortableManifest> {
  if (!input.sourceFingerprint.trim()) throw new Error("source_fingerprint_required");
  const snapshotAt = input.createdAt ?? new Date();
  const tables: RowFileManifest[] = [];
  for (const table of tablesForScope(input.scope)) {
    const file = `tables/${table}.jsonl`;
    await input.sink.beginFile(file);
    const hash = createHash("sha256");
    let byteLength = 0;
    let rowCount = 0;
    for await (const batch of input.source.rows(table, input.batchSize ?? 250)) {
      if (batch.length > (input.batchSize ?? 250)) throw new Error(`unbounded_batch:${table}`);
      let activeConversations: Set<string> | undefined;
      if (table === "riwi_conversation_messages" && batch.length) {
        if (!input.source.activeConversationIds) throw new Error("conversation_retention_proof_required");
        const ids = [...new Set(batch.map((row) => {
          if (typeof row.conversationId !== "string" || !row.conversationId) throw new Error("conversation_reference_invalid");
          return row.conversationId;
        }))];
        const active = await input.source.activeConversationIds(ids, snapshotAt);
        if (active.some((id) => !ids.includes(id))) throw new Error("conversation_retention_proof_invalid");
        activeConversations = new Set(active);
      }
      for (const row of batch) {
        assertPortableFields(table, row);
        if (!shouldExportPrivateRow(row, snapshotAt)) continue;
        if (activeConversations && !activeConversations.has(row.conversationId as string)) continue;
        const line = `${stableJson(row)}\n`;
        hash.update(line);
        byteLength += Buffer.byteLength(line);
        rowCount += 1;
        await input.sink.write(line);
      }
    }
    await input.sink.endFile();
    tables.push({ table, file, rowCount, byteLength, sha256: hash.digest("hex") });
  }

  const objects: PortableObject[] = [];
  for await (const object of input.source.objects(input.scope)) {
    if (object.retentionState !== "active") continue;
    if (input.scope === "riwi" && object.objectClass !== "riwi-knowledge-source") {
      throw new Error(`riwi_private_object:${object.objectClass}`);
    }
    if (input.scope === "learners-area" && object.objectClass === "riwi-knowledge-source") {
      throw new Error("site_export_riwi_object");
    }
    if (input.objectMode === "move-objects" && !/^[a-f0-9]{64}$/.test(object.sha256)) {
      throw new Error(`object_checksum_required:${object.sourceKey}`);
    }
    objects.push(object);
  }

  const unsigned = {
    format: "learners-area-portable" as const,
    portableSchemaVersion: PORTABLE_SCHEMA_VERSION,
    riwiCoreVersion: RIWI_CORE_VERSION,
    assessmentContractSchemaVersion: ASSESSMENT_CONTRACT_SCHEMA_VERSION,
    assessmentPolicySchemaVersion: ASSESSMENT_POLICY_SCHEMA_VERSION,
    speakingDataSchemaVersion: SPEAKING_DATA_SCHEMA_VERSION,
    scope: input.scope,
    objectMode: input.objectMode,
    createdAt: snapshotAt.toISOString(),
    sourceFingerprint: input.sourceFingerprint,
    tables: tables.sort((a, b) => a.table.localeCompare(b.table)),
    objects: objects.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
  };
  return { ...unsigned, manifestSha256: sha256(stableJson(unsigned)) };
}

export function verifyManifest(manifest: PortableManifest): void {
  if (manifest.format !== "learners-area-portable") throw new Error("unsupported_format");
  if (manifest.portableSchemaVersion !== PORTABLE_SCHEMA_VERSION) throw new Error(`unsupported_portable_schema:${manifest.portableSchemaVersion}`);
  if (manifest.riwiCoreVersion !== RIWI_CORE_VERSION) throw new Error(`unsupported_riwi_core:${manifest.riwiCoreVersion}`);
  if (manifest.assessmentContractSchemaVersion !== ASSESSMENT_CONTRACT_SCHEMA_VERSION) throw new Error("unsupported_contract_schema");
  if (manifest.assessmentPolicySchemaVersion !== ASSESSMENT_POLICY_SCHEMA_VERSION) throw new Error("unsupported_policy_schema");
  if (manifest.speakingDataSchemaVersion !== SPEAKING_DATA_SCHEMA_VERSION) throw new Error("unsupported_speaking_schema");
  const { manifestSha256, ...unsigned } = manifest;
  if (sha256(stableJson(unsigned)) !== manifestSha256) throw new Error("manifest_checksum_mismatch");
  const expected = new Set(tablesForScope(manifest.scope));
  for (const table of manifest.tables) {
    if (!expected.delete(table.table as PortableTable)) throw new Error(`unexpected_or_duplicate_table:${table.table}`);
  }
  if (expected.size) throw new Error(`missing_table:${[...expected][0]}`);
}

export type ImportArchive = {
  readRows(file: string): AsyncIterable<string>;
  readObject(object: PortableObject): Promise<Uint8Array>;
};
export type ImportTransaction = {
  planRow(table: PortableTable, row: PortableRow, identityMap: ReadonlyMap<string, string>): Promise<"create" | "update" | "skip" | "conflict">;
  applyRow(table: PortableTable, row: PortableRow, identityMap: ReadonlyMap<string, string>): Promise<void>;
  copyObject(object: PortableObject, bytes: Uint8Array): Promise<void>;
};
export type ImportDestination = { transaction<T>(work: (tx: ImportTransaction) => Promise<T>): Promise<T> };

export async function importPortableArchive(input: {
  manifest: PortableManifest;
  archive: ImportArchive;
  destination: ImportDestination;
  dryRun: boolean;
  identityMap?: ReadonlyMap<string, string>;
}): Promise<ImportPlan> {
  verifyManifest(input.manifest);
  const identityMap = input.identityMap ?? new Map<string, string>();
  let creates = 0; let updates = 0; let skips = 0; let objectCopies = 0;
  const conflicts: string[] = [];
  return input.destination.transaction(async (tx) => {
    for (const entry of input.manifest.tables) {
      const table = entry.table as PortableTable;
      const hash = createHash("sha256");
      let byteLength = 0; let rowCount = 0;
      for await (const line of input.archive.readRows(entry.file)) {
        const canonicalLine = line.endsWith("\n") ? line : `${line}\n`;
        hash.update(canonicalLine); byteLength += Buffer.byteLength(canonicalLine); rowCount += 1;
        const row = JSON.parse(line) as PortableRow;
        assertPortableFields(table, row);
        const decision = await tx.planRow(table, row, identityMap);
        if (decision === "create") creates += 1;
        else if (decision === "update") updates += 1;
        else if (decision === "skip") skips += 1;
        else conflicts.push(`${table}:${String(row.id ?? row.key ?? rowCount)}`);
        if (!input.dryRun && decision !== "conflict") await tx.applyRow(table, row, identityMap);
      }
      if (rowCount !== entry.rowCount || byteLength !== entry.byteLength || hash.digest("hex") !== entry.sha256) {
        throw new Error(`table_checksum_mismatch:${table}`);
      }
    }
    if (conflicts.length) throw new Error(`import_conflicts:${conflicts.length}`);
    if (input.manifest.objectMode === "move-objects") {
      for (const object of input.manifest.objects) {
        const bytes = await input.archive.readObject(object);
        if (bytes.byteLength !== object.byteLength || sha256(bytes) !== object.sha256) throw new Error(`object_checksum_mismatch:${object.sourceKey}`);
        if (!input.dryRun) await tx.copyObject(object, bytes);
        objectCopies += 1;
      }
    }
    return { dryRun: input.dryRun, scope: input.manifest.scope, creates, updates, skips, conflicts, objectCopies };
  });
}
