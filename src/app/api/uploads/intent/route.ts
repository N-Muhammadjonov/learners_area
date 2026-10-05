import { NextRequest, NextResponse } from "next/server";
import { RULES, clientKey, enforce } from "@/lib/http/rate-limit";
import { actorOf, requireActiveUser } from "@/lib/auth/current-user";
import { createUploadIntent, type BlockKind, type UploadPurpose } from "@/lib/data/uploads";
import { uploadErrorBody, uploadError, withUploadErrorBoundary } from "@/lib/uploads/server-errors";

/**
 * POST /api/uploads/intent — step 1 of the upload lifecycle.
 *
 * Authorizes an upload (session, role, ownership of the target material, file
 * category, declared size) and returns a short-lived presigned PUT URL for
 * exactly one server-generated object key. The browser then uploads the bytes
 * straight to Cloudflare R2; they never pass through this server.
 *
 * Body:
 *   {
 *     purpose: "material_primary" | "material_block",
 *     blockKind?: "image" | "audio" | "file",   // required for material_block
 *     materialId?: string,                       // set when editing a resource
 *     speakingAttemptId?: string,                // set for a practice recording
 *     filename: string,
 *     contentType: string,
 *     size: number                               // bytes
 *   }
 *
 * Response (200):
 *   { ok, uploadId, objectKey, mode, uploadUrl, contentType, expiresInSeconds }
 *
 * `mode` is "direct" when `uploadUrl` must be used, and "proxy" when the
 * configured provider cannot accept a browser PUT (local disk) — the client
 * then POSTs the bytes to /api/uploads with the same `uploadId`. Both paths
 * converge on /api/uploads/finalize, so the rest of the flow is identical.
 */
export async function POST(req: NextRequest) {
  return withUploadErrorBoundary("intent", () => handle(req));
}

async function handle(req: NextRequest): Promise<Response> {
  const user = await requireActiveUser();
  // Inline status so the access-control audit can see the refusal.
  if (!user) return NextResponse.json(uploadErrorBody("unauthenticated"), { status: 401 });

  const limited = enforce(RULES.uploadIntent, clientKey(req));
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const purpose = body?.purpose;
  const blockKind = body?.blockKind;
  const filename = body?.filename;
  const contentType = body?.contentType;
  const size = body?.size;

  if (typeof purpose !== "string" || typeof filename !== "string" || typeof contentType !== "string") {
    return uploadError("invalid_input", 400);
  }
  if (purpose !== "material_primary" && purpose !== "material_block" && purpose !== "speaking_recording") {
    return uploadError("invalid_purpose", 400);
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return uploadError("invalid_size", 400);
  }
  if (purpose === "material_block" && !["image", "audio", "file"].includes(blockKind)) {
    return uploadError("invalid_block_kind", 400);
  }

  const result = await createUploadIntent({
    caller: actorOf(user),
    purpose: purpose as UploadPurpose,
    blockKind: blockKind as BlockKind | undefined,
    materialId: typeof body.materialId === "string" ? body.materialId : undefined,
    speakingAttemptId: typeof body.speakingAttemptId === "string" ? body.speakingAttemptId : undefined,
    filename,
    contentType,
    size,
  });

  if (!result.ok) {
    return uploadError(result.error, result.status);
  }

  return NextResponse.json({
    ok: true,
    uploadId: result.uploadId,
    objectKey: result.objectKey,
    mode: result.mode,
    uploadUrl: result.uploadUrl,
    fallbackUploadUrl: result.fallbackUploadUrl,
    contentType: result.contentType,
    expiresInSeconds: result.expiresInSeconds,
  });
}
