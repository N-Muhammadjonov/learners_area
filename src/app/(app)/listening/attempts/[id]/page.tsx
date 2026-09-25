import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getAttemptDetail } from "@/lib/data/listening";
import { ListeningExam } from "@/components/listening/ListeningExam";
import { ListeningAnalysis } from "@/components/listening/ListeningAnalysis";
import { ClickableText } from "@/components/vocabulary/ClickableText";

export default async function ListeningAttemptPage({ params }: { params: { id: string } }) {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(getLocale());

  const detail = await getAttemptDetail(params.id, user.id);
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
            <div className="card mt-4" data-interactive-transcript>
              <h3 className="mb-2 font-display text-base text-ink-900">{dict.listening.transcript}</h3>
              <p className="mb-2 text-xs text-ink-300">{dict.listening.transcriptHint}</p>
              {/* The transcript is interactive: every word can be looked up or saved. */}
              <ClickableText
                dict={dict}
                text={test.transcript}
                sourceType="listening"
                sourceId={test.id}
                className="text-sm leading-relaxed text-ink-700"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
