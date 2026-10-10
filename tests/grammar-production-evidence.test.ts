import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { grammarPracticeEvidence, grammarPracticeSchema } from "../src/lib/services/grammar/production";
import { checkStructures } from "../src/lib/services/grammar/mastery";
import { getAssessmentContract, grammarContractKey } from "../src/lib/services/coach/contracts/registry";
import { validateAssessmentOutput } from "../src/lib/services/coach/contracts/compose";
import { resolveEvaluation } from "../src/lib/services/coach/resolver";
import { createLlmEvaluationProvider } from "../src/lib/services/coach/providers/shared/llm-provider";
import { providerRegistry } from "../src/lib/services/coach/registry";
import type { ProviderEvaluationOutput } from "../src/lib/services/coach/schema";

const exercise = { translatePromptUz: "Tirbandlik katta muammo bo'lib bormoqda.", activationPrompt: "Describe a problem using the present continuous.", targetStructures: ["traffic", "problem"] };
const criteria = ["meaning", "grammar", "target_structure"].map(key => ({ key, label: key, band: null, limited: false, note: "Fixture assessment" }));
const output: ProviderEvaluationOutput = { overallEstimate: null, confidence: 0.8, verdict: "correct", criteria, strengths: [], weaknesses: [], issues: [], nextActions: [], recommendedExercises: [] };
const contract = getAssessmentContract("grammar.translate-assessed")!;

test("Grammar practice uses only the authored activity prompt; correction options and literal phrase matches cannot grant translation credit", () => {
  const selected = grammarPracticeEvidence(exercise, "translate_it", "Present continuous")!;
  assert.equal(selected.promptText, exercise.translatePromptUz);
  assert.equal(selected.sampleAnswer, null);
  assert.match(selected.targetStructure!, /Present continuous.*traffic, problem/);
  assert.equal(grammarPracticeEvidence({ ...exercise, translatePromptUz: "  " }, "translate_it", "Present continuous"), null);
  assert.equal(grammarPracticeEvidence({ ...exercise, activationPrompt: null }, "activate_it", null), null);
  assert.equal(grammarPracticeSchema.safeParse({ activity: "translate_it", answer: "   " }).success, false);
  assert.equal(grammarPracticeSchema.safeParse({ activity: "translate_it", answer: "Valid answer", sampleAnswer: "Forged reference" }).success, false);
  const wrongMeaning = "Traffic is never a problem.";
  assert.equal(checkStructures(wrongMeaning, exercise.targetStructures).complete, true);
  const input = { ...selected, studentAnswer: wrongMeaning };
  assert.equal(validateAssessmentOutput(contract, "grammar", input, { ...output, criteria: [] }), null);
  for (const invalid of [[...criteria, criteria[0]!], criteria.slice(1), criteria.map(item => item.key === "meaning" ? { ...item, limited: true } : item), criteria.map(item => ({ ...item, band: 9 }))]) {
    assert.equal(validateAssessmentOutput(contract, "grammar", input, { ...output, criteria: invalid }), null);
  }
  assert.equal(grammarContractKey("translate_it"), contract.key);
  assert.notEqual(contract.key, "grammar.translate-it");
  assert.match(getAssessmentContract("grammar.translate-it")!.version, /-v1$/);
  const route = readFileSync(new URL("../src/app/api/grammar/exercises/[id]/practice/route.ts", import.meta.url), "utf8");
  assert.ok(!route.includes("structureVerdict") && !route.includes("needsEvaluator"));
  assert.match(route, /grammarPracticeEvidence\(/);
  assert.match(route, /evaluateGrammarProduction\(/);
  assert.match(route, /isCorrect: false/);
  assert.match(route, /sampleAnswer: null/);
  const service = readFileSync(new URL("../src/lib/services/coach/grammar.ts", import.meta.url), "utf8");
  assert.match(service, /input.activity === "translate_it" \? \{ fallback: "none" \}/);
});

test("Translation uses the shared resolver, accepts assessed alternative wording and refuses incomplete coverage or local fallback", async () => {
  const originals = providerRegistry.ids().map(id => providerRegistry.get(id)!.provider);
  let answer = output;
  let calls = 0;
  const provider = createLlmEvaluationProvider({ id: "grammar-translation-fixture", displayName: "Fixture", version: "test", model: () => "fixed", requiredSecrets: () => [], transport: async payload => {
    calls++;
    assert.match(JSON.stringify(payload), /grammar\.translate-assessed/);
    return { ok: true, text: JSON.stringify(answer) };
  } });
  providerRegistry.register(provider);
  const ctx = { userId: "11111111-2222-3333-4444-555555555555", language: "en" as const };
  const input = { ...grammarPracticeEvidence(exercise, "translate_it", "Present continuous")!, studentAnswer: "Congestion is becoming a serious issue." };
  try {
    const request = { evaluationType: "grammar" as const, assessmentContractKey: contract.key, input };
    const config = { aiPrimaryProvider: provider.id, externalEnabled: true, maxAttempts: 1 };
    const result = await resolveEvaluation(request, ctx, config, { fallback: "none" });
    assert.equal(result.ok, true);
    if (result.ok) { assert.equal(result.result.verdict, "correct"); assert.equal(result.result.overallEstimate, null); assert.equal(result.result.assessmentContractKey, contract.key); }
    answer = { ...output, criteria: criteria.filter(item => item.key !== "meaning") };
    assert.equal((await resolveEvaluation(request, ctx, config, { fallback: "none" })).ok, false);
    assert.equal(calls, 2);
    assert.equal((await resolveEvaluation(request, ctx, { aiPrimaryProvider: "riwi" }, { fallback: "none" })).ok, false);
  } finally { providerRegistry.clear(); originals.forEach(provider => providerRegistry.register(provider)); }
});
