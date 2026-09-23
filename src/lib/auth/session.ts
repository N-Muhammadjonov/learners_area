import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "la_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type Role = "student" | "teacher" | "admin";

export type SessionPayload = {
  sub: string; // user id
  role: Role;
  name: string;
  locale: string;
  onboarded: boolean;
  isOwner: boolean;
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
      typeof payload.role === "string" &&
      typeof payload.name === "string" &&
      typeof payload.locale === "string" &&
      typeof payload.onboarded === "boolean" &&
      typeof payload.isOwner === "boolean"
    ) {
      return payload as unknown as SessionPayload;
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
