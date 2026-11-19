import assert from "node:assert/strict";
import test from "node:test";

import {
  cookiePolicyFor,
  cookiePolicyForRequest,
  requestIsHttps,
  serializeCookieClear,
} from "../src/lib/auth/cookie-policy";

/**
 * The sign-in cookie rules.
 *
 * These exist because of a real, reproducible failure: the Arena preview embeds
 * the app in a frame on another site, and a `SameSite=Lax` cookie is never stored
 * there — so the visitor signed in successfully (HTTP 200) and was thrown straight
 * back to the login screen.
 */

function request(headers: Record<string, string>, protocol?: string) {
  const bag = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name: string) => bag.get(name.toLowerCase()) ?? null }, nextUrl: protocol ? { protocol } : undefined };
}

test("over TLS a first-party cookie is Lax, Secure and not partitioned", () => {
  assert.deepEqual(cookiePolicyFor(true), { sameSite: "lax", secure: true, partitioned: false });
  assert.deepEqual(cookiePolicyFor(true, true), { sameSite: "none", secure: true, partitioned: true });
});

test("over plain HTTP the cookie keeps the protective Lax default", () => {
  assert.deepEqual(cookiePolicyFor(false), { sameSite: "lax", secure: false, partitioned: false });
});

test("the browser-facing scheme is taken from the proxy when it is forwarded", () => {
  assert.equal(requestIsHttps(request({ "x-forwarded-proto": "https" })), true);
  assert.equal(requestIsHttps(request({ "x-forwarded-proto": "http" })), false);
  // Proxies append; the left-most value is the client's.
  assert.equal(requestIsHttps(request({ "x-forwarded-proto": "https, http" })), true);
});

test("the page's own origin is the backstop when a proxy forwards nothing", () => {
  assert.equal(requestIsHttps(request({ origin: "https://3000-abc.e2b.app" })), true);
  assert.equal(requestIsHttps(request({ origin: "http://localhost:3000" })), false);
  assert.equal(requestIsHttps(request({ referer: "https://3000-abc.e2b.app/login" })), true);
  assert.equal(requestIsHttps(request({})), false);
});

test("the request URL is the last signal", () => {
  assert.equal(requestIsHttps(request({}, "https:")), true);
  assert.equal(requestIsHttps(request({}, "http:")), false);
  assert.deepEqual(cookiePolicyForRequest(request({ "x-forwarded-proto": "https" })), {
    sameSite: "lax",
    secure: true,
    partitioned: false,
  });
  for (const headers of [
    { "x-forwarded-proto": "https", "x-learners-embedded": "1" },
    { "x-forwarded-proto": "https", "sec-fetch-dest": "iframe" },
  ]) {
    assert.deepEqual(cookiePolicyForRequest(request(headers)), {
      sameSite: "none", secure: true, partitioned: true,
    });
  }
});

test("a partitioned cookie is retired only by a matching expiry", () => {
  const partitioned = serializeCookieClear("la_session", cookiePolicyFor(true, true));
  assert.equal(partitioned, "la_session=; Path=/; Max-Age=0; SameSite=None; Secure; Partitioned");

  // The pre-partition shape of the same cookie, so signing out ends all of it.
  const plain = serializeCookieClear("la_session", cookiePolicyFor(true));
  assert.equal(plain, "la_session=; Path=/; Max-Age=0; SameSite=Lax; Secure");
  assert.ok(!plain.includes("Partitioned"));
  const local = serializeCookieClear("la_session", cookiePolicyFor(false));
  assert.equal(local, "la_session=; Path=/; Max-Age=0; SameSite=Lax");
});
