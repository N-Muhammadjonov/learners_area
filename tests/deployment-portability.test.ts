import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { configuredPublicOrigin, deploymentEnvironment, normalizeOrigin, performanceDiagnosticsEnabled } from "../src/lib/config/site";
import { checkRequestOrigin, requestOrigin } from "../src/lib/http/request-origin";
import { sessionCookieOptions } from "../src/lib/auth/session";
import { getStorageService, resetStorageServiceForTests } from "../src/lib/services/storage";

test("one canonical authority survives domain and provider changes", () => {
  assert.equal(configuredPublicOrigin({ PUBLIC_BASE_URL: "https://centre.example/", NEXT_PUBLIC_APP_URL: "https://legacy.example" }), "https://centre.example");
  assert.equal(configuredPublicOrigin({ NEXT_PUBLIC_APP_URL: "http://localhost:3100/" }), "http://localhost:3100");
  assert.equal(configuredPublicOrigin({ VERCEL_URL: "random-preview.vercel.app" }), null);
  assert.throws(() => configuredPublicOrigin({ PUBLIC_BASE_URL: "https://centre.example/path", NEXT_PUBLIC_APP_URL: "https://legacy.example" }));
  for (const value of ["javascript:alert(1)", "https://user:password@example.com", "https://example.com/?x=1", "https:", "*", "https://example.com/#x"]) assert.equal(normalizeOrigin(value), null);
});

test("preview stays preview even with a production canonical domain configured", () => {
  assert.equal(deploymentEnvironment({ VERCEL_ENV: "preview", NODE_ENV: "production" }), "preview");
  assert.equal(deploymentEnvironment({ APP_ENV: "preview", NODE_ENV: "production" }), "preview");
  assert.equal(deploymentEnvironment({ APP_ENV: "production" }), "production");
});

test("CSRF compares complete origins and ignores untrusted forwarded headers", () => {
  const req = (origin: string, extra = {}) => new NextRequest("https://centre.example/api/write", { method: "POST", headers: { origin, ...extra } });
  assert.equal(checkRequestOrigin(req("https://centre.example")).allowed, true);
  assert.equal(checkRequestOrigin(req("http://centre.example")).allowed, false, "HTTPS downgrade is not same origin");
  assert.equal(checkRequestOrigin(req("https://centre.example:444")).allowed, false);
  assert.equal(checkRequestOrigin(new NextRequest("http://localhost:3101/api/write", { method: "POST", headers: { host: "127.0.0.1:3101", origin: "http://127.0.0.1:3101" } })).allowed, true, "use actual HTTP authority when Next normalizes loopback");
  assert.equal(checkRequestOrigin(req("https://evil.example", { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" })).allowed, false);
  assert.equal(checkRequestOrigin(new NextRequest("https://centre.example/api/write", { method: "POST", headers: { "sec-fetch-site": "cross-site" } })).allowed, false);
});

test("sessions remain host-only across domains", () => {
  for (const host of ["centre.example", "new-centre.example"]) {
    const options = sessionCookieOptions(new NextRequest(`https://${host}/api/auth/login`));
    assert.equal(options.httpOnly, true);
    assert.equal(options.secure, true);
    assert.equal("domain" in options, false);
  }
});

test("trusted TLS proxy can supply the public authority without fixing a provider hostname", () => {
  const req = new NextRequest("http://127.0.0.1:3000/api/write", { headers: { host: "centre.example", "x-forwarded-proto": "https" } });
  assert.equal(requestOrigin(req, { TRUST_PROXY_HEADERS: "true" }), "https://centre.example");
  assert.equal(requestOrigin(req, { VERCEL: "1" }), "https://centre.example");
  assert.equal(requestOrigin(req, { VERCEL: "1", TRUST_PROXY_HEADERS: "false" }), "http://centre.example");
});

test("unknown storage configuration never silently falls back to disk", () => {
  const previous = process.env.STORAGE_PROVIDER;
  try {
    process.env.STORAGE_PROVIDER = "misspelled-provider";
    resetStorageServiceForTests();
    assert.throws(getStorageService, /STORAGE_PROVIDER must/);
  } finally {
    if (previous === undefined) delete process.env.STORAGE_PROVIDER;
    else process.env.STORAGE_PROVIDER = previous;
    resetStorageServiceForTests();
  }
});

test("browser diagnostics are automatic on Preview and can never run on production", () => {
  assert.equal(performanceDiagnosticsEnabled({ APP_ENV: "preview" }), true);
  assert.equal(performanceDiagnosticsEnabled({ VERCEL_ENV: "preview", NODE_ENV: "production" }), true);
  assert.equal(performanceDiagnosticsEnabled({ NODE_ENV: "development" }), false);
  assert.equal(performanceDiagnosticsEnabled({ APP_ENV: "preview", NODE_ENV: "production", PERFORMANCE_DIAGNOSTICS: "1" }), true);
  assert.equal(performanceDiagnosticsEnabled({ APP_ENV: "production", PERFORMANCE_DIAGNOSTICS: "1" }), false);
  assert.equal(performanceDiagnosticsEnabled({ NODE_ENV: "production", PERFORMANCE_DIAGNOSTICS: "1" }), false);
  assert.equal(performanceDiagnosticsEnabled({ APP_ENV: "preview", VERCEL_ENV: "production", PERFORMANCE_DIAGNOSTICS: "1" }), false);
});
