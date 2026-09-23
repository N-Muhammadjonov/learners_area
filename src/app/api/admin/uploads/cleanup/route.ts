import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { cleanupAbandonedUploads } from "@/lib/data/uploads";

/**
 * POST /api/admin/uploads/cleanup — sweeps abandoned uploads.
 *
 * An intent that was never finalized (browser closed mid-upload, user navigated
 * away) still has an object sitting in the bucket. This deletes those objects
 * and closes out their rows.
 *
 * Admin only. Safe to call repeatedly; it only touches intents whose expiry has
 * already passed. Wire it to a scheduler in production — see README.
 */
export async function POST(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const result = await cleanupAbandonedUploads();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("Upload cleanup failed:", err);
    return NextResponse.json({ error: "cleanup_failed" }, { status: 500 });
  }
}
