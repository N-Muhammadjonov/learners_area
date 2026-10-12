import { contentEnvelopeSchema, looksLikeEnvelope, type CanonicalPackage } from "./envelope";
import { packageContentHash } from "./identity";
import { listContentTypes, resolveContentType, type ContentTypeDescriptor } from "./registry";
import {
  executableMarkupIssues,
  issue,
  issuesFromZodError,
  report,
  type ImportErrorCode,
  type ImportIssue,
  type ValidationReport,
} from "./validation";

/**
 * The pure half of the import pipeline: JSON → validated canonical package.
 *
 * It performs level 1 (structure), level 2 (domain semantics) and the asset
 * DECLARATION checks. It touches no database and no storage, which is what lets
 * the browser validate a 50 KB JSON file before a 25 MB recording is uploaded.
 *
 * Older, still-supported package versions are upgraded through the handler's own
 * `upgrade` function — a module's history stays with the module.
 */

export type ParseSuccess = {
  ok: true;
  pkg: CanonicalPackage;
  descriptor: ContentTypeDescriptor;
  /** Set when an older, still supported package version was upgraded. */
  migratedFrom?: number;
  warnings: ImportIssue[];
};

export type ParseFailure = {
  ok: false;
  code: ImportErrorCode;
  report: ValidationReport;
};

export type ParseOutcome = ParseSuccess | ParseFailure;

function fail(code: ImportErrorCode, entries: ImportIssue[]): ParseFailure {
  return { ok: false, code, report: report(entries) };
}

function duplicateAssetKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

/** A bare module payload (no `module` field) can only be claimed by one handler. */
function upgradeBarePayload(
  version: number,
  raw: Record<string, unknown>,
): { descriptor: ContentTypeDescriptor; upgraded: unknown } | undefined {
  const candidates = listContentTypes().filter(
    (descriptor) => (descriptor.migratableVersions ?? []).includes(version) && descriptor.upgrade,
  );
  const matches: { descriptor: ContentTypeDescriptor; upgraded: unknown }[] = [];
  for (const descriptor of candidates) {
    try {
      const upgraded = descriptor.upgrade!(version, raw);
      const parsed = contentEnvelopeSchema.safeParse(upgraded);
      if (parsed.success && parsed.data.module === descriptor.module && parsed.data.contentType === descriptor.contentType)
        matches.push({ descriptor, upgraded });
    } catch {
      // A handler that cannot read this payload simply is not the owner of it.
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

export function parseContentPackage(raw: unknown): ParseOutcome {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return fail("invalid_input", [issue(1, "invalid_input", "The package must be a JSON object.")]);

  const initial = raw as Record<string, unknown>;
  let candidate: unknown = raw;
  let migratedFrom: number | undefined;
  let owner: ContentTypeDescriptor | undefined;

  if (!looksLikeEnvelope(initial)) {
    const version = initial.schemaVersion;
    if (typeof version !== "number" || !Number.isInteger(version))
      return fail("schema_invalid", [
        issue(1, "schema_invalid", "Missing `schemaVersion`. This is not a Learners Area content package."),
      ]);
    const claimed = upgradeBarePayload(version, initial);
    if (!claimed)
      return fail("invalid_input", [
        issue(
          1,
          "invalid_input",
          "The file has no `module` field and does not match any supported package format. Add `module`, `contentType` and `schemaVersion`.",
        ),
      ]);
    owner = claimed.descriptor;
    candidate = claimed.upgraded;
    migratedFrom = version;
  }

  const envelopeParsed = contentEnvelopeSchema.safeParse(candidate);
  if (!envelopeParsed.success) return fail("schema_invalid", issuesFromZodError(envelopeParsed.error, 1));
  const envelope = envelopeParsed.data;

  const resolved = resolveContentType(envelope.module, envelope.contentType, envelope.schemaVersion);
  if (resolved.kind === "unknown_content_type")
    return fail("unknown_content_type", [
      issue(
        1,
        "unknown_content_type",
        `No importer is registered for ${envelope.module}:${envelope.contentType}.`,
        "contentType",
      ),
    ]);
  if (resolved.kind === "unsupported_version")
    return fail("unsupported_schema_version", [
      issue(
        1,
        "unsupported_schema_version",
        `schemaVersion ${resolved.schemaVersion} is not supported for ${envelope.module}:${envelope.contentType} ` +
          `(supported: ${resolved.supported.join(", ")}).`,
        "schemaVersion",
      ),
    ]);

  const descriptor = owner ?? resolved.descriptor;
  if (owner && (owner.module !== envelope.module || owner.contentType !== envelope.contentType))
    return fail("schema_invalid", [issue(1, "schema_invalid", "The upgraded package does not match its importer.")]);

  let value: unknown = envelope;
  if (resolved.kind === "upgradable" && !owner) {
    const upgraded = descriptor.upgrade!(resolved.schemaVersion, envelope);
    if (!upgraded || typeof upgraded !== "object")
      return fail("schema_invalid", [issue(1, "schema_invalid", "The package could not be upgraded.")]);
    const reParsed = contentEnvelopeSchema.safeParse(upgraded);
    if (!reParsed.success) return fail("schema_invalid", issuesFromZodError(reParsed.error, 1));
    value = reParsed.data;
    migratedFrom = resolved.schemaVersion;
  }

  const contentParsed = descriptor.contentSchema.safeParse((value as { content: unknown }).content);
  if (!contentParsed.success) return fail("schema_invalid", issuesFromZodError(contentParsed.error, 1));

  const pkg = { ...(value as CanonicalPackage), content: contentParsed.data } as CanonicalPackage;

  const issues: ImportIssue[] = [];

  for (const key of duplicateAssetKeys(pkg.assets.map((asset) => asset.key)))
    issues.push(issue(1, "duplicate_asset", `Asset key "${key}" is declared more than once.`, "assets"));

  for (const entry of descriptor.semanticIssues?.(pkg) ?? []) issues.push(entry);

  // Level 2: educational data is inert by contract.
  for (const entry of executableMarkupIssues(pkg.content, "content")) issues.push(entry);

  // Declared assets must cover what the content actually points at.
  if (descriptor.requiredAssets) {
    const declared = new Map(pkg.assets.map((asset) => [asset.key, asset]));
    for (const requirement of descriptor.requiredAssets(pkg.content)) {
      const declaration = declared.get(requirement.key);
      if (!declaration) {
        if (requirement.required)
          issues.push(
            issue(
              3,
              "asset_missing",
              `Asset "${requirement.key}" is required by the content but not declared in "assets".`,
              "assets",
            ),
          );
        continue;
      }
      if (declaration.role !== requirement.role)
        issues.push(
          issue(
            3,
            "asset_mime_invalid",
            `Asset "${requirement.key}" is declared as ${declaration.role} but the content uses it as ${requirement.role}.`,
            "assets",
          ),
        );
    }
  }

  // Integrity: an advisory hash that does not match is a blocker, never a warning.
  // The message carries the hash the server just computed, so an author can pin
  // the canonical value instead of guessing how defaults are normalized.
  const canonical = packageContentHash(pkg);
  if (pkg.contentHash && pkg.contentHash !== canonical)
    issues.push(
      issue(
        1,
        "content_hash_mismatch",
        `The declared contentHash does not match the package content (canonical hash: ${canonical}).`,
        "contentHash",
      ),
    );

  const verdict = report(issues);
  if (!verdict.ok) return fail(verdict.issues[0]!.code, issues);
  return { ok: true, pkg, descriptor, ...(migratedFrom ? { migratedFrom } : {}), warnings: verdict.warnings };
}
