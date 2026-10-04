import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireActiveUser } from "@/lib/auth/current-user";
import { db } from "@/db/client";
import { uploadIntents } from "@/db/schema";
import { getStorageService } from "@/lib/services/storage";
import { validateUploadFile, type UploadCategory } from "@/lib/validation/uploads";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { RULES, clientKey, enforce } from "@/lib/http/rate-limit";
import { authorizeCapability } from "@/lib/services/riwi/capabilities";
import { isSupportedKnowledgeSourceFilename, RIWI_SOURCE_LIMIT_BYTES } from "@/lib/services/riwi/knowledge-parser";
import { ownerJson } from "@/lib/services/riwi/owner-route";
import { isUuid } from "@/lib/validation/ids";

export const runtime = "nodejs";

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * POST /api/uploads — bounded proxy path for the shared upload-intent flow.
 * The client sends X-Upload-Id so the server can authorize the intent and set
 * a byte-accurate streaming cap before multipart parsing allocates file data.
 */
export async function POST(req: NextRequest) {
  const origin = checkRequestOrigin(req);
  if (!origin.allowed) return NextResponse.json({ error: "invalid_input" }, { status: 403 });

  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const limited = enforce(RULES.uploadIntent, clientKey(req));
  if (limited) return limited;

  const uploadId = req.headers.get("x-upload-id");
  if (!uploadId || !isUuid(uploadId)) return NextResponse.json({ error: "invalid_upload_id" }, { status: 400 });
  const intent = await db.query.uploadIntents.findFirst({ where: eq(uploadIntents.id, uploadId) });
  if (!intent || intent.userId !== user.id) return NextResponse.json({ error: "upload_not_found" }, { status: 404 });
  if (intent.status !== "pending") return NextResponse.json({ error: "upload_not_active" }, { status: 409 });
  if (intent.directToStorage) return NextResponse.json({ error: "use_direct_upload" }, { status: 409 });

  if (intent.purpose === "riwi_knowledge_source") {
    if (user.role !== "owner" || !authorizeCapability({ id: user.id, role: user.role, accountStatus: user.accountStatus }, "riwi.knowledge.submit_candidate").allowed) {
      return ownerJson({ error: { code: "forbidden" } }, 403);
    }
    if (!isSupportedKnowledgeSourceFilename(intent.originalName)) return ownerJson({ error: { code: "unsupported_type" } }, 400);
    if (intent.size > RIWI_SOURCE_LIMIT_BYTES) return ownerJson({ error: { code: "file_too_large" } }, 413);
  }

  const bodyLimit = intent.size + MULTIPART_OVERHEAD_BYTES;
  const body = await readBoundedBody(req, bodyLimit);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.error === "too_large" ? 413 : 400 });
  const contentType = req.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  let form: FormData;
  try { form = await new Response(body.bytes, { headers: { "Content-Type": contentType } }).formData(); }
  catch { return NextResponse.json({ error: "invalid_input" }, { status: 400 }); }
  const ids = form.getAll("uploadId");
  const files = form.getAll("file");
  const formUploadId = ids.length === 1 ? ids[0] : null;
  const file = files.length === 1 ? files[0] : null;
  if (formUploadId !== intent.id || !file || !(file instanceof File)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  if (file.size !== intent.size) return NextResponse.json({ error: "size_mismatch" }, { status: 413 });
  const category: UploadCategory =
    intent.purpose === "speaking_recording"
      ? "audio"
      : intent.purpose === "material_primary"
        ? "primary"
        : intent.purpose === "riwi_knowledge_source"
          ? "file"
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

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength !== intent.size || bytes.byteLength > bodyLimit) {
    return NextResponse.json({ error: "size_mismatch" }, { status: 413 });
  }
  const storage = getStorageService();

  try {
    if (intent.purpose === "riwi_knowledge_source") {
      // A finalized/attached source object is evidence. Repeated or concurrent
      // proxy requests may never replace the bytes that were signature-checked.
      const written = await storage.putIfAbsent({ key: intent.objectKey, body: bytes, contentType: intent.mimeType });
      if (!written) return ownerJson({ error: { code: "riwi_upload_already_written" } }, 409);
    } else {
      await storage.put({ key: intent.objectKey, body: bytes, contentType: intent.mimeType });
    }
  } catch (err) {
    console.error("Proxy upload failed:", err);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, uploadId: intent.id, objectKey: intent.objectKey });
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<
  | { ok: true; bytes: Buffer }
  | { ok: false; error: "too_large" | "invalid_input" }
> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) return { ok: false, error: "invalid_input" };
    const length = Number(declared);
    if (!Number.isSafeInteger(length)) return { ok: false, error: "invalid_input" };
    if (length > maxBytes) return { ok: false, error: "too_large" };
  }
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, error: "invalid_input" };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, error: "too_large" };
      }
      chunks.push(value);
    }
    return { ok: true, bytes: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size) };
  } catch {
    return { ok: false, error: "invalid_input" };
  } finally {
    reader.releaseLock();
  }
}
