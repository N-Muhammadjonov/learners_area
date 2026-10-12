import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { userProfilePhotos } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { enforce } from "@/lib/http/rate-limit";
import { verifySignature } from "@/lib/uploads/signature";
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const limited = enforce({ name: "profile_photo", limit: 12, windowMs: 60_000 }, user.id);
  if (limited) return limited;
  if (Number(req.headers.get("content-length") ?? 0) > 320000) return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File) || !["image/jpeg", "image/png"].includes(file.type) || !file.size || file.size > 307200) return NextResponse.json({ error: "invalid_image" }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!verifySignature(file.type === "image/png" ? "photo.png" : "photo.jpg", bytes).ok) return NextResponse.json({ error: "invalid_image" }, { status: 400 });
  try {
    const ready = await db.execute(sql`select to_regclass('public.user_profile_photos') as ready`);
    if (!ready.rows[0]?.ready) return NextResponse.json({ error: "schema_unavailable" }, { status: 503 });
    const values = { userId: user.id, imageBase64: bytes.toString("base64"), contentType: file.type, updatedAt: new Date() };
    await db.insert(userProfilePhotos).values(values).onConflictDoUpdate({ target: userProfilePhotos.userId, set: values });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "save_failed" }, { status: 503 }); }
}
export async function DELETE() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try { await db.delete(userProfilePhotos).where(eq(userProfilePhotos.userId, user.id)); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ error: "save_failed" }, { status: 503 }); }
}
