// Staff/learner forms must never show raw server codes (master §O, §47, §59).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";
import { apiErrorMessage } from "../src/lib/api-error-message";

const RAW = /^[a-z0-9]+(_[a-z0-9]+)+$/;

test("AE1 known codes map to localized sentences in both locales", () => {
  for (const d of [en, uz]) {
    assert.equal(apiErrorMessage("forbidden", 403, d), d.apiErrors.forbidden);
    assert.equal(apiErrorMessage("unauthenticated", 401, d), d.apiErrors.unauthenticated);
    assert.equal(apiErrorMessage("upload_not_owned_or_finalized", 400, d), d.apiErrors.uploadNotReady);
    assert.equal(apiErrorMessage("not_found", 404, d), d.apiErrors.notFound);
  }
});

test("AE2 unknown codes, validator sentences and network failure never echo the raw value", () => {
  for (const [raw, status] of [["some_new_internal_code", 500], ["String must contain at least 1 character(s)", 400], [undefined, undefined], [{ x: 1 }, 502]] as const) {
    const msg = apiErrorMessage(raw, status, en);
    assert.notEqual(msg, raw);
    assert.ok(!RAW.test(msg), msg);
    assert.ok(Object.values(en.apiErrors).includes(msg));
  }
  assert.equal(apiErrorMessage("String must contain at least 1 character(s)", 400, en), en.apiErrors.invalid);
});

test("AE3 Uzbek copy is Latin-only; history empty state no longer promises 'coming soon'", () => {
  assert.ok(!/[\u0400-\u04FF]/.test(JSON.stringify(uz.apiErrors)));
  assert.ok(!/soon/i.test(en.dashboard.noAttemptsYet));
  assert.ok(!/tez orada/i.test(uz.dashboard.noAttemptsYet));
});

test("AE4 the four affected forms route errors through the mapper (no data.error rendered)", () => {
  for (const f of ["src/components/admin/NewListeningQuestionForm.tsx", "src/components/admin/NewTestForm.tsx", "src/components/admin/AdmissionQueue.tsx", "src/components/coach/ManualTranscriptForm.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /apiErrorMessage\(/, f);
    assert.doesNotMatch(src, /setError\([^)]*(data|result)\.error \?\?/, f);
  }
});


test("AE5 infrastructure failures distinguish database and storage in both locales", () => {
  for (const dict of [en, uz]) {
    for (const code of ["database_unavailable", "storage_not_configured", "storage_unavailable"] as const) {
      assert.equal(apiErrorMessage({ error: code, stage: "speaking_attempt_start" }, 503, dict), dict.uploadErrors[code]);
      assert.notEqual(apiErrorMessage(code, 503, dict), dict.apiErrors.generic);
    }
  }
});
