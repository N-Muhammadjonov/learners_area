import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, onboardingProfiles, courses, enrollments } from "@/db/schema";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { createSessionToken, SESSION_COOKIE, clearSessionCookies, sessionCookieOptions } from "@/lib/auth/session";
import { cookiePolicyForRequest } from "@/lib/auth/cookie-policy";
import { requireActiveUser } from "@/lib/auth/current-user";
import { localeCookieOptions, LOCALE_COOKIE } from "@/lib/i18n";

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = onboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const data = parsed.data;

  await db
    .insert(onboardingProfiles)
    .values({
      userId: user.id,
      currentLevel: data.currentLevel,
      currentBand: data.currentBand ?? null,
      targetBand: data.targetBand,
      examDate: data.examDate ? new Date(data.examDate) : null,
      dailyStudyMinutes: data.dailyStudyMinutes,
      strongestSkill: data.strongestSkill,
      weakestSkill: data.weakestSkill,
    })
    .onConflictDoUpdate({
      target: onboardingProfiles.userId,
      set: {
        currentLevel: data.currentLevel,
        currentBand: data.currentBand ?? null,
        targetBand: data.targetBand,
        examDate: data.examDate ? new Date(data.examDate) : null,
        dailyStudyMinutes: data.dailyStudyMinutes,
        strongestSkill: data.strongestSkill,
        weakestSkill: data.weakestSkill,
      },
    });

  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date(), locale: data.preferredLanguage })
    .where(eq(users.id, user.id));

  // Auto-enroll in the (only, for now) IELTS course.
  const ieltsCourse = await db.query.courses.findFirst({ where: eq(courses.slug, "ielts") });
  if (ieltsCourse) {
    const existing = await db.query.enrollments.findFirst({
      where: eq(enrollments.userId, user.id),
    });
    if (!existing) {
      await db.insert(enrollments).values({ userId: user.id, courseId: ieltsCourse.id });
    }
  }

  const token = await createSessionToken({
    sub: user.id,
    role: user.role,
    name: user.name,
    locale: data.preferredLanguage,
    onboarded: true,
  });
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res, req);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
  res.cookies.set(LOCALE_COOKIE, data.preferredLanguage, localeCookieOptions(req));
  return res;
}
