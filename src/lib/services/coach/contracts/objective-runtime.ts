import "server-only";
import { getAssessmentContractOrThrow, objectiveContractKeyForMetadata } from "./registry";

const READING_CODES: Readonly<Record<string, string>> = {
  TFNG: "tfng", YNNG: "ynng", MCQ: "multiple_choice", MCQ_MULTI: "multiple_choice", MH: "matching_headings",
  MI: "matching_information", MF: "matching_features", MSE: "matching_sentence_endings",
  SC: "summary_completion", SUMMARY: "summary_completion", NOTE: "note_completion",
  SEN: "sentence_completion", DIAG: "diagram_label", TABLE: "table_completion", FLOW: "flowchart_completion", DIAGRAM: "diagram_label", SAQ: "short_answer",
};

/** Only persisted task metadata belongs here. No answer, learner-selected key,
 * instruction prose, or provider output determines the assessment contract. */
export function objectiveAssessmentEvidence(domain: "reading" | "listening", metadata: {
  type: string; typeCode?: string | null; requiredSelections?: number;
}) {
  const code = metadata.typeCode?.trim().toUpperCase();
  if (domain === "reading" && metadata.typeCode != null && (!code || !READING_CODES[code])) throw new Error("objective_assessment_metadata_unsupported");
  const requiredSelections = domain === "reading" && code === "MCQ_MULTI" ? 2
    : domain === "reading" && code === "MCQ" ? 1 : metadata.requiredSelections;
  const canonicalType = domain === "reading" && metadata.typeCode
    ? READING_CODES[code!] ?? metadata.type : metadata.type;
  const key = objectiveContractKeyForMetadata(domain, { questionType: canonicalType, requiredSelections: requiredSelections });
  if (!key) throw new Error("objective_assessment_metadata_unsupported");
  const contract = getAssessmentContractOrThrow(key);
  if (contract.execution !== "objective_local") throw new Error("objective_assessment_execution_invalid");
  return { key: contract.key, promptVersion: contract.version, rubricVersion: contract.rubricVersion };
}
