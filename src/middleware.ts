import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Coarse routing guard.
 *
 * Middleware runs on the Edge runtime and cannot reach PostgreSQL, so it only
 * answers "is anybody signed in, and what does the signed cookie claim?" That is
 * enough to redirect a visitor to the login page before a page renders — it is
 * deliberately *not* the authorization layer.
 *
 * Real authorization happens in the Node runtime on every request:
 *   src/lib/auth/current-user.ts   (role + account status, straight from the DB)
 *   src/app/(app)/layout.tsx       (the private-area gate)
 *   every /api route               (requireActiveUser / requireAdministrator …)
 */

const STAFF_PREFIXES = ["/teacher"];
const ADMIN_PREFIXES = ["/admin"];
const OWNER_PREFIXES = ["/owner"];

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
  ...STAFF_PREFIXES,
  ...ADMIN_PREFIXES,
  ...OWNER_PREFIXES,
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

  // A role in the cookie can be one request out of date; this only decides which
  // shell the visitor lands in. The page and the API re-check against the DB.
  if (matches(pathname, STAFF_PREFIXES) && session.role === "student") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  if (matches(pathname, ADMIN_PREFIXES) && session.role !== "admin" && session.role !== "owner") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  if (matches(pathname, OWNER_PREFIXES) && session.role !== "owner") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

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
