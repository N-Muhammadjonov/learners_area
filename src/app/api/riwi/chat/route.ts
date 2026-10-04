import { NextRequest, NextResponse } from "next/server";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { RULES, clientKey, consume } from "@/lib/http/rate-limit";
import { runRiwiGateway } from "@/lib/services/riwi/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** HTTP edge only: CSRF and IP abuse controls; the authenticated RIWI gateway owns request policy. */
export async function POST(request: NextRequest) {
  const origin = checkRequestOrigin(request);
  if (!origin.allowed) {
    return NextResponse.json({ error: { code: "riwi_request_invalid" } }, {
      status: 403,
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  }

  const ipLimit = consume(RULES.riwiChatByIp, clientKey(request));
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

  const result = await runRiwiGateway(request);
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
