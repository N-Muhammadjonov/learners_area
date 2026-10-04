import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { applySecurityHeaders, buildCsp } from "@/lib/http/security-headers";

/**
 * Edge middleware: transport-level concerns only.
 *
 * Three jobs, in order:
 *   1. refuse a cross-site state-changing request before it reaches an API
 *      (origin verification — see src/lib/http/request-origin.ts);
 *   2. answer one coarse question for private paths: "is anybody signed in?";
 *   3. attach the security headers, including a per-request CSP nonce.
 *
 * Middleware runs on the Edge runtime and cannot reach PostgreSQL, so it is
 * deliberately *not* the authorization layer. Real authorization happens in the
 * Node runtime on every request:
 *   src/lib/auth/current-user.ts   (role + account status, straight from the DB)
 *   src/app/(app)/layout.tsx       (the private-area gate)
 *   every /api route               (requireActiveUser / requireAdministrator …)
 */

/** Areas that require an account at all — the coarse, cookie-level check. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/courses",
  "/writing",
  "/vocabulary",
  "/listening",
  "/reading",
  "/speaking",
  "/grammar",
  "/mocks",
  "/coach",
  "/assignments",
  "/progress",
  "/live-classes",
  "/pending",
  "/teacher",
  "/admin",
  "/owner",
];

async function readSession(token: string | undefined) {
  if (!token) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return payload as { sub: string; role: string; name: string; locale: string; onboarded: boolean };
  } catch {
    return null;
  }
}

function matches(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const secure = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const dev = process.env.NODE_ENV !== "production";
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? req.nextUrl.host;
  const headerOptions = { nonce, secure, dev, hsts: secure && !dev, host };

  // 1. State-changing API calls must come from this deployment.
  if (pathname.startsWith("/api/")) {
    const origin = checkRequestOrigin(req);
    if (!origin.allowed) {
      return applySecurityHeaders(
        NextResponse.json({ error: "invalid_origin", reason: origin.reason }, { status: 403 }),
        headerOptions
      );
    }
  }

  // 2. Coarse session check for private pages.
  const session = matches(pathname, PROTECTED_PREFIXES)
    ? await readSession(req.cookies.get(SESSION_COOKIE)?.value)
    : null;

  if (matches(pathname, PROTECTED_PREFIXES) && !session) {
    const target = pathname === "/pending" ? new URL("/login", req.url) : (() => {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("next", pathname);
      return loginUrl;
    })();
    return applySecurityHeaders(NextResponse.redirect(target), headerOptions);
  }

  // 3. Security headers, on every response shape (page, API, 404).
  //
  // The policy travels on the *request* headers too: that is how Next.js learns
  // the nonce and stamps it onto the inline scripts it injects during render.
  const csp = buildCsp(headerOptions);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  const secured = applySecurityHeaders(response, headerOptions);
  // Only the fixed Listening launcher gets an executable source policy. The
  // response-level sandbox ALSO forces an opaque origin when opened directly.
  // All authentication, origin and private-resource guards above still apply.
  if (/^\/api\/listening\/full\/(?:[0-9a-f-]{36}|preview)\/sandbox$/.test(pathname)) {
    secured.headers.set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data: blob:; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; sandbox allow-scripts");
  }
  return secured;
}

export const config = {
  matcher: [
    /*
     * Every route except Next.js build output and static files, so the security
     * headers and the origin check cover APIs and public pages too — not only
     * the private pages the original matcher listed.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|txt|xml|woff2?)$).*)",
  ],
};
