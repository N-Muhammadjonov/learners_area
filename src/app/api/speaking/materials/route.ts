import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { speakingMaterials, materialBlocks, activityEvents } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { createMaterialSchema } from "@/lib/validation/speaking";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "teacher" && session.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createMaterialSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });
  const data = parsed.data;

  const materialId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(speakingMaterials)
      .values({
        createdByUserId: session.sub,
        category: data.category,
        title: data.title,
        primaryType: data.primaryType,
        primaryUrl: data.primaryUrl,
        primaryObjectKey: data.primaryObjectKey,
        primaryOriginalName: data.primaryOriginalName,
        primaryMimeType: data.primaryMimeType,
        primarySize: data.primarySize,
      })
      .returning();

    if (data.blocks.length > 0) {
      await tx.insert(materialBlocks).values(
        data.blocks.map((b, i) => ({
          materialId: created!.id,
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

    return created!.id;
  });

  await db.insert(activityEvents).values({
    userId: session.sub,
    type: "SPEAKING_MATERIAL_POSTED",
    payload: { materialId },
  });

  return NextResponse.json({ ok: true, id: materialId });
}
