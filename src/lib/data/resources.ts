import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { resourceBlocks } from "@/db/schema";
import { claimAttachment, releaseAttachments } from "@/lib/data/uploads";
import type { ResourceOwnerType } from "@/lib/services/resources/owners";

export type ResourceBlock = typeof resourceBlocks.$inferSelect;

/**
 * What the browser needs and no more: no user ids, no timestamps. Shared by the
 * composer, the reader view and the API response, so the three cannot drift.
 */
export type ResourceBlockView = {
  id: string;
  type: string;
  position: number;
  textContent: string | null;
  linkUrl: string | null;
  objectKey: string | null;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
};

export function toResourceBlockView(blocks: ResourceBlock[]): ResourceBlockView[] {
  return blocks.map((block) => ({
    id: block.id,
    type: block.type,
    position: block.position,
    textContent: block.textContent,
    linkUrl: block.linkUrl,
    objectKey: block.objectKey,
    originalName: block.originalName,
    mimeType: block.mimeType,
    size: block.size,
  }));
}

/** A block as the browser sends it: media arrives as an upload id or a retained key. */
export type ResourceBlockInput = {
  type: "text" | "link" | "file" | "image" | "audio";
  textContent?: string | null;
  linkUrl?: string | null;
  uploadId?: string | null;
  objectKey?: string | null;
};

export function listResourceBlocks(ownerType: ResourceOwnerType, ownerId: string) {
  return db.query.resourceBlocks.findMany({
    where: and(eq(resourceBlocks.ownerType, ownerType), eq(resourceBlocks.ownerId, ownerId)),
    orderBy: asc(resourceBlocks.position),
  });
}

export type SaveResult =
  | { ok: true; blocks: ResourceBlock[] }
  | { ok: false; status: number; error: string };

/**
 * Replace an owner's material list with exactly what was sent.
 *
 * Why replace rather than patch: the composer is one ordered list, and the order
 * is what a student reads. Replacing makes the stored order identical to the
 * order on screen, so there is no way for a stale index to reorder somebody's
 * materials behind their back.
 *
 * Two rules are enforced here rather than trusted from the request:
 *
 *   * a media block must reference an upload that this user finalized and that
 *     has not already been spent — `claimAttachment` is the single place that
 *     decides that, and it takes every field (name, type, size, key) from the
 *     intent row, never from the body;
 *   * positions are renumbered from zero in the order received, so a client
 *     cannot create two blocks at position 3 or a negative position.
 *
 * If the write fails after uploads were claimed, the claims are released, so a
 * failed save does not strand objects as "attached" to nothing.
 */
export async function saveResourceBlocks(input: {
  ownerType: ResourceOwnerType;
  ownerId: string;
  userId: string;
  blocks: ResourceBlockInput[];
}): Promise<SaveResult> {
  const existing = await listResourceBlocks(input.ownerType, input.ownerId);
  const retained = existing
    .filter((block) => block.objectKey)
    .map((block) => ({
      objectKey: block.objectKey,
      originalName: block.originalName,
      mimeType: block.mimeType,
      size: block.size,
    }));

  const claimedUploadIds: string[] = [];
  const rows: (typeof resourceBlocks.$inferInsert)[] = [];

  for (const [index, block] of input.blocks.entries()) {
    if (block.type === "text") {
      const textContent = (block.textContent ?? "").trim();
      if (!textContent) return { ok: false, status: 400, error: "empty_text_block" };
      rows.push({
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        position: index,
        type: "text",
        textContent: textContent.slice(0, 4000),
        createdByUserId: input.userId,
      });
      continue;
    }

    if (block.type === "link") {
      const linkUrl = (block.linkUrl ?? "").trim();
      let parsed: URL;
      try {
        parsed = new URL(linkUrl);
      } catch {
        return { ok: false, status: 400, error: "invalid_link" };
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false, status: 400, error: "invalid_link" };
      }
      rows.push({
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        position: index,
        type: "link",
        linkUrl: linkUrl.slice(0, 2048),
        createdByUserId: input.userId,
      });
      continue;
    }

    const claim = await claimAttachment(
      { uploadId: block.uploadId ?? null, objectKey: block.objectKey ?? null },
      // A block upload is a material block upload: the intent already proved the
      // file category (image/audio/file) and the size before the bytes moved.
      { userId: input.userId, purpose: "material_block", blockKind: block.type, retainedBlocks: retained }
    );
    if (!claim.ok) return { ok: false, status: 400, error: claim.error };
    if (block.uploadId) claimedUploadIds.push(block.uploadId);

    rows.push({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      position: index,
      type: block.type,
      objectKey: claim.value.objectKey,
      originalName: claim.value.originalName.slice(0, 255),
      mimeType: claim.value.mimeType.slice(0, 120),
      size: claim.value.size,
      createdByUserId: input.userId,
    });
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(resourceBlocks)
        .where(
          and(
            eq(resourceBlocks.ownerType, input.ownerType),
            eq(resourceBlocks.ownerId, input.ownerId)
          )
        );
      if (rows.length > 0) await tx.insert(resourceBlocks).values(rows);
    });
  } catch {
    await releaseAttachments(claimedUploadIds);
    return { ok: false, status: 500, error: "write_failed" };
  }

  return { ok: true, blocks: await listResourceBlocks(input.ownerType, input.ownerId) };
}
