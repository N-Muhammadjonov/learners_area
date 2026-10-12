import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { applySecurityHeaders, buildCsp } from "@/lib/http/security-headers";
import { ACCOUNT_GATED_PATHS, APP_HOME, PRIVATE_MODULE_SEGMENTS } from "@/lib/nav/private-modules.mjs";
import { isMalformedIdPath } from "@/lib/nav/uuid-page-routes.mjs";

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
 *   src/app/app/layout.tsx         (the /app namespace access gate)
 *   every /api route               (requireActiveUser / requireAdministrator …)
 */

/**
 * Areas that require an account at all — the coarse, cookie-level check.
 *
 * The set is DERIVED, not restated: `/app` is the canonical namespace, the
 * account-gated non-module paths come from the shared table, and every historical
 * top-level module is listed so it is checked whichever layer sees the request
 * first. `next.config.mjs` builds its redirect table from that same module
 * (`src/lib/nav/private-modules.mjs`), and `tests/app-namespace.test.ts` fails if
 * the two ever drift — which is exactly the defect this replaces: `/video-lessons`,
 * `/profile`, `/notifications`, `/reports`, `/support` and `/management` were
 * redirected but not session-checked.
 */
const PROTECTED_PREFIXES = [
  APP_HOME,
  ...ACCOUNT_GATED_PATHS,
  ...PRIVATE_MODULE_SEGMENTS.map((segment) => `/${segment}`),
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

  // 2b. A malformed id in a `[id]` page segment is answered 404 HERE.
  //
  // Why here and not in the page: `src/app/app/(shell)/loading.tsx` puts a Suspense
  // boundary above every shell page, so Next flushes the shell with HTTP 200 before the
  // page body runs. A later notFound() can then only swap the BODY — the status stays
  // 200. Proven by experiment: removing that loading.tsx makes the very same routes
  // answer 404. Deleting it would cost the route-entry skeleton on 81 pages that have
  // no Suspense of their own, so the shape check moves in front of the boundary
  // instead, where it costs nothing and cannot reach the database.
  //
  // Shape only. "Valid uuid but no such row" still needs a database read inside the
  // page, and still returns the 404 body with a 200 status; that residual is recorded
  // in docs/KNOWN-ISSUES-NOT-FOUND-STATUS.md.
  // 2b. RETIRED ROUTES.
  //
  // Shadowing was removed from the product (owner decision). The URL is kept as a
  // redirect so old links and bookmarks land somewhere sensible, and the redirect is
  // issued HERE rather than from the page because `(shell)/loading.tsx` puts a
  // Suspense boundary above every shell page: a redirect() inside the page flushes a
  // 200 first and only then swaps the body, so the retired URL answered "200 OK".
  // Middleware runs in front of that boundary, so the status is honest.
  //
  // Narrow on purpose: one exact pathname, no database access, and the global
  // route-entry skeleton is untouched.
  if (pathname === "/app/speaking/shadowing") {
    return applySecurityHeaders(
      NextResponse.redirect(new URL("/app/speaking/lessons", req.url), 308),
      headerOptions
    );
  }

  if (isMalformedIdPath(pathname)) {
    return applySecurityHeaders(
      new NextResponse(null, { status: 404 }),
      headerOptions
    );
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
