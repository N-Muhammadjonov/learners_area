import { NextRequest } from "next/server";
import { getKnowledgeSourceDetail, KnowledgeServiceError } from "@/lib/services/riwi/knowledge";
import { enforceRiwiOwnerRate, knowledgeErrorResponse, ownerJson, requireRiwiOwner } from "@/lib/services/riwi/owner-route";
import { RULES } from "@/lib/http/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ sourceId: string }> }) {
  const access = await requireRiwiOwner();
  if (!access.ok) return access.response;
  const limited = enforceRiwiOwnerRate(request, access.user, {
    account: RULES.riwiGovernanceReadByAccount, ip: RULES.riwiGovernanceReadByIp,
  });
  if (limited) return limited;
  try {
    const { sourceId } = await context.params;
    const source = await getKnowledgeSourceDetail({ id: access.user.id, role: access.user.role, accountStatus: access.user.accountStatus }, sourceId);
    if (!source) return ownerJson({ error: { code: "riwi_knowledge_not_found" } }, 404);
    return ownerJson({ ok: true, source });
  } catch (error) {
    if (error instanceof KnowledgeServiceError) return knowledgeErrorResponse(error);
    return ownerJson({ error: { code: "riwi_knowledge_unavailable" } }, 503);
  }
}
