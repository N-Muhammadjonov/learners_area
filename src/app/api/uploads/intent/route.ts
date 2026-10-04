import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RULES, clientKey, enforce } from "@/lib/http/rate-limit";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { actorOf, requireActiveUser } from "@/lib/auth/current-user";
import { createUploadIntent } from "@/lib/data/uploads";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { uploadErrorBody, uploadError, withUploadErrorBoundary } from "@/lib/uploads/server-errors";

const intentSchema = z.object({
  purpose: z.enum(["material_primary", "material_block", "speaking_recording", "riwi_knowledge_source"]),
  blockKind: z.enum(["image", "audio", "file"]).optional(),
  materialId: z.string().uuid().optional(),
  speakingAttemptId: z.string().uuid().optional(),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().max(120),
  size: z.number().int().positive().safe(),
}).strict();

/**
 * POST /api/uploads/intent — authorize one server-generated private object key.
 * Every purpose uses the shared signature/finalize lifecycle; RIWI knowledge
 * uploads are owner-only and capped to the parser's supported formats/bytes.
 */
export async function POST(req: NextRequest) {
  return withUploadErrorBoundary("intent", () => handle(req));
}

async function handle(req: NextRequest): Promise<Response> {
  const origin = checkRequestOrigin(req);
  if (!origin.allowed) return uploadError("invalid_input", 403);

  const user = await requireActiveUser();
  if (!user) return NextResponse.json(uploadErrorBody("unauthenticated"), { status: 401 });

  const limited = enforce(RULES.uploadIntent, clientKey(req));
  if (limited) return limited;

  const body = await readRiwiBoundedJson(req, 16_384);
  if (!body.ok) return uploadError("invalid_input", body.reason === "too_large" ? 413 : 400);
  const parsed = intentSchema.safeParse(body.value);
  if (!parsed.success) return uploadError("invalid_input", 400);

  const result = await createUploadIntent({
    caller: actorOf(user),
    purpose: parsed.data.purpose,
    blockKind: parsed.data.blockKind,
    materialId: parsed.data.materialId,
    speakingAttemptId: parsed.data.speakingAttemptId,
    filename: parsed.data.filename,
    contentType: parsed.data.contentType,
    size: parsed.data.size,
  });

  if (!result.ok) return uploadError(result.error, result.status);

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
