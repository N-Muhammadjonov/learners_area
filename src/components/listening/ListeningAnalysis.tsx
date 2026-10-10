import { Card } from "@/components/ui/Card";
import type { Dictionary } from "@/lib/i18n/en";
import type { listeningQuestions, listeningAnswers } from "@/db/schema";

type Question = typeof listeningQuestions.$inferSelect;
type Answer = typeof listeningAnswers.$inferSelect;

/**
 * The four things a question can be, taken from the authoritative row.
 *
 * `listening_answers.is_correct` is a NULLABLE boolean, which means the database distinguishes
 * "graded wrong" (false) from "no verdict has been reached" (NULL) — and the absence of a row at all
 * means the learner never answered. Those are three different facts and they must not look alike.
 */
type Verdict = "correct" | "incorrect" | "notGraded" | "unanswered";

export function ListeningAnalysis({
  dict,
  score,
  total,
  questions,
  answers,
}: {
  dict: Dictionary;
  score: number | null;
  total: number | null;
  questions: Question[];
  answers: Answer[];
}) {
  const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col items-center gap-1 py-6 text-center">
        <span className="text-xs uppercase tracking-wide text-ink-300">{dict.listening.score}</span>
        <span className="font-display text-4xl text-ink-900">
          {/* Finished but never graded is a real state: show it, do not print "/" or invent 0. */}
          {score === null || total === null ? dict.listening.notGradedYet : `${score}/${total}`}
        </span>
      </Card>

      {questions.map((q) => {
        const a = answerByQuestion.get(q.id);
        /*
         * This used to be a truthiness test on `a?.isCorrect`, in three places at once: the card
         * border, the badge, and the decision to reveal the answer key. Because NULL, false and
         * "no row" are all falsy, a completed-but-ungraded attempt painted EVERY question with the
         * red bad-band border and a red "Incorrect" badge — a grading verdict nobody had reached, and
         * an implied score of zero — while the header directly above correctly said "Not graded yet".
         * The same screen contradicted itself.
         *
         * The verdict is now derived once, from the row, and every visual decision follows from it.
         */
        const verdict: Verdict =
          a === undefined ? "unanswered"
          : a.isCorrect === null ? "notGraded"
          : a.isCorrect ? "correct"
          : "incorrect";

        // Neutral ink tokens for the two states that are not failures. `band-bad` would assert a
        // wrong answer and `band-warn` would assert a warning; neither was issued. These are tokens
        // the theme already defines, so Night/Day both follow and no colour is introduced.
        const tone =
          verdict === "correct" ? { card: "border-band-good/40", badge: "bg-band-good/10 text-band-good" }
          : verdict === "incorrect" ? { card: "border-band-bad/40", badge: "bg-band-bad/10 text-band-bad" }
          : { card: "border-ink-100", badge: "bg-ink-50 text-ink-500" };

        const label =
          verdict === "correct" ? dict.listening.correct
          : verdict === "incorrect" ? dict.listening.incorrect
          : verdict === "notGraded" ? dict.listening.notGraded
          : dict.listening.unanswered;

        return (
          <Card key={q.id} className={tone.card} data-listening-verdict={verdict}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-ink-900">
                {q.order}. {q.questionText}
              </p>
              <span className={`badge ${tone.badge}`} data-listening-verdict-label={verdict}>
                {label}
              </span>
            </div>
            <p className="text-sm text-ink-500">
              {dict.listening.yourAnswer}: <span className="text-ink-900">{a?.userAnswer || "—"}</span>
            </p>
            {/*
              * The answer key is revealed for anything that is not a graded correct answer, which is
              * the review this component is: the attempt is finished, so the key is authorized. What
              * changed is that revealing it no longer travels with a red "Incorrect" verdict for work
              * that was never graded.
              */}
            {verdict !== "correct" && (
              <p className="text-sm text-ink-500" data-listening-answer-key>
                {dict.listening.correctAnswer}: <span className="text-ink-900">{q.correctAnswer}</span>
              </p>
            )}
            {/*
              * EVIDENCE ONLY WHEN IT WAS AUTHORED (§28). The row carries whatever the centre
              * wrote — and nothing when the centre wrote nothing — so an empty explanation is
              * left out instead of rendering a blank line that looks like evidence. This is not
              * a stylistic choice: a review may never imply that something was explained when
              * nobody explained it, and generated wording in a review would be fabrication.
              */}
            {q.explanation.trim() ? (
              <p className="mt-1 text-xs text-ink-500" data-listening-analysis-evidence>
                {q.explanation}
              </p>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
