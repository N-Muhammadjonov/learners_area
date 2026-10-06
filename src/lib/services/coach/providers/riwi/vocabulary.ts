import type { Criterion, ProviderEvaluationOutput } from "../../schema";
import type { VocabularyEvaluationInput } from "../../types";
import { analyseText, containsWordForm, looksLikeCompleteSentence } from "./text";

/**
 * RIWI — Vocabulary in active use.
 *
 * The rule this service is built around: a sentence is NOT credited because the
 * target string appears in it. The target has to be used as a word in a
 * complete sentence, in a plausible form, and without a known-wrong pattern
 * attached to it. Recognition (the review queue) and active use (this) stay
 * separate signals and are stored separately.
 */

/** Wrong patterns attached to particular words, checked as strings. */
const WRONG_USAGE: [string, string, string][] = [
  ["discuss about", "discuss", "discuss takes a direct object: discuss the issue"],
  ["depend of", "depend on", "depend ON something"],
  ["married with", "married to", "married TO someone"],
  ["arrive to", "arrive at", "arrive AT / IN a place"],
  ["interested for", "interested in", "interested IN something"],
  ["good in", "good at", "good AT a skill"],
  ["afraid from", "afraid of", "afraid OF something"],
  ["explain about", "explain", "explain takes a direct object"],
  ["suggest me", "suggest to me", "suggest something TO someone"],
];

export function evaluateVocabularyWithRiwi(input: VocabularyEvaluationInput): ProviderEvaluationOutput {
  const { targetWord, definition, studentSentence } = input;
  const sentence = studentSentence.trim();
  const signals = analyseText(sentence);

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const nextActions: string[] = [];
  const issues: ProviderEvaluationOutput["issues"] = [];

  const used = containsWordForm(sentence, targetWord);
  const exact = sentence.toLowerCase().includes(targetWord.toLowerCase().trim());
  const complete = looksLikeCompleteSentence(sentence);
  const tooShort = signals.wordCount < 4;

  let critical = false;

  if (!used) {
    critical = true;
    weaknesses.push(`"${targetWord}" does not appear in the sentence.`);
    issues.push({
      category: "VOCAB_NOT_USED",
      message: "Target word missing.",
      severity: "high",
      suggestion: `Write a new sentence that contains "${targetWord}" with a real meaning.`,
    });
    nextActions.push(`Re-read the definition (${definition}) and produce one sentence of your own.`);
  } else if (tooShort) {
    critical = true;
    weaknesses.push("The sentence is too short to show the word in use.");
    nextActions.push("One full sentence with a subject, a verb and a reason is enough for the word to count as used.");
  } else if (!complete) {
    critical = true;
    weaknesses.push("The word appears, but not inside a complete sentence.");
    issues.push({
      category: "VOCAB_WRONG_FORM",
      message: "Incomplete sentence around the target word.",
      severity: "medium",
      suggestion: "Add a finite verb and finish the sentence with a full stop.",
    });
  } else {
    strengths.push(`"${targetWord}" is used inside a complete sentence.`);
  }

  if (used && !exact) {
    strengths.push("Used in an inflected form rather than copied verbatim — that is real active use.");
  }
  if (used && exact && signals.wordCount <= 6) {
    // Copying the example sentence is not active use.
    weaknesses.push("The sentence is very close to a copied phrase — try to express something of your own.");
  }

  for (const [wrong, right, explanation] of WRONG_USAGE) {
    if (!signals.lower.includes(wrong)) continue;
    issues.push({
      category: "VOCAB_COLLOCATION",
      message: `Collocation pattern: "${wrong}"`,
      severity: "medium",
      suggestion: `${explanation} — try "${right}".`,
    });
    weaknesses.push(`"${wrong}" is not the accepted pattern — ${explanation}.`);
  }

  const grammarIssues = signals.issues.filter((i) => i.severity !== "low");
  for (const issue of grammarIssues.slice(0, 3)) {
    issues.push({
      category: issue.category,
      message: issue.message,
      excerpt: issue.excerpt || null,
      suggestion: issue.suggestion,
      severity: issue.severity,
    });
  }

  const verdict = critical
    ? "needs_correction"
    : issues.some((i) => i.severity === "high")
      ? "needs_correction"
      : issues.length > 0
        ? "mostly_correct"
        : "correct";

  if (verdict === "correct") {
    nextActions.push("Use the same word in tomorrow's writing task to push it from recognition into active use.");
  } else {
    nextActions.push("Rewrite the sentence once, fixing the point above, then submit again.");
  }

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
      note: used ? `Target word found (${signals.wordCount} words).` : "Target word not found.",
    },
    {
      key: "active_use",
      label: "Active use",
      band: null,
      note: used ? "The word appears in the student's own sentence." : "Recognition only — not yet used.",
    },
    {
      key: "sentence_completeness",
      label: "Sentence completeness",
      band: null,
      note: complete ? "Complete sentence." : "Sentence completeness could not be confirmed.",
    },
  ];

  return {
    overallEstimate: null,
    confidence: verdict === "correct" ? 0.65 : 0.6,
    criteria,
    strengths: strengths.slice(0, 4),
    weaknesses: weaknesses.slice(0, 4),
    issues: issues.slice(0, 8),
    nextActions: nextActions.slice(0, 4),
    recommendedExercises: [
      {
        kind: "vocabulary",
        label: "Review the due words",
        href: "/app/vocabulary/review",
        reason: "Recognition still has to be maintained while active use is practised.",
      },
    ],
    verdict,
  };
}
