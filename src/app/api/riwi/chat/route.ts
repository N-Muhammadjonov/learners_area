import { NextRequest, NextResponse } from "next/server";
import { checkRequestOrigin, type OriginCheck } from "@/lib/http/request-origin";
import { RULES, clientKey, consume, type RateLimitResult } from "@/lib/http/rate-limit";
import { runRiwiGateway, type RiwiGatewayResult } from "@/lib/services/riwi/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RiwiChatRouteDependencies = {
  checkOrigin: (request: NextRequest) => OriginCheck;
  consumeIpLimit: (request: NextRequest) => RateLimitResult;
  runGateway: (request: Request) => Promise<RiwiGatewayResult>;
};

const defaultRouteDependencies: RiwiChatRouteDependencies = {
  checkOrigin: checkRequestOrigin,
  consumeIpLimit: (request) => consume(RULES.riwiChatByIp, clientKey(request)),
  runGateway: (request) => runRiwiGateway(request),
};

/** HTTP edge only: CSRF and IP abuse controls; the authenticated RIWI gateway owns request policy. */
export async function handleRiwiChatPost(
  request: NextRequest,
  overrides: Partial<RiwiChatRouteDependencies> = {},
) {
  const deps = { ...defaultRouteDependencies, ...overrides };
  const origin = deps.checkOrigin(request);
  if (!origin.allowed) {
    return NextResponse.json({ error: { code: "riwi_request_invalid" } }, {
      status: 403,
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  }

  const ipLimit = deps.consumeIpLimit(request);
  if (!ipLimit.ok) {
    return NextResponse.json({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: ipLimit.retryAfterSeconds }, {
      status: 429,
      headers: {
        "Retry-After": String(ipLimit.retryAfterSeconds),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        Vary: "Cookie",
      },
    });
  }

  const result = await deps.runGateway(request);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie",
      ...result.headers,
    },
  });
}

export async function POST(request: NextRequest) {
  return handleRiwiChatPost(request);
}
