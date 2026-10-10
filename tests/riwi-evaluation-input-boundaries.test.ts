import assert from "node:assert/strict";
import test from "node:test";
import { validateAssessmentInput, validateAssessmentOutput } from "../src/lib/services/coach/contracts/compose";
import { getAssessmentContract } from "../src/lib/services/coach/contracts/registry";
import { resolveEvaluation, type EvaluationRequest } from "../src/lib/services/coach/resolver";
import { providerRegistry } from "../src/lib/services/coach/registry";
import { createLlmEvaluationProvider } from "../src/lib/services/coach/providers/shared/llm-provider";
import { providerEvaluationOutputSchema } from "../src/lib/services/coach/schema";
import { guardExternalPayload } from "../src/lib/services/riwi/outbound-guard";

const ctx = { userId: "11111111-2222-3333-4444-555555555555", language: "en" as const };
const text = "I went home yesterday.";
const verdictOutput = providerEvaluationOutputSchema.parse({ overallEstimate: null, confidence: 0.8, verdict: "correct", criteria: [], strengths: [], weaknesses: [], issues: [], nextActions: [], recommendedExercises: [] });
const inputs = [
  ["writing", "writing.task2.generic", { taskType: "task2", prompt: "Explain", content: text, targetWordCount: 250 }, "content", 20_000],
  ["speaking", "speaking.part1", { part: "part1", transcript: text, transcriptOrigin: "manual", durationMs: 1000, pronunciationAvailable: false }, "transcript", 20_000],
  ["grammar", "grammar.activate-it", { promptText: "Write", studentAnswer: text, targetStructure: null, sampleAnswer: null }, "studentAnswer", 10_000],
  ["vocabulary", "vocabulary.use-in-sentence", { targetWord: "home", definition: "where someone lives", studentSentence: text }, "studentSentence", 5000],
  ["assignment", "assignment.free-form", { title: "Write", description: null, studentResponse: text }, "studentResponse", 20_000],
] as const;

test("all evaluation domains refuse absent/blank/oversized work before provider dispatch and after output validation", async () => {
  let calls = 0;
  const originals = providerRegistry.ids().map(id => providerRegistry.get(id)!.provider);
  const provider = createLlmEvaluationProvider({ id: "input-boundary-spy", displayName: "Boundary spy", version: "test", model: () => "fixed", requiredSecrets: () => [], transport: async () => { calls++; return { ok: true, text: JSON.stringify(verdictOutput) }; } });
  providerRegistry.register(provider);
  try {
    for (const [task, key, input, field, maximum] of inputs) {
      assert.equal(validateAssessmentInput(task, input), true);
      for (const value of [null, undefined, 4, {}, "", " \n\t", "x".repeat(maximum + 1)]) {
        const invalid = { ...input, [field]: value };
        assert.equal(validateAssessmentInput(task, invalid), false, `${task}: ${typeof value}`);
        assert.equal(validateAssessmentOutput(getAssessmentContract(key)!, task, invalid, verdictOutput), null);
        const result = await resolveEvaluation({ evaluationType: task, input: invalid } as unknown as EvaluationRequest, ctx, { aiPrimaryProvider: provider.id, externalEnabled: true });
        assert.deepEqual(result, { ok: false, error: "invalid_evaluation", attempts: [] });
      }
    }
    assert.equal(calls, 0);
  } finally { providerRegistry.clear(); originals.forEach(p => providerRegistry.register(p)); }
});

test("all three sentence-check families reach the shared external resolver with zero essay word-count target", async () => {
  let calls = 0;
  const originals = providerRegistry.ids().map(id => providerRegistry.get(id)!.provider);
  let keys: string[] = [];
  const provider = createLlmEvaluationProvider({ id: "sentence-check-spy", displayName: "Sentence spy", version: "test", model: () => "fixed", requiredSecrets: () => [], transport: async () => {
    calls++;
    return { ok: true, text: JSON.stringify({ ...verdictOutput, criteria: keys.map(key => ({ key, label: key, band: 7, limited: false, note: null })) }) };
  } });
  providerRegistry.register(provider);
  try {
    const fixtures = [
      [{ kind: "translation", uzbekSource: "Men kecha uyga bordim.", referenceEnglish: text, acceptedAlternatives: ["Yesterday I went home."], targetBand: 6, answer: text }, ["meaning", "grammar", "vocabulary"]],
      [{ kind: "activation", item: "home", meaningHint: "where someone lives", mode: "writing", targetLevel: "B2", uzbekPrompt: null, upgradeFrom: null, answer: text }, ["meaning", "form", "collocation", "naturalness", "grammar"]],
      [{ kind: "pattern", pattern: "I went", sourceExample: "I went to school.", sourceTopic: "school", newTopic: "home", answer: text }, ["grammar", "meaning", "pattern", "adaptation"]],
    ] as const;
    for (const [check, expectedKeys] of fixtures) {
      keys = [...expectedKeys];
      const input = { taskType: "task2", prompt: "", content: text, targetWordCount: 0, check };
      assert.equal(guardExternalPayload("writing", input).ok, true);
      const result = await resolveEvaluation({ evaluationType: "writing", input } as unknown as EvaluationRequest, ctx, { aiPrimaryProvider: provider.id, externalEnabled: true, maxAttempts: 1 }, { fallback: "none" });
      assert.equal(result.ok, true, check.kind);
      if (result.ok) {
        assert.equal(result.result.providerId, provider.id);
        assert.equal(result.result.fallbackUsed, false);
        assert.equal(result.result.overallEstimate, null);
        assert.deepEqual(result.result.criteria.map(c => c.key), expectedKeys);
      }
      assert.equal(guardExternalPayload("writing", { ...input, content: "different work" }).ok, false);
      assert.equal(validateAssessmentInput("writing", { ...input, content: "different work" }), false);
    }
    assert.equal(calls, 3);
    assert.equal(guardExternalPayload("writing", { taskType: "task2", prompt: "Explain", content: text, targetWordCount: 0 }).ok, false);
  } finally { providerRegistry.clear(); originals.forEach(p => providerRegistry.register(p)); }
});
