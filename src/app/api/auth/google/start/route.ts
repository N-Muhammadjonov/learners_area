import { publicAuthPolicy, publicAuthDisabledResponse } from "@/lib/auth/public-auth-policy";
import { NextRequest, NextResponse } from "next/server";
import { authorizationUrl, googleConfigFrom, pkceChallenge, randomToken } from "@/lib/auth/providers/google";
import { RULES, clientKey, enforce } from "@/lib/http/rate-limit";
import { googleFlowCookieOptions, GOOGLE_FLOW_COOKIE } from "@/lib/auth/google-flow";

/** GET /api/auth/google/start — begins OIDC; 404-style redirect when not configured. */
export async function GET(req: NextRequest) {
  if (!publicAuthPolicy().googleEnabled) return publicAuthDisabledResponse();
  const limited = enforce(RULES.loginByIp, clientKey(req));
  if (limited) return limited;
  const { config } = googleConfigFrom(process.env);
  if (!config) return NextResponse.redirect(new URL("/login?error=google_unavailable", req.url));
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const res = NextResponse.redirect(authorizationUrl(config, { state, nonce, challenge: await pkceChallenge(verifier) }));
  res.cookies.set(GOOGLE_FLOW_COOKIE, JSON.stringify({ state, nonce, verifier }), googleFlowCookieOptions(req));
  res.headers.set("Cache-Control", "no-store");
  return res;
}
