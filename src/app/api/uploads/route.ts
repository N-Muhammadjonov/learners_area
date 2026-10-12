import { withUploadErrorBoundary } from "@/lib/uploads/server-errors";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { db } from "@/db/client";
import { uploadIntents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getStorageService } from "@/lib/services/storage";
import { validateUploadFile, type UploadCategory } from "@/lib/validation/uploads";

/**
 * POST /api/uploads — the proxy upload path.
 *
 * Used only when the configured provider cannot accept a direct browser PUT,
 * i.e. `STORAGE_PROVIDER=local`. The bytes go browser → this server → disk.
 * For `r2`/`s3` the browser uploads straight to the bucket via the presigned
 * URL from /api/uploads/intent and this route is never called.
 *
 * The intent is still required and still authoritative: the object key, the
 * declared size and the declared content type all come from the intent row,
 * not from this request. A caller cannot use this route to write an arbitrary
 * key or to oversize a file past the policy in
 * src/lib/validation/uploads.ts.
 *
 * Body (multipart): uploadId, file
 */
export async function POST(req: NextRequest) {
  return withUploadErrorBoundary("proxy", () => upload(req));
}

async function upload(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const uploadId = form?.get("uploadId");
  const file = form?.get("file");

  if (typeof uploadId !== "string" || !file || !(file instanceof File)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const intent = await db.query.uploadIntents.findFirst({ where: eq(uploadIntents.id, uploadId) });
  // The intent row, not the role, is the authorization: creating an intent
  // already required the caller to own the material or the Speaking attempt
  // this upload belongs to. Students therefore proxy their own practice
  // recordings, while never anyone else's upload.
  if (!intent || intent.userId !== user.id) {
    return NextResponse.json({ error: "upload_not_found" }, { status: 404 });
  }
  if (intent.status !== "pending" && intent.status !== "finalized") {
    return NextResponse.json({ error: "upload_not_active" }, { status: 409 });
  }
  if (intent.directToStorage) {
    // The provider supports presigned PUTs — refuse to proxy bytes for an
    // intent that was issued a direct URL. Keeps the two paths from blurring.
    return NextResponse.json({ error: "use_direct_upload" }, { status: 409 });
  }

  const category: UploadCategory =
    intent.purpose === "speaking_recording"
      ? "audio"
      : intent.purpose === "material_primary"
      ? "primary"
      : intent.blockKind === "image"
        ? "image"
        : intent.blockKind === "audio"
          ? "audio"
          : "file";

  const validation = validateUploadFile({
    filename: intent.originalName,
    contentType: intent.mimeType,
    size: file.size,
    category,
  });
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error },
      { status: validation.error === "file_too_large" ? 413 : 400 }
    );
  }

  const body = Buffer.from(await file.arrayBuffer());
  const storage = getStorageService();

  return withUploadErrorBoundary("proxy_storage", async () => {
    await storage.put({ key: intent.objectKey, body, contentType: intent.mimeType });
    return NextResponse.json({ ok: true, uploadId: intent.id, objectKey: intent.objectKey });
  }, "storage");
}
