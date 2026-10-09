import { ObjectiveExplanation } from "@/components/riwi/ObjectiveExplanation";
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
  attemptId,
}: {
  dict: Dictionary;
  score: number | null;
  total: number | null;
  questions: Question[];
  answers: Answer[];
  attemptId?: string;
}) {
  const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col items-center gap-1 py-6 text-center">
        <span className="text-xs uppercase tracking-wide text-ink-300">{dict.listening.score}</span>
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
            <p className="mt-1 text-xs text-ink-500">{q.explanation}</p>
            {attemptId && <ObjectiveExplanation domain="listening" attemptId={attemptId} questionId={q.id} dict={dict} />}
          </Card>
        );
      })}
    </div>
  );
}
