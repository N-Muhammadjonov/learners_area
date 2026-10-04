import { NextRequest } from "next/server";
import { RULES } from "@/lib/http/rate-limit";
import { RiwiAuditError, listRiwiGovernanceAuditPage } from "@/lib/services/riwi/audit";
import { RIWI_OWNER_HISTORY_PAGE_SIZE } from "@/lib/services/riwi/owner-history-cursor";
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
  const limits = request.nextUrl.searchParams.getAll("limit");
  const cursors = request.nextUrl.searchParams.getAll("cursor");
  if (limits.length > 1 || cursors.length > 1 || (limits[0] !== undefined && !/^\d{1,3}$/.test(limits[0]))) {
    return ownerJson({ error: { code: "riwi_request_invalid" } }, 400);
  }
  const limit = limits[0] === undefined ? RIWI_OWNER_HISTORY_PAGE_SIZE : Number(limits[0]);
  try {
    const page = await listRiwiGovernanceAuditPage({
      id: access.user.id, role: access.user.role, accountStatus: access.user.accountStatus,
    }, { limit, cursor: cursors[0] });
    return ownerJson({ ok: true, ...page });
  } catch (error) {
    if (error instanceof RiwiAuditError && error.code === "forbidden") return ownerJson({ error: { code: "forbidden" } }, 403);
    if (error instanceof RiwiAuditError && error.code === "invalid_input") return ownerJson({ error: { code: "riwi_request_invalid" } }, 400);
    return ownerJson({ error: { code: "riwi_audit_unavailable" } }, 503);
  }
}
