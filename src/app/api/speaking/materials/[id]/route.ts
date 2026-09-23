import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingMaterials, materialBlocks } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { canManageContent } from "@/lib/auth/ownership";
import { updateMaterialSchema, resourceHref, type BlockInput } from "@/lib/validation/speaking";
import {
  claimAttachment,
  releaseAttachments,
  type ClaimedAttachment,
} from "@/lib/data/uploads";
import { getStorageService } from "@/lib/services/storage";
import { inferMaterialType } from "@/lib/uploads/material-type";

/**
 * PATCH /api/speaking/materials/:id — edit an existing resource.
 *
 * Supports everything the composer exposes: rename, replace the primary file,
 * and replace the whole ordered block list (edit text, add, remove, reorder,
 * replace an attachment).
 *
 * Retention rule — the important one: a block the client re-sends by its
 * existing `objectKey` keeps that object. Only keys that disappear from the
 * list are deleted. So editing one text block, or reordering, does not force a
 * re-upload and does not delete a retained object. Replacement is explicit:
 * a new `uploadId` in place of the old key.
 *
 * Deletion order: the DB transaction commits first, then storage objects are
 * removed. If storage cleanup fails we log it and move on — the safer failure
 * direction is a possibly-orphaned object, never a resource pointing at
 * deleted bytes.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const material = await db.query.speakingMaterials.findFirst({ where: eq(speakingMaterials.id, params.id) });
  if (!material) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canManageContent(session, material.createdByUserId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });
  }
  const data = parsed.data;

  const existingBlocks = await db.query.materialBlocks.findMany({
    where: eq(materialBlocks.materialId, params.id),
  });

  // Keys the client may retain without re-uploading: what is stored right now.
  const retainedBlocks = existingBlocks.map((b) => ({
    objectKey: b.objectKey,
    originalName: b.originalName,
    mimeType: b.mimeType,
    size: b.size,
  }));

  // --- Primary replacement -------------------------------------------------
  let primaryUpdate:
    | {
        primaryType: "video" | "audio" | "file" | "link";
        primaryUrl: string;
        primaryObjectKey: string | null;
        primaryOriginalName: string | null;
        primaryMimeType: string | null;
        primarySize: number | null;
      }
    | null = null;

  if (data.primary) {
    if (data.primary.mode === "link") {
      primaryUpdate = {
        primaryType: "link",
        primaryUrl: data.primary.primaryUrl,
        primaryObjectKey: null,
        primaryOriginalName: null,
        primaryMimeType: null,
        primarySize: null,
      };
    } else {
      const claimed = await claimAttachment(data.primary.ref, {
        userId: session.sub,
        purpose: "material_primary",
        materialId: params.id,
        retainedBlocks,
      });
      if (!claimed.ok) return NextResponse.json({ error: claimed.error }, { status: 400 });
      primaryUpdate = {
        primaryType: inferMaterialType(claimed.value.mimeType),
        primaryUrl: resourceHref(claimed.value.objectKey),
        primaryObjectKey: claimed.value.objectKey,
        primaryOriginalName: claimed.value.originalName,
        primaryMimeType: claimed.value.mimeType,
        primarySize: claimed.value.size,
      };
    }
  }

  // --- Blocks --------------------------------------------------------------
  let blockRows:
    | {
        materialId: string;
        type: BlockInput["type"];
        position: number;
        textContent: string | null;
        linkUrl: string | null;
        objectUrl: string | null;
        objectKey: string | null;
        originalName: string | null;
        mimeType: string | null;
        size: number | null;
      }[]
    | null = null;

  const claimedUploadIds: string[] = [];

  if (data.blocks) {
    blockRows = [];
    for (const [index, block] of data.blocks.entries()) {
      if (block.type === "text" || block.type === "link") {
        blockRows.push({
          materialId: params.id,
          type: block.type,
          position: index,
          textContent: block.type === "text" ? block.textContent : null,
          linkUrl: block.type === "link" ? block.linkUrl : null,
          objectUrl: null,
          objectKey: null,
          originalName: null,
          mimeType: null,
          size: null,
        });
        continue;
      }

      const claimed = await claimAttachment(block.ref, {
        userId: session.sub,
        purpose: "material_block",
        blockKind: block.type,
        materialId: params.id,
        retainedBlocks,
      });
      if (!claimed.ok) {
        await releaseAttachments(claimedUploadIds);
        return NextResponse.json({ error: claimed.error }, { status: 400 });
      }
      claimedUploadIds.push(block.ref.uploadId ?? "");
      blockRows.push({
        materialId: params.id,
        type: block.type,
        position: index,
        textContent: null,
        linkUrl: null,
        objectUrl: resourceHref(claimed.value.objectKey),
        objectKey: claimed.value.objectKey,
        originalName: claimed.value.originalName,
        mimeType: claimed.value.mimeType,
        size: claimed.value.size,
      });
    }
  }

  // --- Persist -------------------------------------------------------------
  // Only compute "removed" keys when the client actually sent a new block list.
  // A patch that only flips isActive or renames must NOT be read as "the block
  // list is now empty" and delete every attachment out from under the resource.
  const allExistingKeys = existingBlocks.flatMap((b) => (b.objectKey ? [b.objectKey] : []));
  const keptBlockKeys = new Set(
    blockRows ? blockRows.flatMap((b) => (b.objectKey ? [b.objectKey] : [])) : allExistingKeys
  );
  const removedBlockKeys = blockRows ? allExistingKeys.filter((k) => !keptBlockKeys.has(k)) : [];

  // A replaced primary means the old primary object is no longer referenced.
  const replacedPrimaryKey =
    primaryUpdate && primaryUpdate.primaryObjectKey !== material.primaryObjectKey
      ? material.primaryObjectKey
      : null;

  try {
    await db.transaction(async (tx) => {
      if (data.title !== undefined || data.isActive !== undefined || primaryUpdate) {
        await tx
          .update(speakingMaterials)
          .set({
            ...(data.title !== undefined ? { title: data.title } : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
            ...(primaryUpdate ?? {}),
            updatedAt: new Date(),
          })
          .where(eq(speakingMaterials.id, params.id));
      }

      if (blockRows) {
        await tx.delete(materialBlocks).where(eq(materialBlocks.materialId, params.id));
        if (blockRows.length > 0) {
          await tx.insert(materialBlocks).values(blockRows);
        }
      }
    });
  } catch (err) {
    await releaseAttachments(claimedUploadIds);
    console.error("Material update failed:", err);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  // --- Storage cleanup (after the DB is safely committed) ------------------
  const keysToDelete = [...removedBlockKeys, ...(replacedPrimaryKey ? [replacedPrimaryKey] : [])];
  if (keysToDelete.length > 0) {
    const storage = getStorageService();
    await Promise.all(
      keysToDelete.map((key) =>
        storage.delete(key).catch((err) => console.warn(`Failed to delete storage object ${key}:`, err))
      )
    );
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/speaking/materials/:id — remove a resource and its objects.
 *
 * The DB row goes first (it cascades to blocks). If storage cleanup partially
 * fails afterwards we are left with an orphaned object, which is recoverable
 * by the abandoned-upload sweep — not with a resource pointing at bytes that
 * no longer exist.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const material = await db.query.speakingMaterials.findFirst({ where: eq(speakingMaterials.id, params.id) });
  if (!material) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canManageContent(session, material.createdByUserId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const blocks = await db.query.materialBlocks.findMany({ where: eq(materialBlocks.materialId, params.id) });
  const keysToDelete = [material.primaryObjectKey, ...blocks.map((b) => b.objectKey)].filter(
    (k): k is string => Boolean(k)
  );

  await db.delete(speakingMaterials).where(eq(speakingMaterials.id, params.id));

  const storage = getStorageService();
  await Promise.all(
    keysToDelete.map((key) => storage.delete(key).catch((err) => console.warn(`Failed to delete storage object ${key}:`, err)))
  );

  return NextResponse.json({ ok: true });
}
