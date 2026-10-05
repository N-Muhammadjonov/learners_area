import {
  defineAssessmentContracts,
  OWNER_OVERLAY_FIELDS_BY_DOMAIN,
  type AssessmentContractKey,
  type AssessmentContractSeed,
} from "./types";

export const WRITING_DOMAIN_RULES = `WRITING DOMAIN
- Match the criterion label and task purpose to the server-supplied Task 1 or Task 2 metadata. Task 1 reports/selects key features; Task 2 answers the exact question and develops a clear position or response.
- Do not infer a chart type, question type, visual data, position, or missing prompt facts from the essay alone. If the server category is generic, use the generic task contract.
- The four writing criteria are server-authoritative. Do not add, omit, reorder, rename, or duplicate criteria. Do not award evidence the essay does not contain.
- Task-specific examples and comparisons must be grounded in the prompt and learner response; never invent chart values, map changes, process steps, causes, or effects.`;

const fields = OWNER_OVERLAY_FIELDS_BY_DOMAIN.writing;
function writing(key: AssessmentContractKey, purpose: string, taskRules: string, scoringMode: AssessmentContractSeed["scoringMode"] = "writing_band_estimate"): AssessmentContractSeed {
  return {
    key, domain: "writing", execution: "coach_evaluation", scoringMode,
    purpose, taskRules, ownerOverlayFields: fields,
  };
}

export const writingContracts = defineAssessmentContracts([
  writing("writing.task1.generic", "IELTS Academic Writing Task 1 with an unspecified visual type.", "Summarize only the key features that the prompt makes available. Include a clear overview, accurate comparisons, and relevant figures only when supplied. Do not invent data."),
  writing("writing.task1.line-chart", "IELTS Academic Writing Task 1 line chart.", "Identify the overall trend, notable turning points, and meaningful comparisons across series. Track the stated time period and units; do not invent intermediate values."),
  writing("writing.task1.bar-chart", "IELTS Academic Writing Task 1 bar chart.", "Compare the largest and smallest categories and the most useful contrasts. Preserve the categories, units, and time points given; do not invent values."),
  writing("writing.task1.pie-chart", "IELTS Academic Writing Task 1 pie chart.", "Summarize the largest shares and important changes or contrasts between pies. Preserve percentages and labels exactly when stated; do not infer unavailable totals."),
  writing("writing.task1.table", "IELTS Academic Writing Task 1 data table.", "Select the strongest patterns and comparisons in the table, not every cell. Keep units, dates, and category labels faithful to the prompt."),
  writing("writing.task1.process", "IELTS Academic Writing Task 1 process diagram.", "Check sequence, stages, inputs, outputs, and passive forms only against the supplied diagram description. Never add a stage or causal explanation not shown."),
  writing("writing.task1.map", "IELTS Academic Writing Task 1 map or plan.", "Compare locations and changes across the supplied maps, using direction and time labels only when given. Do not infer unshown buildings, scale, or reasons for change."),
  writing("writing.task1.mixed", "IELTS Academic Writing Task 1 with multiple visual types.", "Synthesize the visuals by selecting key features and comparisons that are supported by each one. Keep the source, unit, and time period of each figure clear."),
  writing("writing.task2.generic", "IELTS Academic Writing Task 2 with an unspecified prompt type.", "Answer the whole question, make the position or response clear, and develop relevant reasons with support. Do not assume the prompt asks for a different essay type."),
  writing("writing.task2.opinion", "IELTS Academic Writing Task 2 opinion or agree/disagree prompt.", "Identify the exact proposition and requested degree of agreement. State a consistent position and support it; do not replace the question with a two-sided discussion unless requested."),
  writing("writing.task2.discussion", "IELTS Academic Writing Task 2 discussion prompt.", "Address every view the question asks to discuss and include the learner's own position when requested. Do not treat a discussion prompt as an opinion-only task."),
  writing("writing.task2.advantages-disadvantages", "IELTS Academic Writing Task 2 advantages/disadvantages prompt.", "Cover both advantages and disadvantages and answer any additional question about whether one side outweighs the other. Do not assume a conclusion the learner did not state."),
  writing("writing.task2.problem-solution", "IELTS Academic Writing Task 2 problem/solution prompt.", "Separate the stated problem or causes from proposed solutions, and assess whether the response covers every part the prompt asks. Do not invent facts about the topic."),
  writing("writing.task2.two-part", "IELTS Academic Writing Task 2 two-part question.", "Identify and answer each distinct question. Give each part adequate development; do not let a fluent answer to one part conceal an omitted part."),
  writing("writing.task2.cause-effect", "IELTS Academic Writing Task 2 cause/effect prompt.", "Distinguish causes, consequences, and any requested response. Treat causal claims as the learner's argument unless evidence is supplied; do not present them as verified facts."),
  writing("writing.grade.task1", "Grade My Work for Task 1 with no more specific server-supplied category.", "Use the Task Achievement criterion (never Task Response), followed by the other three canonical Writing criteria. The server derives the overall from four half-band criteria."),
  writing("writing.grade.task2", "Grade My Work for Task 2 with no more specific server-supplied category.", "Use the Task Response criterion, followed by the other three canonical Writing criteria. The server derives the overall from four half-band criteria."),
  writing("writing.check.translation", "A short English translation of a server-supplied Uzbek source sentence.", "Preserve the full intended meaning while accepting natural paraphrases. The reference answer is one valid rendering, not the only one. Return exactly the `meaning`, `grammar`, and `vocabulary` criteria in that order, each with a 0–9 band; return a verdict and no overall IELTS essay band.", "verdict"),
  writing("writing.check.activation-writing", "Use a target vocabulary item in a learner-written sentence.", "Judge target meaning, form, collocation, naturalness, and grammar from the submitted sentence. Return exactly the `meaning`, `form`, `collocation`, `naturalness`, and `grammar` criteria in that order, each with a 0–9 band. Do not infer spoken performance or award an essay band.", "verdict"),
  writing("writing.check.activation-speaking", "A typed sentence intended as speaking practice.", "Judge only the words typed and their language use. Return exactly the `meaning`, `form`, `collocation`, `naturalness`, and `grammar` criteria in that order, each with a 0–9 band. No audio is available: do not claim pronunciation, fluency, prosody, or speaking performance.", "verdict"),
  writing("writing.check.pattern-adaptation", "Adapt a language pattern from a source example to a new topic.", "Check whether the new sentence transfers the pattern to the new topic instead of copying the source example. Return exactly the `grammar`, `meaning`, `pattern`, and `adaptation` criteria in that order, each with a 0–9 band. Quote only the learner's answer or server-supplied source text.", "verdict"),
] as const);
