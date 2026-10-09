import test from "node:test";
import assert from "node:assert/strict";
import { objectiveAssessmentEvidence } from "../src/lib/services/coach/contracts/objective-runtime";
import { gradeAnswer as readingGrade } from "../src/lib/services/reading/grading";

test("objective runtime selects source-specific contracts from canonical metadata and leaves official scoring deterministic", () => {
  assert.equal(objectiveAssessmentEvidence("reading", { type: "short_answer", typeCode: "SC" }).key, "reading.summary-completion");
  assert.equal(objectiveAssessmentEvidence("reading", { type: "short_answer", typeCode: "SEN" }).key, "reading.sentence-completion");
  assert.equal(objectiveAssessmentEvidence("reading", { type: "multiple_choice", typeCode: "MCQ_MULTI" }).key, "reading.mcq-multiple");
  assert.equal(objectiveAssessmentEvidence("reading", { type: "multiple_choice", typeCode: "MCQ" }).key, "reading.mcq-single");
  assert.equal(objectiveAssessmentEvidence("reading", { type: "short_answer", typeCode: "MH" }).key, "reading.matching-headings");
  assert.equal(objectiveAssessmentEvidence("reading", { type: "true_false_not_given", typeCode: "TFNG" }).key, "reading.true-false-not-given");
  assert.equal(objectiveAssessmentEvidence("reading", { type: "yes_no_not_given", typeCode: "YNNG" }).key, "reading.yes-no-not-given");
  assert.equal(objectiveAssessmentEvidence("listening", { type: "multiple_choice", requiredSelections: 2 }).key, "listening.mcq-multiple");
  assert.equal(objectiveAssessmentEvidence("listening", { type: "multiple_choice", requiredSelections: 1 }).key, "listening.mcq-single");
  assert.equal(objectiveAssessmentEvidence("listening", { type: "multiple_choice" }).key, "listening.multiple-choice");
  assert.throws(() => objectiveAssessmentEvidence("reading", { type: "invented" }), /metadata_unsupported/);
  assert.throws(() => objectiveAssessmentEvidence("listening", { type: "multiple_choice", requiredSelections: 0 }), /metadata_unsupported/);
  assert.throws(() => objectiveAssessmentEvidence("reading", { type: "short_answer", typeCode: "UNKNOWN" }), /metadata_unsupported/);
  assert.throws(() => objectiveAssessmentEvidence("reading", { type: "short_answer", typeCode: " " }), /metadata_unsupported/);
  assert.equal(readingGrade("40 mm", "40 millimetres", ["40 mm"]), true);
  assert.equal(readingGrade("invent a new answer", "40 millimetres"), false);
  const proof = objectiveAssessmentEvidence("reading", { type: "short_answer", typeCode: "NOTE" });
  assert.deepEqual(Object.keys(proof).sort(), ["key", "promptVersion", "rubricVersion"]);
});
