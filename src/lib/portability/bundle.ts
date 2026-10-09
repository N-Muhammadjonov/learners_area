import "server-only";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Zip, ZipPassThrough } from "fflate";
import { exportPortableArchive, stableJson } from "./archive";
import { encryptPortableFile } from "./encryption";
import { withPostgresExportSource, type PgPool } from "./postgres-adapter";
import type { ExportScope, ObjectMode, PortableObject } from "./types";

/** Owner-authorized, bounded ZIP production followed by AES-GCM delivery.
 * The ZIP uses stored entries; table rows and object bytes stream to a private
 * staging file. Only the encrypted envelope survives. Keys are never persisted.
 * Callers provide a trusted authenticated owner ID, not a request-body role.
 */
export async function exportEncryptedPostgresBundle(input: {
  pool: PgPool;
  ownerId: string;
  scope: ExportScope;
  objectMode: ObjectMode;
  destination: string;
  key: Uint8Array;
  sourceFingerprint: string;
  snapshotAt: Date;
  objects(scope: ExportScope): AsyncIterable<PortableObject>;
  readObject?(object: PortableObject): AsyncIterable<Uint8Array>;
}) {
  if (input.key.byteLength !== 32) throw new Error("portable_encryption_key_must_be_32_bytes");
  if (!input.ownerId) throw new Error("portable_owner_required");
  const staging = await mkdtemp(join(tmpdir(), "riwi-portable-"));
  const plain = join(staging, "archive.zip");
  const handle = await open(plain, "wx", 0o600).catch(async (error) => { await rm(staging, { recursive: true, force: true }); throw error; });
  let writes = Promise.resolve(); let zipError: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) { zipError = error; return; }
    writes = writes.then(async () => {
      let position = 0;
      while (position < chunk.length) {
        const result = await handle.write(chunk, position, chunk.length - position);
        if (!result.bytesWritten) throw new Error("portable_bundle_write_failed");
        position += result.bytesWritten;
      }
    });
    // Attach a handler immediately, retaining the rejected promise for flush.
    void writes.catch(() => {});
  });
  const flush = async () => { await writes; if (zipError) throw zipError; };
  let active: ZipPassThrough | null = null;
  let closed = false;
  try {
    const manifest = await withPostgresExportSource(input.pool, {
      snapshotAt: input.snapshotAt, scope: input.scope, ownerId: input.ownerId,
      objects: input.objects,
    }, async (source) => {
      const result = await exportPortableArchive({ scope: input.scope, objectMode: input.objectMode,
        sourceFingerprint: input.sourceFingerprint, source,
        sink: {
          async beginFile(path) {
            if (active) throw new Error("portable_bundle_file_overlap");
            active = new ZipPassThrough(path); zip.add(active); await flush();
          },
          async write(chunk) { if (!active) throw new Error("portable_bundle_file_missing"); active.push(Buffer.from(chunk)); await flush(); },
          async endFile() { if (!active) throw new Error("portable_bundle_file_missing"); active.push(new Uint8Array(), true); active = null; await flush(); },
        },
      });
      if (input.objectMode === "move-objects") {
        if (!input.readObject) throw new Error("portable_object_reader_required");
        const stored = new Set<string>();
        for (const object of result.objects) {
          if (stored.has(object.sha256)) continue;
          const entry = new ZipPassThrough(`objects/${object.sha256}`); zip.add(entry);
          const hash = createHash("sha256"); let bytes = 0;
          for await (const chunk of input.readObject(object)) {
            bytes += chunk.byteLength;
            if (bytes > object.byteLength) throw new Error("portable_object_size_mismatch");
            hash.update(chunk); entry.push(chunk); await flush();
          }
          if (bytes !== object.byteLength || hash.digest("hex") !== object.sha256) throw new Error("portable_object_checksum_mismatch");
          entry.push(new Uint8Array(), true); await flush(); stored.add(object.sha256);
        }
      }
      const metadata = new ZipPassThrough("manifest.json"); zip.add(metadata);
      metadata.push(Buffer.from(stableJson(result)), true); zip.end(); await flush();
      return result;
    });
    await handle.close(); closed = true;
    await encryptPortableFile(plain, input.destination, input.key, { removeSourceAfterSuccess: true });
    return manifest;
  } finally {
    zip.terminate();
    await writes.catch(() => {});
    if (!closed) await handle.close();
    await rm(staging, { recursive: true, force: true });
  }
}
