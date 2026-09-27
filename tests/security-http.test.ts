import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { RULES, consume, isBlocked, reset, resetAll } from "@/lib/http/rate-limit";
import { checkRequestOrigin, isSafeMethod } from "@/lib/http/request-origin";
import { buildCsp } from "@/lib/http/security-headers";

const request = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(url, { method: init.method ?? "POST", headers: init.headers });

test("a guessing loop is stopped, a correct password is not", () => {
  resetAll();
  const rule = RULES.loginByAccount;
  const key = "student@learnersarea.uz";

  for (let attempt = 0; attempt < rule.limit; attempt += 1) {
    assert.equal(consume(rule, key).ok, true, `attempt ${attempt + 1} should pass`);
  }
  // The next failed attempt is over the limit…
  assert.equal(consume(rule, key).ok, false);
  // …and a caller that is already blocked is refused without doing any work.
  assert.equal(isBlocked(rule, key).ok, false);

  // Signing in successfully clears the counter, so a student who eventually
  // remembers the password is not punished for their typos.
  reset(rule, key);
  assert.equal(isBlocked(rule, key).ok, true);
  assert.equal(consume(rule, key).ok, true);
});

test("counters are per key, never shared between accounts", () => {
  resetAll();
  const rule = RULES.loginByAccount;
  for (let i = 0; i < rule.limit; i += 1) consume(rule, "a@learnersarea.uz");
  assert.equal(isBlocked(rule, "a@learnersarea.uz").ok, false);
  assert.equal(isBlocked(rule, "b@learnersarea.uz").ok, true, "another student must not be blocked");
});

test("an expired window frees the key again", () => {
  resetAll();
  const rule = { name: "test_expiry", limit: 1, windowMs: 20 };
  assert.equal(consume(rule, "ip").ok, true);
  assert.equal(consume(rule, "ip").ok, false);
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      assert.equal(isBlocked(rule, "ip").ok, true, "the counter should expire");
      resolve();
    }, 40);
  });
});

test("safe methods are never blocked by the origin check", () => {
  assert.equal(isSafeMethod("GET"), true);
  assert.equal(isSafeMethod("HEAD"), true);
  assert.equal(isSafeMethod("OPTIONS"), true);
  assert.equal(isSafeMethod("POST"), false);
  assert.equal(isSafeMethod("DELETE"), false);

  const get = request("http://localhost:3000/api/vocabulary", {
    method: "GET",
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(checkRequestOrigin(get).allowed, true);
});

test("a cross-site state-changing request is refused", () => {
  const foreign = request("http://localhost:3000/api/auth/login", {
    headers: { origin: "https://attacker.example" },
  });
  const verdict = checkRequestOrigin(foreign);
  assert.equal(verdict.allowed, false);

  // A sandboxed frame sends `Origin: null`; that is never a legitimate caller.
  const opaque = request("http://localhost:3000/api/vocabulary", { headers: { origin: "null" } });
  assert.equal(checkRequestOrigin(opaque).allowed, false);
});

test("same-origin and headerless callers pass", () => {
  const sameOrigin = request("http://localhost:3000/api/vocabulary", {
    headers: { origin: "http://localhost:3000" },
  });
  assert.equal(checkRequestOrigin(sameOrigin).allowed, true);

  // Through the preview proxy the browser sends the forwarded host.
  const forwarded = request("https://app.test:3443/api/vocabulary", {
    headers: { origin: "https://app.test:3443", "x-forwarded-host": "app.test:3443" },
  });
  assert.equal(checkRequestOrigin(forwarded).allowed, true);

  // curl and the project's own scripts send neither header.
  const scripted = request("http://localhost:3000/api/auth/login");
  assert.equal(checkRequestOrigin(scripted).allowed, true);
});

test("a foreign referer is refused even without an origin header", () => {
  const sneak = request("http://localhost:3000/api/vocabulary", {
    headers: { referer: "https://attacker.example/evil.html" },
  });
  assert.equal(checkRequestOrigin(sneak).allowed, false);
});

test("the CSP names what the app needs and opens nothing to *", () => {
  const csp = buildCsp({ nonce: "abc123", secure: true, dev: false });
  assert.match(csp, /script-src 'self' 'nonce-abc123' 'strict-dynamic'/);
  assert.ok(!csp.includes("'unsafe-eval'"), "production must not allow eval");
  assert.ok(!csp.includes("unsafe-inline' 'strict-dynamic'"));
  assert.ok(!/(^|[\s;])\*([\s;]|$)/.test(csp), "a wildcard must never appear in the policy");
  assert.match(csp, /frame-src 'self' https:\/\/www\.youtube-nocookie\.com https:\/\/www\.youtube\.com/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /upgrade-insecure-requests/);

  const devCsp = buildCsp({ nonce: "abc123", secure: false, dev: true });
  assert.match(devCsp, /'unsafe-eval'/, "the dev server needs eval for HMR");
  assert.ok(!devCsp.includes("upgrade-insecure-requests"), "plain http must not be upgraded");
});

test("a preview hostname does not automatically allow arbitrary embedding", () => {
  const preview = buildCsp({ nonce: "n", secure: true, dev: false, host: "3000-abc.e2b.app" });
  assert.match(preview, /frame-ancestors 'self';/);
  // …and nothing is ever framed by everybody.
  assert.ok(!preview.includes("frame-ancestors *"));
});

test("style-src keeps its documented exception", () => {
  const csp = buildCsp({ nonce: "n", secure: true, dev: false });
  // Recorded on purpose: Next.js emits inline styles and a style nonce is not
  // plumbed through the framework today. Scripts stay nonce-only.
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
});
