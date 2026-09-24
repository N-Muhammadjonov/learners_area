import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
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

/** Read + verify the session cookie. Safe to call from Server Components. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
