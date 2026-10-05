import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerAssessmentPolicyPanel } from "../../src/components/riwi/OwnerAssessmentPolicyPanel";

test("APUI1 owner policy panel presents the two-step approval boundary without exposing a free-form executable policy", () => {
  const html = renderToStaticMarkup(React.createElement(OwnerAssessmentPolicyPanel, { locale: "en" }));
  assert.match(html, /Assessment policy chat/);
  assert.match(html, /not stored/);
  assert.match(html, /Preview and run regression/);
  assert.match(html, /Approve and activate/);
  assert.match(html, /Create candidate/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /<script|systemPrompt|raw SQL|https?:\/\//i);
});

test("APUI2 Uzbek policy panel also explains that candidates need preview and separate approval", () => {
  const html = renderToStaticMarkup(React.createElement(OwnerAssessmentPolicyPanel, { locale: "uz" }));
  assert.match(html, /Baholash siyosati suhbati/);
  assert.match(html, /Regressiyani ko&#x27;rib chiqish/);
  assert.match(html, /tasdig/i);
});
