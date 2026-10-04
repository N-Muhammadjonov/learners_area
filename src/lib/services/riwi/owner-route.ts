import "server-only";
import { NextRequest, NextResponse } from "next/server";
import type { CurrentUser } from "@/lib/auth/current-user";
import { requireActiveUser } from "@/lib/auth/current-user";
import { RULES, accountKey, clientKey, consume } from "@/lib/http/rate-limit";
import { authorizeCapability } from "./capabilities";
import { KnowledgeServiceError } from "./knowledge";

export function ownerJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" },
  });
}

export function knowledgeErrorResponse(error: unknown) {
  if (!(error instanceof KnowledgeServiceError)) return ownerJson({ error: { code: "riwi_knowledge_unavailable" } }, 503);
  const status = error.code === "forbidden" ? 403 : error.code === "not_found" ? 404
    : error.code === "invalid_input" ? 400 : error.code === "invalid_state" || error.code === "duplicate_source" || error.code === "unresolved_conflict" || error.code === "stale_version" ? 409
      : error.code === "rights_unverified" || error.code === "regression_required" ? 422 : 503;
  return ownerJson({ error: { code: `riwi_knowledge_${error.code}` } }, status);
}

export async function requireRiwiOwner(): Promise<
  | { ok: true; user: CurrentUser }
  | { ok: false; response: NextResponse }
> {
  let user: CurrentUser | null;
  try { user = await requireActiveUser(); }
  catch { return { ok: false, response: ownerJson({ error: { code: "riwi_auth_unavailable" } }, 503) }; }
  if (!user) return { ok: false, response: ownerJson({ error: { code: "unauthorized" } }, 401) };
  if (user.role !== "owner" || user.accountStatus !== "active"
    || !authorizeCapability({ id: user.id, role: user.role, accountStatus: user.accountStatus }, "riwi.knowledge.review").allowed) {
    return { ok: false, response: ownerJson({ error: { code: "forbidden" } }, 403) };
  }
  return { ok: true, user };
}

export function enforceRiwiOwnerRate(
  request: NextRequest,
  user: Pick<CurrentUser, "id">,
  rules: {
    account: (typeof RULES)[keyof typeof RULES];
    ip: (typeof RULES)[keyof typeof RULES];
  },
): NextResponse | null {
  const ip = consume(rules.ip, clientKey(request));
  if (!ip.ok) return ownerJson({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: ip.retryAfterSeconds }, 429);
  const account = consume(rules.account, accountKey(user.id));
  if (!account.ok) return ownerJson({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: account.retryAfterSeconds }, 429);
  return null;
}
