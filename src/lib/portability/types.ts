export const PORTABLE_SCHEMA_VERSION = "1.0.0" as const;
export const RIWI_CORE_VERSION = "1.0.0" as const;
export const ASSESSMENT_CONTRACT_SCHEMA_VERSION = "1.0.0" as const;
export const ASSESSMENT_POLICY_SCHEMA_VERSION = "1.0.0" as const;
export const SPEAKING_DATA_SCHEMA_VERSION = "1.0.0" as const;

export const EXPORT_SCOPES = ["full-system", "riwi", "learners-area"] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];
export const OBJECT_MODES = ["keep-r2", "move-objects"] as const;
export type ObjectMode = (typeof OBJECT_MODES)[number];

export type PortableRow = Readonly<Record<string, unknown>>;
export type RowFileManifest = Readonly<{
  table: string;
  file: string;
  rowCount: number;
  sha256: string;
  byteLength: number;
}>;
export type PortableObject = Readonly<{
  objectClass: "riwi-knowledge-source" | "speaking-audio" | "site-private";
  sourceKey: string;
  destinationKey: string | null;
  ownerId: string | null;
  scope: "global" | "role" | "user";
  retentionState: "active" | "deleted" | "expired";
  sha256: string;
  byteLength: number;
  mimeType: string;
}>;
export type PortableManifest = Readonly<{
  format: "learners-area-portable";
  portableSchemaVersion: typeof PORTABLE_SCHEMA_VERSION;
  riwiCoreVersion: typeof RIWI_CORE_VERSION;
  assessmentContractSchemaVersion: typeof ASSESSMENT_CONTRACT_SCHEMA_VERSION;
  assessmentPolicySchemaVersion: typeof ASSESSMENT_POLICY_SCHEMA_VERSION;
  speakingDataSchemaVersion: typeof SPEAKING_DATA_SCHEMA_VERSION;
  scope: ExportScope;
  objectMode: ObjectMode;
  createdAt: string;
  sourceFingerprint: string;
  tables: readonly RowFileManifest[];
  objects: readonly PortableObject[];
  manifestSha256: string;
}>;

export type ImportPlan = Readonly<{
  dryRun: boolean;
  scope: ExportScope;
  creates: number;
  updates: number;
  skips: number;
  conflicts: readonly string[];
  objectCopies: number;
}>;
