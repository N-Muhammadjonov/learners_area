import { NextRequest } from "next/server";
import { z } from "zod";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { KnowledgeParseError } from "@/lib/services/riwi/knowledge-parser";
import { ingestUploadedKnowledgeSource } from "@/lib/services/riwi/knowledge-upload";
import {
  KNOWLEDGE_RIGHTS_CLASSES,
  KNOWLEDGE_SOURCE_TYPES,
  RIWI_KNOWLEDGE_HISTORY_STATES,
  getActiveConflictCount,
  listKnowledgeSourcePage,
  KnowledgeServiceError,
} from "@/lib/services/riwi/knowledge";
import { redactExternalText } from "@/lib/services/riwi/outbound-guard";
import { enforceRiwiOwnerRate, knowledgeErrorResponse, ownerJson, requireRiwiOwner } from "@/lib/services/riwi/owner-route";
import { RULES } from "@/lib/http/rate-limit";
import { RIWI_OWNER_HISTORY_PAGE_SIZE } from "@/lib/services/riwi/owner-history-cursor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({ kind: z.literal("role"), role: z.enum(["student", "teacher", "admin", "owner"]) }).strict(),
  z.object({ kind: z.literal("user"), userId: z.string().uuid() }).strict(),
]);
const uploadSchema = z.object({
  uploadId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  sourceType: z.enum(KNOWLEDGE_SOURCE_TYPES),
  provenance: z.string().trim().min(1).max(300),
  rightsClass: z.enum(KNOWLEDGE_RIGHTS_CLASSES),
  scope: scopeSchema,
}).strict();

export async function GET(request: NextRequest) {
  const access = await requireRiwiOwner();
  if (!access.ok) return access.response;
  const limited = enforceRiwiOwnerRate(request, access.user, {
    account: RULES.riwiGovernanceReadByAccount, ip: RULES.riwiGovernanceReadByIp,
  });
  if (limited) return limited;
  const limits = request.nextUrl.searchParams.getAll("limit");
  const cursors = request.nextUrl.searchParams.getAll("cursor");
  const states = request.nextUrl.searchParams.getAll("state");
  if (
    limits.length > 1 || cursors.length > 1 || states.length > 1
    || (limits[0] !== undefined && !/^\d{1,3}$/.test(limits[0]))
    || (states[0] !== undefined && !(RIWI_KNOWLEDGE_HISTORY_STATES as readonly string[]).includes(states[0]))
  ) {
    return ownerJson({ error: { code: "riwi_request_invalid" } }, 400);
  }
  try {
    const actor = { id: access.user.id, role: access.user.role, accountStatus: access.user.accountStatus };
    const limit = limits[0] === undefined ? RIWI_OWNER_HISTORY_PAGE_SIZE : Number(limits[0]);
    const [page, openConflicts] = await Promise.all([
      listKnowledgeSourcePage(actor, { limit, cursor: cursors[0], state: states[0] }), getActiveConflictCount(),
    ]);
    return ownerJson({ ok: true, ...page, openConflicts });
  } catch (error) {
    if (error instanceof KnowledgeServiceError) return knowledgeErrorResponse(error);
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

  // File bytes never travel through JSON/base64. They must already belong to a
  // finalized shared upload intent issued to this active owner.
  const body = await readRiwiBoundedJson(request, 16_384);
  if (!body.ok) return ownerJson({ error: { code: "riwi_request_invalid" } }, body.reason === "too_large" ? 413 : 400);
  const parsed = uploadSchema.safeParse(body.value);
  if (!parsed.success) return ownerJson({ error: { code: "riwi_request_invalid" } }, 400);
  if (/https?:\/\//i.test(parsed.data.provenance)
    || redactExternalText(parsed.data.title, 200) !== parsed.data.title
    || redactExternalText(parsed.data.provenance, 300) !== parsed.data.provenance) {
    return ownerJson({ error: { code: "riwi_knowledge_metadata_invalid" } }, 400);
  }

  try {
    const candidate = await ingestUploadedKnowledgeSource({
      actor: { id: access.user.id, role: access.user.role, accountStatus: access.user.accountStatus },
      ...parsed.data,
    });
    return ownerJson({ ok: true, sourceId: candidate.id, state: candidate.state,
      version: candidate.version, unitCount: candidate.unitCount, conflictCount: candidate.conflictCount,
      sourceChecksum: candidate.sourceChecksum }, 201);
  } catch (error) {
    if (error instanceof KnowledgeParseError) {
      const status = error.code === "source_too_large" || error.code === "too_many_units" ? 413
        : error.code === "source_timeout" ? 504
          : error.code === "unsupported_format" ? 415 : 400;
      return ownerJson({ error: { code: `riwi_source_${error.code}` } }, status);
    }
    if (error instanceof KnowledgeServiceError) return knowledgeErrorResponse(error);
    return ownerJson({ error: { code: "riwi_knowledge_unavailable" } }, 503);
  }
}
