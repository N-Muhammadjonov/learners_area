import { toBand } from "@/lib/services/writing-evaluation/heuristics";
import type {
  Criterion,
  EvaluationIssue,
  ProviderEvaluationOutput,
  RecommendedExercise,
} from "../../schema";
import type { SpeakingEvaluationInput } from "../../types";
import { analyseText, type DetectedIssue } from "./text";
import { notAssessedPronunciationCriterion } from "../../pronunciation";

/**
 * RIWI — Speaking.
 *
 * Everything here is derived from the transcript plus the recording duration.
 * That means:
 *   - Fluency, lexical resource and grammar get a genuine, measured estimate.
 *   - Pronunciation gets NO estimate. Judging pronunciation from text is not
 *     possible, so the criterion is returned as `limited` with a null band and
 *     an explicit note. A fabricated pronunciation score is exactly the kind of
 *     output this project refuses to produce.
 *
 * Pausing, intonation and stress also need audio analysis RIWI does not have;
 * the fluency note says the metric comes from duration and word count only.
 */

const MIN_WORDS: Record<SpeakingEvaluationInput["part"], number> = {
  part1: 40,
  part2: 150,
  part3: 60,
  general: 80,
  mock: 120,
};

export function evaluateSpeakingWithRiwi(input: SpeakingEvaluationInput): ProviderEvaluationOutput {
  const { transcript, durationMs, part, promptText } = input;

  if (!transcript || transcript.trim().length === 0) {
    // No transcript, no evaluation. The service checks this first; this is a
    // second line of defence so a provider can never invent one.
    throw new Error("riwi_speaking_requires_transcript");
  }

  const signals = analyseText(transcript);
  const wordCount = signals.wordCount;
  const minimumWords = MIN_WORDS[part];
  /**
   * The learner corrected the transcript before sending it. Declared up front
   * because every rate-derived signal below has to say so: what was measured is
   * the edited text, not the original recognition and not the audio itself.
   */
  const edited = input.transcriptEdited === true;

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const nextActions: string[] = [];
  const recommendedExercises: RecommendedExercise[] = [];
  const issues: EvaluationIssue[] = [
    ...signals.issues.map((i: DetectedIssue) => ({
      category: i.category,
      message: i.message,
      excerpt: i.excerpt || null,
      suggestion: i.suggestion,
      severity: i.severity,
    })),
  ];

  const durationSeconds = durationMs && durationMs > 0 ? durationMs / 1000 : null;
  const wordsPerMinute = durationSeconds ? (wordCount / durationSeconds) * 60 : null;

  // --- Fluency and coherence ---------------------------------------------
  const fluencyNotes: string[] = [];
  let fluencyRaw = 6.0;

  if (durationSeconds === null) {
    fluencyNotes.push("No recording duration was supplied, so the speaking rate could not be measured.");
    fluencyRaw -= 0.5;
  } else if (wordsPerMinute !== null) {
    // Word count comes from the transcript; when the learner edited it, the rate
    // is derived from their corrected wording, and the note says so rather than
    // implying the audio was measured word by word.
    fluencyNotes.push(
      `~${Math.round(wordsPerMinute)} words per minute over ${Math.round(durationSeconds)}s` +
      `${edited ? ", counted from your edited transcript" : ""}.`,
    );
    if (wordsPerMinute < 90) {
      fluencyRaw -= 1.0;
      weaknesses.push(`Speaking rate of about ${Math.round(wordsPerMinute)} words per minute is slow — hesitation is likely to be audible.`);
      issues.push({
        category: "SPEAKING_FLUENCY",
        message: `Slow delivery: ~${Math.round(wordsPerMinute)} wpm.`,
        severity: "medium",
        suggestion: "Practise the same answer twice, aiming for a steady 110–150 words per minute.",
      });
    } else if (wordsPerMinute > 200) {
      fluencyRaw -= 0.5;
      weaknesses.push(`Speaking rate of about ${Math.round(wordsPerMinute)} words per minute is very fast — clarity may suffer.`);
    } else {
      fluencyRaw += 0.5;
      strengths.push("Delivery rate sits in the comfortable range (roughly 110–150 words per minute).");
    }
  }

  if (signals.hesitationCount > 0) {
    const rate = signals.hesitationRate;
    fluencyRaw -= Math.min(1.5, rate / 2);
    weaknesses.push(`${signals.hesitationCount} hesitation sound(s) detected (${rate.toFixed(1)} per 100 words).`);
    issues.push({
      category: "SPEAKING_FILLERS",
      message: `${signals.hesitationCount} hesitation sound(s) transcribed.`,
      severity: rate > 4 ? "high" : "medium",
      suggestion: "Replace the filler with a one-second pause — silence reads as control, fillers read as hesitation.",
    });
    recommendedExercises.push({
      kind: "speaking",
      label: "Filler-free 30-second answers",
      href: "/speaking/practice",
      reason: "Recording the same prompt twice is the fastest fix for hesitation.",
    });
  } else {
    strengths.push("No hesitation sounds transcribed.");
  }

  if (signals.vaguePhraseCount > 2) {
    fluencyRaw -= 0.25;
    weaknesses.push(`${signals.vaguePhraseCount} vague phrase(s) such as "kind of" or "you know" — these dilute a formal answer.`);
  }

  if (signals.discourseMarkers.length === 0) {
    fluencyRaw -= 0.5;
    weaknesses.push("No discourse markers — the answer reads as a list rather than a developed response.");
    nextActions.push('Structure the answer out loud: "First…", "On the other hand…", "So overall…".');
  } else {
    strengths.push(`Signposts the answer with ${signals.discourseMarkers.length} discourse marker(s).`);
  }

  if (wordCount < minimumWords) {
    fluencyRaw -= 1.0;
    weaknesses.push(`Only ${wordCount} words; this part expects at least about ${minimumWords}.`);
    issues.push({
      category: "SPEAKING_SHORT_RESPONSE",
      message: `Short answer: ${wordCount} words (target ≈ ${minimumWords}).`,
      severity: "high",
      suggestion: "Develop each point with a reason and a concrete example before moving on.",
    });
    recommendedExercises.push({
      kind: "speaking",
      label: `Extend answers to ${minimumWords}+ words`,
      href: "/speaking/practice",
      reason: "Answer length is the most common ceiling on the fluency band.",
    });
  } else {
    strengths.push(`Answer length (${wordCount} words) fits the expectations for this part.`);
  }

  // --- Lexical resource ---------------------------------------------------
  let lexicalRaw = 5.5 + signals.typeTokenRatioOnContentWords * 4;
  if (signals.topRepeatedContentWords.length > 0 && signals.topRepeatedContentWords[0]!.count >= 5) {
    const worst = signals.topRepeatedContentWords[0]!;
    lexicalRaw -= 0.5;
    weaknesses.push(`"${worst.word}" repeated ${worst.count} times.`);
    issues.push({
      category: "SPEAKING_REPETITION",
      message: `Repeated word: "${worst.word}" (${worst.count}×).`,
      severity: "medium",
      suggestion: "Prepare two alternatives for this word and use them next time.",
    });
  }
  if (signals.typeTokenRatioOnContentWords >= 0.55 && wordCount >= 60) {
    lexicalRaw += 0.5;
    strengths.push("Varied vocabulary across the answer.");
  }

  // --- Grammatical range and accuracy ------------------------------------
  let grammarRaw = 6.0;
  const highSeverity = signals.issues.filter((i) => i.severity === "high").length;
  if (highSeverity > 0) {
    grammarRaw -= Math.min(1.5, highSeverity * 0.5);
    weaknesses.push(`${highSeverity} grammatical error pattern(s) detected in the transcript.`);
  }
  if (signals.shortSentences.length > 2) {
    grammarRaw -= 0.5;
    weaknesses.push("Many very short clauses — try one subordinating structure per answer.");
  }
  if (signals.avgSentenceWords >= 12) {
    grammarRaw += 0.5;
    strengths.push("Attempts complex structures rather than isolated short clauses.");
  }

  const criteria: Criterion[] = [
    {
      key: "fluency",
      label: "Fluency and Coherence",
      band: toBand(fluencyRaw),
      note: fluencyNotes.join(" "),
    },
    {
      key: "lexical",
      label: "Lexical Resource",
      band: toBand(lexicalRaw),
      note: `Content-word variety ${(signals.typeTokenRatioOnContentWords * 100).toFixed(0)}%.`,
    },
    {
      key: "grammar",
      label: "Grammatical Range and Accuracy",
      band: toBand(grammarRaw),
      note: `${signals.issues.length} pattern-level issue(s) in the transcript.`,
    },
    // One wording, one decision — shared with every other evaluator through
    // PronunciationEvaluationService.
    notAssessedPronunciationCriterion(),
  ];

  const measurable = criteria.filter((c) => c.band !== null);
  const overallEstimate =
    measurable.length === 0
      ? null
      : toBand(measurable.reduce((sum, c) => sum + (c.band ?? 6), 0) / measurable.length);

  // Confidence is capped below the writing ceiling: pronunciation is missing
  // from the estimate, and transcript origin matters.
  //
  // Origin ordering reflects how closely the text tracks the audio, not how much
  // we trust the learner:
  //   stt         a server transcriber worked on the actual recording
  //   browser_stt the learner's browser recognised the actual recording, then the
  //               learner reviewed it — real speech, but user-side and editable
  //   manual      typed from memory, so it may not match the recording at all
  let confidence = 0.3 + 0.3 * Math.min(1, wordCount / 150);
  if (durationMs) confidence += 0.1;
  if (input.transcriptOrigin === "stt") confidence += 0.1;
  if (input.transcriptOrigin === "browser_stt") confidence += 0.05;
  if (input.transcriptOrigin === "manual") confidence -= 0.05;
  // An edited transcript is the learner's corrected text. That is exactly what
  // should be judged, but it can diverge from the audio, so rate-derived signals
  // (words per minute) are slightly less certain than an untouched transcript.
  if (edited) confidence -= 0.05;
  if (!input.pronunciationAvailable) confidence -= 0.05;
  confidence = Math.round(Math.min(0.72, Math.max(0.15, confidence)) * 100) / 100;

  if (input.transcriptOrigin === "manual") {
    nextActions.push("This transcript was typed by you, not transcribed from the audio — check it against your recording before acting on the details.");
  }
  if (edited) {
    // §14: the evaluation saw the CORRECTED text. Nothing below may be reported
    // as evidence of what was actually said, and no wording here claims it was.
    nextActions.push("You edited this transcript before sending it, so the feedback describes the corrected text — not necessarily the exact words in your recording.");
  }
  if (promptText) {
    recommendedExercises.push({
      kind: "speaking",
      label: "Repeat this same prompt one week later",
      href: "/speaking/history",
      reason: "Comparing two recordings of the same topic makes progress visible.",
    });
  }
  if (nextActions.length === 0) {
    nextActions.push("Record one more take of the same prompt and compare the two transcripts side by side.");
  }
  if (strengths.length === 0) {
    strengths.push("A complete recorded attempt is the raw material every speaking improvement is built from.");
  }
  if (weaknesses.length === 0) {
    weaknesses.push("No structural problems detected in the transcript patterns RIWI checks.");
  }

  return {
    overallEstimate,
    confidence,
    criteria,
    strengths: strengths.slice(0, 6),
    weaknesses: weaknesses.slice(0, 6),
    issues: issues.slice(0, 12),
    nextActions: nextActions.slice(0, 5),
    recommendedExercises: recommendedExercises.slice(0, 4),
    verdict: null,
  };
}
