import { requestIsHttps } from "@/lib/auth/cookie-policy";
export const GOOGLE_FLOW_COOKIE = "la_google_flow";
type RequestLike = Parameters<typeof requestIsHttps>[0];
/**
 * Short-lived (10 min), httpOnly, path-scoped to /api/auth/google. SameSite=Lax
 * so the top-level redirect back from Google carries it; never partitioned
 * (the OAuth flow is a top-level navigation, not an embedded one).
 */
export function googleFlowCookieOptions(req: RequestLike) {
  return { httpOnly: true, secure: requestIsHttps(req), sameSite: "lax" as const, path: "/api/auth/google", maxAge: 600 };
}
export function parseFlowCookie(value: string | undefined): { state: string; nonce: string; verifier: string } | null {
  if (!value || value.length > 1000) return null;
  try {
    const v = JSON.parse(value) as Record<string, unknown>;
    if ([v.state, v.nonce, v.verifier].every((x) => typeof x === "string" && /^[A-Za-z0-9_-]{32,80}$/.test(x))) return v as never;
  } catch { /* fallthrough */ }
  return null;
}
