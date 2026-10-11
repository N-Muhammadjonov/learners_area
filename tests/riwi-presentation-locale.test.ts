import assert from "node:assert/strict";
import test from "node:test";
import { riwiLocaleFromRequest, riwiPresentationLocale } from "../src/lib/services/riwi/locale";

test("RIWI honours both explicit supported UI preferences and keeps the profile fallback", () => {
  assert.equal(riwiPresentationLocale("uz", "en"), "uz");
  assert.equal(riwiPresentationLocale("en", "uz"), "en");
  assert.equal(riwiPresentationLocale(undefined, "en"), "en");
  assert.equal(riwiPresentationLocale(undefined, "uz"), "uz");
  assert.equal(riwiPresentationLocale("invalid", "en"), "en");
  assert.equal(riwiPresentationLocale(undefined, "invalid"), "uz");
});

test("RIWI request language uses the exact preference cookie, never an arbitrary cookie or body", () => {
  const request = (cookie: string) => new Request("https://example.test/api/riwi/chat", { headers: { cookie } });
  assert.equal(riwiLocaleFromRequest(request("session=private; la_locale=uz; other=en"), "en"), "uz");
  assert.equal(riwiLocaleFromRequest(request("other_la_locale=uz"), "en"), "en");
  assert.equal(riwiLocaleFromRequest(request("la_locale=owner"), "uz"), "uz");
  assert.equal(riwiLocaleFromRequest(request("la_locale=; language=uz"), "en"), "en");
});
