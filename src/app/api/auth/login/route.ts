import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { loginSchema } from "@/lib/validation/auth";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE, clearSessionCookies, sessionCookieOptions } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !user.passwordHash) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const token = await createSessionToken({
    sub: user.id,
    role: user.role,
    name: user.name,
    locale: user.locale,
    onboarded: Boolean(user.onboardingCompletedAt),
  });
  // `accountStatus` is the caller's own admission state — the client uses it to
  // route to the right place (the waiting room for anything that is not ACTIVE)
  // instead of guessing from the onboarding flag and landing a pending applicant
  // on a form they are not allowed to submit.
  const res = NextResponse.json({
    ok: true,
    onboarded: Boolean(user.onboardingCompletedAt),
    accountStatus: user.accountStatus,
  });
  // Retire any cookie written in another context first, then issue this session's
  // cookie with the attributes this transport needs.
  clearSessionCookies(res, req);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
  return res;
}
