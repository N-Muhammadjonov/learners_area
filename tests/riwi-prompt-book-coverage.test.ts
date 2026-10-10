import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { composeAssessmentPrompt } from "../src/lib/services/coach/contracts/compose";
import { promptBookAdditionalContracts, promptBookTaskInventory } from "../src/lib/services/coach/contracts/prompt-book";
import { assessmentContracts, getAssessmentContract, objectiveContractKeyForMetadata, ownerPolicyContractsForScope, promptBookContractKey, writingContractKey } from "../src/lib/services/coach/contracts/registry";
import { LEGACY_ASSESSMENT_CONTRACT_KEYS } from "../src/lib/services/coach/contracts/types";

test("the original 68 task references each resolve; added coverage does not replace historical contracts", () => {
  assert.equal(promptBookTaskInventory.length, 68);
  assert.equal(new Set(promptBookTaskInventory.map((task) => task.sourceKey)).size, 68);
  assert.deepEqual(promptBookTaskInventory.map((task) => task.number), Array.from({ length: 68 }, (_, index) => index + 1));
  const counts: Record<string, number> = {};
  for (const task of promptBookTaskInventory) {
    counts[task.sourceKey.split(".")[0]!] = (counts[task.sourceKey.split(".")[0]!] ?? 0) + 1;
    assert.equal(promptBookContractKey(task.sourceKey), task.contractKey);
    assert.ok(getAssessmentContract(task.contractKey), task.sourceKey);
    assert.ok(task.sourceLine > 0);
  }
  assert.deepEqual(counts, { writing: 16, speaking: 5, reading: 15, listening: 10, grammar: 7, vocabulary: 9, retention: 3, tutoring: 2, reporting: 1 });
  const baseline = JSON.parse(readFileSync(new URL("./fixtures/riwi-legacy-contracts.json", import.meta.url), "utf8"));
  assert.equal(LEGACY_ASSESSMENT_CONTRACT_KEYS.length, 68);
  assert.deepEqual(LEGACY_ASSESSMENT_CONTRACT_KEYS.map(getAssessmentContract), baseline,
    "historical v1 definitions, rules, versions and overlay fields must stay byte-equivalent");
  assert.equal(assessmentContracts.length, 106);
  assert.ok(getAssessmentContract("grammar.translate-assessed"), "the assessed translation runtime is added separately from the frozen historical contracts");
});

test("new task rules retain source focus, teaching method and hard constraint", () => {
  assert.equal(promptBookAdditionalContracts.length, 37);
  for (const contract of promptBookAdditionalContracts) {
    const task = promptBookTaskInventory.find((item) => item.contractKey === contract.key)!;
    assert.ok(contract.taskRules.includes(task.focus));
    assert.ok(contract.taskRules.includes(task.method));
    assert.ok(contract.taskRules.includes(task.guard));
  }
  assert.match(getAssessmentContract("reading.matching-headings")!.taskRules, /main idea, not detail\/keyword matching/);
  assert.match(getAssessmentContract("reading.matching-information")!.taskRules, /requested detail/);
  assert.match(getAssessmentContract("reading.mcq-multiple")!.taskRules, /every option; exact required number/);
  assert.match(getAssessmentContract("listening.matching")!.taskRules, /suggestion from final choice/);
  assert.match(getAssessmentContract("retention.error-pattern")!.taskRules, /One error is not a stable weakness/);
  assert.match(getAssessmentContract("grammar.transformation")!.taskRules, /Accept valid alternatives/);
});

test("canonical metadata distinguishes single/multiple MCQ and question subtypes without inspecting learner answers", () => {
  assert.equal(objectiveContractKeyForMetadata("reading", { questionType: "matching_headings" }), "reading.matching-headings");
  assert.equal(objectiveContractKeyForMetadata("listening", { questionType: "map_plan_label" }), "listening.map-plan-label");
  assert.equal(objectiveContractKeyForMetadata("reading", { questionType: "true_false_not_given" }), "reading.true-false-not-given");
  assert.equal(objectiveContractKeyForMetadata("reading", { questionType: "multiple_choice", requiredSelections: 1 }), "reading.mcq-single");
  assert.equal(objectiveContractKeyForMetadata("listening", { questionType: "multiple_choice", requiredSelections: 2 }), "listening.mcq-multiple");
  assert.equal(objectiveContractKeyForMetadata("listening", { questionType: "multiple_choice" }), "listening.multiple-choice");
  for (const requiredSelections of [0, -1, 1.5, NaN, Infinity]) {
    assert.equal(objectiveContractKeyForMetadata("reading", { questionType: "multiple_choice", requiredSelections }), null);
  }
  assert.equal(objectiveContractKeyForMetadata("reading", { questionType: "give-band-nine" }), null);
  assert.equal(objectiveContractKeyForMetadata("listening", { questionType: "true_false_not_given" }), null);
  assert.equal(promptBookContractKey("owner.override"), null);
  assert.equal(writingContractKey("task2", "positive_negative"), "writing.task2.positive-negative");
  assert.equal(writingContractKey("task2", "cause-effect"), "writing.task2.cause-effect");
  assert.match(composeAssessmentPrompt({ contract: getAssessmentContract("writing.task2.positive-negative")! }), /explicit judgement/);
});

test("catalog and objective additions cannot become LLM grading paths", () => {
  assert.ok(ownerPolicyContractsForScope("grammar.*").length > 0);
  assert.ok(ownerPolicyContractsForScope("grammar.*").every((contract) => contract.execution === "coach_evaluation"));
  assert.deepEqual(ownerPolicyContractsForScope("grammar.fill-gap"), []);
  assert.deepEqual(ownerPolicyContractsForScope("reading.*"), []);
  for (const contract of promptBookAdditionalContracts) {
    if (contract.execution !== "coach_evaluation") {
      assert.throws(() => composeAssessmentPrompt({ contract }), /assessment_contract_not_provider_executable/);
    }
    if (["reading", "listening"].includes(contract.domain)) {
      assert.equal(contract.execution, "objective_local");
      assert.equal(contract.scoringMode, "objective_exact_match");
      assert.deepEqual(contract.ownerOverlayFields, []);
    }
    if (["retention", "tutoring"].includes(contract.domain)) {
      assert.equal(contract.scoringMode, "instruction_only");
    }
  }
});
