import "server-only";
import { z } from "zod";
import { verifySessionToken } from "@/lib/auth/session";
import { exportPortableArchive } from "./archive";
import { withPostgresExportSource, type PgPool } from "./postgres-adapter";
import { exportEncryptedPostgresBundle } from "./bundle";
import { EXPORT_SCOPES, type PortableObject } from "./types";

export const portableExportCommandSchema = z.object({
  scope: z.enum(EXPORT_SCOPES), dryRun: z.boolean(), sourceFingerprint: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,119}$/),
  destination: z.string().min(1).max(4096).optional(),
}).strict().superRefine((input, ctx) => { if (!input.dryRun && !input.destination) ctx.addIssue({ code: "custom", message: "destination_required" }); });

/** Credential is an out-of-band signed session; request roles/owner IDs are
 * never command arguments. The PostgreSQL snapshot revalidates persisted owner.
 * O1 inventory access/lifecycle remains a separate operational acceptance gate.
 */
export async function runPortableExportCommand(input: {
  request: unknown; sessionToken: string; pool: PgPool; key?: Uint8Array;
  objects(scope: (typeof EXPORT_SCOPES)[number]): AsyncIterable<PortableObject>;
}) {
  const request = portableExportCommandSchema.parse(input.request);
  const session = await verifySessionToken(input.sessionToken);
  if (!session) throw new Error("portable_owner_required");
  const snapshotAt = new Date();
  if (request.dryRun) {
    return withPostgresExportSource(input.pool, { scope: request.scope, ownerId: session.sub, snapshotAt, objects: input.objects }, source =>
      exportPortableArchive({ scope: request.scope, objectMode: "keep-r2", sourceFingerprint: request.sourceFingerprint, source,
        sink: { async beginFile() {}, async write() {}, async endFile() {} } }));
  }
  if (!input.key || input.key.byteLength !== 32) throw new Error("portable_encryption_key_must_be_32_bytes");
  return exportEncryptedPostgresBundle({ pool: input.pool, ownerId: session.sub, scope: request.scope, objectMode: "keep-r2",
    destination: request.destination!, key: input.key, sourceFingerprint: request.sourceFingerprint, snapshotAt, objects: input.objects });
}
