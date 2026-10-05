import { and, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  materialBlocks,
  resourceBlocks,
  listeningPackages,
  speakingAttempts,
  speakingMaterials,
  uploadIntents,
  users,
} from "@/db/schema";
import type { Actor } from "@/lib/auth/ownership";
import { isStaff } from "@/lib/auth/roles";
import { canManageContent } from "@/lib/auth/ownership";
import { getStorageService, isSafeObjectKey } from "@/lib/services/storage";
import {
  isResourceOwnerType,
  loadResourceOwner,
  mayReadResources,
} from "@/lib/services/resources/owners";
import { canonicalMimeFor, validateUploadFile, type UploadCategory } from "@/lib/validation/uploads";
import { buildObjectKey } from "@/lib/uploads/keys";
import { verifySignature } from "@/lib/uploads/signature";
import type { StorageService } from "@/lib/services/storage/types";

const SIGNATURE_BYTES = 4096;

/**
 * The upload lifecycle, server side.
 *
 *   intent → presigned PUT → browser uploads direct to R2 → finalize → claim
 *
 * Every step is authorized against the caller and every step writes a row, so
 * there is always a server-side record of who was allowed to write which
 * object key. That record is what makes it safe to accept a direct browser PUT
 * and what stops a client registering an arbitrary bucket key as its own
 * resource.
 *
 * A PUT succeeding in the browser is NOT proof the object exists. `finalize`
 * HEADs the object and compares content type and size against what the intent
 * declared before it will mark anything finalized.
 */

/** How long an unused presigned PUT stays valid. Short on purpose. */
export const PRESIGN_TTL_SECONDS = 5 * 60;

/** How long an unfinalized intent lives before cleanup may delete its object. */
export const UPLOAD_INTENT_TTL_SECONDS = 15 * 60;

/** How long a signed read URL stays valid for private delivery. */
export const READ_URL_TTL_SECONDS = 5 * 60;

export type UploadPurpose = "material_primary" | "material_block" | "speaking_recording";
export type BlockKind = "image" | "audio" | "file";

export type CreateIntentInput = {
  caller: Actor;
  purpose: UploadPurpose;
  blockKind?: BlockKind;
  materialId?: string;
  /** Set for purpose="speaking_recording" — the attempt the recording belongs to. */
  speakingAttemptId?: string;
  filename: string;
  contentType: string;
  size: number;
};

export type CreateIntentResult =
  | {
      ok: true;
      uploadId: string;
      objectKey: string;
      /** "direct" = browser PUTs to uploadUrl; "proxy" = browser POSTs to /api/uploads. */
      mode: "direct" | "proxy";
      uploadUrl: string | null;
      fallbackUploadUrl: string | null;
      contentType: string;
      expiresInSeconds: number;
    }
  | { ok: false; status: number; error: string };

function categoryFor(purpose: UploadPurpose, blockKind?: BlockKind): UploadCategory {
  if (purpose === "material_primary") return "primary";
  if (purpose === "speaking_recording") return "audio";
  return blockKind ?? "file";
}

/**
 * Step 1. Authorizes the upload and issues an intent. The object key is
 * generated here — the browser never chooses it, and never learns a key it was
 * not issued.
 */
