import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { requireActiveUser } from "@/lib/auth/current-user";
import { finalizeUploadIntent } from "@/lib/data/uploads";
import { uploadErrorBody, uploadError, withUploadErrorBoundary } from "@/lib/uploads/server-errors";

const finalizeSchema = z.object({ uploadId: z.string().uuid() }).strict();

/**
 * POST /api/uploads/finalize — storage HEAD and byte-signature verification.
 * For RIWI knowledge, the upload service also rechecks the owner's current
 * database role/capability and the parser-supported size/extension contract.
 */
export async function POST(req: NextRequest) {
  return withUploadErrorBoundary("finalize", () => handle(req));
}

async function handle(req: NextRequest): Promise<Response> {
  const origin = checkRequestOrigin(req);
  if (!origin.allowed) return uploadError("invalid_input", 403);

  const user = await requireActiveUser();
  if (!user) return NextResponse.json(uploadErrorBody("unauthenticated"), { status: 401 });

  const body = await readRiwiBoundedJson(req, 4096);
  if (!body.ok) return uploadError("invalid_upload_id", body.reason === "too_large" ? 413 : 400);
  const parsed = finalizeSchema.safeParse(body.value);
  if (!parsed.success) return uploadError("invalid_upload_id", 400);

  const result = await finalizeUploadIntent(user.id, parsed.data.uploadId);
  if (!result.ok) return uploadError(result.error, result.status);

  return NextResponse.json({
    ok: true,
    uploadId: result.uploadId,
    objectKey: result.objectKey,
    originalName: result.originalName,
    mimeType: result.mimeType,
    size: result.size,
  });
}
