import { questionTypeLabel } from "@/lib/reading-labels";
import { publicReadingConstraint, readingQuestionType } from "@/lib/reading/question-model";
import { BackLink } from "@/components/ui/BackLink";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getAttemptDetail } from "@/lib/data/reading";
import { ReadingExam } from "@/components/reading/ReadingExam";
import { ReadingAnalysis } from "@/components/reading/ReadingAnalysis";
import { isUuid } from "@/lib/validation/ids";

export default async function ReadingAttemptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams:Promise<{type?:string}> }) {
  const [{ id },query] = await Promise.all([params,searchParams]);
  const user = await requireActiveUser();
  if (!user) return null;
  const locale = await getLocale();
  const dict = getDictionary(locale);

  // Shakli noto'g'ri id hech qachon bazaga yetib bormaydi: javob 500 emas, 404.
  if (!isUuid(id)) notFound();
  const detail = await getAttemptDetail(id, user.id);
  if (!detail) notFound();
  const { attempt, passage, questions, groups, paragraphs, answers, occurrences } = detail;

  // "Test 2, Passage 3" is only claimed when the passage really came from a
  // numbered test; a hand-written passage shows its title alone.
  const passageMeta =
    passage.testNo !== null && passage.passageNo !== null
      ? dict.readingPractice.passageMeta
          .replace("{test}", String(passage.testNo))
          .replace("{passage}", String(passage.passageNo))
      : null;

  return (
    <div className="mx-auto max-w-[1440px]">
      <BackLink fallbackHref="/app/reading/history" label={dict.common.back} />
      {query.type && questions.some(q=>readingQuestionType(q.typeCode??q.type)?.id===query.type) && <p className="body-text" data-requested-reading-type={query.type}>{dict.readingV4.requestedType}: {questionTypeLabel(query.type,locale)}. {dict.readingV4.wholePassage}</p>}
      {attempt.status === "in_progress" ? (
        // ACADEMIC_EXAM: no occurrence/sense data is sent to the active passage.
        <ReadingExam
          dict={dict}
          attemptId={attempt.id}
          passageTitle={passage.title}
          passageBody={passage.bodyText}
          passageMeta={passageMeta}
          parts={detail.sections.length > 1 ? detail.sections.map(section => ({
            title: section.passage.title, body: section.passage.bodyText,
            paragraphs: section.paragraphs.map(p => ({ id: p.id, position: p.position, label: p.label, text: p.text, isFootnote: p.isFootnote })),
            questionIds: section.questions.map(q => q.id), groupIds: section.groups.map(group => group.id),
          })) : []}
          startedAt={attempt.startedAt.toISOString()}
          suggestedMinutes={passage.suggestedMinutes}
          groups={groups.map((group) => ({
            id: group.id,
            position: group.position,
            typeCode: group.typeCode,
            displayTitle: group.displayTitle,
            instructionsText: group.instructionsText,
            fromQuestionNo: group.fromQuestionNo,
            toQuestionNo: group.toQuestionNo,
            sharedChoices: group.sharedChoices,
          }))}
          paragraphs={paragraphs.map((paragraph) => ({
            id: paragraph.id,
            position: paragraph.position,
            label: paragraph.label,
            text: paragraph.text,
            isFootnote: paragraph.isFootnote,
          }))}
          // Draft answers are restored by question id, so a reload continues the
          // attempt exactly where the student left it.
          savedAnswers={Object.fromEntries(
            answers.filter((answer) => answer.isCorrect === null).map((answer) => [answer.questionId, answer.userAnswer])
          )}
          questions={questions.map((q) => ({
            id: q.id,
            order: q.order,
            questionNo: q.questionNo,
            sourceQuestionNo: q.sourceQuestionNo,
            type: q.type,
            typeCode: q.typeCode,
            groupId: q.groupId,
            renderMode: q.renderMode,
            questionText: q.questionText,
            options: q.options ?? null,
            answerConstraint: publicReadingConstraint(q.answerConstraint),
          }))}
        />
      ) : (
        <ReadingAnalysis
          dict={dict}
          passages={detail.sections.map(s=>({id:s.passage.id,title:s.passage.title,body:s.passage.bodyText}))}
          occurrences={occurrences}
          score={attempt.score}
          total={attempt.totalQuestions}
          questions={questions}
          groups={groups}
          answers={answers}
          passageBody={passage.bodyText}
          passageTitle={passage.title}
          passageLevel={passage.difficultyLevel}
          attemptId={attempt.id}
          locale={locale}
        />
      )}
    </div>
  );
}
