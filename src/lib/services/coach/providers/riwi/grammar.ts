import type { Criterion, ProviderEvaluationOutput } from "../../schema";
import type { GrammarEvaluationInput } from "../../types";
import {
  analyseText,
  containsWordForm,
  looksLikeCompleteSentence,
  verdictFromIssues,
  type DetectedIssue,
} from "./text";

/**
 * RIWI — Grammar production.
 *
 * A correct answer does not have to be the sample answer, so nothing here
 * compares whole strings. What is checked: whether the target structure is
 * actually present in the student's sentence, whether the sentence is
 * complete (subject, finite verb, capital letter, terminal punctuation), and
 * whether the pattern detectors fire inside the produced sentence.
 *
 * There is no band: a grammar item is graded as correct / mostly correct /
 * needs correction, which is what a learner can act on.
 */
export function evaluateGrammarWithRiwi(input: GrammarEvaluationInput): ProviderEvaluationOutput {
  const { promptText, studentAnswer, targetStructure, sampleAnswer } = input;
  const signals = analyseText(studentAnswer);
  const sentence = studentAnswer.trim();

  const issues: DetectedIssue[] = [...signals.issues, ...signals.punctuationIssues];
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const nextActions: string[] = [];

  const isComplete = looksLikeCompleteSentence(sentence);
  const tooShort = signals.wordCount < 4;
  /**
   * Many grammar items are answered with a phrase rather than a sentence
   * ("does not go"). Demanding sentence completeness for a five-word answer
   * would mark the item's own sample answer wrong, so the completeness
   * requirement only applies once the answer is long enough to be a sentence.
   */
  const expectsSentence = signals.wordCount > 6;

  let critical = false;

  if (tooShort) {
    critical = true;
    weaknesses.push("The answer is too short to show the structure in use.");
    nextActions.push("Write one full sentence — a full sentence is what proves the structure is under control.");
  } else if (expectsSentence && !isComplete) {
    critical = true;
    weaknesses.push("The sentence looks incomplete (missing capital letter, finite verb or terminal punctuation).");
    nextActions.push("Check three things: capital letter, a finite verb, and a full stop at the end.");
  } else if (isComplete) {
    strengths.push("Complete sentence with a subject and a finite verb.");
  } else {
    strengths.push("Phrase-level answer, which is accepted for this kind of item.");
  }

  // Target structure: structural words from the prompt (do/does/wh-words,
  // auxiliaries, prepositions) plus the explicit target label are looked for in
  // the produced sentence. Absent that, the answer is only compared loosely.
  const structuralTokens = promptText
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && ["does", "do", "did", "is", "are", "was", "were", "has", "have", "had", "the", "a", "an", "to", "of", "in", "on", "at", "not", "will", "would"].includes(w));

  let structurePresent = true;
  if (structuralTokens.length > 0) {
    const missing = structuralTokens.filter((token) => !containsWordForm(signals.lower, token));
    // At least one key structural token has to appear, otherwise the student
    // answered something unrelated to the item.
    structurePresent = missing.length < structuralTokens.length;
    if (!structurePresent) {
      critical = true;
      weaknesses.push("The expected structure does not appear in the answer.");
      nextActions.push("Rebuild the sentence around the structure shown in the explanation.");
    }
  }

  if (sampleAnswer) {
    const overlap = signals.contentWords.filter((w) => sampleAnswer.toLowerCase().includes(w));
    if (overlap.length === 0 && structurePresent) {
      // Not an error — a rewrite can legitimately share no vocabulary. It only
      // lowers RIWI's confidence, and the note says exactly that.
      weaknesses.push("Your wording shares almost no vocabulary with the sample answer — that is allowed, but it makes the structure harder to verify automatically.");
    }
  }

  const meaningful = issues.filter((i) => !(tooShort || (expectsSentence && !isComplete)));
  const verdict = verdictFromIssues(meaningful, critical);

  const limitingSignals: string[] = [
    "Target structure present in the produced sentence.",
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
      note: isComplete
        ? "Subject and finite verb present."
        : expectsSentence
          ? "Could not confirm a subject + finite verb."
          : "Short answer: judged on the target structure only.",
    },
    {
      key: "target_structure",
      label: targetStructure ? `Target: ${targetStructure}` : "Target structure",
      band: null,
      note: structurePresent
        ? "The expected structure appears in your sentence."
        : "The expected structure was not found.",
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
        href: "/app/grammar",
        reason: "Same structure, different content, immediately after the correction.",
      },
    ],
    verdict,
  };
}
