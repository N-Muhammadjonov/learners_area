import type { z } from "zod";
import type { AssetRole, ContentModule, CanonicalPackage } from "./envelope";
import type { ImportIssue } from "./validation";

/**
 * The import registry maps `module + contentType + schemaVersion` to exactly one
 * handler. It is deliberately small: a handler owns a DOMAIN schema and its
 * semantics — it is never a generic "JSON blob" importer that knows nothing about
 * the material. Handlers here are pure (no database, no filesystem), so the same
 * registry can be imported by the admin UI to render capabilities and templates.
 *
 * Database-backed importers are bound in `./server-registry` so that client
 * bundles never pull server-only code.
 */

export type AssetRequirement = {
  key: string;
  role: AssetRole;
  required: boolean;
  label?: string;
  mimeTypes: string[];
  maxBytes: number;
  /** Content location that points at this asset, e.g. `content.audio`. */
  usedBy?: string;
};

export type PreviewLine = { label: string; value: string };

export type PackagePreview = {
  title: string;
  lines: PreviewLine[];
  warnings: string[];
};

export type ContentTypeDescriptor<TContent = unknown> = {
  module: ContentModule;
  /** Canonical content type inside the module. */
  contentType: string;
  /** Latest supported envelope version for this content type. */
  schemaVersion: number;
  /** Staff-facing label (English technical label; UI localizes its own copy). */
  label: string;
  /**
   * `active`  — a real importer exists and is registered in server-registry.
   * `planned` — the canonical shape is declared and documented, the importer is
   *             not built yet. Declared honestly so the UI never offers a
   *             capability that does not exist.
   */
  status: "active" | "planned";
  /** Level-1 schema for `envelope.content`. */
  contentSchema: z.ZodType<TContent, z.ZodTypeDef, unknown>;
  /** Older package versions this handler still accepts, newest first. */
  migratableVersions?: number[];
  /** Upgrades an older payload into a value shaped like the current version. */
  upgrade?: (fromVersion: number, raw: unknown) => unknown;
  /** Level-2 domain semantics. */
  semanticIssues?: (pkg: CanonicalPackage<TContent>) => ImportIssue[];
  /** Assets the content genuinely needs; the declared list must cover them. */
  requiredAssets?: (content: TContent) => AssetRequirement[];
  /** Staff preview summary, database-free. */
  preview?: (pkg: CanonicalPackage<TContent>) => PackagePreview;
  /** Downloadable canonical template. */
  template?: () => unknown;
  /** Canonical synthetic example (QA fixture + docs, never copyrighted material). */
  example?: () => unknown;
};

const registry = new Map<string, ContentTypeDescriptor>();

/**
 * Type erasure at ONE point, on purpose: a module descriptor is authored against
 * its own content type (so its schema, semantics and preview are fully typed),
 * while the registry stores every module behind the same `unknown`-content
 * contract. The content is only reachable through `contentSchema.safeParse`, so
 * the erased type can never be used to skip validation.
 */
export function defineContentType<TContent>(
  descriptor: ContentTypeDescriptor<TContent>,
): ContentTypeDescriptor {
  return descriptor as unknown as ContentTypeDescriptor;
}

function slot(module: ContentModule, contentType: string, schemaVersion: number) {
  return `${module}:${contentType}:v${schemaVersion}`;
}

export function registerContentType(descriptor: ContentTypeDescriptor): void {
  const key = slot(descriptor.module, descriptor.contentType, descriptor.schemaVersion);
  const existing = registry.get(key);
  // The same descriptor object may be registered from both the pure capability
  // entry point and the server binding; anything else is a real conflict.
  if (existing && existing !== descriptor) throw new Error(`Duplicate content type registration: ${key}`);
  registry.set(key, descriptor as ContentTypeDescriptor);
}

export type ResolvedDescriptor =
  | { kind: "exact"; descriptor: ContentTypeDescriptor; schemaVersion: number }
  | { kind: "upgradable"; descriptor: ContentTypeDescriptor; schemaVersion: number }
  | { kind: "unsupported_version"; descriptor: ContentTypeDescriptor; schemaVersion: number; supported: number[] }
  | { kind: "unknown_content_type"; module: string; contentType: string };

export function resolveContentType(
  module: string,
  contentType: string,
  schemaVersion: number,
): ResolvedDescriptor {
  const exact = registry.get(slot(module as ContentModule, contentType, schemaVersion));
  if (exact) return { kind: "exact", descriptor: exact, schemaVersion };

  // A single registered version for this (module, contentType) can also accept
  // older versions it declares as migratable.
  const family = [...registry.values()].filter(
    (descriptor) => descriptor.module === module && descriptor.contentType === contentType,
  );
  if (!family.length) return { kind: "unknown_content_type", module, contentType };
  for (const descriptor of family) {
    if ((descriptor.migratableVersions ?? []).includes(schemaVersion) && descriptor.upgrade)
      return { kind: "upgradable", descriptor, schemaVersion };
  }
  const known = family[0]!;
  return {
    kind: "unsupported_version",
    descriptor: known,
    schemaVersion,
    supported: [...(known.migratableVersions ?? []), known.schemaVersion].sort((a, b) => a - b),
  };
}

export function listContentTypes(): ContentTypeDescriptor[] {
  return [...registry.values()].sort(
    (a, b) => a.module.localeCompare(b.module) || a.contentType.localeCompare(b.contentType),
  );
}

export function descriptorFor(module: ContentModule, contentType: string): ContentTypeDescriptor | undefined {
  return listContentTypes().find((entry) => entry.module === module && entry.contentType === contentType);
}
