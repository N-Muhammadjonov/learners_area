import { Card } from "@/components/ui/Card";
import type { Dictionary } from "@/lib/i18n/en";
import type { listeningQuestions, listeningAnswers } from "@/db/schema";

type Question = typeof listeningQuestions.$inferSelect;
type Answer = typeof listeningAnswers.$inferSelect;

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
        return (
          <Card key={q.id} className={a?.isCorrect ? "border-band-good/40" : "border-band-bad/40"}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-ink-900">
                {q.order}. {q.questionText}
              </p>
              <span className={`badge ${a?.isCorrect ? "bg-band-good/10 text-band-good" : "bg-band-bad/10 text-band-bad"}`}>
                {a?.isCorrect ? dict.listening.correct : dict.listening.incorrect}
              </span>
            </div>
            <p className="text-sm text-ink-500">
              {dict.listening.yourAnswer}: <span className="text-ink-900">{a?.userAnswer || "—"}</span>
            </p>
            {!a?.isCorrect && (
              <p className="text-sm text-ink-500">
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
