import { NextResponse, NextRequest } from "next/server";
import { consumeIntent } from "@/lib/auth/telegram-intent";
import { createSessionToken, SESSION_COOKIE, clearSessionCookies, sessionCookieOptions } from "@/lib/auth/session";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const { intentId, browserNonce } = await req.json();
    if (!intentId || !browserNonce) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    const intent = await consumeIntent(intentId, browserNonce);
    if (!intent || !intent.telegramUserId) {
      return NextResponse.json({ error: "Intent not found, expired, or not confirmed" }, { status: 400 });
    }

    let user = await db.query.users.findFirst({
      where: eq(users.telegramId, intent.telegramUserId),
    });

    if (!user) {
      if (intent.userId) {
        const [updatedUser] = await db.update(users)
          .set({ telegramId: intent.telegramUserId })
          .where(eq(users.id, intent.userId))
          .returning();
        
        if (!updatedUser) {
           return NextResponse.json({ error: "Failed to link user" }, { status: 400 });
        }
        user = updatedUser;
      } else {
        return NextResponse.json({ error: "No Learners Area account linked to this Telegram identity. Please use the bot to request access first." }, { status: 404 });
      }
    } else {
      if (intent.userId && intent.userId !== user.id) {
         return NextResponse.json({ error: "This Telegram identity is already linked to a different account." }, { status: 409 });
      }
    }

    const token = await createSessionToken({
      sub: user.id,
      role: user.role,
      name: user.name,
      locale: user.locale,
      onboarded: Boolean(user.onboardingCompletedAt),
    });

    const res = NextResponse.json({
      success: true,
      onboarded: Boolean(user.onboardingCompletedAt),
      accountStatus: user.accountStatus,
    });
    
    clearSessionCookies(res, req);
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
    return res;
  } catch (error) {
    console.error("Exchange intent error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
