import { defineAssessmentContracts, type AssessmentContractKey, type AssessmentContractSeed } from "./types";

export const REPORTING_DOMAIN_RULES = `REPORTING DOMAIN
- Reporter metrics are calculated deterministically by the server from authorized, bounded source rows. Do not calculate, estimate, interpolate, normalize, or rewrite numeric metrics in a model.
- Preserve the server's roster, role, subject, time-window, historical-cutoff, pagination, and per-request reauthorization rules. Never combine scopes or add a learner outside the authorized query.
- Explain supplied values faithfully, keep missing values unknown rather than zero, and distinguish counts, rates, and snapshots. Do not invent citations, capabilities, cohort totals, or URLs.
- Reporting contracts are catalog-only: they are not a path into the Coach LLM resolver. No owner overlay can change Reporter math or historical-window semantics.`;

function reporting(key: AssessmentContractKey, purpose: string, taskRules: string): AssessmentContractSeed {
  return { key, domain: "reporting", execution: "deterministic_report", scoringMode: "deterministic_metrics", purpose, taskRules, ownerOverlayFields: [] };
}

export const reportingContracts = defineAssessmentContracts([
  reporting("reporting.progress", "Explain a single server-generated learner progress snapshot.", "Use only the supplied deterministic snapshot and its authorized scope. Preserve each number exactly and identify its stated time window."),
  reporting("reporting.progress-explanation", "Explain how to read a server-generated progress result.", "Explain supplied metric names and values without recomputing them. If a metric is absent, say it is unavailable rather than substituting zero."),
  reporting("reporting.strengths", "Summarize strengths calculated from authorized learning records.", "Separate measured completion or accuracy from qualitative interpretation. Do not claim a skill improved unless the source snapshot includes that comparison."),
  reporting("reporting.priorities", "Explain deterministic next-practice priorities.", "Use only the server-ranked categories and approved destinations supplied to the view. Do not create a new priority, score, or arbitrary exercise URL."),
  reporting("reporting.teacher-roster", "Explain a teacher report limited to the currently assigned roster.", "Keep the authorized teacher roster boundary and current reauthorization intact. Do not reveal other learners or claim a whole-centre aggregate."),
  reporting("reporting.centre-metrics", "Explain server-generated centre or admin cohort metrics.", "Use the exact operational cohort returned by the server. Do not broaden a cohort, infer an unavailable demographic, or modify a count or rate."),
  reporting("reporting.historical-window", "Explain a historical report with its server-applied cutoff.", "Preserve the historical-window cutoff and the roster/scope at the window end. Never include records outside that cutoff or retroactively reinterpret membership."),
] as const);
