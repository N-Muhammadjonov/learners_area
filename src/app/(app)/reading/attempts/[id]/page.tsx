import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getAttemptDetail } from "@/lib/data/reading";
import { ReadingExam } from "@/components/reading/ReadingExam";
import { ReadingAnalysis } from "@/components/reading/ReadingAnalysis";

export default async function ReadingAttemptPage({ params }: { params: { id: string } }) {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(getLocale());

  const detail = await getAttemptDetail(params.id, user.id);
  if (!detail) notFound();
  const { attempt, passage, questions, answers } = detail;

  return (
    <div className="mx-auto max-w-5xl">
      {attempt.status === "in_progress" ? (
        <ReadingExam
          dict={dict}
          attemptId={attempt.id}
          passageTitle={passage.title}
          passageBody={passage.bodyText}
          questions={questions.map((q) => ({
            id: q.id,
            order: q.order,
            type: q.type,
            questionText: q.questionText,
            options: q.options ?? null,
          }))}
        />
      ) : (
        <ReadingAnalysis
          dict={dict}
          score={attempt.score}
          total={attempt.totalQuestions}
          questions={questions}
          answers={answers}
          passageBody={passage.bodyText}
          passageTitle={passage.title}
          passageLevel={passage.difficultyLevel}
          attemptId={attempt.id}
        />
      )}
    </div>
  );
}
