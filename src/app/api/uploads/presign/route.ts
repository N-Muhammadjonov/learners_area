import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getStorageService } from "@/lib/services/storage";

/**
 * Direct-to-storage upload path (S3/R2 only — see storage/types.ts). The
 * browser calls this to get a short-lived signed PUT URL, uploads the file
 * bytes straight to R2 (never through this server), then includes the
 * returned `key`/`publicUrl` when creating the material/block.
 *
 * Not yet wired up on the client — the composer currently always proxies
 * through /api/uploads regardless of provider, which is simpler and
 * provider-agnostic. This endpoint is real and correct; swapping the
 * client to prefer it when STORAGE_PROVIDER=s3 is the natural next step.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "teacher" && session.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const filename = body?.filename;
  const contentType = body?.contentType;
  const folder = body?.folder || "speaking";

  if (typeof filename !== "string" || typeof contentType !== "string" || !/^[a-z0-9_-]+$/i.test(folder)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const storage = getStorageService();
  if (!storage.presignUpload) {
    return NextResponse.json({ error: "provider_does_not_support_presigned_upload" }, { status: 501 });
  }

  try {
    const result = await storage.presignUpload({ filename, contentType, folder });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("Presign failed:", err);
    return NextResponse.json({ error: "presign_failed" }, { status: 500 });
  }
}
