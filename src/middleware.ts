import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/auth/session";

const TEACHER_PREFIX = "/teacher";
const ADMIN_PREFIX = "/admin";

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
  TEACHER_PREFIX,
  ADMIN_PREFIX,
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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (!isProtected) return NextResponse.next();

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!session.onboarded && pathname !== "/onboarding" && session.role === "student") {
    return NextResponse.redirect(new URL("/onboarding", req.url));
  }

  if (pathname.startsWith(ADMIN_PREFIX) && session.role !== "admin") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  if (
    pathname.startsWith(TEACHER_PREFIX) &&
    session.role !== "teacher" &&
    session.role !== "admin"
  ) {
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
    "/teacher/:path*",
    "/admin/:path*",
  ],
};
