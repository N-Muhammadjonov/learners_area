import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { externalCapabilityReady } from "../src/lib/services/coach/capability-readiness";

const fn = async () => ({}) as never;
const env = { OPENAI_API_KEY: "x" } as unknown as NodeJS.ProcessEnv;
const base = { externalEnabled: true, providerIsRiwi: false, method: "evaluateWriting" as const };
const writingOnly = { type: "external" as const, requiredSecrets: ["OPENAI_API_KEY"], evaluateWriting: fn };
const speakingOnly = { type: "external" as const, requiredSecrets: ["OPENAI_API_KEY"], evaluateSpeaking: fn };

test("AR1 Writing checks evaluateWriting, not evaluateSpeaking", () => {
  assert.equal(externalCapabilityReady({ ...base, provider: writingOnly }, env), true);
  const src = readFileSync("src/components/writing/workspace/WritingGradeTab.tsx", "utf8");
  assert.ok(!src.includes("speakingAiReadiness") && !src.includes("speaking/ai-readiness"));
  assert.ok(readFileSync("src/lib/writing/ai-readiness.ts", "utf8").includes('method: "evaluateWriting"'));
});
test("AR2 speaking-only provider is not Writing-ready", () => {
  assert.equal(externalCapabilityReady({ ...base, provider: speakingOnly }, env), false);
});
test("AR3 writing provider with secrets is ready; missing secret is not", () => {
  assert.equal(externalCapabilityReady({ ...base, provider: writingOnly }, env), true);
  assert.equal(externalCapabilityReady({ ...base, provider: writingOnly }, {} as NodeJS.ProcessEnv), false);
  assert.equal(externalCapabilityReady({ ...base, provider: writingOnly }, { OPENAI_API_KEY: "  " } as unknown as NodeJS.ProcessEnv), false);
});
test("AR4 RIWI / internal / disabled are never external Writing AI", () => {
  assert.equal(externalCapabilityReady({ ...base, providerIsRiwi: true, provider: writingOnly }, env), false);
  assert.equal(externalCapabilityReady({ ...base, provider: { ...writingOnly, type: "internal" } }, env), false);
  assert.equal(externalCapabilityReady({ ...base, externalEnabled: false, provider: writingOnly }, env), false);
  assert.equal(externalCapabilityReady({ ...base, provider: null }, env), false);
});
test("Speaking readiness still requires evaluateSpeaking + STT", () => {
  const src = readFileSync("src/lib/speaking/ai-readiness.ts", "utf8");
  assert.ok(src.includes("evaluateSpeaking") && src.includes("isSttConfigured"));
});
