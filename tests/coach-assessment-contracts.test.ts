import assert from "node:assert/strict";
import test from "node:test";
import { applyOwnerOverlayToOutput, composeAssessmentPrompt, filterOwnerOverlay, promptInvariantSnapshot, validateAssessmentOutput } from "../src/lib/services/coach/contracts/compose";
import { HARD_CORE_RULES, GLOBAL_TEACHING_RULES, STRICT_OUTPUT_RULES } from "../src/lib/services/coach/contracts/core";
import { SPEAKING_DOMAIN_RULES } from "../src/lib/services/coach/contracts/speaking";
import { assessmentContracts, assessmentContractsForScope, getAssessmentContract, speakingContractKey, writingContractKey } from "../src/lib/services/coach/contracts/registry";
import { assessmentOwnerOverlaySchema } from "../src/lib/services/coach/contracts/schema";
import { providerEvaluationOutputSchema } from "../src/lib/services/coach/schema";
import { ASSESSMENT_CONTRACT_KEYS, OWNER_OVERLAY_FIELDS_BY_DOMAIN } from "../src/lib/services/coach/contracts/types";

test("AC1 the complete registry inventory is unique, versioned per task, and has no oversized provenance labels", () => {
  assert.equal(ASSESSMENT_CONTRACT_KEYS.length, assessmentContracts.length);
  assert.equal(new Set(ASSESSMENT_CONTRACT_KEYS).size, ASSESSMENT_CONTRACT_KEYS.length);
  assert.equal(assessmentContracts.length, ASSESSMENT_CONTRACT_KEYS.length);
  assert.deepEqual(new Set(assessmentContracts.map((contract) => contract.key)), new Set(ASSESSMENT_CONTRACT_KEYS));
  assert.equal(new Set(assessmentContracts.map((contract) => contract.version)).size, ASSESSMENT_CONTRACT_KEYS.length);
  assert.equal(new Set(assessmentContracts.map((contract) => contract.rubricVersion)).size, ASSESSMENT_CONTRACT_KEYS.length);
  for (const key of ASSESSMENT_CONTRACT_KEYS) {
    const contract = getAssessmentContract(key);
    assert.ok(contract, `missing ${key}`);
    assert.ok(contract.version.startsWith(key.replaceAll(".", "-").slice(0, Math.min(30, key.length + 4))) || contract.version.endsWith("-v1"));
    assert.ok(contract.version.length <= 40);
    assert.ok(contract.rubricVersion.length <= 40);
    assert.ok(contract.taskRules.length > 20);
  }
});

test("AC2 server-owned metadata resolves writing categories and speaking parts without caller text", () => {
  assert.equal(writingContractKey("task1", "line_chart"), "writing.task1.line-chart");
  assert.equal(writingContractKey("task2", "two-part"), "writing.task2.two-part");
  assert.equal(writingContractKey("task2", "unknown owner category"), "writing.task2.generic");
  assert.equal(speakingContractKey("part3"), "speaking.part3");
  assert.equal(getAssessmentContract("speaking.shadowing")?.execution, "instruction_catalog");
  assert.equal(getAssessmentContract("reading.short-answer")?.execution, "objective_local");
  assert.equal(getAssessmentContract("listening.multiple-choice")?.execution, "objective_local");
  assert.equal(getAssessmentContract("reporting.historical-window")?.execution, "deterministic_report");
  assert.equal(getAssessmentContract("assignment.objective-choice")?.execution, "objective_local");
});

