import { toBand } from "@/lib/services/writing-evaluation/heuristics";
import { PRONUNCIATION_CRITERION_KEY } from "@/lib/services/coach/pronunciation";
import type { SessionPlanLimitation, SessionPlanMode } from "./ai-session-plan";
import type { PracticePart } from "./practice-browse";

/**
 * Session summary aggregation (spec §28, §29, §49).
 *
 * This is a PURE function over already-stored rows. It calls no provider and
 * reads no database, which is the structural guarantee behind §29: every number
 * on the summary card is arithmetic over evaluations that were really persisted.
 * No model is in the loop, so none can invent one.
 *
 * The two honesty rules it exists to enforce:
 *
 *  - NO OVERALL BAND FROM PART 1 ALONE (§28). A Part-1-only session — or a full
 *    session where the learner only ever answered Part 1 questions — gets no
 *    overall estimate at all, and the reason is returned so the UI can say it
 *    out loud instead of showing a suspiciously complete number. Part 1 is short
 *    social Q&A; a full interview band from it would be a fabrication.
 *
 *  - PRONUNCIATION IS NEVER AGGREGATED WHEN IT WAS NOT ASSESSED (§23). A
 *    criterion that is `limited`, or carries no band, contributes nothing to any
 *    mean and is reported as "Not assessed". Averaging over the criteria that did
 *    produce bands would silently smuggle a pronunciation score into the summary.
 *
 * Anything the summary shows is also labelled as a text-based estimate: the whole
 * path runs on transcripts, so it can never claim to be an official IELTS band.
 */

export type SummaryCriterionInput = {
  key: string;
  label: string;
  band: number | null;
  limited?: boolean;
  note?: string | null;
};

export type SummaryIssueInput = {
  category: string;
  message: string;
  severity: "low" | "medium" | "high";
  excerpt?: string | null;
  suggestion?: string | null;
};

export type SummaryEvaluationInput = {
  overallEstimate: number | null;
  confidence: number;
  criteria: SummaryCriterionInput[];
  strengths: string[];
  weaknesses: string[];
  issues: SummaryIssueInput[];
  nextActions: string[];
  /** True when the local RIWI evaluator produced this answer's feedback. */
  fallbackUsed: boolean;
};

export type SummaryAnswerInput = {
  itemId: string;
  ordinal: number;
  part: PracticePart;
  topicKey: string;
  topicTitle: string | null;
  questionPosition: number;
  clusterSize: number;
  isCueCard: boolean;
  status: "pending" | "answered" | "skipped";
  attemptId: string | null;
  evaluation: SummaryEvaluationInput | null;
};

export type SessionSummaryInput = {
  mode: SessionPlanMode;
  answers: readonly SummaryAnswerInput[];
  limitations?: readonly SessionPlanLimitation[];
};

export type SummaryCriterion = {
  key: string;
  label: string;
  band: number | null;
  /** True when nothing could judge this criterion, so no band exists. */
  limited: boolean;
  /** How many answers contributed a real band. 0 means "not assessed". */
  assessedFrom: number;
};

export type SummaryWeakness = {
  category: string;
  message: string;
  /** How many distinct answers raised it. */
  occurrences: number;
  highestSeverity: "low" | "medium" | "high";
};

export type SummaryTopic = {
  part: PracticePart;
  topicKey: string;
  topicTitle: string | null;
  answered: number;
  total: number;
};

export type SessionSummary = {
  mode: SessionPlanMode;
  totalCount: number;
  answeredCount: number;
  skippedCount: number;
  unansweredCount: number;
  estimate: {
    /** Null whenever an honest overall number does not exist. */
    band: number | null;
    /** Always "text_based_estimate": the UI must render this label, not "IELTS band". */
    labelKind: "text_based_estimate";
    /** Why there is no band, so the UI can state it rather than show nothing. */
    suppressedReason: "part1_only" | "no_answers" | "not_evaluated" | "no_assessed_criteria" | null;
    basedOnAnswers: number;
  };
  criteria: SummaryCriterion[];
  pronunciationAssessed: boolean;
  strengths: string[];
  weaknesses: SummaryWeakness[];
  nextActions: string[];
  topics: SummaryTopic[];
  limitations: SessionPlanLimitation[];
  /** True if any answer fell back to the local evaluator. */
  fallbackUsed: boolean;
};

