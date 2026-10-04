import { NextRequest } from "next/server";
import { z } from "zod";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { KnowledgeParseError, RIWI_SOURCE_LIMIT_BYTES, extractKnowledgeText } from "@/lib/services/riwi/knowledge-parser";
import { KNOWLEDGE_RIGHTS_CLASSES, KNOWLEDGE_SOURCE_TYPES, createKnowledgeCandidate, getActiveConflictCount, listKnowledgeSources, KnowledgeServiceError } from "@/lib/services/riwi/knowledge";
import { redactExternalText } from "@/lib/services/riwi/outbound-guard";
import { enforceRiwiOwnerRate, knowledgeErrorResponse, ownerJson, requireRiwiOwner } from "@/lib/services/riwi/owner-route";
import { RULES } from "@/lib/http/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BASE64_BYTES = Math.ceil(RIWI_SOURCE_LIMIT_BYTES / 3) * 4;
const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({ kind: z.literal("role"), role: z.enum(["student", "teacher", "admin", "owner"]) }).strict(),
  z.object({ kind: z.literal("user"), userId: z.string().uuid() }).strict(),
]);
const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(120).regex(/^[^/\\\u0000-\u001f]+\.(?:txt|md|html?|pdf|docx)$/i),
  title: z.string().trim().min(1).max(200),
  sourceType: z.enum(KNOWLEDGE_SOURCE_TYPES),
  provenance: z.string().trim().min(1).max(300),
  rightsClass: z.enum(KNOWLEDGE_RIGHTS_CLASSES),
  scope: scopeSchema,
  contentBase64: z.string().min(4).max(MAX_BASE64_BYTES).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();

export async function GET(request: NextRequest) {
  const access = await requireRiwiOwner();
  if (!access.ok) return access.response;
  const limited = enforceRiwiOwnerRate(request, access.user, {
    account: RULES.riwiGovernanceReadByAccount, ip: RULES.riwiGovernanceReadByIp,
  });
  if (limited) return limited;
  try {
    const actor = { id: access.user.id, role: access.user.role, accountStatus: access.user.accountStatus };
    const [sources, openConflicts] = await Promise.all([
      listKnowledgeSources(actor), getActiveConflictCount(),
    ]);
    return ownerJson({ ok: true, sources, openConflicts });
  } catch {
    return ownerJson({ error: { code: "riwi_knowledge_unavailable" } }, 503);
  }
}

export async function POST(request: NextRequest) {
  const origin = checkRequestOrigin(request);
  if (!origin.allowed) return ownerJson({ error: { code: "riwi_request_invalid" } }, 403);
  const access = await requireRiwiOwner();
  if (!access.ok) return access.response;
  const limited = enforceRiwiOwnerRate(request, access.user, {
    account: RULES.riwiKnowledgeWriteByAccount, ip: RULES.riwiKnowledgeWriteByIp,
  });
  if (limited) return limited;
  // The binary file is base64-wrapped so the streaming JSON reader enforces a hard
  // request bound before allocating the parser input. The parser still validates
  // extension, signature, archive paths, extracted text and unit limits.
  const body = await readRiwiBoundedJson(request, MAX_BASE64_BYTES + 16_384);
  if (!body.ok) return ownerJson({ error: { code: "riwi_request_invalid" } }, body.reason === "too_large" ? 413 : 400);
  const parsed = uploadSchema.safeParse(body.value);
  if (!parsed.success) return ownerJson({ error: { code: "riwi_request_invalid" } }, 400);
  if (/https?:\/\//i.test(parsed.data.provenance)
    || redactExternalText(parsed.data.title, 200) !== parsed.data.title
    || redactExternalText(parsed.data.provenance, 300) !== parsed.data.provenance) {
    return ownerJson({ error: { code: "riwi_knowledge_metadata_invalid" } }, 400);
  }

  try {
    const fileBytes = Buffer.from(parsed.data.contentBase64, "base64");
    if (fileBytes.byteLength === 0 || fileBytes.byteLength > RIWI_SOURCE_LIMIT_BYTES
      || fileBytes.toString("base64") !== parsed.data.contentBase64) {
      return ownerJson({ error: { code: "riwi_request_invalid" } }, fileBytes.byteLength > RIWI_SOURCE_LIMIT_BYTES ? 413 : 400);
    }
    const extracted = await extractKnowledgeText(parsed.data.filename, new Uint8Array(fileBytes));
    if (redactExternalText(extracted, 200_000) !== extracted) {
      return ownerJson({ error: { code: "riwi_source_contains_sensitive_data" } }, 400);
    }
    const candidate = await createKnowledgeCandidate({
      actor: access.user,
      sourceType: parsed.data.sourceType,
      title: parsed.data.title,
      provenance: `${parsed.data.provenance}; upload=${parsed.data.filename}`,
      rightsClass: parsed.data.rightsClass,
      scope: parsed.data.scope,
      content: extracted,
    });
    return ownerJson({ ok: true, sourceId: candidate.id, state: candidate.state,
      version: candidate.version, unitCount: candidate.unitCount, conflictCount: candidate.conflictCount }, 201);
  } catch (error) {
    if (error instanceof KnowledgeParseError) {
      const status = error.code === "source_too_large" || error.code === "too_many_units" ? 413
        : error.code === "source_timeout" ? 504 : 400;
      return ownerJson({ error: { code: `riwi_source_${error.code}` } }, status);
    }
    if (error instanceof KnowledgeServiceError) return knowledgeErrorResponse(error);
    return ownerJson({ error: { code: "riwi_knowledge_unavailable" } }, 503);
  }
}