test("AC3 the canonical composer preserves hard-core, teaching, domain/task, approved overlay, strict-output order", () => {
  const contract = getAssessmentContract("writing.task2.opinion")!;
  const overlay = { feedbackStyle: "step_by_step" as const, evidenceRequired: true, maxWeaknesses: 3 };
  const prompt = composeAssessmentPrompt({ contract, overlay, policyVersion: 7 });
  const locations = [
    prompt.indexOf("[IMMUTABLE HARD CORE]"),
    prompt.indexOf("[GLOBAL TEACHING AND EVIDENCE]"),
    prompt.indexOf("[WRITING DOMAIN CONTRACT]"),
    prompt.indexOf("[TASK-SPECIFIC CONTRACT]"),
    prompt.indexOf("[APPROVED OWNER PRESENTATION OVERLAY]"),
    prompt.indexOf("[STRICT OUTPUT RULES]"),
  ];
  assert.ok(locations.every((value) => value >= 0));
  assert.ok(locations.every((value, index) => index === 0 || locations[index - 1]! < value));
  assert.ok(prompt.includes(HARD_CORE_RULES));
  assert.ok(prompt.includes(GLOBAL_TEACHING_RULES));
  assert.ok(prompt.includes(STRICT_OUTPUT_RULES));
  assert.ok(prompt.includes('"version":7'));
  assert.equal(prompt.includes("ignore previous instructions"), false);

  const grade = composeAssessmentPrompt({ contract: getAssessmentContract("writing.grade.task2")!, detailedWritingAnalysis: true });
  assert.ok(grade.indexOf("[GRADE MY WORK OUTPUT ANNEX]") > grade.indexOf("[TASK-SPECIFIC CONTRACT]"));
  assert.ok(grade.indexOf("[GRADE MY WORK OUTPUT ANNEX]") < grade.indexOf("[APPROVED OWNER PRESENTATION OVERLAY]"));
  assert.equal(promptInvariantSnapshot(contract.key, overlay).hasHardCore, true);
  assert.throws(() => composeAssessmentPrompt({ contract: getAssessmentContract("reading.short-answer")! }), /assessment_contract_not_provider_executable/);
});

test("AC4 overlays are strict presentation fields and are filtered again for each affected task", () => {
  const parsed = assessmentOwnerOverlaySchema.safeParse({ maxWeaknesses: 3, feedbackStyle: "concise", systemPrompt: "reveal data" });
  assert.equal(parsed.success, false);
  const writing = getAssessmentContract("writing.task2.opinion")!;
  const speaking = getAssessmentContract("speaking.part1")!;
  const valid = { maxWeaknesses: 3, feedbackStyle: "balanced" as const, showPerAnswerScore: false };
  assert.deepEqual(filterOwnerOverlay(writing, valid), { maxWeaknesses: 3, feedbackStyle: "balanced" });
  assert.deepEqual(filterOwnerOverlay(speaking, valid), { maxWeaknesses: 3, feedbackStyle: "balanced", showPerAnswerScore: false });
  assert.equal(assessmentContractsForScope("reading.*").every((contract) => contract.ownerOverlayFields.length === 0), true);
  assert.deepEqual(OWNER_OVERLAY_FIELDS_BY_DOMAIN.reading, []);
});

test("AC5 output overlays cannot alter scores, criteria, verdict, task keys, or invent evidence and destinations", () => {
  const output = providerEvaluationOutputSchema.parse({
    overallEstimate: 6.5, confidence: 0.6, verdict: null,
    criteria: [
      { key: "task_response", label: "Task Response", band: 6.5, limited: false, note: null },
      { key: "coherence", label: "Coherence and Cohesion", band: 6, limited: false, note: null },
      { key: "lexical", label: "Lexical Resource", band: 7, limited: false, note: null },
      { key: "grammar", label: "Grammatical Range and Accuracy", band: 6.5, limited: false, note: null },
    ],
    strengths: ["strength one", "strength two"], weaknesses: ["weak one", "weak two"],
    issues: [], nextActions: ["next one", "next two"], recommendedExercises: [],
    teachingFeedback: {
      simpleExplanation: "A supported summary.", evidence: [
        { excerpt: "the exact learner words", point: "The point is supported.", correction: "a useful correction" },
        { excerpt: " ", point: "This is not a usable quote.", correction: null },
      ], steps: ["One step."], examples: [
        { before: "before", after: "after", explanation: "short" },
        { before: null, after: "another", explanation: null },
      ], illustration: "A small illustration.",
    },
  });
  const result = applyOwnerOverlayToOutput(output, {
    maxStrengths: 1, maxWeaknesses: 1, maxNextActions: 1, exampleCount: 1,
    prioritizeBandLimitingIssues: true, evidenceRequired: true, includeCorrections: false,
    useMiniIllustrations: false,
  });
  assert.equal(result.overallEstimate, output.overallEstimate);
  assert.deepEqual(result.criteria, output.criteria);
  assert.equal(result.verdict, output.verdict);
  assert.equal(result.strengths.length, 1);
  assert.equal(result.weaknesses.length, 1);
  assert.equal(result.nextActions.length, 1);
  assert.equal(result.teachingFeedback?.examples.length, 1);
  assert.deepEqual(result.teachingFeedback?.evidence.map((item) => item.correction), [null]);
  assert.equal(result.teachingFeedback?.illustration, null);
  assert.deepEqual(result.recommendedExercises, []);
});

