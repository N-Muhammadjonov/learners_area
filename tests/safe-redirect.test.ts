import assert from "node:assert/strict";
import test from "node:test";

import { safeNextPath } from "../src/lib/auth/safe-redirect";

/**
 * `/login?next=…` is attacker-controlled, so the only acceptable answers are
 * paths inside this application.
 */

test("a real in-app path is honoured", () => {
  assert.equal(safeNextPath("/app/vocabulary"), "/app/vocabulary");
  assert.equal(safeNextPath("/app"), "/app");
  assert.equal(safeNextPath("/app/courses/ielts/lessons/abc"), "/app/courses/ielts/lessons/abc");
  // `/app/dashboard` is still a legitimate, safe next target — it is the alias that
  // redirects onto the canonical Home `/app`, not a second dashboard.
  assert.equal(safeNextPath("/app/dashboard?tab=words"), "/app/dashboard?tab=words");
});

test("absolute and protocol-relative targets are refused", () => {
  assert.equal(safeNextPath("https://evil.example"), null);
  assert.equal(safeNextPath("http://evil.example/login"), null);
  assert.equal(safeNextPath("//evil.example"), null);
  assert.equal(safeNextPath("///evil.example"), null);
  assert.equal(safeNextPath("/\\evil.example"), null);
  assert.equal(safeNextPath("\\\\evil.example"), null);
  assert.equal(safeNextPath("javascript:alert(1)"), null);
  assert.equal(safeNextPath("evil.example"), null);
});

test("encoded and malformed values do not slip through", () => {
  assert.equal(safeNextPath("/%2F%2Fevil.example"), null);
  assert.equal(safeNextPath("/%5Cevil.example"), null);
  assert.equal(safeNextPath("%2F%2Fevil.example"), null); // no leading slash after decoding
  assert.equal(safeNextPath("/dashboard%00"), null); // control character
  assert.equal(safeNextPath("%E0%A4%A"), null); // malformed escape
});

test("empty, missing and absurd values fall back to the default", () => {
  assert.equal(safeNextPath(null), null);
  assert.equal(safeNextPath(undefined), null);
  assert.equal(safeNextPath(""), null);
  assert.equal(safeNextPath("   "), null);
  assert.equal(safeNextPath(`/${"a".repeat(600)}`), null);
});
