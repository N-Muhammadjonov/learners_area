import { questionTypeLabel } from "@/lib/reading-labels";
import { publicReadingConstraint, readingQuestionType } from "@/lib/reading/question-model";
import { questionType } from "@/lib/content/question-types";
import { notFound, redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { generalProgress, generalSetDetail, restoredGeneralCheck } from "@/lib/data/general-reading";
import { GeneralReadingSession, type GeneralPassage } from "@/components/reading/GeneralReadingSession";

/** One unlimited General learning session opens exactly one published passage. */
export default async function GeneralReadingSetPage({ params, searchParams }: {
  params: Promise<{ setId: string }>;
  searchParams: Promise<{ passage?: string; type?:string }>;
}) {
  const [{ setId }, { passage, type }] = await Promise.all([params, searchParams]);
  if (!isUuid(setId)) notFound();
  const user = await requireActiveUser();
  if (!user) return null;
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const detail = await generalSetDetail(setId, user.role);
  if (!detail || detail.passages.length === 0) notFound();

  const selected = detail.passages.find(p => p.passageNo === Number(passage)) ?? detail.passages[0]!;
  const mode = selected.passageNo as 1 | 2 | 3;
  if (passage !== String(mode)) {
    const query = new URLSearchParams({ passage: String(mode) });
    if (type && questionType(type,"reading")) query.set("type",type);
    redirect(`/app/reading/general/${setId}?${query}`);
  }
  const chosen = [selected];
  const progress = await generalProgress(user.id, setId);
  const passages: GeneralPassage[] = chosen.map((p) => ({
    passageNo: p.passageNo,
    passageId: p.passage.id,
    title: p.passage.title,
    body: p.passage.bodyText,
    paragraphs: p.paragraphs.map((paragraph) => ({ id: paragraph.id, label: paragraph.label, text: paragraph.text, isFootnote: paragraph.isFootnote })),
    groups:p.groups.map(g=>({id:g.id,position:g.position,typeCode:g.typeCode,displayTitle:g.displayTitle,instructionsText:g.instructionsText,fromQuestionNo:g.fromQuestionNo,toQuestionNo:g.toQuestionNo,sharedChoices:g.sharedChoices})),
    // The answer key never reaches the browser before "Check answers".
    questions: p.questions.map((q) => ({ id: q.id, questionNo: q.questionNo, order: q.order, type: q.type, typeCode:q.typeCode, groupId:q.groupId, renderMode:q.renderMode, answerConstraint:publicReadingConstraint(q.answerConstraint), questionText: q.questionText, options: q.options ?? null })),
    occurrences: p.occurrences,
  }));
  const initialProgress = Object.fromEntries(progress.map(row => {
    const section = chosen.find(p => p.passage.id === row.passageId);
    const result = section ? restoredGeneralCheck(row, section.questions, section.groups) : null;
    return [row.passageId, { answers: row.answers, score: row.score, total: row.total, checked: Boolean(result), result }];
  }));
  return <>{type && questionType(type,"reading") && chosen.some(p=>p.questions.some(q=>readingQuestionType(q.typeCode??q.type)?.id===type)) && <p className="body-text" data-requested-reading-type={type}>{dict.readingV4.requestedType}: {questionTypeLabel(type,locale)}. {dict.readingV4.wholePassage}</p>}<GeneralReadingSession key={`${user.id}:${setId}:${mode}`} userId={user.id} dict={dict} setId={setId} setTitle={detail.set.title} passages={passages} initialProgress={initialProgress} mode={mode} /></>;
}
