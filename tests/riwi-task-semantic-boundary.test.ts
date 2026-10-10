import test from "node:test";
import assert from "node:assert/strict";
import { RiwiProvider } from "../src/lib/services/coach/providers/riwi";
import { getAssessmentContract } from "../src/lib/services/coach/contracts/registry";
import { resolveEvaluation } from "../src/lib/services/coach/resolver";
import type { EvaluationContext } from "../src/lib/services/coach/types";

const base = { userId: "11111111-2222-4333-8444-555555555555", language: "en" as const };
const grammar = { promptText: "Preserve the meaning: I have never been there.", studentAnswer: "I have always been there.", targetStructure: "present perfect", sampleAnswer: "I have always been there." };
const vocabulary = { targetWord: "home", definition: "the place where a person lives", studentSentence: "I went to school yesterday." };

function context(key: string): EvaluationContext {
  const contract = getAssessmentContract(key)!;
  return { ...base, assessmentContract: { key: contract.key, version: contract.version, rubricVersion: contract.rubricVersion, policyScope: null, policyVersion: null, overlay: null } };
}

test("an exact reference cannot let the generic local Grammar heuristic certify transformation or translation meaning", async () => {
  const provider = new RiwiProvider();
  for (const key of ["grammar.transformation", "grammar.free-production", "grammar.translate-it", "grammar.translate-assessed"]) {
    const result = await provider.evaluateGrammar(context(key), grammar);
    assert.equal(result.ok, false, key);
    if (!result.ok) assert.equal(result.failure.reason, "capability_missing");
  }
  assert.equal((await provider.evaluateGrammar(context("grammar.correct-it"), { ...grammar, promptText: "Use the authored reference." })).ok, true, "the existing authored correction reference still works");
});

test("missing a target string cannot decide synonym choice, paraphrase, word form or collocation semantics", async () => {
  const provider = new RiwiProvider();
  for (const key of ["vocabulary.synonym-choice", "vocabulary.paraphrase", "vocabulary.word-form", "vocabulary.collocation"]) {
    const result = await provider.evaluateVocabulary(context(key), vocabulary);
    assert.equal(result.ok, false, key);
    if (!result.ok) assert.equal(result.failure.reason, "capability_missing");
  }
  const result = await provider.evaluateVocabulary(context("vocabulary.use-in-sentence"), vocabulary);
  assert.equal(result.ok, true, "missing the required target remains a supported active-use negative check");
});

test("the shared resolver returns unavailable rather than persisting a different task's local verdict", async () => {
  for (const key of ["grammar.transformation", "grammar.free-production"] as const) {
    const result = await resolveEvaluation({ evaluationType: "grammar", assessmentContractKey: key, input: grammar }, base, { aiPrimaryProvider: "riwi" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "evaluation_unavailable");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]!.outcome, "failed");
  }
  for (const key of ["vocabulary.synonym-choice", "vocabulary.paraphrase", "vocabulary.word-form", "vocabulary.collocation"] as const) {
    const result = await resolveEvaluation({ evaluationType: "vocabulary", assessmentContractKey: key, input: vocabulary }, base, { aiPrimaryProvider: "riwi" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "evaluation_unavailable");
  }
});