export async function createUploadIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
  const { caller, purpose, blockKind, materialId, speakingAttemptId } = input;

  if (purpose === "material_block" && !blockKind) {
    return { ok: false, status: 400, error: "missing_block_kind" };
  }
  if (purpose === "speaking_recording") {
    // A student's own practice recording. The attempt must exist, belong to
    // this user, and still be open for recording — otherwise anyone could hang
    // audio off someone else's attempt by guessing its id.
    if (!speakingAttemptId) return { ok: false, status: 400, error: "missing_attempt_id" };
    const attempt = await db.query.speakingAttempts.findFirst({
      where: eq(speakingAttempts.id, speakingAttemptId),
    });
    if (!attempt) return { ok: false, status: 404, error: "attempt_not_found" };
    if (attempt.userId !== caller.id) return { ok: false, status: 403, error: "forbidden" };
    if (attempt.status !== "recording") return { ok: false, status: 409, error: "attempt_already_submitted" };
  } else if (!isStaff(caller.role)) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  // Editing an existing material: the material must exist and the caller must
  // own it (or be the platform owner). Without this, any teacher could attach
  // objects to someone else's resource by guessing its id.
  if (materialId) {
    const material = await db.query.speakingMaterials.findFirst({
      where: eq(speakingMaterials.id, materialId),
    });
    if (!material) return { ok: false, status: 404, error: "material_not_found" };
    if (!canManageContent(caller, material.createdByUserId)) {
      return { ok: false, status: 403, error: "forbidden" };
    }
  }

  const category = categoryFor(purpose, blockKind);
  const validation = validateUploadFile({
    filename: input.filename,
    contentType: input.contentType,
    size: input.size,
    category,
  });
  if (!validation.ok) {
    return {
      ok: false,
      status: validation.error === "file_too_large" ? 413 : 400,
      error: validation.error,
    };
  }

  // Id is generated up front because an unknown material id means the object
  // has to live in the pending/ namespace, which is keyed by the intent.
  const intentId = crypto.randomUUID();
  const objectKey = buildObjectKey({
    materialId: materialId ?? null,
    speakingAttemptId: speakingAttemptId ?? null,
    intentId,
    category,
    filename: input.filename,
  });

  const storage = getStorageService();
  const direct = storage.supportsDirectUpload;

  // The stored label comes from the extension, not the browser claim: Safari
  // sends "" / octet-stream for ordinary files, and markup must stay inert.
  const contentType = canonicalMimeFor(input.filename, category);

  const presigned = direct
    ? await storage.presignPut({
        key: objectKey,
        contentType,
        expiresInSeconds: PRESIGN_TTL_SECONDS,
      })
    : null;

  await db.insert(uploadIntents).values({
    id: intentId,
    userId: caller.id!,
    materialId: materialId ?? null,
    speakingAttemptId: speakingAttemptId ?? null,
    purpose,
    blockKind: blockKind ?? null,
    objectKey,
    originalName: input.filename.slice(0, 255),
    mimeType: contentType.slice(0, 120),
    size: input.size,
    status: "pending",
    directToStorage: Boolean(presigned),
    expiresAt: new Date(Date.now() + UPLOAD_INTENT_TTL_SECONDS * 1000),
  });

  return {
    ok: true,
    uploadId: intentId,
    objectKey,
    mode: presigned ? "direct" : "proxy",
    uploadUrl: presigned?.uploadUrl ?? null,
    fallbackUploadUrl: presigned?.fallbackUploadUrl ?? null,
    contentType,
    expiresInSeconds: presigned?.expiresInSeconds ?? UPLOAD_INTENT_TTL_SECONDS,
  };
}

export type FinalizeResult =
  | { ok: true; uploadId: string; objectKey: string; originalName: string; mimeType: string; size: number }
  | { ok: false; status: number; error: string };

/**
 * Step 4. Verifies the object actually exists in storage with the declared
 * content type and size, then flips the intent to `finalized`. Only a
 * finalized intent can be claimed by a resource.
 */
