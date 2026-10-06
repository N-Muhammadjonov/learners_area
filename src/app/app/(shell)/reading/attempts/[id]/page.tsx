import { BackLink } from "@/components/ui/BackLink";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getAttemptDetail } from "@/lib/data/reading";
import { ReadingExam } from "@/components/reading/ReadingExam";
import { ReadingAnalysis } from "@/components/reading/ReadingAnalysis";
import { isUuid } from "@/lib/validation/ids";
import { listResourceBlocks, toResourceBlockView } from "@/lib/data/resources";

export default async function ReadingAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return null;
  const locale = await getLocale();
  const dict = getDictionary(locale);

  // Shakli noto'g'ri id hech qachon bazaga yetib bormaydi: javob 500 emas, 404.
  if (!isUuid(id)) notFound();
  const detail = await getAttemptDetail(id, user.id);
  if (!detail) notFound();
  const { attempt, passage, questions, groups, paragraphs, answers, occurrences } = detail;

  // Anything an administrator attached to this passage — via the universal
  // composer — is shown inside the workspace, so a summary or an audio version
  // sits next to the text it belongs to.
  const materials = toResourceBlockView(await listResourceBlocks("reading", passage.id));

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
      {attempt.status === "in_progress" ? (
        // ACADEMIC_EXAM: no occurrence/sense data is sent to the active passage.
        <ReadingExam
          dict={dict}
          attemptId={attempt.id}
          passageTitle={passage.title}
          passageBody={passage.bodyText}
          passageMeta={passageMeta}
          materials={materials}
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
            type: q.type,
            typeCode: q.typeCode,
            groupId: q.groupId,
            renderMode: q.renderMode,
            questionText: q.questionText,
            options: q.options ?? null,
            answerConstraint: (q.answerConstraint ?? null) as Record<string, unknown> | null,
          }))}
        />
      ) : (
        <ReadingAnalysis
          dict={dict}
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
