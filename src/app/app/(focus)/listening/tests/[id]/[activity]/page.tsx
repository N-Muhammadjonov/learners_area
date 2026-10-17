import {listeningSequenceAccess} from "@/lib/data/listening-sequence";
import {ListeningSequenceLocked} from "@/components/listening/ListeningSequenceLocked";
import { hasOriginalListeningRuntime } from "@/lib/listening/original-listening";
import { ListeningPractice } from "@/components/listening/ListeningPractice";
import { listeningPracticeProgress } from "@/lib/data/full-listening";
import type { PracticeKind } from "@/lib/listening/activities";
import { db } from "@/db/client";
import { listeningOccurrenceSpans, listeningSegmentSpans, listeningVocabularySession } from "@/lib/services/lexical/listening-occurrences";
import { lexicalAssistanceAllowed, modeForActivity } from "@/lib/listening/lexical-policy";
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
  fullListeningProgress,
  listeningExamState,
  allowedListeningSpeeds,
} from "@/lib/data/full-listening";
import { isUuid } from "@/lib/validation/ids";
import { mapDiagramSections } from "@/lib/listening/activities";
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
  const practiceKind = ["matching","completion","retry","map"].includes(activity) ? activity as PracticeKind : null;
  if (!isUuid(id) || (!practiceKind && (!Number.isInteger(n) || n < 1 || n > 5))) notFound();
  if(!await listeningSequenceAccess(user,id))return <ListeningSequenceLocked dict={getDictionary(await getLocale())}/>;
  const detail = await fullListeningDetail(id, user.role);
  if (!detail) notFound();
  if (detail.pkg.payload.authoredRuntime || hasOriginalListeningRuntime(id, detail.pkg.sourceId)) redirect(`/app/listening/tests/${id}`);
  const dict = getDictionary(await getLocale());
  if (practiceKind) {
    if (!detail.pkg.payload.studyPack?.activities?.includes(practiceKind)) notFound();
    if ((await listeningExamState(user,id)).examInProgress) return <p role="status">{dict.fullListeningHub.research.examLocked}</p>;
    let questions = detail.pkg.payload.questions.filter(q => q.kind === practiceKind);
    if (practiceKind === "retry") {
      const progress = await fullListeningProgress(user.id,id);
      const report = progress.exam ? await getAttemptDetail(progress.exam.id,user.id) : null;
      const missed = new Set(report?.answers.filter(a=>a.isCorrect === false).map(a=>report.questions.find(q=>q.id===a.questionId)?.order));
      questions = detail.pkg.payload.questions.filter(q=>missed.has(q.number));
    }
    const progress = await listeningPracticeProgress(user.id,id);
    // Map / Plan Mastery needs the drawing itself as well as the questions: the learner answers
    // by locating things on the plan, so the plan is part of the exercise, not decoration.
    return <ListeningPractice id={id} title={detail.test.title} kind={practiceKind} mapDiagram={practiceKind === "map" ? detail.pkg.payload.mapDiagram : undefined} audioUrl={detail.test.audioUrl} initial={progress[practiceKind]?.latest.answers ?? {}} dict={dict} questions={questions.map(q=>({number:q.number,text:q.text,instruction:q.instruction,options:q.options,at:q.evidence.at,end:q.evidence.end}))}/>;
  }

  if (n === 1) return <FullExamStart id={id} title={detail.test.title} dict={getDictionary(await getLocale())} />;
  if ((await listeningExamState(user, id)).examInProgress) return <p role="status">{dict.fullListeningHub.research.examLocked}</p>;
  const progress = await fullListeningProgress(user.id, id);
  // Review & Revision is the transcript study surface; the exam itself (activity 1)
  // never reaches this component, keyword drills keep their own interaction.
  const lexicalAssistance = lexicalAssistanceAllowed(modeForActivity(n), await listeningExamState(user, id));
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
      ? { vocabulary: await listeningVocabularySession(db, id, detail.pkg.payload.vocabulary) }
      : n === 3
        ? { keyword1: detail.pkg.payload.keyword1, questionSections: Object.fromEntries(detail.pkg.payload.questions.map(q=>[q.number,q.section])), studyPack: detail.pkg.payload.studyPack }
        : n === 4
          ? { keyword2: detail.pkg.payload.keyword2, studyPack: detail.pkg.payload.studyPack }
          : {
              studyPack: detail.pkg.payload.studyPack,
              questions: detail.pkg.payload.questions,
              sections: detail.pkg.payload.sections,
              mapDiagram: detail.pkg.payload.mapDiagram,
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
      mapSections={mapDiagramSections(detail.pkg.payload)}
      imageUrl={n === 2 && detail.pkg.imageObjectKey ? `/api/resources/${detail.pkg.imageObjectKey}` : null}
      audioUrl={n === 5 ? null : detail.test.audioUrl}
      initial={progress.activities[n - 1]?.latest?.answers ?? {}}
      lexicalAssistance={lexicalAssistance}
      segmentOccurrences={lexicalAssistance ? await listeningSegmentSpans(db, id) : {}}
      occurrences={(n === 2 || n === 3) && lexicalAssistance ? await listeningOccurrenceSpans(db, id) : {}}
      dict={getDictionary(await getLocale())}
    />
  );
}