const SEVERITY_RANK: Record<SummaryIssueInput["severity"], number> = { low: 0, medium: 1, high: 2 };
const RANK_SEVERITY: SummaryIssueInput["severity"][] = ["low", "medium", "high"];

/** A criterion that produced no band cannot be averaged. */
function isAssessed(criterion: SummaryCriterionInput): boolean {
  return criterion.band !== null && criterion.limited !== true;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Builds the summary. Deterministic: the same stored rows always produce the
 * same output, with stable ordering and no dependence on map iteration luck.
 */
export function buildSessionSummary(input: SessionSummaryInput): SessionSummary {
  // Plan order is the display order, so sort defensively rather than trusting
  // the caller to have done it — a summary in random order looks like a bug.
  const answers = [...input.answers].sort((a, b) => a.ordinal - b.ordinal);

  const answered = answers.filter((a) => a.status === "answered" && a.evaluation !== null);
  const skippedCount = answers.filter((a) => a.status === "skipped").length;
  const answeredCount = answers.filter((a) => a.status === "answered").length;

  // ---- per-criterion aggregation -----------------------------------------
  // Keyed by criterion key, in first-seen order, which is the provider's own
  // rubric order — stable across answers, so stable here.
  const criterionOrder: string[] = [];
  const criterionLabels = new Map<string, string>();
  const criterionBands = new Map<string, number[]>();

  for (const answer of answered) {
    for (const criterion of answer.evaluation!.criteria) {
      if (!criterionOrder.includes(criterion.key)) {
        criterionOrder.push(criterion.key);
        criterionLabels.set(criterion.key, criterion.label);
        criterionBands.set(criterion.key, []);
      }
      // Only a real band is averaged. A limited criterion contributes nothing,
      // which is what stops an unassessed pronunciation from being smuggled into
      // a mean as a zero or as a guess.
      if (isAssessed(criterion)) criterionBands.get(criterion.key)!.push(criterion.band as number);
    }
  }

  const criteria: SummaryCriterion[] = criterionOrder.map((key) => {
    const bands = criterionBands.get(key) ?? [];
    // `limited` means exactly "there is no band to show". A criterion that was
    // assessed in some answers keeps its band, and `assessedFrom` says how much
    // of the session backed it — marking it limited as well would render
    // "Not assessed" next to a number.
    const limited = bands.length === 0;
    return {
      key,
      label: criterionLabels.get(key) ?? key,
      band: limited ? null : toBand(mean(bands)!),
      limited,
      assessedFrom: bands.length,
    };
  });

  const pronunciation = criteria.find((c) => c.key === PRONUNCIATION_CRITERION_KEY);
  const pronunciationAssessed = Boolean(pronunciation && !pronunciation.limited && pronunciation.band !== null);

  // ---- overall estimate ---------------------------------------------------
  const estimates = answered
    .map((a) => a.evaluation!.overallEstimate)
    .filter((v): v is number => typeof v === "number");

  // Which parts did the learner actually answer? Suppressing on answered parts
  // rather than on the requested mode is the stricter, more honest reading of
  // §28: a "full" session where Parts 2 and 3 were all skipped still has nothing
  // but Part 1 evidence, and must not produce an interview band either.
  const answeredParts = new Set<PracticePart>(answered.map((a) => a.part));
  const onlyPart1 = answeredParts.size > 0 && [...answeredParts].every((p) => p === "part1");

  let band: number | null = null;
  let suppressedReason: SessionSummary["estimate"]["suppressedReason"] = null;
  if (answers.length === 0 || answeredCount === 0) {
    // Nothing was answered, so there is nothing to summarise.
    suppressedReason = "no_answers";
  } else if (answered.length === 0) {
    // The learner did answer, but no evaluation was persisted for any of it.
    // Distinct from "no answers": saying nothing was answered would be a lie.
    suppressedReason = "not_evaluated";
  } else if (onlyPart1) {
    suppressedReason = "part1_only";
  } else if (estimates.length === 0) {
    suppressedReason = "no_assessed_criteria";
  } else {
    band = toBand(mean(estimates)!);
  }

  // ---- recurring weaknesses ----------------------------------------------
  // A pattern needs the SAME issue category in at least two distinct answers
  // before it is called recurring; one answer can be a one-off. A high-severity
  // issue qualifies on its own, because waiting for a second occurrence would
  // bury the thing most worth fixing.
  const occurrences = new Map<string, number>();
  const firstMessage = new Map<string, string>();
  const highestSeverity = new Map<string, number>();

  for (const answer of answered) {
    const seenInAnswer = new Set<string>();
    for (const issue of answer.evaluation!.issues) {
      // Once per answer: three filler issues in one answer is not three answers.
      if (seenInAnswer.has(issue.category)) continue;
      seenInAnswer.add(issue.category);
      occurrences.set(issue.category, (occurrences.get(issue.category) ?? 0) + 1);
      if (!firstMessage.has(issue.category)) firstMessage.set(issue.category, issue.message);
      const rank = SEVERITY_RANK[issue.severity] ?? 0;
      highestSeverity.set(issue.category, Math.max(highestSeverity.get(issue.category) ?? 0, rank));
    }
  }

  const weaknesses: SummaryWeakness[] = [...occurrences.entries()]
    .map(([category, count]) => ({
      category,
      message: firstMessage.get(category) ?? category,
      occurrences: count,
      highestSeverity: RANK_SEVERITY[highestSeverity.get(category) ?? 0] ?? "low",
    }))
    .filter((w) => w.occurrences >= 2 || w.highestSeverity === "high")
    // Deterministic: most-evidenced first, then severity, then category name.
    .sort(
      (a, b) =>
        b.occurrences - a.occurrences ||
        SEVERITY_RANK[b.highestSeverity] - SEVERITY_RANK[a.highestSeverity] ||
        a.category.localeCompare(b.category),
    );

  // ---- strengths / next actions ------------------------------------------
  // Deduplicated in first-seen order (answers are already in plan order), so the
  // same stored rows always render the same list.
  const strengths = dedupeInOrder(answered.flatMap((a) => a.evaluation!.strengths)).slice(0, 6);
  const nextActions = dedupeInOrder(answered.flatMap((a) => a.evaluation!.nextActions)).slice(0, 5);

  // ---- topics -------------------------------------------------------------
  const topics: SummaryTopic[] = [];
  for (const answer of answers) {
    const existing = topics.find((t) => t.part === answer.part && t.topicKey === answer.topicKey);
    if (existing) {
      existing.total += 1;
      if (answer.status === "answered") existing.answered += 1;
    } else {
      topics.push({
        part: answer.part,
        topicKey: answer.topicKey,
        topicTitle: answer.topicTitle,
        answered: answer.status === "answered" ? 1 : 0,
        total: 1,
      });
    }
  }

  return {
    mode: input.mode,
    totalCount: answers.length,
    answeredCount,
    skippedCount,
    unansweredCount: answers.length - answeredCount - skippedCount,
    estimate: {
      band,
      labelKind: "text_based_estimate",
      suppressedReason,
      basedOnAnswers: estimates.length,
    },
    criteria,
    pronunciationAssessed,
    strengths,
    weaknesses,
    nextActions,
    topics,
    limitations: [...(input.limitations ?? [])],
    fallbackUsed: answered.some((a) => a.evaluation!.fallbackUsed),
  };
}

function dedupeInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
