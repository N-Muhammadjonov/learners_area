import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users, userProfilePhotos } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireActiveUser()) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return new NextResponse(null, { status: 404 });
  try {
    const ready = await db.execute(sql`select to_regclass('public.user_profile_photos') as ready`);
    if (!ready.rows[0]?.ready) return new NextResponse(null, { status: 404 });
    const [photo] = await db.select({ image: userProfilePhotos.imageBase64, type: userProfilePhotos.contentType }).from(userProfilePhotos).innerJoin(users, eq(users.id, userProfilePhotos.userId)).where(and(eq(users.id, id), eq(users.accountStatus, "active"))).limit(1);
    if (!photo) return new NextResponse(null, { status: 404 });
    return new NextResponse(Buffer.from(photo.image, "base64"), { headers: { "Content-Type": photo.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new NextResponse(null, { status: 503 }); }
}
