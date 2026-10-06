import { z } from "zod";

/**
 * Learners Area Content Package — the shared ingestion envelope.
 *
 * One shape for every module, with a module-specific `content` payload:
 *
 *   envelope (identity, provenance, publication intent, asset declarations)
 *     + content (domain data owned by the module schema)
 *     + assets (declared binaries; the server resolves upload ids to objects)
 *
 * Rules that this file enforces structurally:
 *   • AI/user supplied JSON is untrusted input: identity that the server owns
 *     (actor, ids, object keys, roles) has no field here and can never be sent.
 *   • No executable content: the payload is data. Legacy HTML is converted in a
 *     separate, inert pipeline (`src/lib/import/listening/legacy.ts`).
 *   • Nothing here knows about a module's domain invariants — those live with
 *     the module schema (see `./registry` and `src/lib/import/<module>`).
 */

export const CONTENT_MODULES = [
  "listening",
  "reading",
  "writing",
  "grammar",
  "vocabulary",
  "ted",
  "speaking",
] as const;
export type ContentModule = (typeof CONTENT_MODULES)[number];

/** Where the material came from. Server-recorded; never inferred from a filename. */
export const PROVENANCE_SOURCES = [
  "owner_authored",
  "teacher_authored",
  "ai_authoring",
  "legacy_conversion",
  "third_party",
  "unknown",
] as const;
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

export const provenanceSchema = z
  .object({
    source: z.enum(PROVENANCE_SOURCES).default("unknown"),
    /** Free note from the author ("converted from 01_full_exam.html", "ChatGPT draft, reviewed by teacher"). */
    note: z.string().trim().max(1000).optional(),
    /** Copyright line for third-party material; shown internally, never invented. */
    attribution: z.string().trim().max(500).optional(),
    organization: z.string().trim().max(300).optional(),
    sourceUrl: z.string().trim().url().max(1000).optional(),
    originalFilename: z.string().trim().max(255).optional(),
    rights: z.string().trim().max(300).optional(),
  })
  .strict();
export type PackageProvenance = z.infer<typeof provenanceSchema>;

/**
 * Publication INTENT. Import is not publication: the server records the request
 * and the actor, and only an authorized role may honour "published"/"scheduled".
 */
export const publicationIntentSchema = z
  .object({
    state: z.enum(["draft", "scheduled", "published", "archived"]).default("draft"),
    publishAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .default({ state: "draft" });
export type PublicationIntent = z.infer<typeof publicationIntentSchema>;

export const ASSET_ROLES = ["audio", "image", "document"] as const;
export type AssetRole = (typeof ASSET_ROLES)[number];

/**
 * A declared binary. `key` is a package-local name (never an object key or a
 * bucket path); `path` is only a lookup hint inside a transport archive (ZIP).
 * Ownership and existence are proven server-side from the finalized upload.
 */
export const assetDeclarationSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9._-]{0,60}$/, "asset key must be a short lowercase name such as audio.full"),
    role: z.enum(ASSET_ROLES),
    required: z.boolean().default(true),
    label: z.string().trim().max(200).optional(),
    mimeTypes: z.array(z.string().trim().max(100)).min(1).max(20),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(512 * 1024 * 1024)
      .default(120 * 1024 * 1024),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters")
      .optional(),
    /** Lookup hint inside a ZIP transport container; never trusted as ownership. */
    path: z.string().trim().max(400).optional(),
  })
  .strict();
export type AssetDeclaration = z.infer<typeof assetDeclarationSchema>;

export const contentEnvelopeSchema = z
  .object({
    schemaVersion: z.number().int().min(1).max(1000),
    module: z.enum(CONTENT_MODULES),
    /** Canonical content type within the module, e.g. `full_test`, `general_set`. */
    contentType: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,59}$/, "contentType must be lower_snake_case"),
    /** Stable source identity: the same material always maps to the same ref. */
    sourceRef: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/, "sourceRef may contain letters, digits, dot, dash and underscore"),
    title: z.string().trim().min(1).max(200),
    language: z.string().trim().min(2).max(12).default("en"),
    provenance: provenanceSchema.default({ source: "unknown" }),
    publication: publicationIntentSchema,
    assets: z.array(assetDeclarationSchema).max(40).default([]),
    /**
     * Advisory only. The server always recomputes the canonical hash from the
     * normalized payload, so a caller cannot claim integrity it does not have.
     */
    contentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    content: z.unknown(),
  })
  .strict();

export type ContentEnvelope = z.infer<typeof contentEnvelopeSchema>;
/** An envelope whose `content` has been validated by the module handler. */
export type CanonicalPackage<TContent = unknown> = Omit<ContentEnvelope, "content"> & {
  content: TContent;
};

/** `module:contentType:vN` — the registry key used by the importer and the docs. */
export function packageKey(module: ContentModule, contentType: string, schemaVersion: number): string {
  return `${module}:${contentType}:v${schemaVersion}`;
}

/** True when an unknown file looks like the shared envelope (module-tagged). */
export function looksLikeEnvelope(value: unknown): boolean {
  return Boolean(value) && typeof value === "object" && "module" in (value as Record<string, unknown>);
}
