import type { Criterion, ProviderEvaluationOutput } from "../../schema";
import type { VocabularyEvaluationInput } from "../../types";
import { analyseText, containsWordForm, looksLikeCompleteSentence } from "./text";

/**
 * RIWI — Vocabulary in active use.
 *
 * The rule this service is built around: a sentence is NOT credited because the
 * target string appears in it. Local checks detect word form, completeness and
 * known-wrong patterns. Meaning and natural use remain unassessed, so these
 * checks cannot return the "correct" verdict that awards active-use credit.
 * Recognition and productive use remain separate deterministic signals.
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
    weaknesses.push("The short sentence limits local context checks.");
    nextActions.push("One full sentence with a subject, a verb and a reason is enough for the word to count as used.");
  } else if (!complete) {
    weaknesses.push("Sentence completeness could not be verified locally; this is not proof of a form error.");
  } else {
    strengths.push(`"${targetWord}" appears inside a complete sentence.`);
  }

  for (const [wrong, right, explanation] of WRONG_USAGE) {
    const match = sentence.match(new RegExp(`\\b${wrong.replaceAll(" ", "\\s+")}\\b`, "i"));
    if (!match) continue;
    issues.push({
      category: "VOCAB_COLLOCATION",
      message: `Collocation pattern: "${wrong}"`,
      excerpt: match[0],
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
        : "mostly_correct";

  if (critical || issues.length > 0) {
    nextActions.push("Rewrite the sentence once, fixing the point above, then submit again.");
  }
  nextActions.push("Meaning and natural use need a semantic check against the canonical definition; local word and sentence checks do not establish active-use mastery.");

  const criteria: Criterion[] = [
    {
      key: "verdict",
      label: verdict === "mostly_correct" ? "Mostly correct" : "Needs correction",
      band: null,
      note: used ? `Target word found (${signals.wordCount} words).` : "Target word not found.",
    },
    {
      key: "active_use",
      label: "Active use",
      band: null,
      limited: true,
      note: used ? "Word form found; intended meaning, natural use and authorship were not verified locally." : "Target word not found; active use not established.",
    },
    {
      key: "sentence_completeness",
      label: "Sentence completeness",
      band: null,
      limited: !complete,
      note: complete ? "Complete sentence." : "Sentence completeness could not be confirmed.",
    },
  ];

  return {
    overallEstimate: null,
    confidence: 0.6,
    criteria,
    strengths: strengths.slice(0, 4),
    weaknesses: weaknesses.slice(0, 4),
    issues: issues.slice(0, 8),
    nextActions: nextActions.slice(0, 4),
    recommendedExercises: [
      {
        kind: "vocabulary",
        label: "Review the due words",
        href: "/vocabulary/review",
        reason: "Recognition still has to be maintained while active use is practised.",
      },
    ],
    verdict,
  };
}
