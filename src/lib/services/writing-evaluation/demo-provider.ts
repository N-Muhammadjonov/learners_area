import type { EvaluationInput, EvaluationResult, WritingEvaluationService } from "./types";
import {
  averageSentenceLength,
  countWords,
  lexicalDiversity,
  linkingWordCount,
  splitParagraphs,
  toBand,
} from "./heuristics";

/**
 * DEMO PROVIDER — not a real AI evaluator.
 *
 * This is a transparent, deterministic heuristic (word count, sentence
 * length, lexical variety, linking-word usage, paragraphing) standing in
 * for the WritingEvaluationService interface. It exists so the full
 * submit -> evaluate -> feedback -> history loop is real and testable
 * end to end. Swap this file for a real model call behind the same
 * interface once REAL_AI_ENABLED is turned on — nothing else in the app
 * needs to change.
 */
export class DemoWritingEvaluationProvider implements WritingEvaluationService {
  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const { content, targetWordCount } = input;
    const wordCount = countWords(content);
    const paragraphs = splitParagraphs(content);
    const avgSentenceLen = averageSentenceLength(content);
    const diversity = lexicalDiversity(content);
    const linkers = linkingWordCount(content);

    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const suggestions: string[] = [];

    // --- Task response ---------------------------------------------------
    const lengthRatio = targetWordCount > 0 ? wordCount / targetWordCount : 1;
    let taskResponseRaw = 6.5;
    if (lengthRatio < 0.8) {
      taskResponseRaw -= 1.5;
      weaknesses.push(`Under the target length (${wordCount}/${targetWordCount} words).`);
      suggestions.push("Develop your ideas further to comfortably clear the word target.");
    } else if (lengthRatio >= 1) {
      taskResponseRaw += 0.5;
      strengths.push("Meets the word-count target.");
    }
    if (paragraphs.length < 4 && input.taskType === "task2") {
      taskResponseRaw -= 0.5;
      weaknesses.push("Fewer than four paragraphs — an introduction, two body paragraphs and a conclusion are expected.");
    } else if (input.taskType === "task2") {
      strengths.push("Clear paragraph structure.");
    }

    // --- Coherence & cohesion --------------------------------------------
    let coherenceRaw = 6.0 + Math.min(1.5, linkers * 0.25);
    if (linkers === 0) {
      weaknesses.push("No linking words detected — ideas may read as disconnected.");
      suggestions.push('Add cohesive devices such as "however", "in contrast" or "as a result".');
    } else {
      strengths.push("Uses cohesive devices to connect ideas.");
    }

    // --- Lexical resource --------------------------------------------------
    let lexicalRaw = 5.5 + diversity * 4;
    if (diversity < 0.4 && wordCount > 40) {
      weaknesses.push("Noticeable word repetition — vocabulary range looks narrow.");
      suggestions.push("Vary your word choice; avoid repeating the same key noun or adjective.");
    } else if (diversity >= 0.55) {
      strengths.push("Good range of vocabulary.");
    }

    // --- Grammatical range & accuracy --------------------------------------
    // Proxy only: longer, varied sentences suggest more complex grammar attempts.
    // This demo cannot actually parse grammatical correctness.
    let grammarRaw = 6.0;
    if (avgSentenceLen < 8) {
      grammarRaw -= 0.5;
      weaknesses.push("Sentences are short and simple on average — try combining ideas with clauses.");
    } else if (avgSentenceLen > 14) {
      grammarRaw += 0.5;
      strengths.push("Attempts longer, more complex sentence structures.");
    }

    const taskResponseBand = toBand(taskResponseRaw);
    const coherenceBand = toBand(coherenceRaw);
    const lexicalBand = toBand(lexicalRaw);
    const grammarBand = toBand(grammarRaw);
    const overallBand = toBand(
      (taskResponseBand + coherenceBand + lexicalBand + grammarBand) / 4
    );

    if (suggestions.length === 0) {
      suggestions.push("Solid draft — read it aloud once to catch any remaining slips before your next attempt.");
    }
    if (strengths.length === 0) {
      strengths.push("You completed the attempt under real conditions — that repetition is what moves the band score.");
    }

    return {
      taskResponseBand,
      coherenceBand,
      lexicalBand,
      grammarBand,
      overallBand,
      strengths,
      weaknesses,
      suggestions,
    };
  }
}
