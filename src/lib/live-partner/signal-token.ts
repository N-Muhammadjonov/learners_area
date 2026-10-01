import { SignJWT, jwtVerify } from "jose";

/**
 * Short-lived token for the external realtime signalling service (WebRTC
 * offer/answer/ICE). Audience-bound, 2-minute expiry, issued only for a live
 * session the server already authorised. The secret is shared with the
 * signalling service via LIVE_PARTNER_SIGNAL_SECRET; without it, no token is
 * issued and the UI states that realtime audio is not configured.
 */
export const SIGNAL_AUDIENCE = "learners-area-live-signal";
export const SIGNAL_ISSUER = "learners-area";
function key(secret: string | undefined) {
  return secret && secret.length >= 32 ? new TextEncoder().encode(secret) : null;
}
export function signalConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(key(env.LIVE_PARTNER_SIGNAL_SECRET) && env.LIVE_PARTNER_SIGNAL_URL?.startsWith("wss://"));
}
export async function issueSignalToken(input: { userId: string; sessionId: string }, secret = process.env.LIVE_PARTNER_SIGNAL_SECRET, now = new Date()) {
  const k = key(secret);
  if (!k) return null;
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ sid: input.sessionId }).setProtectedHeader({ alg: "HS256" }).setSubject(input.userId)
    .setAudience(SIGNAL_AUDIENCE).setIssuer(SIGNAL_ISSUER).setIssuedAt(iat).setExpirationTime(iat + 120).sign(k);
}
/** Reference verifier for the signalling service (same rules, used in tests). */
export async function verifySignalToken(token: string, secret = process.env.LIVE_PARTNER_SIGNAL_SECRET, now = new Date()) {
  const k = key(secret);
  if (!k) throw new Error("signal secret missing");
  const { payload } = await jwtVerify(token, k, { audience: SIGNAL_AUDIENCE, issuer: SIGNAL_ISSUER, currentDate: now, algorithms: ["HS256"] });
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string") throw new Error("malformed");
  return { userId: payload.sub, sessionId: payload.sid };
}
