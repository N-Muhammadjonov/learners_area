import type { Criterion, EvaluationIssue, ProviderEvaluationOutput } from "../../schema";
import type { AssignmentEvaluationInput } from "../../types";
import { analyseText } from "./text";

/**
 * RIWI — free-form assignment response.
 *
 * This is the generic path used only when an assignment has no task type that
 * maps onto a specialised service. RIWI reports what it can measure about the
 * response and refuses to invent a band: no estimated score is produced, only a
 * verdict and the measured facts. Anything that *does* map onto writing,
 * speaking, grammar or vocabulary is dispatched to that service by
 * AssignmentEvaluationService instead of arriving here.
 */

const SOFT_MINIMUM_WORDS = 80;

export function evaluateAssignmentWithRiwi(input: AssignmentEvaluationInput): ProviderEvaluationOutput {
  const signals = analyseText(input.studentResponse);

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const nextActions: string[] = [];
  const issues: EvaluationIssue[] = signals.issues
    .slice(0, 8)
    .map((i) => ({
      category: i.category,
      message: i.message,
      excerpt: i.excerpt || null,
      suggestion: i.suggestion,
      severity: i.severity,
    }));

  const tooShort = signals.wordCount < SOFT_MINIMUM_WORDS;

  if (tooShort) {
    weaknesses.push(`The response is ${signals.wordCount} words; assignments here expect roughly ${SOFT_MINIMUM_WORDS}+.`);
    nextActions.push("Expand each point with a reason and one concrete example.");
    issues.push({
      category: "WRITING_LENGTH",
      message: `Short response: ${signals.wordCount} words.`,
      severity: signals.wordCount < 30 ? "high" : "medium",
      suggestion: "Aim for a developed answer rather than a list of headings.",
    });
  } else {
    strengths.push(`Developed response (${signals.wordCount} words).`);
  }

  if (signals.paragraphs.length > 1) {
    strengths.push(`${signals.paragraphs.length} paragraphs — the response is structured.`);
  } else if (signals.wordCount > 120) {
    weaknesses.push("One long block of text — split it into paragraphs.");
  }

  if (signals.linkerOccurrences === 0) {
    weaknesses.push("No cohesive devices — the reader has to infer the connection between points.");
  } else {
    strengths.push(`Uses ${signals.uniqueLinkers} distinct cohesive device(s).`);
  }

  const repeated = signals.topRepeatedContentWords[0];
  if (repeated && repeated.count >= 6) {
    weaknesses.push(`"${repeated.word}" repeated ${repeated.count} times.`);
  }

  const highSeverity = signalHighCount(signals.issues);
  if (highSeverity > 0) {
    weaknesses.push(`${highSeverity} grammatical error pattern(s) detected.`);
  }

  const verdict = tooShort
    ? "needs_correction"
    : issues.some((i) => i.severity === "high")
      ? "needs_correction"
      : issues.length > 0
        ? "mostly_correct"
        : "correct";

  const criteria: Criterion[] = [
    {
      key: "verdict",
      label:
        verdict === "correct"
          ? "Correct"
          : verdict === "mostly_correct"
            ? "Mostly correct"
            : "Needs correction",
      band: null,
      note: "RIWI reports measured facts for this assignment type, not a band score.",
    },
    {
      key: "development",
      label: "Development",
      band: null,
      note: `${signals.wordCount} words in ${signals.paragraphs.length} paragraph(s).`,
    },
    {
      key: "cohesion",
      label: "Cohesion",
      band: null,
      note: `${signals.uniqueLinkers} distinct cohesive device(s).`,
    },
  ];

  if (input.description === null) {
    nextActions.push("This assignment has no description — ask your teacher what the expected output is.");
  }

  return {
    overallEstimate: null,
    confidence: Math.round(Math.min(0.7, 0.3 + signals.wordCount / 400) * 100) / 100,
    criteria,
    strengths: strengths.slice(0, 5),
    weaknesses: weaknesses.slice(0, 5),
    issues: issues.slice(0, 8),
    nextActions:
      nextActions.length > 0
        ? nextActions.slice(0, 4)
        : ["Re-read your response once and cut anything that does not answer the assignment."],
    recommendedExercises: [
      {
        kind: "writing",
        label: "Practice task",
        href: "/app/writing",
        reason: "Structured writing practice feeds the same weakness tracking as this assignment.",
      },
    ],
    verdict,
  };
}

function signalHighCount(issues: { severity: string }[]): number {
  return issues.filter((i) => i.severity === "high").length;
}
