export type ListeningQuestionType = "multiple_choice" | "short_answer";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Same exact-match approach as Reading — see that module's grading.ts for the caveat on short_answer. */
export function gradeAnswer(_type: ListeningQuestionType, userAnswer: string, correctAnswer: string): boolean {
  if (!userAnswer.trim()) return false;
  return normalize(userAnswer) === normalize(correctAnswer);
}
