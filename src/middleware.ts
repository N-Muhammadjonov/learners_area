import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Coarse routing guard.
 *
 * Middleware runs on the Edge runtime and cannot reach PostgreSQL, so it answers
 * exactly one question: "is anybody signed in?" That is enough to send a visitor
 * to the login page before a page renders, and it is deliberately *not* the
 * authorization layer — the signed-in check is all it claims.
 *
 * Real authorization happens in the Node runtime on every request:
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
  if (!matches(pathname, PROTECTED_PREFIXES)) return NextResponse.next();

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    if (pathname === "/pending") return NextResponse.redirect(new URL("/login", req.url));
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // NOTE: this guard deliberately does not compare the cookie's role against the
  // path. A cookie is a snapshot from the last sign-in, so a freshly promoted
  // teacher would be bounced out of /teacher until they signed in again, and a
  // freshly demoted admin would keep the address. Role decisions belong to the
  // page and the API, which read the database row on every request.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/courses/:path*",
    "/writing/:path*",
    "/vocabulary/:path*",
    "/listening/:path*",
    "/reading/:path*",
    "/speaking/:path*",
    "/grammar/:path*",
    "/mocks/:path*",
    "/coach/:path*",
    "/assignments/:path*",
    "/progress/:path*",
    "/live-classes/:path*",
    "/pending/:path*",
    "/teacher/:path*",
    "/admin/:path*",
    "/owner/:path*",
  ],
};
