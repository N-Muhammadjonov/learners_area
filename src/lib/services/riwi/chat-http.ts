import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { RULES, clientKey, consume, type RateLimitResult } from "@/lib/http/rate-limit";
import { runRiwiGateway, type RiwiGatewayResult } from "./gateway";

type RiwiChatRouteDependencies = {
  consumeIpLimit: (request: NextRequest) => RateLimitResult;
  runGateway: (request: Request) => Promise<RiwiGatewayResult>;
};

const defaultDependencies: RiwiChatRouteDependencies = {
  consumeIpLimit: (request) => consume(RULES.riwiChatByIp, clientKey(request)),
  runGateway: (request) => runRiwiGateway(request),
};

/**
 * HTTP edge only: real origin/CSRF checks and an IP limit stay here; the
 * authenticated RIWI gateway owns identity and request policy. Overrides are
 * constructor-injected test dependencies, never request-controlled settings.
 */
export async function handleRiwiChatPost(
  request: NextRequest,
  overrides: Partial<RiwiChatRouteDependencies> = {},
): Promise<NextResponse> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = checkRequestOrigin(request);
  if (!origin.allowed) {
    return NextResponse.json({ error: { code: "riwi_request_invalid" } }, {
      status: 403,
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  }

  const ipLimit = dependencies.consumeIpLimit(request);
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

  const result = await dependencies.runGateway(request);
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
