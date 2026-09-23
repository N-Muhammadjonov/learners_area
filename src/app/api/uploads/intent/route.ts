import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createUploadIntent, type BlockKind, type UploadPurpose } from "@/lib/data/uploads";

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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const purpose = body?.purpose;
  const blockKind = body?.blockKind;
  const filename = body?.filename;
  const contentType = body?.contentType;
  const size = body?.size;

  if (typeof purpose !== "string" || typeof filename !== "string" || typeof contentType !== "string") {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (purpose !== "material_primary" && purpose !== "material_block") {
    return NextResponse.json({ error: "invalid_purpose" }, { status: 400 });
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "invalid_size" }, { status: 400 });
  }
  if (purpose === "material_block" && !["image", "audio", "file"].includes(blockKind)) {
    return NextResponse.json({ error: "invalid_block_kind" }, { status: 400 });
  }

  const result = await createUploadIntent({
    session,
    purpose: purpose as UploadPurpose,
    blockKind: blockKind as BlockKind | undefined,
    materialId: typeof body.materialId === "string" ? body.materialId : undefined,
    filename,
    contentType,
    size,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    uploadId: result.uploadId,
    objectKey: result.objectKey,
    mode: result.mode,
    uploadUrl: result.uploadUrl,
    contentType: result.contentType,
    expiresInSeconds: result.expiresInSeconds,
  });
}
