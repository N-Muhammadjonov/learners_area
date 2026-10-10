import type { Criterion, ProviderEvaluationOutput } from "../../schema";
import type { GrammarEvaluationInput } from "../../types";
import {
  analyseText,
  looksLikeCompleteSentence,
  verdictFromIssues,
  type DetectedIssue,
} from "./text";

/**
 * RIWI — Grammar production.
 *
 * Inspect sentence form and known error patterns. An exact authored reference
 * is one accepted answer. Other valid constructions need a semantic check;
 * topic names and prompt tokens cannot prove the target structure or meaning.
 *
 * There is no band: a grammar item is graded as correct / mostly correct /
 * needs correction, which is what a learner can act on.
 */
export function evaluateGrammarWithRiwi(input: GrammarEvaluationInput): ProviderEvaluationOutput {
  const { studentAnswer, targetStructure, sampleAnswer } = input;
  const signals = analyseText(studentAnswer);
  const sentence = studentAnswer.trim();
  const referenceMatch = Boolean(sampleAnswer?.trim() && sentence === sampleAnswer.trim());
  const referencePhrase = referenceMatch && signals.wordCount <= 6;
  const issues: DetectedIssue[] = [...signals.issues, ...(referencePhrase ? [] : signals.punctuationIssues)];
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const nextActions: string[] = [];

  const isComplete = looksLikeCompleteSentence(sentence);
  const tooShort = signals.wordCount < 4 && !referenceMatch;
  /**
   * Many grammar items are answered with a phrase rather than a sentence
   * ("does not go"). Demanding sentence completeness for a five-word answer
   * would mark the item's own sample answer wrong, so the completeness
   * requirement only applies once the answer is long enough to be a sentence.
   */
  const expectsSentence = signals.wordCount > 6;

  if (tooShort) {
    weaknesses.push("The short answer limits local checks of the target structure.");
    nextActions.push("Write one full sentence so the structure can be checked in context.");
  } else if (expectsSentence && !isComplete) {
    weaknesses.push("Sentence completeness could not be verified locally.");
    nextActions.push("Check three things: capital letter, a finite verb, and a full stop at the end.");
  } else if (isComplete) {
    strengths.push("Complete sentence with a subject and a finite verb.");
  } else {
    strengths.push("Phrase-level answer; sentence completeness was not confirmed.");
  }

  // Prompt keywords and a free-text topic name cannot prove correct structure
  // or meaning. A reference match is one accepted answer, never the only one.
  if (!referenceMatch) nextActions.push("The target structure and intended meaning need a semantic check; local checks only inspect sentence form and known error patterns.");

  const detectedVerdict = verdictFromIssues(issues, false);
  const verdict = detectedVerdict === "correct" && !referenceMatch ? "mostly_correct" : detectedVerdict;

  const limitingSignals: string[] = [
    referenceMatch ? "Matches the authored reference answer." : "Target structure and meaning not verified by local checks.",
    `${signals.wordCount} words, ${signals.sentenceCount} sentence(s).`,
  ];
  if (expectsSentence && !isComplete && !tooShort) limitingSignals.push("Completeness check failed.");

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
      note: limitingSignals.join(" "),
    },
    {
      key: "sentence_completeness",
      label: "Sentence completeness",
      band: null,
      limited: !isComplete && !referenceMatch,
      note: isComplete
        ? "Subject and finite verb present."
        : expectsSentence
          ? "Could not confirm a subject + finite verb; this is not proof of an error."
          : "Short answer: sentence completeness was not assessed.",
    },
    {
      key: "target_structure",
      label: targetStructure ? `Target: ${targetStructure}` : "Target structure",
      band: null,
      limited: !referenceMatch,
      note: referenceMatch
        ? "Matches the authored reference answer; other valid answers are also possible."
        : "The target structure and intended meaning were not assessed locally.",
    },
  ];

  if (issues.length > 0) {
    weaknesses.push(...issues.map((i) => i.message).slice(0, 4));
  }

  return {
    overallEstimate: null,
    // Confidence reflects how much of a four-word sentence can honestly be judged.
    confidence:
      verdict === "correct"
        ? Math.min(0.8, 0.4 + signals.wordCount * 0.02)
        : Math.min(0.85, 0.5 + signals.wordCount * 0.02),
    criteria,
    strengths: strengths.slice(0, 4),
    weaknesses: weaknesses.slice(0, 5),
    issues: issues.slice(0, 8).map((i) => ({
      category: i.category,
      message: i.message,
      excerpt: i.excerpt || null,
      suggestion: i.suggestion,
      severity: i.severity,
    })),
    nextActions:
      nextActions.length > 0
        ? nextActions.slice(0, 4)
        : ["Use the structure again in a sentence about your own life — that is what moves it into active use."],
    recommendedExercises: [
      {
        kind: "grammar",
        label: "Another item on this topic",
        href: "/grammar",
        reason: "Same structure, different content, immediately after the correction.",
      },
    ],
    verdict,
  };
}