export async function finalizeUploadIntent(
  userId: string,
  uploadId: string,
  deps: { database?: typeof db; storage?: StorageService } = {},
): Promise<FinalizeResult> {
  const database = deps.database ?? db;
  if (!isUuid(uploadId)) return { ok: false, status: 400, error: "invalid_upload_id" };

  const intent = await database.query.uploadIntents.findFirst({ where: eq(uploadIntents.id, uploadId) });
  if (!intent || intent.userId !== userId) return { ok: false, status: 404, error: "upload_not_found" };
  if (intent.status === "finalized" || intent.status === "attached") {
    return {
      ok: true,
      uploadId: intent.id,
      objectKey: intent.objectKey,
      originalName: intent.originalName,
      mimeType: intent.mimeType,
      size: intent.size,
    };
  }
  if (intent.status !== "pending") return { ok: false, status: 409, error: "upload_not_active" };
  if (intent.expiresAt.getTime() < Date.now()) return { ok: false, status: 410, error: "upload_expired" };

  const storage = deps.storage ?? getStorageService();
  const head = await storage.head(intent.objectKey);
  if (!head) {
    return { ok: false, status: 409, error: "upload_not_found_in_storage" };
  }

  // Content type: R2 stores what the PUT declared. A mismatch means the bytes
  // that landed are not the bytes that were authorized.
  if (head.contentType && !contentTypesMatch(head.contentType, intent.mimeType)) {
    return { ok: false, status: 409, error: "upload_type_mismatch" };
  }
  // Size: R2 reports exactly what arrived. A short or padded PUT is a truncated
  // or tampered upload, not something to attach to course content.
  if (typeof head.size === "number" && head.size > 0 && head.size !== intent.size) {
    return { ok: false, status: 409, error: "upload_size_mismatch" };
  }

  // Stored bytes are the authority. The browser's signature preflight is a UX
  // shortcut a custom client can skip; this check cannot be skipped, because
  // nothing can claim an intent that never reaches `finalized`.
  const prefix = await storage.readHead(intent.objectKey, SIGNATURE_BYTES);
  const verdict = prefix ? verifySignature(intent.originalName, new Uint8Array(prefix)) : { ok: false as const, reason: "mismatch" as const };
  if (!verdict.ok) {
    const error = verdict.reason === "executable" ? "dangerous_type" : "upload_type_mismatch";
    await database
      .update(uploadIntents)
      .set({ status: "aborted", error: `signature_${verdict.reason}` })
      .where(and(eq(uploadIntents.id, intent.id), eq(uploadIntents.status, "pending")));
    await storage.delete(intent.objectKey).catch((err) => {
      // The intent is already aborted, so the object can never be claimed;
      // the expired-intent sweeper retries the delete.
      console.warn(`finalizeUploadIntent: could not delete rejected ${intent.objectKey}:`, err);
    });
    return { ok: false, status: 422, error };
  }

  const finalized = await database
    .update(uploadIntents)
    .set({ status: "finalized", finalizedAt: new Date(), error: null })
    .where(and(eq(uploadIntents.id, intent.id), eq(uploadIntents.status, "pending"), gt(uploadIntents.expiresAt, new Date())))
    .returning({ id: uploadIntents.id });
  if (!finalized.length) return { ok: false, status: 409, error: "upload_not_active" };

  return {
    ok: true,
    uploadId: intent.id,
    objectKey: intent.objectKey,
    originalName: intent.originalName,
    mimeType: intent.mimeType,
    size: intent.size,
  };
}

/**
 * Cancel. Marks the intent aborted and removes the object if it already
 * landed — a cancelled upload must not leave a billable orphan behind.
 */
export async function abortUploadIntent(userId: string, uploadId: string): Promise<{ ok: boolean }> {
  if (!isUuid(uploadId)) return { ok: false };
  const intent = await db.query.uploadIntents.findFirst({ where: eq(uploadIntents.id, uploadId) });
  if (!intent || intent.userId !== userId) return { ok: false };
  if (intent.status === "attached") return { ok: false }; // still referenced by content

  const aborted = await db.update(uploadIntents).set({ status: "aborted" }).where(
    and(eq(uploadIntents.id, intent.id), inArray(uploadIntents.status, ["pending", "finalized", "aborted"]))
  ).returning({ id: uploadIntents.id });
  if (!aborted.length) return { ok: false };

  const storage = getStorageService();
  await storage.delete(intent.objectKey).catch((err) => {
    console.warn(`abortUploadIntent: could not delete ${intent.objectKey}:`, err);
  });
  return { ok: true };
}

