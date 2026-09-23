import { toBand } from "@/lib/services/writing-evaluation/heuristics";
import type {
  Criterion,
  EvaluationIssue,
  ProviderEvaluationOutput,
  RecommendedExercise,
} from "../../schema";
import type { WritingEvaluationInput } from "../../types";
import { analyseText, type DetectedIssue } from "./text";

/**
 * RIWI — Writing.
 *
 * What this genuinely measures: length against the task target, paragraphing,
 * sentence-length profile, lexical variety and repetition, cohesive-device
 * usage (including mechanical overuse), and a set of pattern-level grammar
 * detectors. What it does *not* do: judge whether an argument is convincing,
 * whether examples are relevant, or whether the register suits the task. That
 * is why `confidence` never reaches 1.0 and why the result is always labelled
 * an estimate.
 */

const MIN_CONFIDENT_WORDS = 120;

function toIssues(detected: DetectedIssue[], limit = 8): EvaluationIssue[] {
  return detected.slice(0, limit).map((issue) => ({
    category: issue.category,
    message: issue.message,
    excerpt: issue.excerpt || null,
    suggestion: issue.suggestion,
    severity: issue.severity,
  }));
}

function bandToConfidence(wordCount: number, sentenceCount: number, taskType: "task1" | "task2"): number {
  // An estimate built on 60 words is not the same claim as one built on 250.
  const lengthFactor = Math.min(1, wordCount / MIN_CONFIDENT_WORDS);
  const sentenceFactor = Math.min(1, sentenceCount / 8);
  const base = 0.35 + 0.3 * lengthFactor + 0.15 * sentenceFactor;
  const ceiling = taskType === "task1" ? 0.85 : 0.8;
  return Math.round(Math.min(ceiling, base) * 100) / 100;
}

