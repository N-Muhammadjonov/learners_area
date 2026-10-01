import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { googleConfigFrom } from "../src/lib/auth/providers/google-config";
import { authorizationUrl, exchangeCode, pkceChallenge, randomToken, verifyGoogleIdToken } from "../src/lib/auth/providers/google";
import { parseFlowCookie } from "../src/lib/auth/google-flow";
import { resolveGoogleAccount } from "../src/lib/auth/google-account";
import { createTestDatabase, type TestDatabase } from "./support/pglite";

const ID = "123-abc.apps.googleusercontent.com";
const env = { GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: "secret-value-123", PUBLIC_BASE_URL: "https://learn.example.uz" } as NodeJS.ProcessEnv;

test("config check: missing/invalid values hide the provider and are named without exposing secrets", () => {
  assert.deepEqual(googleConfigFrom({} as NodeJS.ProcessEnv).missing, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]);
  const ok = googleConfigFrom(env);
  assert.equal(ok.config?.redirectUri, "https://learn.example.uz/api/auth/google/callback");
  assert.deepEqual(googleConfigFrom({ ...env, GOOGLE_REDIRECT_URI: "http://evil.example/api/auth/google/callback" }).missing, ["GOOGLE_REDIRECT_URI"]);
  assert.deepEqual(googleConfigFrom({ ...env, GOOGLE_REDIRECT_URI: "https://learn.example.uz/other" }).missing, ["GOOGLE_REDIRECT_URI"]);
  assert.ok(!JSON.stringify(googleConfigFrom({ ...env, GOOGLE_CLIENT_ID: "x" })).includes("secret-value-123"));
});

test("authorization URL uses code flow + PKCE S256 + state + nonce", async () => {
  const verifier = randomToken(48);
  const url = new URL(authorizationUrl(googleConfigFrom(env).config!, { state: "s".repeat(43), nonce: "n".repeat(43), challenge: await pkceChallenge(verifier) }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), await pkceChallenge(verifier));
  assert.ok(!url.toString().includes("secret-value-123"));
});

test("id_token verification: signature, issuer, audience, nonce, expiry", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string } = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(opts.iss ?? "https://accounts.google.com").setAudience(opts.aud ?? ID).setIssuedAt().setExpirationTime(opts.exp ?? "5m").sign(privateKey);
  const good = await verifyGoogleIdToken(await sign({ sub: "g-1", nonce: "N", email: "A@Example.com", email_verified: true, name: "A" }), { clientId: ID }, "N", keys);
  assert.deepEqual(good, { sub: "g-1", email: "a@example.com", emailVerified: true, name: "A" });
  await assert.rejects(verifyGoogleIdToken(await sign({ sub: "g-1", nonce: "N" }, { aud: "other" }), { clientId: ID }, "N", keys));
  await assert.rejects(verifyGoogleIdToken(await sign({ sub: "g-1", nonce: "N" }, { iss: "https://evil" }), { clientId: ID }, "N", keys));
  await assert.rejects(verifyGoogleIdToken(await sign({ sub: "g-1", nonce: "X" }), { clientId: ID }, "N", keys), /nonce/);
  await assert.rejects(verifyGoogleIdToken(await sign({ sub: "g-1", nonce: "N" }, { exp: "-10m" }), { clientId: ID }, "N", keys));
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT({ sub: "g-1", nonce: "N" }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer("https://accounts.google.com").setAudience(ID).setExpirationTime("5m").sign(other.privateKey);
  await assert.rejects(verifyGoogleIdToken(forged, { clientId: ID }, "N", keys));
});

test("token exchange: bounded, no retry, non-2xx fails", async () => {
  let calls = 0;
  const failing = (async () => { calls += 1; return new Response("{}", { status: 400 }); }) as typeof fetch;
  await assert.rejects(exchangeCode(googleConfigFrom(env).config!, "c", "v", failing), /400/);
  assert.equal(calls, 1);
  const ok = (async (_u: RequestInfo | URL, init?: RequestInit) => { assert.ok(init?.signal); return Response.json({ id_token: "t" }); }) as typeof fetch;
  assert.equal(await exchangeCode(googleConfigFrom(env).config!, "c", "v", ok), "t");
});

test("flow cookie parser rejects tampered/short values", () => {
  const t = randomToken();
  assert.ok(parseFlowCookie(JSON.stringify({ state: t, nonce: t, verifier: randomToken(48) })));
  assert.equal(parseFlowCookie(JSON.stringify({ state: "short", nonce: t, verifier: t })), null);
  assert.equal(parseFlowCookie("not json"), null);
  assert.equal(parseFlowCookie(undefined), null);
});

let database: TestDatabase;
before(async () => { database = await createTestDatabase(); });
after(async () => { await database.close(); });

test("account resolution: sub wins, no email merge, unverified refused, new users are PENDING students", async () => {
  await database.query(`insert into users (name, role, account_status, email, google_sub) values ('Known', 'teacher', 'active', 'known@example.test', 'g-known')`);
  await database.query(`insert into users (name, role, account_status, email, password_hash) values ('Password user', 'student', 'active', 'pw@example.test', 'x')`);
  const conn = database.db as never;
  const known = await resolveGoogleAccount({ sub: "g-known", email: "different@example.test", emailVerified: true, name: "K" }, { locale: "uz" }, conn);
  assert.ok(known.kind === "signed_in" && !known.created && known.user.role === "teacher");
  const link = await resolveGoogleAccount({ sub: "g-new", email: "pw@example.test", emailVerified: true, name: "Attacker" }, { locale: "uz" }, conn);
  assert.equal(link.kind, "link_required");
  const rows = await database.query<{ google_sub: string | null }>(`select google_sub from users where email = 'pw@example.test'`);
  assert.equal(rows[0]!.google_sub, null, "existing account was not modified");
  assert.equal((await resolveGoogleAccount({ sub: "g-x", email: "x@example.test", emailVerified: false, name: null }, { locale: "uz" }, conn)).kind, "unverified_email");
  const created = await resolveGoogleAccount({ sub: "g-fresh", email: "fresh@example.test", emailVerified: true, name: "Fresh" }, { locale: "en" }, conn);
  assert.ok(created.kind === "signed_in" && created.created);
  assert.equal(created.user.accountStatus, "pending");
  assert.equal(created.user.role, "student");
  assert.equal(created.user.passwordHash, null);
});
