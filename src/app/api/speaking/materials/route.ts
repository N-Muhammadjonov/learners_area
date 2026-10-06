import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { speakingMaterials, materialBlocks, activityEvents } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { createMaterialSchema, resourceHref, type BlockInput } from "@/lib/validation/speaking";
import { claimAttachment, releaseAttachments } from "@/lib/data/uploads";
import { inferMaterialType } from "@/lib/uploads/material-type";
import { pinSpeakingMaterialVersion, sourceRefForSpeakingMaterial } from "@/lib/services/speaking/materials";

/**
 * POST /api/speaking/materials — create a resource.
 *
 * A resource is a primary file/link plus an ordered list of description blocks
 * (text, link, image, audio, file). Block order is persisted as `position`;
 * it is not left to client array order.
 *
 * Attachments arrive as references to upload intents this user was issued.
 * Filename/mime/size are resolved server-side from the intent row, so a client
 * cannot claim a bigger, different or arbitrary object than the one it was
 * authorized to upload.
 *
 * This route is also where an UPLOAD-BACKED material gets its canonical identity
 * (§6): the row is given a revision in `content_versions` under the same
 * (module, contentType, sourceRef) contract as every other content kind, with the
 * attachment represented by its type and name — never by its object key. Files are
 * the one thing an authoring payload may not carry, so this pipeline remains the
 * only door for them; the identity it writes is the same one authoring uses.
 */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!isStaff(user.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

  const body = await req.json().catch(() => null);
  const parsed = createMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });
  }
  const data = parsed.data;

  // --- Primary -------------------------------------------------------------
  let primaryUrl: string;
  let primaryType: "video" | "audio" | "file" | "link";
  let primaryObjectKey: string | null = null;
  let primaryOriginalName: string | null = null;
  let primaryMimeType: string | null = null;
  let primarySize: number | null = null;

  if (data.primary.mode === "link") {
    primaryUrl = data.primary.primaryUrl;
    primaryType = "link";
  } else {
    const claimed = await claimAttachment(data.primary.ref, {
      userId: user.id,
      purpose: "material_primary",
    });
    if (!claimed.ok) return NextResponse.json({ error: claimed.error }, { status: 400 });
    const value = claimed.value;
    primaryObjectKey = value.objectKey;
    primaryOriginalName = value.originalName;
    primaryMimeType = value.mimeType;
    primarySize = value.size;
    primaryType = inferMaterialType(value.mimeType);
    // Stable path, not a signed URL — see validation/uploads.ts#resourceHref.
    primaryUrl = resourceHref(value.objectKey);
  }

  // --- Blocks --------------------------------------------------------------
  const resolvedBlocks: {
    type: BlockInput["type"];
    position: number;
    textContent?: string;
    linkUrl?: string;
    objectKey: string | null;
    originalName: string | null;
    mimeType: string | null;
    size: number | null;
  }[] = [];
  const claimedUploadIds: string[] = [];

  for (const [index, block] of data.blocks.entries()) {
    if (block.type === "text") {
      resolvedBlocks.push({ type: "text", position: index, textContent: block.textContent, objectKey: null, originalName: null, mimeType: null, size: null });
      continue;
    }
    if (block.type === "link") {
      resolvedBlocks.push({ type: "link", position: index, linkUrl: block.linkUrl, objectKey: null, originalName: null, mimeType: null, size: null });
      continue;
    }
    const claimed = await claimAttachment(block.ref, {
      userId: user.id,
      purpose: "material_block",
      blockKind: block.type,
    });
    if (!claimed.ok) {
      await releaseAttachments(claimedUploadIds);
      return NextResponse.json({ error: claimed.error }, { status: 400 });
    }
    claimedUploadIds.push(block.ref.uploadId ?? "");
    resolvedBlocks.push({ type: block.type, position: index, ...claimed.value });
  }

  // --- Persist -------------------------------------------------------------
  const requestedSourceRef = (() => {
    const value = (body as { sourceRef?: unknown } | null)?.sourceRef;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  })();

  let materialId: string;
  let sourceRef: string;
  try {
    const stored = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(speakingMaterials)
        .values({
          createdByUserId: user.id,
          category: data.category,
          title: data.title,
          primaryType,
          primaryUrl,
          primaryObjectKey,
          primaryOriginalName,
          primaryMimeType,
          primarySize,
        })
        .returning();

      if (resolvedBlocks.length > 0) {
        await tx.insert(materialBlocks).values(
          resolvedBlocks.map((b) => ({
            materialId: created!.id,
            type: b.type,
            position: b.position,
            textContent: b.textContent ?? null,
            linkUrl: b.linkUrl ?? null,
            objectUrl: b.objectKey ? resourceHref(b.objectKey) : null,
            objectKey: b.objectKey,
            originalName: b.originalName,
            mimeType: b.mimeType,
            size: b.size,
          }))
        );
      }
      // Identity: the item's own row name, stable across edits. A caller editing an
      // existing material may name it; a caller that does not is never trusted to
      // invent one from a title — a fresh opaque ref is minted and recorded.
      const identity = requestedSourceRef ?? (await sourceRefForSpeakingMaterial(created!.id, tx as never)) ?? randomUUID();
      await pinSpeakingMaterialVersion(tx as never, {
        materialId: created!.id,
        sourceRef: identity,
        title: created!.title,
        category: created!.category,
        primaryType: created!.primaryType,
        primaryUrl: created!.primaryUrl,
        primaryObjectKey: created!.primaryObjectKey,
        primaryOriginalName: created!.primaryOriginalName,
        primaryMimeType: created!.primaryMimeType,
        primarySize: created!.primarySize,
        publicationState: created!.publicationState,
        actorUserId: user.id,
        via: "upload_route",
      });
      return { id: created!.id, sourceRef: identity };
    });
    materialId = stored.id;
    sourceRef = stored.sourceRef;
  } catch (err) {
    // DB write failed — hand the objects back so cleanup can reclaim them
    // rather than leaving them attached to a resource that does not exist.
    await releaseAttachments(claimedUploadIds);
    console.error("Material creation failed:", err);
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }

  await db.insert(activityEvents).values({
    userId: user.id,
    type: "SPEAKING_MATERIAL_POSTED",
    payload: { materialId },
  });

  return NextResponse.json({ ok: true, id: materialId, sourceRef, contentType: "speaking:material" });
}
