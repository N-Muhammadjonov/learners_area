import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { googleConfigFrom, type GoogleConfig } from "./google-config";

export { googleConfigFrom, type GoogleConfig };

/**
 * Google sign-in (OpenID Connect, authorization-code flow with PKCE + state +
 * nonce). Identity is the verified `sub` claim. An email address is NEVER used
 * to join a Google identity onto an existing account automatically: a matching
 * email produces `link_required`, and the person must sign in with their
 * existing method. New Google users start PENDING like every other applicant.
 */
export const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
let remoteJwks: JWTVerifyGetKey | null = null;
function googleJwks(): JWTVerifyGetKey {
  remoteJwks ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 5_000 });
  return remoteJwks;
}

export function isGoogleConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return googleConfigFrom(env).config !== null;
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export function authorizationUrl(config: GoogleConfig, input: { state: string; nonce: string; challenge: string }): string {
  const url = new URL(GOOGLE_AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code",
    scope: "openid email profile", state: input.state, nonce: input.nonce,
    code_challenge: input.challenge, code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return url.toString();
}

export type GoogleClaims = { sub: string; email: string | null; emailVerified: boolean; name: string | null };

export async function verifyGoogleIdToken(
  idToken: string,
  config: Pick<GoogleConfig, "clientId">,
  expectedNonce: string,
  keys: JWTVerifyGetKey = googleJwks()
): Promise<GoogleClaims> {
  const { payload } = await jwtVerify(idToken, keys, { issuer: GOOGLE_ISSUERS, audience: config.clientId, clockTolerance: 30 });
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("google: missing sub");
  if (payload.nonce !== expectedNonce) throw new Error("google: nonce mismatch");
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email.toLowerCase() : null,
    emailVerified,
    name: typeof payload.name === "string" ? payload.name.slice(0, 200) : null,
  };
}

/** Exchange the code with a bounded timeout; never retried automatically. */
export async function exchangeCode(config: GoogleConfig, code: string, verifier: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code", code_verifier: verifier }),
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`google: token endpoint ${response.status}`);
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string") throw new Error("google: no id_token");
  return body.id_token;
}
