import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, onboardingProfiles, courses, enrollments } from "@/db/schema";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { getSession, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { localeCookieOptions, LOCALE_COOKIE } from "@/lib/i18n";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = onboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const data = parsed.data;

  await db
    .insert(onboardingProfiles)
    .values({
      userId: session.sub,
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
    .where(eq(users.id, session.sub));

  // Auto-enroll in the (only, for now) IELTS course.
  const ieltsCourse = await db.query.courses.findFirst({ where: eq(courses.slug, "ielts") });
  if (ieltsCourse) {
    const existing = await db.query.enrollments.findFirst({
      where: eq(enrollments.userId, session.sub),
    });
    if (!existing) {
      await db.insert(enrollments).values({ userId: session.sub, courseId: ieltsCourse.id });
    }
  }

  const token = await createSessionToken({
    sub: session.sub,
    role: session.role,
    name: session.name,
    locale: data.preferredLanguage,
    onboarded: true,
    isOwner: session.isOwner,
  });
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions);
  cookies().set(LOCALE_COOKIE, data.preferredLanguage, localeCookieOptions);

  return NextResponse.json({ ok: true });
}
