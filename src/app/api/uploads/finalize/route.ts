import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { finalizeUploadIntent } from "@/lib/data/uploads";
import { uploadErrorBody, uploadError, withUploadErrorBoundary } from "@/lib/uploads/server-errors";

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
  return withUploadErrorBoundary("finalize", () => handle(req));
}

async function handle(req: NextRequest): Promise<Response> {
  const user = await requireActiveUser();
  // Inline status so the access-control audit can see the refusal.
  if (!user) return NextResponse.json(uploadErrorBody("unauthenticated"), { status: 401 });

  const body = await req.json().catch(() => null);
  const uploadId = body?.uploadId;
  if (typeof uploadId !== "string") {
    return uploadError("invalid_upload_id", 400);
  }

  const result = await finalizeUploadIntent(user.id, uploadId);
  if (!result.ok) {
    return uploadError(result.error, result.status);
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
