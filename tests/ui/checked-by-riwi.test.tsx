// Owner rule (2026-10-03): learners always see "Checked by RIWI"; staff keep the truthful provenance.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EvaluationView } from "../../src/components/coach/EvaluationView";
import en from "../../src/lib/i18n/en";
import type { EvaluationRecord } from "../../src/lib/data/evaluations";

const external: EvaluationRecord = {
  id: "e1", userId: "u1", evaluationType: "writing" as EvaluationRecord["evaluationType"], sourceType: "writing_submission", sourceId: "s1",
  providerId: "vendorx-chat", providerDisplayName: "VendorX AI", providerType: "external", providerVersion: "2025-01",
  model: "vx-large-7", promptVersion: "p9", rubricVersion: "r4", fallbackUsed: true, fallbackFrom: "othervendor-primary",
  checkedByName: "RIWI", checkedBy: { id: "vendorx-chat", displayName: "VendorX AI", type: "external" },
  overallEstimate: 6.5, confidence: 0.8, verdict: null, criteria: [], strengths: [], weaknesses: [], issues: [], nextActions: [],
  recommendedExercises: [], processedInMs: 900, createdAt: new Date("2026-10-03T08:00:00Z"),
};
const SECRET_PROVENANCE = ["vendorx-chat", "VendorX AI", "vx-large-7", "othervendor-primary", "2025-01", "rubric r4"];

test("CR1 learner render: only 'Checked by RIWI'; no provider id, vendor, model, version or fallback source in the HTML", () => {
  const html = renderToStaticMarkup(React.createElement(EvaluationView, { dict: en, evaluation: external }));
  assert.ok(html.includes("Checked by RIWI"));
  for (const leak of SECRET_PROVENANCE) assert.ok(!html.includes(leak), `learner HTML leaks ${leak}`);
  assert.ok(!html.includes("data-staff-provenance"));
});

test("CR2 even a legacy row whose stored label is a vendor name renders RIWI to learners", () => {
  const html = renderToStaticMarkup(React.createElement(EvaluationView, { dict: en, evaluation: { ...external, checkedByName: "VendorX AI" } }));
  assert.ok(html.includes("Checked by RIWI") && !html.includes("VendorX AI"));
});

test("CR3 staff render keeps truthful provenance: actual provider, type, model, versions and fallback", () => {
  const html = renderToStaticMarkup(React.createElement(EvaluationView, { dict: en, evaluation: external, audience: "staff" }));
  assert.ok(html.includes("data-staff-provenance"));
  for (const truth of ["VendorX AI (vendorx-chat, external)", "model vx-large-7", "v2025-01", "prompt p9", "rubric r4", "fallback from othervendor-primary"]) {
    assert.ok(html.includes(truth), `staff provenance missing ${truth}`);
  }
  assert.ok(html.includes("Checked by RIWI"), "the public label is the same for every audience");
});
