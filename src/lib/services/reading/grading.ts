/**
 * Two answers are compared after the differences that do not change meaning are
 * removed: case, repeated spaces, a trailing full stop, underscores vs spaces
 * ("not_given" and "NOT GIVEN" are the same answer), and typographic dashes.
 */
function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "");
}

/**
 * "A — Paragraph A" and "A" are the same choice written two ways.
 *
 * Only a value that really starts with a single letter followed by a separator is
 * reduced, so ordinary prose ("well - known") is never trimmed down to a letter.
 */
const LABELLED = /^([a-z])\s*-\s*\S/;

function letterOf(normalized: string): string | null {
  const match = LABELLED.exec(normalized);
  return match ? match[1]! : null;
}

function matchesOne(candidate: string, expected: string): boolean {
  const left = normalize(candidate);
  const right = normalize(expected);
  if (!left) return false;
  if (left === right) return true;

  const leftLetter = letterOf(left);
  const rightLetter = letterOf(right);
  if (leftLetter && rightLetter) return leftLetter === rightLetter;
  // A bare letter against a labelled option: "A" answers "A — wild animals".
  if (!leftLetter && rightLetter) return rightLetter === left;
  if (!rightLetter && leftLetter) return leftLetter === right;
  return false;
}

/**
 * Objective grading — unlike Writing, IELTS Reading answers have one correct
 * answer, so this is a match, not a heuristic. That match is deliberately
 * generous in exactly one way: every string the source itself lists as
 * acceptable is accepted.
 *
 * Without that, a student who types "40 mm" for a key of "40 millimetres", or
 * who clicks the letter "A" for a key of "A — wild animals", is marked wrong for
 * producing the real IELTS answer. Teaching a student something false is worse
 * than being slightly lenient, and the accepted list is the source's own.
 *
 * short_answer stays strict otherwise: no fuzzy or partial credit, no stemming,
 * no synonym matching.
 */
export function gradeAnswer(
  userAnswer: string,
  correctAnswer: string,
  acceptedAnswers: string[] = []
): boolean {
  if (!userAnswer.trim()) return false;
  if (matchesOne(userAnswer, correctAnswer)) return true;
  return acceptedAnswers.some((accepted) => matchesOne(userAnswer, accepted));
}