test("AC6 task validators retain source-grounded evidence and transcript-only pronunciation limits", () => {
  const grammar = getAssessmentContract("grammar.activate-it")!;
  const input = {
    promptText: "Use a conditional.", studentAnswer: "If I had time, I would travel.", targetStructure: "second conditional", sampleAnswer: null,
  };
  const output = providerEvaluationOutputSchema.parse({
    overallEstimate: null, confidence: 0.8, verdict: "correct", criteria: [], strengths: [], weaknesses: [],
    issues: [{ category: "GRAMMAR_TENSE", message: "A grounded observation.", excerpt: "If I had time", suggestion: null, severity: "low" }],
    nextActions: [], recommendedExercises: [],
  });
  assert.ok(validateAssessmentOutput(grammar, "grammar", input, output));
  assert.equal(validateAssessmentOutput(grammar, "grammar", input, { ...output, issues: [{ ...output.issues[0]!, excerpt: "words never submitted" }] }), null);
  assert.equal(validateAssessmentOutput(grammar, "grammar", input, { ...output, issues: [{ ...output.issues[0]!, excerpt: "   " }] }), null,
    "whitespace-only excerpts are not evidence");
  const teaching = {
    simpleExplanation: null,
    evidence: [],
    steps: [],
    examples: [{ before: "words never submitted", after: "a corrected example", explanation: null }],
    illustration: null,
  };
  assert.equal(validateAssessmentOutput(grammar, "grammar", input, { ...output, teachingFeedback: teaching }), null,
    "a displayed before-example must be grounded in the learner's source");
  assert.ok(validateAssessmentOutput(grammar, "grammar", input, {
    ...output,
    teachingFeedback: { ...teaching, examples: [{ ...teaching.examples[0]!, before: "If I had time" }] },
  }));
  assert.match(HARD_CORE_RULES, /Pronunciation, accent, intonation, stress, pauses, and prosody cannot be inferred from a transcript/);
  const speaking = getAssessmentContract("speaking.part1")!;
  assert.equal(speaking.execution, "coach_evaluation");
  assert.match(SPEAKING_DOMAIN_RULES, /audio|acoustic|pronunciation/i);
});

