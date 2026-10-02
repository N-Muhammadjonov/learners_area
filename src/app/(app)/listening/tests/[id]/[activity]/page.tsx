import { db } from "@/db/client";
import { listeningOccurrenceSpans } from "@/lib/services/lexical/listening-occurrences";
import type { McqStage } from "@/lib/services/listening/mcq-mastery";
import {
  listMcqQuestions,
  listMcqSessions,
  getAttemptDetail,
} from "@/lib/data/listening";
import { notFound, redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import {
  fullListeningDetail,
  hasFullExam,
  fullListeningProgress,
  allowedListeningSpeeds,
} from "@/lib/data/full-listening";
import { isUuid } from "@/lib/validation/ids";
import { FullListeningActivity } from "@/components/listening/FullListeningActivity";
import { FullExamStart } from "@/components/listening/FullExamStart";
import { getDictionary, getLocale } from "@/lib/i18n";
export default async function Activity({
  params,
}: {
  params: Promise<{ id: string; activity: string }>;
}) {
  const user = await requireActiveUser();
  if (!user) return null;
  const { id, activity } = await params;
  const n = Number(activity);
  if (!isUuid(id) || !Number.isInteger(n) || n < 1 || n > 5) notFound();
  const detail = await fullListeningDetail(id, user.role);
  if (!detail) notFound();
  if (n === 1) return <FullExamStart id={id} title={detail.test.title} />;
  if (!(await hasFullExam(user.id, id))) redirect(`/listening/tests/${id}`);
  const progress = await fullListeningProgress(user.id, id);
  const report =
    n === 2 && progress.exam
      ? await getAttemptDetail(progress.exam.id, user.id)
      : null;
  const mcqRows = n === 2 ? await listMcqQuestions(id) : [];
  const mcqSessions = n === 2 ? await listMcqSessions(user.id, id) : new Map();
  const speeds = n === 2 ? await allowedListeningSpeeds(user.id, id) : [];
  // Vocabulary route serializes neither audio URL nor transcript/questions into its client payload.
  const data =
    n === 5
      ? { vocabulary: detail.pkg.payload.vocabulary }
      : n === 3
        ? { keyword1: detail.pkg.payload.keyword1 }
        : n === 4
          ? { keyword2: detail.pkg.payload.keyword2 }
          : {
              questions: detail.pkg.payload.questions,
              sections: detail.pkg.payload.sections,
              report: report
                ? {
                    score: report.attempt.score,
                    total: report.attempt.totalQuestions,
                    answers: report.questions.map((q) => ({
                      number: q.order,
                      ...report.answers.find((a) => a.questionId === q.id),
                    })),
                  }
                : null,
              speeds,
              mcq: mcqRows
                .filter((q) => q.order >= 21 && q.order <= 24)
                .map((q) => ({
                  id: q.id,
                  order: q.order,
                  questionText: q.questionText,
                  stage: (mcqSessions.get(q.id)?.stage ?? "listen") as McqStage,
                })),
            };
  return (
    <FullListeningActivity
      key={`${id}/${n}`}
      id={id}
      userId={user.id}
      title={detail.test.title}
      activity={n}
      data={data}
      audioUrl={n === 5 ? null : detail.test.audioUrl}
      initial={progress.activities[n - 1]?.latest?.answers ?? {}}
      occurrences={await listeningOccurrenceSpans(db, id)}
      dict={getDictionary(await getLocale())}
    />
  );
}