export function evaluateWritingWithRiwi(input: WritingEvaluationInput): ProviderEvaluationOutput {
  const { taskType, prompt, content, targetWordCount } = input;
  const signals = analyseText(content);
  const wordCount = signals.wordCount;
  const paragraphs = signals.paragraphs;
  const linkersPer100 = signals.linkersPer100Words;

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const nextActions: string[] = [];
  const recommendedExercises: RecommendedExercise[] = [];
  const issues: EvaluationIssue[] = [...toIssues(signals.issues.concat(signals.punctuationIssues as DetectedIssue[]))];

  const lengthRatio = targetWordCount > 0 ? wordCount / targetWordCount : 1;

  // --- Task response / achievement ---------------------------------------
  let taskRaw = 6.0;
  if (lengthRatio < 0.6) {
    taskRaw -= 2.0;
    weaknesses.push(`Well under the target length: ${wordCount} words against a ${targetWordCount}-word task.`);
    nextActions.push(`Write at least ${targetWordCount} words for this task type before submitting again.`);
    issues.push({
      category: "WRITING_LENGTH",
      message: `Under length: ${wordCount}/${targetWordCount} words.`,
      severity: "high",
      suggestion: "An under-length answer cannot reach the higher bands regardless of quality.",
    });
  } else if (lengthRatio < 0.9) {
    taskRaw -= 1.0;
    weaknesses.push(`Slightly under the target length (${wordCount}/${targetWordCount} words).`);
    issues.push({
      category: "WRITING_LENGTH",
      message: `Slightly under length: ${wordCount}/${targetWordCount} words.`,
      severity: "medium",
      suggestion: "Add one more developed example or explanation.",
    });
  } else if (wordCount >= targetWordCount) {
    taskRaw += 0.5;
    strengths.push(`Meets the word target (${wordCount} words).`);
  }

  if (taskType === "task2") {
    if (paragraphs.length < 4) {
      taskRaw -= 0.5;
      weaknesses.push(`Only ${paragraphs.length} paragraph(s); a Task 2 answer usually needs an introduction, two body paragraphs and a conclusion.`);
      issues.push({
        category: "WRITING_TASK_RESPONSE",
        message: `${paragraphs.length} paragraph(s) detected (blank-line separated).`,
        severity: "medium",
        suggestion: "Separate the introduction, two body paragraphs and the conclusion with blank lines.",
      });
    } else {
      strengths.push("Clear four-part paragraph structure.");
    }

    const firstParagraph = (paragraphs[0] ?? "").toLowerCase();
    const POSITION_MARKERS = [
      "i believe", "i think", "in my opinion", "i agree", "i disagree", "this essay",
      "it will be argued", "i would argue", "personally",
    ];
    const hasPosition = POSITION_MARKERS.some((marker) => firstParagraph.includes(marker));
    if (!hasPosition) {
      taskRaw -= 0.5;
      weaknesses.push("No clear position detected in the introduction.");
      issues.push({
        category: "WRITING_TASK_RESPONSE",
        message: "The opening paragraph does not state a position.",
        severity: "high",
        suggestion: 'State your view explicitly, e.g. "I believe that …" or "This essay will argue that …".',
      });
      nextActions.push("Rewrite the introduction so the examiner can find your position in the first two sentences.");
    } else {
      strengths.push("The introduction states a position.");
    }
  } else {
    // Task 1: an overview is a scored requirement.
    const OVERVIEW_MARKERS = [
      "overall", "in general", "in summary", "generally speaking", "it is clear that",
      "it can be seen that", "in conclusion",
    ];
    const hasOverview = OVERVIEW_MARKERS.some((marker) => signals.lower.includes(marker));
    if (!hasOverview) {
      taskRaw -= 1.0;
      weaknesses.push("No overview sentence detected — Task 1 requires an overall summary of the main trends.");
      issues.push({
        category: "WRITING_TASK_RESPONSE",
        message: "No overview marker found (\"Overall, …\").",
        severity: "high",
        suggestion: "Add an overview paragraph naming the main trends without quoting every figure.",
      });
      nextActions.push("Write a two-sentence overview that names the biggest differences and the general trend.");
    } else {
      strengths.push("Includes an overview of the main trends.");
    }

    const hasData = /\d/.test(content) || /\b(percent|percentage|proportion|twice|half|third|quarter|increase|decrease|rise|fall|higher|lower|double)\b/i.test(content);
    if (!hasData) {
      taskRaw -= 0.5;
      weaknesses.push("Few or no figures/comparative language detected — Task 1 is scored on selecting and reporting key features.");
      issues.push({
        category: "WRITING_TASK_RESPONSE",
        message: "No figures or comparative language detected.",
        severity: "medium",
        suggestion: "Support each claim with a figure or an explicit comparison.",
      });
    }

    if (/^\s*[^.]*\b(in this graph|in this chart|i can see|the graph shows us)\b/i.test(content)) {
      weaknesses.push("Wording such as \"in this graph\" or \"I can see\" is not needed — describe the data directly.");
    }
  }

  // --- Coherence and cohesion --------------------------------------------
  let coherenceRaw = 6.0;
  if (signals.linkerOccurrences === 0) {
    coherenceRaw -= 1.5;
    weaknesses.push("No cohesive devices detected — the reader has to infer how the ideas connect.");
    nextActions.push('Add linking phrases such as "however", "in contrast" and "as a result" where the logic turns.');
    recommendedExercises.push({
      kind: "grammar",
      label: "Cohesive devices",
      href: "/grammar",
      reason: "Practise the linking patterns you are missing.",
    });
  } else {
    coherenceRaw += Math.min(1.0, signals.uniqueLinkers * 0.2);
    if (signals.uniqueLinkers >= 3) strengths.push(`Uses ${signals.uniqueLinkers} different cohesive devices.`);
  }
  if (linkersPer100 > 8) {
    coherenceRaw -= 0.5;
    weaknesses.push("Cohesive devices are used very densely — over-linking reads as mechanical.");
    issues.push({
      category: "WRITING_COHESION",
      message: `${linkersPer100.toFixed(1)} linking words per 100 words.`,
      severity: "medium",
      suggestion: "Keep the connectors that mark a real turn in the argument and cut the rest.",
    });
  }
  if (taskType === "task2" && paragraphs.length >= 4 && signals.wordCount > 0) {
    const bodyParagraphs = paragraphs.slice(1, -1);
    if (bodyParagraphs.length >= 2) {
      const shortBody = bodyParagraphs.filter((p) => signals.words.length > 0 && p.split(/\s+/).length < 35);
      if (shortBody.length > 0) {
        coherenceRaw -= 0.5;
        weaknesses.push("At least one body paragraph is very short — the idea is stated but not developed.");
      } else {
        strengths.push("Body paragraphs are developed rather than listed.");
      }
    }
  }

  // --- Lexical resource ---------------------------------------------------
  let lexicalRaw = 5.5 + signals.typeTokenRatioOnContentWords * 4;
  if (signals.topRepeatedContentWords.length > 0 && signals.topRepeatedContentWords[0]!.count >= 6) {
    lexicalRaw -= 0.5;
    const worst = signals.topRepeatedContentWords[0]!;
    weaknesses.push(`Heavy repetition of "${worst.word}" (${worst.count} times).`);
    issues.push({
      category: "WRITING_LEXICAL_REPETITION",
      message: `"${worst.word}" appears ${worst.count} times.`,
      severity: "medium",
      suggestion: "Build a small synonym set for this word and alternate.",
    });
    recommendedExercises.push({
      kind: "vocabulary",
      label: `Replace repeated "${worst.word}"`,
      href: "/vocabulary",
      reason: "Lexical repetition is the fastest band-limited quick win at this stage.",
    });
  }
  if (signals.typeTokenRatioOnContentWords >= 0.6 && wordCount >= 120) {
    lexicalRaw += 0.5;
    strengths.push("Good variety among content words.");
  }
  if (signals.repeatedBigrams.length > 0) {
    lexicalRaw -= 0.25;
    weaknesses.push(`Repeated phrasing detected: "${signals.repeatedBigrams[0]!.word}".`);
  }

  // --- Grammatical range and accuracy ------------------------------------
  let grammarRaw = 6.0;
  const highSeverity = signals.issues.filter((i) => i.severity === "high").length;
  if (highSeverity > 0) {
    grammarRaw -= Math.min(1.5, highSeverity * 0.5);
    weaknesses.push(`${highSeverity} clear grammatical error pattern(s) detected (agreement, tense or form).`);
  }
  if (signals.avgSentenceWords > 0 && signals.avgSentenceWords < 8) {
    grammarRaw -= 0.5;
    weaknesses.push("Sentences are short and simple on average — few complex structures are attempted.");
    nextActions.push("Combine two related short sentences into one complex sentence using although / because / while.");
  } else if (signals.avgSentenceWords >= 12) {
    grammarRaw += 0.5;
    strengths.push("Sentences are long enough to attempt complex structures.");
  }
  if (signals.sentenceLengthStdDev > 0 && signals.sentenceLengthStdDev < 3 && signals.sentenceCount >= 4) {
    grammarRaw -= 0.5;
    weaknesses.push("Sentence lengths are uniform — vary short and long sentences for emphasis.");
  }
  if (signals.longSentences.length > 0) {
    grammarRaw -= 0.25;
    weaknesses.push("At least one sentence runs past 35 words — check for a comma splice or a lost main verb.");
  }

  const criteria: Criterion[] = [
    {
      key: taskType === "task1" ? "task_achievement" : "task_response",
      label: taskType === "task1" ? "Task Achievement" : "Task Response",
      band: toBand(taskRaw),
      note: `${wordCount} words against a ${targetWordCount}-word target.`,
    },
    {
      key: "coherence",
      label: "Coherence and Cohesion",
      band: toBand(coherenceRaw),
      note: `${paragraphs.length} paragraph(s), ${signals.uniqueLinkers} distinct cohesive devices.`,
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
      note: `Average sentence ${signals.avgSentenceWords.toFixed(1)} words; ${signals.issues.length} pattern-level issue(s).`,
    },
  ];

  const overallEstimate = toBand(
    criteria.reduce((sum, c) => sum + (c.band ?? 6), 0) / criteria.length
  );

  if (strengths.length === 0) {
    strengths.push("You produced a full attempt under task conditions — that repetition is what moves the real score.");
  }
  if (weaknesses.length === 0) {
    weaknesses.push("No structural problems detected by the pattern checks RIWI runs.");
  }
  if (nextActions.length === 0) {
    nextActions.push("Rewrite this answer once, fixing the two weakest criteria above, then compare the two drafts.");
  }

  // The prompt text is part of the evaluation request but RIWI cannot verify
  // relevance beyond the length and structure checks above; saying so here is
  // more useful than implying semantic matching.
  if (prompt.length === 0) {
    nextActions.push("Attach the task prompt next time — without it, relevance cannot be checked at all.");
  }

  return {
    overallEstimate,
    confidence: bandToConfidence(wordCount, signals.sentenceCount, taskType),
    criteria,
    strengths: strengths.slice(0, 6),
    weaknesses: weaknesses.slice(0, 6),
    issues: issues.slice(0, 12),
    nextActions: nextActions.slice(0, 5),
    recommendedExercises: recommendedExercises.slice(0, 4),
    verdict: null,
  };
}