export type ClaimedAttachment = {
  objectKey: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export type ClaimContext = {
  userId: string;
  purpose: UploadPurpose;
  blockKind?: BlockKind;
  materialId?: string;
  /** Blocks already stored on the material — these may be retained without re-uploading. */
  retainedBlocks?: { objectKey: string | null; originalName: string | null; mimeType: string | null; size: number | null }[];
};

export type ClaimResult = { ok: true; value: ClaimedAttachment } | { ok: false; error: string };

/**
 * Turns a client-supplied attachment reference into an authoritative one.
 *
 * Two legitimate shapes:
 *   1. `{ uploadId }` — a fresh upload. The intent must exist, belong to this
 *      user, match the purpose/kind, be finalized, and not already be spent.
 *      All metadata comes from the intent row, never from the request body.
 *   2. `{ objectKey }` with no uploadId — an object already attached to this
 *      same material, being retained across an edit (reordering, or editing an
 *      unrelated text block, must not force a re-upload).
 *
 * Anything else — a bare objectKey the caller was never issued — is rejected.
 * That is the control that stops "register an arbitrary R2 key as my resource".
 */
export async function claimAttachment(
  input: {
    uploadId?: string | null;
    objectKey?: string | null;
  },
  ctx: ClaimContext
): Promise<ClaimResult> {
  if (input.uploadId) {
    if (!isUuid(input.uploadId)) return { ok: false, error: "invalid_upload_id" };
    const intent = await db.query.uploadIntents.findFirst({ where: eq(uploadIntents.id, input.uploadId) });
    if (!intent || intent.userId !== ctx.userId) return { ok: false, error: "upload_not_found" };
    if (intent.purpose !== ctx.purpose) return { ok: false, error: "upload_purpose_mismatch" };
    if (ctx.purpose === "material_block" && intent.blockKind !== ctx.blockKind) {
      return { ok: false, error: "upload_kind_mismatch" };
    }
    if (ctx.materialId && intent.materialId && intent.materialId !== ctx.materialId) {
      return { ok: false, error: "upload_material_mismatch" };
    }
    if (intent.status !== "finalized" || intent.usedAt) {
      return { ok: false, error: "upload_not_finalized" };
    }

    const claimed = await db
      .update(uploadIntents)
      .set({ status: "attached", usedAt: new Date() })
      .where(and(eq(uploadIntents.id, intent.id), eq(uploadIntents.status, "finalized")))
      .returning({ id: uploadIntents.id });
    if (!claimed.length) return { ok: false, error: "upload_not_finalized" };

    return {
      ok: true,
      value: {
        objectKey: intent.objectKey,
        originalName: intent.originalName,
        mimeType: intent.mimeType,
        size: intent.size,
      },
    };
  }

  if (input.objectKey) {
    const retained = (ctx.retainedBlocks ?? []).find((b) => b.objectKey === input.objectKey);
    if (!retained) return { ok: false, error: "object_not_owned" };
    return {
      ok: true,
      value: {
        objectKey: retained.objectKey!,
        originalName: retained.originalName ?? "file",
        mimeType: retained.mimeType ?? "application/octet-stream",
        size: retained.size ?? 0,
      },
    };
  }

  return { ok: false, error: "missing_attachment" };
}

/**
 * Attaches a finalized recording upload to a Speaking attempt.
 *
 * The intent must be finalized, must belong to this user, and must have been
 * issued for this exact attempt — the same rule that stops arbitrary keys
 * being registered as resources applies here, so a recording cannot be pointed
 * at someone else's attempt.
 */
export async function attachRecordingToAttempt(input: {
  userId: string;
  attemptId: string;
  uploadId: string;
  durationMs?: number;
}): Promise<{ ok: true; objectKey: string } | { ok: false; status: number; error: string }> {
  return db.transaction(async (tx) => {
    // Resolve the lifecycle lock before locking the attempt. Pending/aborted
    // cleanup must not wait on an attempt held by a caller waiting on its intent.
    // Already attached intents return immediately, without waiting on an old
    // attempt currently being expired by retention.
    const [intent] = await tx.select().from(uploadIntents)
      .where(eq(uploadIntents.id, input.uploadId)).for("update");
    if (!intent || intent.userId !== input.userId) {
      return { ok: false as const, status: 404, error: "upload_not_found" };
    }
    if (intent.purpose !== "speaking_recording" || intent.speakingAttemptId !== input.attemptId) {
      return { ok: false as const, status: 400, error: "upload_purpose_mismatch" };
    }
    if (intent.status !== "finalized" || intent.usedAt) {
      return { ok: false as const, status: 409, error: "upload_not_finalized" };
    }
    const [attempt] = await tx.select().from(speakingAttempts)
      .where(eq(speakingAttempts.id, input.attemptId)).for("update");
    if (!attempt || attempt.userId !== input.userId) {
      return { ok: false as const, status: 404, error: "attempt_not_found" };
    }
    if (attempt.status !== "recording") {
      return { ok: false as const, status: 409, error: "attempt_already_submitted" };
    }
    const [account] = await tx.select({ status: users.accountStatus }).from(users)
      .where(eq(users.id, input.userId)).for("update");
    if (account?.status !== "active") return { ok: false as const, status: 403, error: "forbidden" };

    const now = new Date();
    await tx.update(uploadIntents).set({ status: "attached", usedAt: now }).where(eq(uploadIntents.id, intent.id));
    await tx.update(speakingAttempts).set({
      recordingObjectKey: intent.objectKey,
      recordingOriginalName: intent.originalName,
      recordingMimeType: intent.mimeType,
      recordingSize: intent.size,
      ...(input.durationMs !== undefined ? { recordingDurationMs: input.durationMs } : {}),
    }).where(eq(speakingAttempts.id, attempt.id));
    await tx.update(users).set({ lastMeaningfulActivityAt: sql`greatest(${users.lastMeaningfulActivityAt}, ${now})` })
      .where(eq(users.id, input.userId));
    return { ok: true as const, objectKey: intent.objectKey };
  });
}

/**
 * Compensating action for a failed resource write: returns claimed intents to
 * `finalized` so the objects are not stranded as "attached" to nothing. They
 * remain retryable. Finalized orphan reconciliation is a separate open audit item.
 */
export async function releaseAttachments(uploadIds: string[]): Promise<void> {
  const ids = uploadIds.filter(Boolean);
  if (ids.length === 0) return;
  await db
    .update(uploadIntents)
    .set({ status: "finalized", usedAt: null })
    .where(and(inArray(uploadIntents.id, ids), eq(uploadIntents.status, "attached")));
}

/**
 * Abandoned-upload cleanup. Anything still `pending` past its expiry is an
 * orphan — the browser went away mid-upload, or the tab was closed — so its
 * object is deleted and the row is closed out only after storage succeeds.
 * This bounded sweep covers pending/aborted intents. It does not list storage
 * to find objects without intents, or remove finalized/attached intents.
 *
 * Returns how many objects it removed, so a caller can log/verify it.
 */
export async function cleanupAbandonedUploads(connection: Pick<typeof db, "select" | "update" | "delete"> = db): Promise<{ removedIntents: number; removedObjects: number }> {
  const now = new Date();
  const stale = await connection.select().from(uploadIntents).where(and(
    inArray(uploadIntents.status, ["pending", "aborted"]), lt(uploadIntents.expiresAt, now)
  )).orderBy(uploadIntents.expiresAt).limit(500);
  const storage = getStorageService();
  let removedObjects = 0;
  let removedIntents = 0;
  for (const intent of stale) {
    // Competes atomically with finalization/claim. No stale read can delete an
    // object after its intent has become finalized/attached.
    const claimed = await connection.update(uploadIntents).set({ status: "aborted" }).where(and(
      eq(uploadIntents.id, intent.id), inArray(uploadIntents.status, ["pending", "aborted"]), lt(uploadIntents.expiresAt, now)
    )).returning({ id: uploadIntents.id });
    if (!claimed.length) continue;
    try {
      await storage.delete(intent.objectKey);
    } catch {
      console.warn("upload cleanup: object deletion failed; intent retained for retry");
      continue;
    }
    removedObjects++;
    const removed = await connection.delete(uploadIntents).where(and(
      eq(uploadIntents.id, intent.id), eq(uploadIntents.status, "aborted")
    )).returning({ id: uploadIntents.id });
    removedIntents += removed.length;
  }
  return { removedIntents, removedObjects };
}

// ---------------------------------------------------------------------------
// Private read authorization
// ---------------------------------------------------------------------------

export type ResourceAccess =
  | { allowed: true; objectKey: string; ownerId: string; materialId: string }
  | { allowed: false; reason: "not_found" | "forbidden" };

/**
 * Decides whether `caller` may read `objectKey`.
 *
 * Course content is private by default: an object is readable when it belongs
 * to an ACTIVE material, or when the caller manages that material (its author,
 * or the platform owner). An inactive material's files are only reachable by
 * the people who can still see it in the management view — a deactivated
 * resource must stop being readable by students immediately, not whenever a
 * cache happens to expire.
 *
 * Unknown keys are reported as not-found rather than forbidden, so the route
 * cannot be used to enumerate which objects exist.
 */
export async function authorizeResourceRead(caller: Actor, objectKey: string): Promise<ResourceAccess> {
  if (!isSafeObjectKey(objectKey)) return { allowed: false, reason: "not_found" };

  const block = await db.query.materialBlocks.findFirst({
    where: eq(materialBlocks.objectKey, objectKey),
  });
  const primary = block
    ? null
    : await db.query.speakingMaterials.findFirst({
        where: eq(speakingMaterials.primaryObjectKey, objectKey),
      });

  const materialId = block?.materialId ?? primary?.id;
  if (materialId) {
    const material = await db.query.speakingMaterials.findFirst({
      where: eq(speakingMaterials.id, materialId),
    });
    if (!material) return { allowed: false, reason: "not_found" };
    const mayRead = material.isActive || canManageContent(caller, material.createdByUserId);
    if (!mayRead) return { allowed: false, reason: "forbidden" };
    return { allowed: true, objectKey, ownerId: material.createdByUserId, materialId };
  }

  // Imported Listening packages predate the universal resource-block mirror in
  // some deployed databases. The package row is the authoritative owner of its
  // audio/image object, so those assets must remain readable even when an older
  // import has no resource_blocks row.
  let listeningPackage: typeof listeningPackages.$inferSelect | undefined;
  try {
    listeningPackage = await db.query.listeningPackages.findFirst({
      where: or(
        eq(listeningPackages.audioObjectKey, objectKey),
        eq(listeningPackages.imageObjectKey, objectKey),
      ),
    });
  } catch (err) {
    // During a staged migration an older database may not have
    // listening_packages yet. That must not take unrelated private resources
    // offline; the legacy/resource/speaking ownership checks below still apply.
    console.warn("[resources] listening package ownership lookup unavailable", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (listeningPackage) {
    const owner = await loadResourceOwner("listening", listeningPackage.testId);
    if (!owner) return { allowed: false, reason: "not_found" };
    if (!mayReadResources(caller.role, owner)) return { allowed: false, reason: "forbidden" };
    return { allowed: true, objectKey, ownerId: owner.creatorId ?? owner.id, materialId: owner.id };
  }

  // A material attached by the universal composer belongs to a content owner
  // (a passage, a lesson, a live class …). It is readable exactly when that owner
  // is readable: staff always, a student only while the content is live. The
  // registry is asked, rather than trusting the key's path, so withdrawing the
  // content withdraws its files in the same breath.
  const resourceBlock = await db.query.resourceBlocks.findFirst({
    where: eq(resourceBlocks.objectKey, objectKey),
  });
  if (resourceBlock && isResourceOwnerType(resourceBlock.ownerType)) {
    const owner = await loadResourceOwner(resourceBlock.ownerType, resourceBlock.ownerId);
    if (!owner) return { allowed: false, reason: "not_found" };
    if (!mayReadResources(caller.role, owner)) return { allowed: false, reason: "forbidden" };
    return { allowed: true, objectKey, ownerId: resourceBlock.createdByUserId, materialId: owner.id };
  }

  // A practice recording belongs to one student's attempt. Readable by that
  // student and by any teacher/admin (so a teacher can review it) — never by
  // another student.
  const attempt = await db.query.speakingAttempts.findFirst({
    where: eq(speakingAttempts.recordingObjectKey, objectKey),
  });
  if (!attempt) return { allowed: false, reason: "not_found" };

  const mayRead =
    attempt.userId === caller.id || isStaff(caller.role);
  if (!mayRead) return { allowed: false, reason: "forbidden" };

  return { allowed: true, objectKey, ownerId: attempt.userId, materialId: attempt.id };
}

/** Resolves the stored content type for an object, for the local read path. */
export async function storedContentType(objectKey: string): Promise<string | null> {
  const block = await db.query.materialBlocks.findFirst({
    where: eq(materialBlocks.objectKey, objectKey),
  });
  if (block?.mimeType) return block.mimeType;
  const primary = await db.query.speakingMaterials.findFirst({
    where: eq(speakingMaterials.primaryObjectKey, objectKey),
  });
  if (primary?.primaryMimeType) return primary.primaryMimeType;
  const intent = await db.query.uploadIntents.findFirst({
    where: eq(uploadIntents.objectKey, objectKey),
  });
  if (intent?.mimeType) return intent.mimeType;
  const attempt = await db.query.speakingAttempts.findFirst({
    where: eq(speakingAttempts.recordingObjectKey, objectKey),
  });
  return attempt?.recordingMimeType ?? null;
}

function contentTypesMatch(actual: string, declared: string): boolean {
  const normalize = (v: string) => v.split(";")[0]!.trim().toLowerCase();
  const a = normalize(actual);
  const d = normalize(declared);
  if (a === d) return true;
  // Browsers and R2 both legitimately widen an untyped file to octet-stream.
  if (a === "application/octet-stream" || d === "application/octet-stream") return true;
  return false;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Re-exported for convenience in routes that need the owning user's name. */
export type { users };
