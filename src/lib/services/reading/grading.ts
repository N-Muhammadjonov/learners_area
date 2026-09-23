export type ReadingQuestionType =
  | "true_false_not_given"
  | "yes_no_not_given"
  | "multiple_choice"
  | "short_answer";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Objective grading — unlike Writing, IELTS Reading answers have a single
 * correct answer, so this is an exact (normalised) match, not a heuristic.
 * short_answer is intentionally strict: no fuzzy/partial credit. That's a
 * real limitation for genuine free-text answers (a synonym would be marked
 * wrong) — acceptable for true_false_not_given and multiple_choice, worth
 * revisiting before short_answer questions are used for real assessment.
 */
export function gradeAnswer(type: ReadingQuestionType, userAnswer: string, correctAnswer: string): boolean {
  if (!userAnswer.trim()) return false;
  return normalize(userAnswer) === normalize(correctAnswer);
}
