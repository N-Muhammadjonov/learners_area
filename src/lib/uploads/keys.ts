import { randomUUID } from "node:crypto";
import { extensionOf, KEY_KIND, type UploadCategory } from "@/lib/validation/uploads";

/**
 * Server-only object-key generation. Kept out of
 * `src/lib/validation/uploads.ts` because that module is imported by client
 * components, and pulling `node:crypto` into a browser bundle breaks the build.
 *
 * The original filename is NEVER the identity — a collision, or a crafted name
 * like `../../etc/passwd`, must not be able to address someone else's object.
 * Identity is a fresh UUID inside a namespace:
 *
 *   resources/<materialId>/primary/<uuid>.<ext>      (known resource)
 *   pending/<intentId>/primary/<uuid>.<ext>          (resource not created yet)
 *
 * The `pending/` namespace is what abandoned-upload cleanup sweeps: anything
 * still there past its intent's expiry is an orphan and gets deleted.
 */
export function buildObjectKey(input: {
  /** Existing material id when editing; null/undefined while creating. */
  materialId?: string | null;
  /** Upload-intent id — always present, used for the pending namespace. */
  intentId: string;
  category: UploadCategory;
  filename: string;
}): string {
  const ext = extensionOf(input.filename).replace(/[^a-z0-9.]/g, "");
  const safeExt = ext && ext.length <= 12 ? ext : "";
  const id = randomUUID();
  const scope = input.materialId
    ? `resources/${sanitizeSegment(input.materialId)}`
    : `pending/${sanitizeSegment(input.intentId)}`;
  return `${scope}/${KEY_KIND[input.category]}/${id}${safeExt}`;
}

/** Strips anything that is not a plain identifier out of a path segment. */
function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
}
