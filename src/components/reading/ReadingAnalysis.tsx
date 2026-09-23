import { Card } from "@/components/ui/Card";
import { ternaryLabel } from "@/lib/reading-choices";
import type { Dictionary } from "@/lib/i18n/en";
import type { readingQuestions, readingAnswers } from "@/db/schema";

type Question = typeof readingQuestions.$inferSelect;
type Answer = typeof readingAnswers.$inferSelect;

const answerLabel = (type: Question["type"], raw: string): string => {
  if (type !== "true_false_not_given" && type !== "yes_no_not_given") return raw;
  return ternaryLabel(type, raw);
};

export function ReadingAnalysis({
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
        <span className="text-xs uppercase tracking-wide text-ink-300">{dict.reading.score}</span>
        <span className="font-display text-4xl text-ink-900">
          {score}/{total}
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
                {a?.isCorrect ? dict.reading.correct : dict.reading.incorrect}
              </span>
            </div>
            <p className="text-sm text-ink-500">
              {dict.reading.yourAnswer}:{" "}
              <span className="text-ink-900">{a?.userAnswer ? answerLabel(q.type, a.userAnswer) : "—"}</span>
            </p>
            {!a?.isCorrect && (
              <p className="text-sm text-ink-500">
                {dict.reading.correctAnswer}:{" "}
                <span className="text-ink-900">{answerLabel(q.type, q.correctAnswer)}</span>
              </p>
            )}
            {q.evidenceQuote && (
              <p className="mt-1 text-xs italic text-ink-300">
                {dict.reading.evidence}: &ldquo;{q.evidenceQuote}&rdquo;
              </p>
            )}
            <p className="mt-1 text-xs text-ink-500">{q.explanation}</p>
          </Card>
        );
      })}
    </div>
  );
}
