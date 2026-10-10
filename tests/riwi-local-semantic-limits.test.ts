import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGrammarWithRiwi } from "../src/lib/services/coach/providers/riwi/grammar";
import { evaluateVocabularyWithRiwi } from "../src/lib/services/coach/providers/riwi/vocabulary";
import { validateAssessmentOutput } from "../src/lib/services/coach/contracts/compose";
import { getAssessmentContract } from "../src/lib/services/coach/contracts/registry";
import { resolveEvaluation } from "../src/lib/services/coach/resolver";

test("local Grammar cannot infer target structure from prompt tokens or certify an unsupported topic", () => {
  for (const targetStructure of ["Present Perfect", "Second Conditional", "Unsupported future topic"]) {
    const input = { promptText: "Use the target structure in a sentence.", studentAnswer: "I walk to school every day.", targetStructure, sampleAnswer: "I have lived here for years." };
    const result = evaluateGrammarWithRiwi(input);
    assert.notEqual(result.verdict, "correct");
    assert.equal(result.criteria.find(c => c.key === "target_structure")?.limited, true);
    assert.match(result.criteria.find(c => c.key === "target_structure")?.note ?? "", /not assessed/);
    assert.doesNotMatch(JSON.stringify(result), /structure (?:appears|present|was not found)/i);
    assert.ok(validateAssessmentOutput(getAssessmentContract("grammar.activate-it")!, "grammar", input, result));
  }
});

test("an authored short reference is accepted, while a different valid construction is limited without a fabricated structure error", () => {
  const base = { promptText: "Correct this phrase.", targetStructure: "Present Simple", sampleAnswer: "does not go" };
  const reference = evaluateGrammarWithRiwi({ ...base, studentAnswer: "does not go" });
  assert.equal(reference.verdict, "correct");
  assert.equal(reference.criteria.find(c => c.key === "target_structure")?.limited, false);
  const alternative = evaluateGrammarWithRiwi({ ...base, studentAnswer: "She stays at home on Fridays." });
  assert.equal(alternative.verdict, "mostly_correct");
  assert.equal(alternative.criteria.find(c => c.key === "target_structure")?.limited, true);
  assert.ok(!alternative.weaknesses.some(w => /expected structure|sample answer|almost no vocabulary/.test(w)));
});

test("local Vocabulary does not invent copying or active-use mastery from a short sentence or an inflection", () => {
  for (const studentSentence of ["I discuss the problem today.", "She discusses the problem every day."]) {
    const input = { targetWord: "discuss", definition: "talk about a subject", studentSentence };
    const result = evaluateVocabularyWithRiwi(input);
    assert.equal(result.verdict, "mostly_correct");
    assert.equal(result.criteria.find(c => c.key === "active_use")?.limited, true);
    assert.doesNotMatch(JSON.stringify(result), /copied phrase|copied verbatim|real active use|student's own sentence/);
    assert.ok(validateAssessmentOutput(getAssessmentContract("vocabulary.use-in-sentence")!, "vocabulary", input, result));
  }
});

test("collocation checks respect word boundaries and preserve the original source quote", () => {
  const base = { targetWord: "arrive", definition: "reach a place" };
  const valid = evaluateVocabularyWithRiwi({ ...base, studentSentence: "We arrive tomorrow after the match." });
  assert.ok(!valid.issues.some(i => i.category === "VOCAB_COLLOCATION"));
  const studentSentence = "We ARRIVE   TO the station early.";
  const invalid = evaluateVocabularyWithRiwi({ ...base, studentSentence });
  const issue = invalid.issues.find(i => i.category === "VOCAB_COLLOCATION");
  assert.equal(issue?.excerpt, "ARRIVE   TO");
  assert.ok(studentSentence.includes(issue?.excerpt ?? ""));
  assert.ok(validateAssessmentOutput(getAssessmentContract("vocabulary.use-in-sentence")!, "vocabulary", { ...base, studentSentence }, invalid));
});

test("real local resolver declines unsupported semantics without granting credit or inventing a fallback result", async () => {
  for (const aiPrimaryProvider of ["riwi", "not-installed-semantic-provider"]) {
    const result = await resolveEvaluation({ evaluationType: "vocabulary", input: { targetWord: "bank", definition: "a financial institution", studentSentence: "I bank the chair every day." } }, { userId: "11111111-2222-3333-4444-555555555555", language: "en" }, { aiPrimaryProvider });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "evaluation_unavailable");
      assert.equal(result.attempts.at(-1)?.providerId, "riwi");
      assert.equal(result.attempts.at(-1)?.failure?.reason, "capability_missing");
      assert.equal(result.attempts.at(-1)?.failure?.detail, "riwi_vocabulary_semantics_unassessed");
    }
  }
});
