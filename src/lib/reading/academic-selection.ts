/** Reviewed single, independent questions retained in General learning only.
 * Source has 1,324 questions across its 99 passages; CD assessments contain 1,320.
 * None of these omissions splits a Choose TWO pair or a shared-stimulus gap.
 */
export const ACADEMIC_105_OMISSIONS = [
  { sourceRef: "reading105:test:08", externalId: "t08-p2-european-heat-wave", questionNo: 14 },
  { sourceRef: "reading105:test:12", externalId: "t12-p1-how-printed-books-began", questionNo: 14 },
  { sourceRef: "reading105:test:30", externalId: "t30-p1-the-terracotta-army", questionNo: 16 },
  { sourceRef: "reading105:test:31", externalId: "t31-p1-this-is-very-much-the-story-of-a-story", questionNo: 14 },
] as const;

type Selectable = { id: string; externalId: string | null; questionNo: number | null };
export function academicQuestionSelection<T extends Selectable>(sourceRef: string | null, questions: T[]): T[] | null {
  if (questions.length === 40) return questions;
  const omission = ACADEMIC_105_OMISSIONS.find(row => row.sourceRef === sourceRef);
  if (questions.length !== 41 || !omission) return null;
  const excluded = questions.filter(q => q.externalId === omission.externalId && q.questionNo === omission.questionNo);
  return excluded.length === 1 ? questions.filter(q => q.id !== excluded[0]!.id) : null;
}

/** Source box/question references must use the displayed CD numbers. */
export function academicInstructionNumbers(text: string | null, from: number, to: number) {
  return text?.replace(/\b(questions?|boxes?)\s+\d+(?:\s*(?:[–—-]|to|and)\s*\d+)?/gi, (_match, lead: string) => `${lead} ${from === to ? from : `${from}–${to}`}`) ?? null;
}
