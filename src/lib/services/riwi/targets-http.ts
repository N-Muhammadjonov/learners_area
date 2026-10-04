import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser, type CurrentUser } from "@/lib/auth/current-user";
import { accountKey, clientKey, consume, RULES, type RateLimitResult } from "@/lib/http/rate-limit";
import { checkSameOriginRead } from "@/lib/http/request-origin";
import { RIWI_TARGET_CURSOR_MAX_LENGTH } from "./contracts";
import { getRiwiTargetPage, type RiwiTargetPage } from "./role-surface";

type RiwiTargetsRouteDependencies = {
  authenticate: () => Promise<CurrentUser | null>;
  consumeIpLimit: (request: NextRequest) => RateLimitResult;
  consumeAccountLimit: (userId: string) => RateLimitResult;
  getTargetPage: (actor: { id: string; role: CurrentUser["role"]; accountStatus: CurrentUser["accountStatus"] }, options: { cursor?: string | null; limit?: number }) => Promise<RiwiTargetPage>;
};

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie",
};

const defaultDependencies: RiwiTargetsRouteDependencies = {
  authenticate: requireActiveUser,
  consumeIpLimit: (request) => consume(RULES.riwiTargetPageByIp, clientKey(request)),
  consumeAccountLimit: (userId) => consume(RULES.riwiTargetPageByAccount, accountKey(userId)),
  getTargetPage: getRiwiTargetPage,
};

function rateLimited(result: RateLimitResult): NextResponse {
  return NextResponse.json({ error: "riwi_rate_limited", retryAfterSeconds: result.retryAfterSeconds }, {
    status: 429,
    headers: { ...responseHeaders, "Retry-After": String(result.retryAfterSeconds) },
  });
}

function badRequest(): NextResponse {
  return NextResponse.json({ error: "riwi_target_request_invalid" }, { status: 400, headers: responseHeaders });
}

/**
 * The browser supplies only a bounded cursor/limit. Identity, current role and
 * active roster/cohort are read again for every page request on the server.
 */
export async function handleRiwiTargetsGet(
  request: NextRequest,
  overrides: Partial<RiwiTargetsRouteDependencies> = {},
): Promise<NextResponse> {
  const origin = checkSameOriginRead(request);
  if (!origin.allowed) return NextResponse.json({ error: "riwi_target_request_invalid" }, { status: 403, headers: responseHeaders });

  const dependencies = { ...defaultDependencies, ...overrides };
  const ipLimit = dependencies.consumeIpLimit(request);
  if (!ipLimit.ok) return rateLimited(ipLimit);

  let user: CurrentUser | null;
  try { user = await dependencies.authenticate(); }
  catch {
    return NextResponse.json({ error: "riwi_targets_unavailable" }, { status: 503, headers: responseHeaders });
  }
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: responseHeaders });

  const accountLimit = dependencies.consumeAccountLimit(user.id);
  if (!accountLimit.ok) return rateLimited(accountLimit);

  const params = new URL(request.url).searchParams;
  if (params.getAll("cursor").length > 1 || params.getAll("limit").length > 1) return badRequest();
  const cursor = params.get("cursor");
  const rawLimit = params.get("limit");
  let limit: number | undefined;
  if (rawLimit !== null) {
    if (!/^[1-9]\d{0,2}$/.test(rawLimit)) return badRequest();
    limit = Number(rawLimit);
    if (limit > 100) return badRequest();
  }
  if (cursor && cursor.length > RIWI_TARGET_CURSOR_MAX_LENGTH) return badRequest();

  try {
    const page = await dependencies.getTargetPage(
      { id: user.id, role: user.role, accountStatus: user.accountStatus },
      { cursor, limit },
    );
    return NextResponse.json({ ok: true, items: page.targetOptions, nextCursor: page.nextCursor }, { headers: responseHeaders });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "riwi_target_cursor_invalid" || code === "riwi_target_limit_invalid") return badRequest();
    if (code === "riwi_role_surface_forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403, headers: responseHeaders });
    }
    return NextResponse.json({ error: "riwi_targets_unavailable" }, { status: 503, headers: responseHeaders });
  }
}