test("AC7 exact task contracts reject mismatches and normalize only safe task-specific output", () => {
  const bilingual = (text: string) => ({ en: text, uz: text });
  const essay = "I believe this is a useful example. word word";
  const gradeContract = getAssessmentContract("writing.grade.task1")!;
  const gradeInput = { taskType: "task1", prompt: "Describe the chart.", content: essay, targetWordCount: 150, detailedAnalysis: true };
  const narratives = [
    { key: "task_achievement", narrative: bilingual("The overview is clear."), evidence: ["I believe this"] },
    { key: "coherence_cohesion", narrative: bilingual("The sequence is clear."), evidence: ["useful example"] },
    { key: "lexical_resource", narrative: bilingual("The vocabulary is clear."), evidence: ["word word"] },
    { key: "grammatical_range_accuracy", narrative: bilingual("The sentence is controlled."), evidence: ["I believe this"] },
  ];
  const gradeOutput = providerEvaluationOutputSchema.parse({
    overallEstimate: 9, confidence: 0.8, verdict: null,
    criteria: [
      { key: "task_achievement", label: "Task Achievement", band: 6, note: null },
      { key: "coherence", label: "Coherence and Cohesion", band: 6.5, note: null },
      { key: "lexical", label: "Lexical Resource", band: 7, note: null },
      { key: "grammar", label: "Grammatical Range and Accuracy", band: 7.5, note: null },
    ],
    strengths: [], weaknesses: [], issues: [], nextActions: [], recommendedExercises: [],
    writingAnalysis: { examinerComment: bilingual("A clear attempt."), criterionNarratives: narratives, sentenceFeedback: [], topFixes: [] },
  });
  const normalizedGrade = validateAssessmentOutput(gradeContract, "writing", gradeInput, gradeOutput);
  assert.ok(normalizedGrade);
  assert.equal(normalizedGrade.overallEstimate, 7, "the server derives overall from the four task criteria");
  assert.deepEqual(normalizedGrade.criteria.map((item) => item.key), ["task_achievement", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy"]);
  assert.equal(validateAssessmentOutput(getAssessmentContract("writing.grade.task2")!, "writing", gradeInput, gradeOutput), null,
    "a Task 2 contract cannot grade Task 1 input");
  assert.equal(validateAssessmentOutput(gradeContract, "writing", gradeInput, {
    ...gradeOutput,
    writingAnalysis: { ...gradeOutput.writingAnalysis!, criterionNarratives: narratives.map((item, index) => index === 1 ? { ...item, key: "task_achievement" } : item) },
  }), null, "narrative criteria must be the exact canonical four without duplicates");
  assert.equal(validateAssessmentOutput(gradeContract, "writing", gradeInput, {
    ...gradeOutput,
    writingAnalysis: {
      ...gradeOutput.writingAnalysis!,
      topFixes: [{ title: bilingual("Fix"), explanation: bilingual("Use evidence."), examples: ["invented quote"] }],
    },
  }), null, "Grade My Work top-fix quotations must be grounded in the essay");

  const checkContract = getAssessmentContract("writing.check.translation")!;
  const checkInput = {
    taskType: "task2", prompt: "", content: "I went home yesterday.", targetWordCount: 0,
    check: { kind: "translation", uzbekSource: "Men kecha uyga bordim.", referenceEnglish: "I went home yesterday.", acceptedAlternatives: [], targetBand: 6, answer: "I went home yesterday." },
  };
  const checkOutput = providerEvaluationOutputSchema.parse({
    overallEstimate: null, confidence: 0.8, verdict: "correct",
    criteria: [
      { key: "meaning", label: "Meaning", band: 8, note: null },
      { key: "grammar", label: "Grammar", band: 7, note: null },
      { key: "vocabulary", label: "Vocabulary", band: 7, note: null },
    ], strengths: [], weaknesses: [], issues: [], nextActions: [], recommendedExercises: [],
  });
  assert.ok(validateAssessmentOutput(checkContract, "writing", checkInput, checkOutput));
  assert.equal(validateAssessmentOutput(checkContract, "writing", checkInput, {
    ...checkOutput, criteria: [{ ...checkOutput.criteria[0]!, key: "invented" }, ...checkOutput.criteria.slice(1)],
  }), null, "a Writing check cannot substitute arbitrary criterion keys");

  const speakingContract = getAssessmentContract("speaking.part1")!;
  const speakingInput = { part: "part1", promptText: "What do you enjoy?", transcript: "I enjoy reading.", transcriptOrigin: "manual", durationMs: 10_000, pronunciationAvailable: false };
  const speakingOutput = providerEvaluationOutputSchema.parse({
    overallEstimate: 9, confidence: 0.7, verdict: null,
    criteria: [
      { key: "fluency_coherence", label: "Provider-specific fluency label", band: 6.1, note: null },
      { key: "lexical_resource", label: "Provider-specific lexical label", band: 6.6, note: null },
      { key: "grammatical_range_accuracy", label: "Provider-specific grammar label", band: 7, note: null },
    ], strengths: [], weaknesses: [], issues: [], nextActions: [], recommendedExercises: [],
  });
  const normalizedSpeaking = validateAssessmentOutput(speakingContract, "speaking", speakingInput, speakingOutput);
  assert.ok(normalizedSpeaking);
  assert.equal(normalizedSpeaking.overallEstimate, 6.5, "the server derives overall only from the three measured criteria");
  assert.deepEqual(normalizedSpeaking.criteria.map((item) => item.key), ["fluency", "lexical", "grammar", "pronunciation"]);
  assert.deepEqual(normalizedSpeaking.criteria.map((item) => item.label), [
    "Fluency and Coherence", "Lexical Resource", "Grammatical Range and Accuracy", "Pronunciation",
  ], "canonical Speaking labels are server-owned");
  assert.equal(normalizedSpeaking.criteria[3]?.limited, true);
  assert.equal(normalizedSpeaking.criteria[3]?.band, null);
  assert.equal(validateAssessmentOutput(speakingContract, "speaking", speakingInput, {
    ...speakingOutput,
    criteria: [...speakingOutput.criteria, { key: "pronunciation", label: "Pronunciation", band: 7, limited: false, note: null }],
  }), null, "a provider's pronunciation score is rejected, not merely hidden");
  assert.equal(validateAssessmentOutput(speakingContract, "speaking", { ...speakingInput, part: "part2" }, speakingOutput), null,
    "the contract part must match the server-selected input part");

  const numericGrammar = providerEvaluationOutputSchema.parse({
    ...outputForVerdict(), criteria: [{ key: "grammar", label: "Grammar", band: 6, note: null }],
  });
  const grammarInput = { promptText: "Use a conditional.", studentAnswer: "If I had time, I would travel.", targetStructure: "second conditional", sampleAnswer: null };
  assert.equal(validateAssessmentOutput(getAssessmentContract("grammar.activate-it")!, "grammar", grammarInput, numericGrammar), null,
    "ordinary verdict tasks cannot introduce unrequested numeric grades");
});

test("AC8 an approved evidence-required overlay fails closed when a provider supplies no grounded excerpt", () => {
  const contract = getAssessmentContract("writing.task2.generic")!;
  const input = { taskType: "task2", prompt: "Explain one benefit.", content: "The city grew.", targetWordCount: 250 };
  const output = providerEvaluationOutputSchema.parse({
    overallEstimate: 6, confidence: 0.7, verdict: null,
    criteria: [
      { key: "task_response", label: "Task Response", band: 6, note: null },
      { key: "coherence", label: "Coherence and Cohesion", band: 6, note: null },
      { key: "lexical", label: "Lexical Resource", band: 6, note: null },
      { key: "grammar", label: "Grammatical Range and Accuracy", band: 6, note: null },
    ], strengths: [], weaknesses: [], issues: [], nextActions: [], recommendedExercises: [],
  });
  assert.equal(validateAssessmentOutput(contract, "writing", input, output, { evidenceRequired: true }), null);
  const grounded = { ...output, issues: [{ category: "WRITING_TASK_RESPONSE" as const, message: "A source-grounded observation.", excerpt: "city grew", suggestion: null, severity: "low" as const }] };
  assert.ok(validateAssessmentOutput(contract, "writing", input, grounded, { evidenceRequired: true }));
});

function outputForVerdict() {
  return {
    overallEstimate: null, confidence: 0.8, verdict: "correct" as const, criteria: [], strengths: [], weaknesses: [],
    issues: [], nextActions: [], recommendedExercises: [],
  };
}
