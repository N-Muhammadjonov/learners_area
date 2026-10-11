import { createHash } from "node:crypto";
import { isSafeObjectKey } from "@/lib/validation/uploads";
import type { StorageService } from "@/lib/services/storage/types";
import type { ImportDestination, ImportTransaction } from "./archive";
import type { PortableObject } from "./types";

/**
 * O2 (move-objects) lifecycle around the existing import transaction.
 *
 * It reuses the application's StorageService; it is not a second storage client.
 *  - Only `active` objects are copied; the destination key is the stable source key.
 *  - A copy is never performed over an existing different object (fail closed).
 *    An existing object with identical size/SHA(/MIME) is reused and is NOT
 *    treated as staged, so cleanup can never delete pre-existing or shared data.
 *  - Every newly created object is read back and byte/size/SHA(/MIME) verified.
 *  - A failure before COMMIT removes only the objects this attempt created.
 *  - An uncertain COMMIT never deletes anything: staged keys are preserved for
 *    reconciliation against the database outcome.
 *  - Cleanup failures stay in the receipt and can be retried.
 * Receipts carry keys and metadata only, never object bytes or credentials.
 */
export type ObjectCopyState = "pending" | "dry_run" | "committed" | "rolled_back" | "commit_uncertain_preserved" | "object_write_uncertain_preserved";
export type ObjectCopyReceipt = Readonly<{
  state: ObjectCopyState;
  staged: readonly { key: string; sha256: string; byteLength: number; mimeType: string }[];
  reused: readonly { key: string; sha256: string; byteLength: number }[];
  cleanedUp: readonly string[];
  cleanupFailures: readonly { key: string; code: string }[];
  uncertainWrites: readonly { key: string; sha256: string; byteLength: number }[];
  reconciliation: null | Readonly<{ action: "verify_database_then_delete_or_keep" | "verify_object_creation_ownership"; stagedKeys: readonly string[] }>;
}>;
export type ObjectCopyStore = Pick<StorageService, "kind" | "putIfAbsent" | "read" | "delete">;

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function withObjectCopyLifecycle(destination: ImportDestination, store: ObjectCopyStore, options: { dryRun?: boolean } = {}): {
  destination: ImportDestination;
  receipt(): ObjectCopyReceipt;
  /** Retry deletion of objects that failed cleanup earlier. Never touches committed/uncertain objects. */
  retryCleanup(): Promise<ObjectCopyReceipt>;
} {
  let state: ObjectCopyState = "pending";
  let used = false;
  const staged: { key: string; sha256: string; byteLength: number; mimeType: string }[] = [];
  const reused: { key: string; sha256: string; byteLength: number }[] = [];
  const uncertainWrites: { key: string; sha256: string; byteLength: number }[] = [];
  const cleanedUp: string[] = [];
  let cleanupFailures: { key: string; code: string }[] = [];
  let removable: string[] = [];

  const matches = (read: { body: Buffer; contentType: string } | null, object: PortableObject) =>
    Boolean(read) && read!.body.byteLength === object.byteLength && sha(read!.body) === object.sha256
    // The local provider infers MIME from the key; object stores persist it.
    && (store.kind !== "s3" || read!.contentType.split(";")[0]!.trim().toLowerCase() === object.mimeType.toLowerCase());

  async function copy(object: PortableObject, bytes: Uint8Array): Promise<void> {
    if (object.retentionState !== "active") throw new Error(`object_retention_not_active:${object.sourceKey}`);
    const key = object.destinationKey ?? object.sourceKey;
    if (!isSafeObjectKey(key)) throw new Error("object_destination_key_unsafe");
    if (bytes.byteLength !== object.byteLength || sha(bytes) !== object.sha256) throw new Error(`object_checksum_mismatch:${object.sourceKey}`);
    const existing = await store.read(key);
    if (existing) {
      if (!matches(existing, object)) throw new Error(`object_destination_collision:${key}`);
      reused.push({ key, sha256: object.sha256, byteLength: object.byteLength });
      return;
    }
    let created: boolean;
    try { created = await store.putIfAbsent({ key, body: Buffer.from(bytes), contentType: object.mimeType }); }
    catch {
      // A lost response does not prove whether this attempt created the object.
      // Never infer ownership from identical bytes or delete this key automatically.
      uncertainWrites.push({ key, sha256: object.sha256, byteLength: object.byteLength });
      throw new Error("object_create_outcome_uncertain");
    }
    if (!created) {
      // Lost a creation race: accept only identical bytes, never claim ownership.
      if (!matches(await store.read(key), object)) throw new Error(`object_destination_collision:${key}`);
      reused.push({ key, sha256: object.sha256, byteLength: object.byteLength });
      return;
    }
    staged.push({ key, sha256: object.sha256, byteLength: object.byteLength, mimeType: object.mimeType });
    removable.push(key);
    if (!matches(await store.read(key), object)) throw new Error(`object_readback_mismatch:${key}`);
  }

  async function cleanup(): Promise<void> {
    const pending = removable; removable = []; cleanupFailures = [];
    for (const key of [...pending].reverse()) {
      try { await store.delete(key); cleanedUp.push(key); }
      catch { cleanupFailures.push({ key, code: "object_cleanup_failed" }); removable.push(key); }
    }
  }

  const snapshot = (): ObjectCopyReceipt => ({
    state, staged: [...staged], reused: [...reused], cleanedUp: [...cleanedUp], cleanupFailures: [...cleanupFailures], uncertainWrites: [...uncertainWrites],
    reconciliation: state === "commit_uncertain_preserved"
      ? { action: "verify_database_then_delete_or_keep", stagedKeys: staged.map(item => item.key) }
      : state === "object_write_uncertain_preserved" ? { action: "verify_object_creation_ownership", stagedKeys: uncertainWrites.map(item => item.key) } : null,
  });

  return {
    destination: {
      ...(destination.orderTables ? { orderTables: destination.orderTables.bind(destination) } : {}),
      async transaction<T>(work: (tx: ImportTransaction) => Promise<T>): Promise<T> {
        if (used) throw new Error("object_lifecycle_single_use");
        used = true;
        try {
          const value = await destination.transaction(tx => work({
            planRow: tx.planRow.bind(tx), applyRow: tx.applyRow.bind(tx), copyObject: copy,
            ...(tx.finalize ? { finalize: tx.finalize.bind(tx) } : {}),
          }));
          state = options.dryRun ? "dry_run" : "committed";
          return value;
        } catch (error) {
          if (error instanceof Error && error.message === "portable_import_commit_uncertain") {
            state = "commit_uncertain_preserved"; // never delete: the DB may have committed
          } else {
            await cleanup();
            state = uncertainWrites.length ? "object_write_uncertain_preserved" : "rolled_back";
          }
          throw error;
        }
      },
    },
    receipt: snapshot,
    async retryCleanup() {
      if ((state === "rolled_back" || state === "object_write_uncertain_preserved") && removable.length) await cleanup();
      return snapshot();
    },
  };
}
