import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { publicAuthPolicy, canUsePasswordRecovery } from "../src/lib/auth/public-auth-policy";
import { authenticatePassword } from "../src/lib/auth/password-sign-in";
import { hashPassword } from "../src/lib/auth/password";
import { verifySessionToken } from "../src/lib/auth/session";
import { verifyTelegramPayload, type TelegramAuthPayload } from "../src/lib/auth/providers/telegram";
import { resetAll } from "../src/lib/http/rate-limit";
import { buildCsp } from "../src/lib/http/security-headers";
import { createTestDatabase } from "./support/pglite";

const ready: Record<string, string | undefined> = {
  PUBLIC_AUTH_MODE: "telegram-only", PUBLIC_BASE_URL: "https://learnersarea.uz",
  TELEGRAM_AUTH_E2E_VERIFIED_ORIGIN: "https://learnersarea.uz",
  TELEGRAM_BOT_TOKEN: "test-only-token", TELEGRAM_BOT_USERNAME: "test_only_bot",
};
async function withEnv(env: Record<string, string | undefined>, run: () => Promise<void>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try { await run(); } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

test("default and rollback preserve public authentication; unverified cutover cannot activate", () => {
  assert.equal(publicAuthPolicy({}).passwordEnabled, true);
  assert.equal(publicAuthPolicy(ready).telegramOnly, true);
  for (const patch of [
    { PUBLIC_AUTH_MODE: "standard" }, { PUBLIC_AUTH_MODE: "typo" },
    { TELEGRAM_AUTH_E2E_VERIFIED_ORIGIN: "" },
    { TELEGRAM_AUTH_E2E_VERIFIED_ORIGIN: "https://preview.example" },
    { PUBLIC_BASE_URL: "http://learnersarea.uz" }, { TELEGRAM_BOT_TOKEN: "" },
    { TELEGRAM_BOT_USERNAME: "" }, { PUBLIC_BASE_URL: "invalid" },
  ]) assert.equal(publicAuthPolicy({ ...ready, ...patch }).telegramOnly, false, JSON.stringify(patch));
  assert.equal(publicAuthPolicy({ ...ready, PUBLIC_BASE_URL: "https://learnersarea.uz/app" }).telegramOnly, true);
});

test("all six public non-Telegram endpoints refuse before validation, DB, hashing or provider work", async () => {
  await withEnv(ready, async () => {
    const handlers = [
      (await import("../src/app/api/auth/login/route")).POST,
      (await import("../src/app/api/auth/register/route")).POST,
      (await import("../src/app/api/auth/reset/request/route")).POST,
      (await import("../src/app/api/auth/reset/confirm/route")).POST,
      (await import("../src/app/api/auth/google/start/route")).GET,
      (await import("../src/app/api/auth/google/callback/route")).GET,
    ];
    for (const handler of handlers) {
      const res = await handler(new NextRequest("https://learnersarea.uz/api/auth/login?recovery=true", {
        method: "POST", body: "malformed-json", headers: { "x-recovery": "true" },
      }));
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: "authentication_method_disabled" });
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("set-cookie"), null);
    }
    process.env.PUBLIC_AUTH_MODE = "standard";
    const normal = await (await import("../src/app/api/auth/login/route")).POST(
      new NextRequest("https://learnersarea.uz/api/auth/login", { method: "POST", body: "{}" }));
    assert.equal(normal.status, 400, "rollback immediately reaches preserved validation");
  });
});

test("recovery accepts only active database owner/admin, regardless of client-claimed role", async () => {
  const database = await createTestDatabase();
  const password = "FixturePassword123!";
  const hashed = await hashPassword(password);
  try {
    await withEnv({ ...ready, AUTH_SECRET: "local-test-secret-at-least-16-characters" }, async () => {
      for (const [role, state, expected] of [
        ["owner", "active", 200], ["admin", "active", 200],
        ["teacher", "active", 401], ["student", "active", 401],
        ["owner", "suspended", 401], ["admin", "pending", 401],
      ] as const) {
        resetAll();
        const email = `${role}-${state}@fixture.test`;
        await database.query("insert into users(email,name,role,account_status,password_hash) values ($1,'Fixture',$2,$3,$4)", [email, role, state, hashed]);
        const before = await database.query("select id,role,account_status,password_hash from users where email=$1", [email]);
        const res = await authenticatePassword(new NextRequest("https://learnersarea.uz/api/auth/recovery/login", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, role: "owner", accountStatus: "active" }),
        }), true, database.db);
        assert.equal(res.status, expected, `${role}/${state}`);
        if (expected === 200) {
          const token = res.cookies.get("la_session")?.value;
          assert.ok(token);
          assert.equal((await verifySessionToken(token))?.role, role);
          const cookie = res.headers.get("set-cookie")!;
          assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i);
          assert.equal(res.headers.get("cache-control"), "no-store");
        } else {
          assert.deepEqual(await res.json(), { error: "invalid_credentials" });
          assert.equal(res.headers.get("set-cookie"), null);
        }
        assert.deepEqual(await database.query("select id,role,account_status,password_hash from users where email=$1", [email]), before);
      }
      resetAll();
      const wrong = await authenticatePassword(new NextRequest("https://learnersarea.uz/api/auth/recovery/login", {
        method: "POST", body: JSON.stringify({ email: "owner-active@fixture.test", password: "wrong-password" }),
      }), true, database.db);
      assert.equal(wrong.status, 401);
      assert.equal(wrong.headers.get("set-cookie"), null);
    });
  } finally { await database.close(); }
  assert.equal(canUsePasswordRecovery(null), false);
});

test("Telegram signature integrity and stale/future/malformed payloads", async () => {
  await withEnv({ TELEGRAM_BOT_TOKEN: "test-only-token" }, async () => {
    const sign = (values: Omit<TelegramAuthPayload, "hash">): TelegramAuthPayload => {
      const str = Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
      return { ...values, hash: createHmac("sha256", createHash("sha256").update("test-only-token").digest()).update(str).digest("hex") };
    };
    const values = { id: 12345, first_name: "Fixture", auth_date: Math.floor(Date.now() / 1000) };
    const valid = sign(values);
    assert.equal(verifyTelegramPayload(valid), true);
    assert.equal(verifyTelegramPayload({ ...valid, first_name: "Forged" }), false);
    assert.equal(verifyTelegramPayload(sign({ ...values, auth_date: values.auth_date - 301 })), false);
    assert.equal(verifyTelegramPayload(sign({ ...values, auth_date: values.auth_date + 120 })), false);
    for (const id of [-1, 0, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(verifyTelegramPayload(sign({ ...values, id })), false);
    assert.equal(verifyTelegramPayload({ ...valid, hash: "bad" }), false);
    process.env.TELEGRAM_BOT_TOKEN = "";
    assert.equal(verifyTelegramPayload(valid), false);
  });
});

test("CSP keeps nonce/strict-dynamic and narrowly allows Telegram widget frame", () => {
  const csp = buildCsp({ nonce: "qa-nonce", secure: true, dev: false });
  assert.match(csp, /script-src 'self' 'nonce-qa-nonce' 'strict-dynamic'/);
  assert.match(csp, /frame-src [^;]*https:\/\/oauth.telegram.org/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline|script-src[^;]*unsafe-eval|frame-src[^;]*\*/);
});
