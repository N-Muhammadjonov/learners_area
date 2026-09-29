export type ReadingAnswerEntry = { questionId: string; answer: string };

/** After expiry, only drafts persisted before the deadline are eligible for grading. */
export function readingAnswersForSubmission(
  timedOut: boolean,
  submitted: readonly ReadingAnswerEntry[],
  savedDrafts: readonly ReadingAnswerEntry[]
): Map<string, string> {
  return new Map((timedOut ? savedDrafts : submitted).map(({ questionId, answer }) => [questionId, answer]));
}
