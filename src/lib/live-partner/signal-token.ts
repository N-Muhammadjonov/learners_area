import { createHmac } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/**
 * Live Partner realtime configuration (N10).
 *
 * - Signalling: short-lived HS256 token for the standalone service in
 *   `services/live-signal` (offer/answer/ICE relay). Audience-bound, 120 s,
 *   names both participants so the service admits exactly two users. The
 *   shared secret stays on servers; the browser only ever sees the token.
 * - TURN: time-limited coturn "REST API" credentials (use-auth-secret):
 *   username = "<expiry>:<userId>", credential = base64(HMAC-SHA1(secret, username)).
 *   Calls run relay-only, so a stranger never learns the peer's IP.
 */
export const SIGNAL_AUDIENCE = "learners-area-live-signal";
export const SIGNAL_ISSUER = "learners-area";
export const SIGNAL_TOKEN_TTL_S = 120;
export const TURN_CREDENTIAL_TTL_S = 600;

function key(secret: string | undefined) {
  return secret && secret.length >= 32 ? new TextEncoder().encode(secret) : null;
}
export function turnUrls(env: NodeJS.ProcessEnv = process.env) {
  return (env.LIVE_PARTNER_TURN_URLS ?? "").split(",").map((s) => s.trim()).filter((u) => /^turns?:[^\s]+$/.test(u));
}
/** Env completeness only. It is NOT proof that audio works — see `realtimeReadiness`. */
export function signalConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    key(env.LIVE_PARTNER_SIGNAL_SECRET) && env.LIVE_PARTNER_SIGNAL_URL?.startsWith("wss://") &&
    turnUrls(env).length > 0 && (env.LIVE_PARTNER_TURN_SECRET?.length ?? 0) >= 16,
  );
}

let healthCache: { at: number; ok: boolean } | null = null;
/**
 * Ready only when configured AND the signalling service answers /healthz now
 * (cached 30 s). Users are never put into a call the transport cannot carry.
 */
export async function realtimeReadiness(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch, nowMs = Date.now()) {
  if (!signalConfigured(env)) return { ready: false as const, reason: "not_configured" as const };
  if (healthCache && nowMs - healthCache.at < 30_000) return healthCache.ok ? { ready: true as const } : { ready: false as const, reason: "service_unreachable" as const };
  const health = env.LIVE_PARTNER_SIGNAL_URL!.replace(/^wss:/, "https:").replace(/\/signal$/, "") + "/healthz";
  let ok = false;
  try { ok = (await fetcher(health, { cache: "no-store", signal: AbortSignal.timeout(2_000) })).ok; } catch { ok = false; }
  healthCache = { at: nowMs, ok };
  return ok ? { ready: true as const } : { ready: false as const, reason: "service_unreachable" as const };
}
export function resetReadinessCache() { healthCache = null; }

export async function issueSignalToken(
  input: { userId: string; peerId: string; sessionId: string; role: "offerer" | "answerer" },
  secret = process.env.LIVE_PARTNER_SIGNAL_SECRET,
  now = new Date(),
) {
  const k = key(secret);
  if (!k) return null;
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ sid: input.sessionId, peer: input.peerId, role: input.role }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(input.userId)
    .setAudience(SIGNAL_AUDIENCE).setIssuer(SIGNAL_ISSUER).setIssuedAt(iat).setExpirationTime(iat + SIGNAL_TOKEN_TTL_S).sign(k);
}
/** Same rules the service applies (services/live-signal/server.mjs#verifyToken). */
export async function verifySignalToken(token: string, secret = process.env.LIVE_PARTNER_SIGNAL_SECRET, now = new Date()) {
  const k = key(secret);
  if (!k) throw new Error("signal secret missing");
  const { payload } = await jwtVerify(token, k, { audience: SIGNAL_AUDIENCE, issuer: SIGNAL_ISSUER, currentDate: now, algorithms: ["HS256"] });
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string" || typeof payload.peer !== "string") throw new Error("malformed");
  return { userId: payload.sub, sessionId: payload.sid, peerId: payload.peer, role: payload.role };
}

export function turnCredentials(userId: string, env: NodeJS.ProcessEnv = process.env, now = new Date()) {
  const urls = turnUrls(env);
  const secret = env.LIVE_PARTNER_TURN_SECRET;
  if (!urls.length || !secret || secret.length < 16) return null;
  const username = `${Math.floor(now.getTime() / 1000) + TURN_CREDENTIAL_TTL_S}:${userId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { iceServers: [{ urls, username, credential }], iceTransportPolicy: "relay" as const, expiresInSeconds: TURN_CREDENTIAL_TTL_S };
}
