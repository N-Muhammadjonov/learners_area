import type { NextRequest } from "next/server";
import { normalizeOrigin, publicBaseUrl, trustedOrigins } from "@/lib/config/site";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Compare the complete origin (scheme, hostname AND port). The reverse proxy
 * must overwrite forwarded headers; a direct Node host ignores them by default.
 * Vercel's managed proxy supplies these headers. Other hosts opt in explicitly.
 */
export function requestOrigin(req: NextRequest, env: Record<string, string | undefined> = process.env): string {
  const trustProxy = env.TRUST_PROXY_HEADERS === "true" ||
    (env.TRUST_PROXY_HEADERS !== "false" && env.VERCEL === "1");
  if (trustProxy) {
    const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
    const protocol = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (host && (protocol === "http" || protocol === "https")) {
      const origin = normalizeOrigin(`${protocol}://${host}`);
      if (origin) return origin;
    }
  }
  // Next may normalize loopback URL names internally. Host is the actual HTTP
  // authority the browser addressed; unlike X-Forwarded-Host it is not optional
  // proxy metadata. Browsers cannot supply a different Host through fetch.
  const host = req.headers.get("host");
  return (host ? normalizeOrigin(`${req.nextUrl.protocol}//${host}`) : null) ?? req.nextUrl.origin;
}

export type OriginCheck = { allowed: true } | { allowed: false; reason: string };

export function checkSameOriginRead(req: NextRequest): OriginCheck {
  const fetchSite = req.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site" || fetchSite === "same-site") return { allowed: false, reason: "cross_site_read" };

  const expected = requestOrigin(req);
  const origin = req.headers.get("origin");
  if (origin && (origin === "null" || normalizeOrigin(origin) !== expected)) {
    return { allowed: false, reason: "cross_origin_read" };
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== expected) return { allowed: false, reason: "cross_origin_referer" };
    } catch { return { allowed: false, reason: "invalid_referer" }; }
  }
  return { allowed: true };
}

export function checkRequestOrigin(req: NextRequest): OriginCheck {
  if (isSafeMethod(req.method)) return { allowed: true };
  const allowed = new Set([requestOrigin(req), ...trustedOrigins]);
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin === "null") return { allowed: false, reason: "opaque_origin" };
    const parsed = normalizeOrigin(origin);
    return parsed && allowed.has(parsed)
      ? { allowed: true }
      : { allowed: false, reason: "cross_origin" };
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      if (allowed.has(new URL(referer).origin)) return { allowed: true };
    } catch { /* Invalid input never widens the allowlist. */ }
    return { allowed: false, reason: "cross_origin_referer" };
  }
  // A browser must not become a trusted script merely by omitting Origin.
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return { allowed: false, reason: "cross_site_without_origin" };
  }
  // Non-browser clients still need the route's normal authentication.
  return { allowed: true };
}

export function hasCanonicalOrigin(): boolean {
  return Boolean(publicBaseUrl);
}
