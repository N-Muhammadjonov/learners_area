import type { NextRequest } from "next/server";
import { publicBaseUrl, trustedOrigins } from "@/lib/config/site";

/**
 * Origin verification for state-changing requests.
 *
 * The session cookie already carries `SameSite` (see src/lib/auth/cookie-policy.ts),
 * which is the first line of defence. This is the second: a browser labels who
 * initiated a request with `Origin` (and `Referer` as a fallback), and a
 * cross-site attacker cannot forge either header.
 *
 * Rules:
 *   - safe methods (GET/HEAD/OPTIONS) are never blocked here;
 *   - a request whose `Origin` matches the host it was sent to passes;
 *   - an origin listed in TRUSTED_ORIGINS / PUBLIC_BASE_URL passes (the hosted
 *     preview and any deliberate embedder);
 *   - a request with no `Origin` and no `Referer` passes: it did not come from a
 *     browser page, so there is no ambient cookie to abuse (curl, server-to-server,
 *     the project's own verification scripts);
 *   - anything else is refused.
 *
 * This module is pure so it can be unit-tested without a server.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/** Hosts that may legitimately call this deployment. */
export function allowedHosts(req: NextRequest): string[] {
  const hosts = new Set<string>();
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) hosts.add(forwardedHost.split(",")[0]!.trim());
  const host = req.headers.get("host");
  if (host) hosts.add(host);
  // The URL the request was actually sent to. A `Host` header is not guaranteed
  // to be present (a proxy may rewrite it, a test may omit it), but the request
  // URL always names the host the browser talked to.
  hosts.add(req.nextUrl.host);
  try {
    hosts.add(new URL(req.url).host);
  } catch {
    /* a malformed url cannot widen the allowlist */
  }
  for (const origin of trustedOrigins) {
    try {
      hosts.add(new URL(origin).host);
    } catch {
      /* a malformed configured origin is ignored here, never trusted */
    }
  }
  return [...hosts];
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export type OriginCheck = { allowed: true } | { allowed: false; reason: string };

export function checkRequestOrigin(req: NextRequest): OriginCheck {
  if (isSafeMethod(req.method)) return { allowed: true };

  const origin = req.headers.get("origin");
  const hosts = allowedHosts(req);

  if (origin) {
    // `Origin: null` means an opaque context (sandboxed frame, file://). It is
    // never a legitimate caller of this API.
    if (origin === "null") return { allowed: false, reason: "opaque_origin" };
    const host = hostOf(origin);
    if (host && hosts.includes(host)) return { allowed: true };
    return { allowed: false, reason: "cross_origin" };
  }

  const referer = req.headers.get("referer");
  if (referer) {
    const host = hostOf(referer);
    if (host && hosts.includes(host)) return { allowed: true };
    return { allowed: false, reason: "cross_origin_referer" };
  }

  return { allowed: true };
}

/** Convenience for tests and docs: does this deployment know its own origin? */
export function hasCanonicalOrigin(): boolean {
  return Boolean(publicBaseUrl);
}
