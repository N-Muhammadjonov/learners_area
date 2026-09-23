import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getAttemptDetail } from "@/lib/data/listening";
import { ListeningExam } from "@/components/listening/ListeningExam";
import { ListeningAnalysis } from "@/components/listening/ListeningAnalysis";

export default async function ListeningAttemptPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return null;
  const dict = getDictionary(getLocale());

  const detail = await getAttemptDetail(params.id, session.sub);
  if (!detail) notFound();
  const { attempt, test, questions, answers } = detail;

  return (
    <div className="mx-auto max-w-3xl">
      {attempt.status === "in_progress" ? (
        <ListeningExam
          dict={dict}
          attemptId={attempt.id}
          testTitle={test.title}
          audioUrl={test.audioUrl}
          audioType={test.audioType}
          questions={questions.map((q) => ({
            id: q.id,
            order: q.order,
            type: q.type,
            questionText: q.questionText,
            options: q.options ?? null,
          }))}
        />
      ) : (
        <>
          <ListeningAnalysis dict={dict} score={attempt.score} total={attempt.totalQuestions} questions={questions} answers={answers} />
          {test.transcript && (
            <div className="card mt-4">
              <h3 className="mb-2 font-display text-base text-ink-900">{dict.listening.transcript}</h3>
              <p className="whitespace-pre-line text-sm text-ink-500">{test.transcript}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
