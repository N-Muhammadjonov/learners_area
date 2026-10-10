import { createHash } from "node:crypto";
import { providerEvaluationOutputSchema } from "../schema";
import { applyOwnerOverlayToOutput, validateAssessmentOutput } from "./compose";
import type { AssessmentContractDefinition, AssessmentOwnerOverlay } from "./types";

/** Bounded deterministic runtime fixtures. They exercise the actual output
 * validator and presentation transform; they do not call a model or use users'
 * historical work. Unknown domains fail closed. */
export function ownerOverlayBehaviorFixtures(contracts: AssessmentContractDefinition[], overlay: AssessmentOwnerOverlay) {
  const observations = contracts.map(contract => {
    const text = "I enjoy reading books.";
    let input: Record<string, unknown>;
    let keys: string[];
    let scored = false;
    if (contract.domain === "writing") {
      const taskType = contract.key.includes("task1") ? "task1" : "task2";
      input = { taskType, content: text, prompt: "Fixture", targetWordCount: 250 };
      keys = [taskType === "task1" ? "task_achievement" : "task_response", "coherence", "lexical", "grammar"];
      scored = true;
      if (contract.key.startsWith("writing.check.")) {
        const kind = contract.key.includes("translation") ? "translation" : contract.key.includes("activation") ? "activation" : "pattern";
        input.check = { kind, mode: contract.key.endsWith("speaking") ? "speaking" : "writing", answer: text };
        keys = kind === "translation" ? ["meaning", "grammar", "vocabulary"] : kind === "activation" ? ["meaning", "form", "collocation", "naturalness", "grammar"] : ["grammar", "meaning", "pattern", "adaptation"];
        scored = false;
      }
      if (contract.key.startsWith("writing.grade.")) input.detailedAnalysis = true;
    } else if (contract.domain === "speaking") {
      input = { part: contract.key.split(".")[1], transcript: text, transcriptOrigin: "manual", pronunciationAvailable: false, durationMs: 1000 };
      keys = ["fluency", "lexical", "grammar"]; scored = true;
    } else if (["grammar", "vocabulary", "assignment"].includes(contract.domain)) {
      input = { studentAnswer: text, studentSentence: text, studentResponse: text }; keys = [];
    } else return { key: contract.key, passed: false };
    const evidence = { excerpt: "I enjoy reading", point: "Fixture quote", correction: null };
    const value = providerEvaluationOutputSchema.parse({ overallEstimate: scored ? 9 : null, confidence: 0.8, verdict: scored ? null : "correct",
      criteria: keys.map(key => ({ key, label: key, band: 6, limited: false, note: null })),
      strengths: ["A", "B"], weaknesses: ["A", "B"], issues: [], nextActions: ["A", "B"], recommendedExercises: [],
      teachingFeedback: { simpleExplanation: "Fixture", evidence: [evidence], steps: [], examples: [], illustration: null },
      ...(input.detailedAnalysis ? { writingAnalysis: { examinerComment: { en: "Fixture", uz: "Sinov" }, criterionNarratives: [keys[0], "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy"].map(key => ({ key, narrative: { en: "Fixture", uz: "Sinov" }, evidence: [text] })), sentenceFeedback: [], topFixes: [] } } : {}),
    });
    const normalized = validateAssessmentOutput(contract, contract.domain, input, value, overlay);
    if (!normalized) return { key: contract.key, passed: false };
    const displayed = applyOwnerOverlayToOutput(normalized, overlay);
    const scoreIdentity = (v: typeof normalized) => JSON.stringify({ criteria: v.criteria, overall: v.overallEstimate, verdict: v.verdict });
    const fabricated = { ...value, teachingFeedback: { ...value.teachingFeedback!, evidence: [{ ...evidence, excerpt: "Fabricated words absent from source" }] } };
    const invalidScore = { ...value, criteria: scored ? [] : [{ key: "essay_band", label: "IELTS", band: 9, note: null, limited: false }], overallEstimate: 9 };
    const passed = scoreIdentity(normalized) === scoreIdentity(displayed)
      && validateAssessmentOutput(contract, contract.domain, input, fabricated, overlay) === null
      && validateAssessmentOutput(contract, contract.domain, input, invalidScore, overlay) === null
      && (contract.domain !== "speaking" || displayed.criteria.some(c => c.key === "pronunciation" && c.band === null && c.limited === true));
    return { key: contract.key, passed, inputHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"), outputHash: createHash("sha256").update(JSON.stringify(displayed)).digest("hex") };
  });
  return { passed: observations.length > 0 && observations.every(o => o.passed), digest: createHash("sha256").update(JSON.stringify(observations)).digest("hex") };
}
