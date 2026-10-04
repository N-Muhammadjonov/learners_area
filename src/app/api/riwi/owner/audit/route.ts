import { NextRequest } from "next/server";
import { RULES } from "@/lib/http/rate-limit";
import { RiwiAuditError, listRiwiGovernanceAudit } from "@/lib/services/riwi/audit";
import { enforceRiwiOwnerRate, ownerJson, requireRiwiOwner } from "@/lib/services/riwi/owner-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireRiwiOwner();
  if (!access.ok) return access.response;
  const limited = enforceRiwiOwnerRate(request, access.user, {
    account: RULES.riwiGovernanceReadByAccount, ip: RULES.riwiGovernanceReadByIp,
  });
  if (limited) return limited;
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return ownerJson({ error: { code: "riwi_request_invalid" } }, 400);
  try {
    const entries = await listRiwiGovernanceAudit({
      id: access.user.id, role: access.user.role, accountStatus: access.user.accountStatus,
    }, limit);
    return ownerJson({ ok: true, entries });
  } catch (error) {
    if (error instanceof RiwiAuditError) return ownerJson({ error: { code: "forbidden" } }, 403);
    return ownerJson({ error: { code: "riwi_audit_unavailable" } }, 503);
  }
}
