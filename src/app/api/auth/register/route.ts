import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { registerSchema } from "@/lib/validation/auth";
import { hashPassword } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE, clearSessionCookies, sessionCookieOptions } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";
import { RULES, clientKey, enforce } from "@/lib/http/rate-limit";
import { classifyDatabaseError, databaseUnavailableResponse } from "@/lib/http/database-errors";
import { createAccessRequest } from "@/lib/data/admission";

export async function POST(req: NextRequest) {
  // Mass registration is the cheapest abuse there is; a private centre admits a
  // handful of people a month, never a burst from one address.
  const limited = enforce(RULES.register, clientKey(req));
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { name, email, password } = parsed.data;

  // A deployment whose database has not been migrated answers 503 with a fixed
  // code instead of an opaque 500. The driver's own message is logged, never
  // returned: it carries the host and the user.
  try {
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existing) {
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const locale = await getLocale();

    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash, role: "student", locale })
      .returning();

    if (!user) {
      return NextResponse.json({ error: "Could not create account" }, { status: 500 });
    }

    /*
     * Registering is asking to join: the account is PENDING either way, and the
     * centre's admission queue is where a pending account is meant to appear.
     * Without this row the applicant waited in a room that said "your request is
     * with the centre" while the owner's queue — which lists requests — showed
     * nothing at all. The row is created here; nobody is approved here.
     *
     * A failure to enqueue must not lose the account: the queue also lists
     * pending accounts whose request row is missing, so the applicant stays
     * visible and an administrator can still decide.
     */
    try {
      await createAccessRequest({ userId: user.id });
    } catch (cause) {
      console.error("[register] could not enqueue the access request", cause);
    }

    return issueSession(user, req);
  } catch (cause) {
    const reason = classifyDatabaseError(cause);
    if (!reason) throw cause;
    console.error(`[register] database unavailable (${reason})`);
    const unavailable = databaseUnavailableResponse(reason);
    return NextResponse.json(unavailable.body, { status: unavailable.status });
  }
}

/** The session half of registration, kept separate so the try block above stays readable. */
async function issueSession(
  user: Pick<typeof users.$inferSelect, "id" | "role" | "name" | "locale" | "accountStatus">,
  req: NextRequest
) {

  const token = await createSessionToken({
    sub: user.id,
    role: user.role,
    name: user.name,
    locale: user.locale,
    onboarded: false,
  });
  // A brand-new account is PENDING by design: the client sends it to the waiting
  // room, where it can ask for access — never into a private area.
  const res = NextResponse.json({ ok: true, onboarded: false, accountStatus: user.accountStatus });
  clearSessionCookies(res, req);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
  return res;
}
