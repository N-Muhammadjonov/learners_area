/**
 * The rate limiter's client key must not be chosen by the client.
 *
 * `x-forwarded-for` is attacker-controlled input: whatever the caller sends arrives
 * intact at the first proxy, which APPENDS rather than sanitises, so the LEFT-most
 * entry is simply what the caller typed. Keying the limiter on it let any caller mint
 * unlimited independent rate-limit identities — rotate the header, get a fresh bucket,
 * and every per-IP limit (failed sign-ins included) stops existing.
 *
 * Trust order: x-vercel-forwarded-for, then x-real-ip (both written by the platform
 * proxy), then x-forwarded-for read RIGHT to LEFT.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { RULES, clientKey, consume, isBlocked, resetAll, type RateLimitRule } from "../src/lib/http/rate-limit";

function reqWith(headers: Record<string, string>): NextRequest {
  return new NextRequest("https://learnersarea.uz/api/auth/login", { headers });
}

test("a forged leftmost x-forwarded-for cannot choose the bucket", () => {
  // The platform appends the true client address; the caller prefixed a lie.
  const forged = clientKey(reqWith({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }));
  assert.equal(forged, "203.0.113.9", "the right-most (proxy-appended) hop must win");

  // Rotating the forged prefix must NOT produce a new identity.
  const keys = new Set(
    ["9.9.9.9", "8.8.8.8", "7.7.7.7", "not-an-ip", ""].map((spoof) =>
      clientKey(reqWith({ "x-forwarded-for": `${spoof}, 203.0.113.9` })),
    ),
  );
  assert.deepEqual([...keys], ["203.0.113.9"], "a rotating forged prefix minted new buckets");
});

test("platform-verified headers outrank anything the client can send", () => {
  assert.equal(
    clientKey(reqWith({
      "x-vercel-forwarded-for": "203.0.113.9",
      "x-real-ip": "198.51.100.5",
      "x-forwarded-for": "1.2.3.4",
    })),
    "203.0.113.9",
  );

  assert.equal(
    clientKey(reqWith({ "x-real-ip": "198.51.100.5", "x-forwarded-for": "1.2.3.4" })),
    "198.51.100.5",
  );
});

test("a bucket key is always an IP literal, never arbitrary attacker text", () => {
  // A header full of text must not become a bucket key.
  assert.equal(clientKey(reqWith({ "x-forwarded-for": "'; DROP TABLE users; --" })), "local");
  assert.equal(clientKey(reqWith({ "x-real-ip": "javascript:alert(1)" })), "local");
  assert.equal(clientKey(reqWith({ "x-forwarded-for": "999.999.999.999" })), "local");

  // A valid IPv6 is accepted and normalised.
  assert.equal(clientKey(reqWith({ "x-real-ip": "2001:DB8::1" })), "2001:db8::1");

  // Absent entirely: one shared local bucket, on purpose.
  assert.equal(clientKey(reqWith({})), "local");
});

test("header rotation can no longer defeat a per-IP limit end to end", () => {
  resetAll();
  const rule = { name: "test_spoof", limit: 3, windowMs: 60_000 } satisfies RateLimitRule;

  // One real client behind the proxy, rotating the forged prefix on every attempt.
  for (let i = 0; i < 3; i += 1) {
    const key = clientKey(reqWith({ "x-forwarded-for": `10.0.0.${i}, 203.0.113.9` }));
    assert.equal(consume(rule, key).ok, true, `attempt ${i} should be inside the limit`);
  }

  const next = clientKey(reqWith({ "x-forwarded-for": "10.9.9.9, 203.0.113.9" }));
  assert.equal(consume(rule, next).ok, false, "a rotated forged prefix bought a fresh bucket");
  assert.equal(isBlocked(rule, "203.0.113.9").ok, false);
  resetAll();
});

test("genuinely different clients still get independent buckets", () => {
  resetAll();
  const rule = { name: "test_distinct", limit: 2, windowMs: 60_000 } satisfies RateLimitRule;

  const a = clientKey(reqWith({ "x-forwarded-for": "203.0.113.9" }));
  const b = clientKey(reqWith({ "x-forwarded-for": "203.0.113.10" }));
  assert.notEqual(a, b, "distinct real clients must not share a bucket");

  assert.equal(consume(rule, a).ok, true);
  assert.equal(consume(rule, a).ok, true);
  assert.equal(consume(rule, a).ok, false, "client A is correctly limited");
  assert.equal(consume(rule, b).ok, true, "client B must not be punished for client A");
  resetAll();
});

test("the per-account limit does not depend on any header at all", () => {
  resetAll();
  const rule = RULES.loginByAccount;
  // Whatever the caller claims about its IP, the account bucket is keyed on the email.
  for (let i = 0; i < rule.limit; i += 1) {
    assert.equal(consume(rule, "victim@example.test").ok, true);
  }
  assert.equal(
    consume(rule, "victim@example.test").ok,
    false,
    "account-scoped limiting must survive unlimited IP rotation",
  );
  resetAll();
});
