import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningTests, uploadIntents, resourceBlocks } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { createListeningTestSchema } from "@/lib/validation/admin";
export async function POST(req: NextRequest) {
 const user = await requireActiveUser();
 if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
 if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
 const parsed = createListeningTestSchema.safeParse(await req.json().catch(() => null));
 if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });
 const { audioUploadId, ...values } = parsed.data;
 const result = await db.transaction(async tx => {
  const [upload] = audioUploadId ? await tx.select().from(uploadIntents).where(eq(uploadIntents.id, audioUploadId)).for("update") : [];
  if (audioUploadId && (!upload || upload.userId !== user.id || upload.status !== "finalized" || upload.usedAt || upload.purpose !== "material_primary" || !upload.mimeType.startsWith("audio/"))) return { error: "upload_not_owned_or_finalized" };
  const [created] = await tx.insert(listeningTests).values({ ...values, audioUrl: upload ? `/api/resources/${upload.objectKey}` : values.audioUrl, createdByUserId: user.id, publicationState: "draft" }).returning({ id: listeningTests.id });
  if (upload) {
   await tx.insert(resourceBlocks).values({ ownerType: "listening", ownerId: created!.id, position: 0, type: "audio", objectKey: upload.objectKey, originalName: upload.originalName, mimeType: upload.mimeType, size: upload.size, createdByUserId: user.id });
   await tx.update(uploadIntents).set({ status: "attached", usedAt: new Date() }).where(eq(uploadIntents.id, upload.id));
  }
  return { ok: true, id: created!.id };
 });
 return NextResponse.json(result, { status: "error" in result ? 409 : 201 });
}
