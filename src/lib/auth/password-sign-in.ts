import { canUsePasswordRecovery } from "@/lib/auth/public-auth-policy";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { loginSchema } from "@/lib/validation/auth";
import { passwordLoginColumns } from "@/lib/auth/password-login-columns";
import { verifyPasswordOrDecoy } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE, clearSessionCookies, sessionCookieOptions } from "@/lib/auth/session";
import { RULES, accountKey, blockIfOver, clientKey, consume, reset } from "@/lib/http/rate-limit";
import { classifyDatabaseError, databaseUnavailableResponse } from "@/lib/http/database-errors";

export async function authenticatePassword(req: NextRequest, recoveryOnly = false, client = db) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  // A guessing loop is stopped before any hashing work happens. A correct
  // password never touches these counters, so a student who simply types it
  // right is never locked out by their own earlier typos… and the failed
  // attempts are counted below, where we know they failed.
  const blocked =
    blockIfOver(RULES.loginByAccount, accountKey(email)) ?? blockIfOver(RULES.loginByIp, clientKey(req));
  if (blocked) return blocked;

  // A database that is not there yet must not look like a wrong password: 503
  // with a fixed code, and the driver's message stays in the server log.
  let user;
  try {
    // Password sign-in does not depend on optional provider identity columns.
    // Explicit projection also avoids fetching unrelated profile/private data.
    user = await client.query.users.findFirst({ where: eq(users.email, email), columns: passwordLoginColumns });
  } catch (cause) {
    const reason = classifyDatabaseError(cause);
    if (!reason) throw cause;
    console.error(`[login] database unavailable (${reason})`);
    const unavailable = databaseUnavailableResponse(reason);
    return NextResponse.json(unavailable.body, { status: unavailable.status });
  }

  // ALWAYS one bcrypt comparison, whether or not the account exists: a missing hash used
  // to skip the work entirely and answered ~390 ms faster, which is an enumeration oracle
  // no uniform error message can hide. See verifyPasswordOrDecoy.
  const valid = await verifyPasswordOrDecoy(password, user?.passwordHash);

  if (!valid || !user || (recoveryOnly && !canUsePasswordRecovery(user))) {
    consume(RULES.loginByAccount, accountKey(email));
    consume(RULES.loginByIp, clientKey(req));
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  // The password was right: forgive this account's earlier failed attempts.
  reset(RULES.loginByAccount, accountKey(email));

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
  res.headers.set("Cache-Control", "no-store");
  clearSessionCookies(res, req);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
  return res;
}
