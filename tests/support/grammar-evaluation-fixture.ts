import assert from "node:assert/strict";
import type { EvaluationRecord } from "../../src/lib/data/evaluations";
import type { GrammarEvaluationRequest } from "../../src/lib/services/coach/grammar";
import { grammarContractKey, getAssessmentContractOrThrow } from "../../src/lib/services/coach/contracts/registry";
import { evaluationResultSchema } from "../../src/lib/services/coach/schema";

/** Transport substitute only: use the actual domain persistence callback so
 * gateway tests cannot pass by returning a foreign or never-saved verdict. */
export async function persistGrammarFixture(input: GrammarEvaluationRequest, record: EvaluationRecord) {
  assert.ok(input.persist, "Grammar handoffs require the canonical atomic write");
  const contract = getAssessmentContractOrThrow(grammarContractKey(input.activity ?? "activate_it"));
  const saved = await input.persist(evaluationResultSchema.parse({
    evaluationId: record.id, evaluationType: "grammar", createdAt: record.createdAt.toISOString(),
    providerId: record.providerId, providerDisplayName: record.providerDisplayName,
    providerType: record.providerType, providerVersion: record.providerVersion, model: record.model,
    promptVersion: contract.version, rubricVersion: contract.rubricVersion, assessmentContractKey: contract.key,
    fallbackUsed: record.fallbackUsed, fallbackFrom: record.fallbackFrom, checkedBy: record.checkedBy,
    overallEstimate: null, confidence: record.confidence, verdict: record.verdict, criteria: record.criteria,
    strengths: record.strengths, weaknesses: record.weaknesses, issues: record.issues, nextActions: record.nextActions,
    recommendedExercises: record.recommendedExercises, processedInMs: record.processedInMs,
  }));
  Object.assign(record, saved.record);
  return { ok: true as const, evaluation: saved.record, reused: !saved.created };
}
