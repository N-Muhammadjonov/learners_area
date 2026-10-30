import { SignJWT, jwtVerify } from "jose";
import { cookiePolicyForRequest, serializeCookieClear, type RequestLike } from "./cookie-policy";
import { isRole, type Role } from "./roles";

export const SESSION_COOKIE = "la_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type { Role };

/**
 * What the signed cookie carries: **identity and presentation only**.
 *
 * `role` is here so the UI can render the right navigation without an extra
 * query, but it is never trusted for authorization — every sensitive server
 * path re-reads role and account status from the database via
 * `getCurrentUser()` (src/lib/auth/current-user.ts). Likewise there is no
 * "isOwner" flag: ownership is the OWNER role, and a stale cookie cannot
 * preserve a permission that was revoked.
 */
export type SessionPayload = {
  sub: string; // user id
  role: Role;
  name: string;
  locale: string;
  onboarded: boolean;
};

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Set a real secret in .env (see .env.example)."
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      typeof payload.sub === "string" &&
      isRole(payload.role) &&
      typeof payload.name === "string" &&
      typeof payload.locale === "string" &&
      typeof payload.onboarded === "boolean"
    ) {
      return {
        sub: payload.sub,
        role: payload.role,
        name: payload.name,
        locale: payload.locale,
        onboarded: payload.onboarded,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The session cookie, described for the request that is writing it.
 *
 * The attributes depend on the transport (see ./cookie-policy): the same app is
 * served as a top-level site and, in the Arena preview, inside a frame on another
 * site — and only `SameSite=None; Secure; Partitioned` survives the second one.
 */
export function sessionCookieOptions(req: RequestLike) {
  return {
    httpOnly: true,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    ...cookiePolicyForRequest(req),
  };
}

/**
 * Expire the session cookie — in both shapes it can have.
 *
 * A cookie written before the partition-aware policy, or in a top-level context,
 * sits in the same jar under the same name. Leaving it behind would mean "sign
 * out" only ended half a session, and a stale cookie can shadow the fresh one
 * because the request parser returns the first match.
 */
export function clearSessionCookies(res: { headers: { append(name: string, value: string): void } }, req: RequestLike) {
  const policy = cookiePolicyForRequest(req);
  res.headers.append("Set-Cookie", serializeCookieClear(SESSION_COOKIE, policy));
  if (policy.partitioned) {
    // The pre-partition shape of the same cookie.
    res.headers.append("Set-Cookie", serializeCookieClear(SESSION_COOKIE, { sameSite: "lax", secure: false, partitioned: false }));
  }
}
