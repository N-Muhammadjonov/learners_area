import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { finalizeUploadIntent } from "@/lib/data/uploads";

/**
 * POST /api/uploads/finalize — step 4 of the upload lifecycle.
 *
 * A browser saying "the PUT returned 200" is not proof the object exists, is
 * complete, or is the file that was authorized. This route HEADs the object in
 * storage, compares its content type and size against what the intent
 * declared, and only then flips the intent to `finalized`. A resource can only
 * ever claim a finalized intent.
 *
 * Body: { uploadId: string }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const uploadId = body?.uploadId;
  if (typeof uploadId !== "string") {
    return NextResponse.json({ error: "invalid_upload_id" }, { status: 400 });
  }

  const result = await finalizeUploadIntent(session.sub, uploadId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    uploadId: result.uploadId,
    objectKey: result.objectKey,
    originalName: result.originalName,
    mimeType: result.mimeType,
    size: result.size,
  });
}
