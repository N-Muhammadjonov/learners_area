import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingMaterials, materialBlocks } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { canManageContent } from "@/lib/auth/ownership";
import { updateMaterialSchema } from "@/lib/validation/speaking";
import { getStorageService } from "@/lib/services/storage";

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
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const data = parsed.data;

  await db.transaction(async (tx) => {
    if (data.title !== undefined || data.isActive !== undefined) {
      await tx
        .update(speakingMaterials)
        .set({
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(speakingMaterials.id, params.id));
    }

    if (data.blocks) {
      // Existing attachments the client re-sent unchanged keep their
      // objectKey, so we only delete storage objects for keys that
      // disappear entirely (blocks the user removed) — not ones simply
      // re-ordered or accompanying an edited text block elsewhere.
      const existing = await tx.query.materialBlocks.findMany({ where: eq(materialBlocks.materialId, params.id) });
      const keptKeys = new Set(data.blocks.map((b) => ("objectKey" in b ? b.objectKey : null)).filter(Boolean));
      const removedKeys = existing.map((b) => b.objectKey).filter((k): k is string => !!k && !keptKeys.has(k));

      await tx.delete(materialBlocks).where(eq(materialBlocks.materialId, params.id));
      if (data.blocks.length > 0) {
        await tx.insert(materialBlocks).values(
          data.blocks.map((b, i) => ({
            materialId: params.id,
            type: b.type,
            position: i,
            textContent: b.type === "text" ? b.textContent : undefined,
            linkUrl: b.type === "link" ? b.linkUrl : undefined,
            objectUrl: "objectUrl" in b ? b.objectUrl : undefined,
            objectKey: "objectKey" in b ? b.objectKey : undefined,
            originalName: "originalName" in b ? b.originalName : undefined,
            mimeType: "mimeType" in b ? b.mimeType : undefined,
            size: "size" in b ? b.size : undefined,
          }))
        );
      }

      if (removedKeys.length > 0) {
        const storage = getStorageService();
        await Promise.all(
          removedKeys.map((key) =>
            storage.delete(key).catch((err) => console.warn(`Failed to delete storage object ${key}:`, err))
          )
        );
      }
    }
  });

  return NextResponse.json({ ok: true });
}

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
    (k): k is string => !!k
  );

  // DB row goes first (cascades to blocks) — if storage cleanup partially
  // fails below, we don't leave an orphaned resource still visible to
  // students, just a possibly-orphaned object in the bucket, which is the
  // safer failure direction.
  await db.delete(speakingMaterials).where(eq(speakingMaterials.id, params.id));

  const storage = getStorageService();
  await Promise.all(
    keysToDelete.map((key) => storage.delete(key).catch((err) => console.warn(`Failed to delete storage object ${key}:`, err)))
  );

  return NextResponse.json({ ok: true });
}
