import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { registerSchema } from "@/lib/validation/auth";
import { hashPassword } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { name, email, password } = parsed.data;

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const locale = getLocale();

  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash, role: "student", locale })
    .returning();

  if (!user) {
    return NextResponse.json({ error: "Could not create account" }, { status: 500 });
  }

  const token = await createSessionToken({
    sub: user.id,
    role: user.role,
    name: user.name,
    locale: user.locale,
    onboarded: false,
  });
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions);

  return NextResponse.json({ ok: true });
}
