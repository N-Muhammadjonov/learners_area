import "server-only";
import { z } from "zod";
import { verifySessionToken } from "@/lib/auth/session";
import { EXPORT_SCOPES } from "./types";
import { createPostgresImportDestination, type PgPool } from "./postgres-adapter";
import { withEncryptedPortableArchive } from "./encrypted-archive";
import { importPortableArchive } from "./archive";

export const portableImportCommandSchema = z.object({ source: z.string().min(1).max(4096), expectedScope: z.enum(EXPORT_SCOPES), dryRun: z.boolean(), destinationFingerprint: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,119}$/) }).strict();
export async function runPortableImportCommand(input: { request: unknown; sessionToken: string; pool: PgPool; key: Uint8Array }) {
  const request = portableImportCommandSchema.parse(input.request);
  const session = await verifySessionToken(input.sessionToken);
  if (!session) throw new Error("portable_owner_required");
  if (request.expectedScope === "riwi") throw new Error("portable_riwi_projection_requires_identity_reconciliation");
  const client = await input.pool.connect();
  try {
    const owner = await client.query("select id from users where id=$1 and role='owner' and account_status='active'", [session.sub]);
    if (!owner.rows.length) throw new Error("portable_owner_required");
  } finally { client.release?.(); }
  return withEncryptedPortableArchive({ source: request.source, key: input.key }, async (manifest, archive) => {
    if (manifest.scope !== request.expectedScope) throw new Error("portable_destination_scope_mismatch");
    if (manifest.sourceFingerprint === request.destinationFingerprint) throw new Error("portable_source_destination_must_differ");
    return importPortableArchive({ manifest, archive, dryRun: request.dryRun,
      destination: createPostgresImportDestination(input.pool, undefined, { ownerId: session.sub, dryRun: request.dryRun, scope: request.expectedScope }) });
  });
}
