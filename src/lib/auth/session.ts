import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
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
  authVersion?: number;
};

export type VerifiedSessionPayload = SessionPayload & {
  authVersion: number;
  expiresAt: number;
  /** Opaque digest, never the token or a signing secret. */
  sessionKey: string;
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
  const authVersion = payload.authVersion ?? 0;
  if (!Number.isSafeInteger(authVersion) || authVersion < 0) throw new Error("invalid_auth_version");
  return new SignJWT({ ...payload, authVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<VerifiedSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    // Existing issued cookies predate epochs; they remain valid only while the
    // authoritative row is still at zero. Any subsequent revocation is final.
    const authVersion = payload.authVersion ?? 0;
    if (
      typeof payload.sub === "string" &&
      isRole(payload.role) &&
      typeof payload.name === "string" &&
      typeof payload.locale === "string" &&
      typeof payload.onboarded === "boolean" &&
      Number.isSafeInteger(authVersion) && Number(authVersion) >= 0 &&
      typeof payload.exp === "number" && Number.isSafeInteger(payload.exp)
    ) {
      return {
        sub: payload.sub,
        role: payload.role,
        name: payload.name,
        locale: payload.locale,
        onboarded: payload.onboarded,
        authVersion: Number(authVersion),
        expiresAt: payload.exp,
        sessionKey: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Read + verify the session cookie. Safe to call from Server Components. */
export async function getSession(): Promise<VerifiedSessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
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
