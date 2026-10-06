import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, googleConfigFrom, verifyGoogleIdToken } from "@/lib/auth/providers/google";
import { resolveGoogleAccount } from "@/lib/auth/google-account";
import { GOOGLE_FLOW_COOKIE, googleFlowCookieOptions, parseFlowCookie } from "@/lib/auth/google-flow";
import { createSessionToken, SESSION_COOKIE, clearSessionCookies, sessionCookieOptions } from "@/lib/auth/session";
import { hasPrivateAccess } from "@/lib/auth/account-status";
import { createAccessRequest } from "@/lib/data/admission";
import { getLocale } from "@/lib/i18n";
import { RULES, clientKey, enforce } from "@/lib/http/rate-limit";
import { timingSafeEqual } from "node:crypto";

function fail(req: NextRequest, code: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
  res.cookies.set(GOOGLE_FLOW_COOKIE, "", { ...googleFlowCookieOptions(req), maxAge: 0 });
  return res;
}
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** GET /api/auth/google/callback — verifies state/PKCE/nonce/id_token, then admission rules decide. */
export async function GET(req: NextRequest) {
  const limited = enforce(RULES.loginByIp, clientKey(req));
  if (limited) return limited;
  const { config } = googleConfigFrom(process.env);
  if (!config) return fail(req, "google_unavailable");
  const flow = parseFlowCookie(req.cookies.get(GOOGLE_FLOW_COOKIE)?.value);
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const code = req.nextUrl.searchParams.get("code") ?? "";
  if (!flow || !state || !same(state, flow.state) || !code || code.length > 2000) return fail(req, "google_state");
  let claims;
  try {
    claims = await verifyGoogleIdToken(await exchangeCode(config, code, flow.verifier), config, flow.nonce);
  } catch {
    return fail(req, "google_failed");
  }
  const result = await resolveGoogleAccount(claims, { locale: await getLocale() });
  if (result.kind === "link_required") return fail(req, "google_link_required");
  if (result.kind === "unverified_email") return fail(req, "google_unverified");
  const user = result.user;
  if (result.created) {
    try { await createAccessRequest({ userId: user.id }); } catch (cause) { console.error("[google] could not enqueue access request", cause instanceof Error ? cause.name : "error"); }
  }
  const token = await createSessionToken({ sub: user.id, role: user.role, name: user.name, locale: user.locale, onboarded: Boolean(user.onboardingCompletedAt) });
  const destination = !hasPrivateAccess(user.accountStatus) ? "/pending" : user.onboardingCompletedAt ? "/app/dashboard" : "/onboarding";
  const res = NextResponse.redirect(new URL(destination, req.url));
  clearSessionCookies(res, req);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
  res.cookies.set(GOOGLE_FLOW_COOKIE, "", { ...googleFlowCookieOptions(req), maxAge: 0 });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
