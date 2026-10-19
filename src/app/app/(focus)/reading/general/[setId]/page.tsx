import { questionTypeLabel } from "@/lib/reading-labels";
import { publicReadingConstraint, readingQuestionType } from "@/lib/reading/question-model";
import { questionType } from "@/lib/content/question-types";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { generalProgress, generalSetDetail, restoredGeneralCheck } from "@/lib/data/general-reading";
import { activeAcademicAttemptForPassages } from "@/lib/data/reading-assessments";
import { GeneralReadingSession, type GeneralPassage } from "@/components/reading/GeneralReadingSession";

/**
 * One General Reading set. Without `?passage` the learner chooses how to study:
 * Passage 1, Passage 2, Passage 3 or Full Reading. Vocabulary help is on in every
 * choice — the passages are classified General (learning) in the database, which
 * is what the lookup/save endpoints check; nothing in this URL grants permission.
 */
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
  const t = dict.generalReading;
  const detail = await generalSetDetail(setId, user.role);
  if (!detail || detail.passages.length === 0) notFound();

  const numbers = detail.passages.map((p) => p.passageNo);
  const mode = passage === "full" ? "full" as const : numbers.includes(Number(passage)) ? Number(passage) as 1 | 2 | 3 : null;

  if (!mode) {
    return (
      <div className="reading-exam-intro" data-general-reading-choose>
        <header className="flex flex-col gap-2">
          <h1 className="section-title">{detail.set.title}</h1>
          {detail.set.description && <p className="body-text">{detail.set.description}</p>}
          <p className="body-text text-sm">{t.choose}</p>
        </header>
        <ul className="grid gap-3 sm:grid-cols-2">
          {detail.passages.map((p) => (
            <li key={p.passageNo}>
              <Link prefetch={false} href={`/app/reading/general/${setId}?passage=${p.passageNo}`} className="card flex h-full flex-col gap-1 p-4" data-general-mode={p.passageNo}>
                <span className="card-title">{t.passageN.replace("{n}", String(p.passageNo))}</span>
                <span className="text-sm text-ink-700">{p.passage.title}</span>
                <span className="text-xs text-ink-500">{t.passageHint}</span>
              </Link>
            </li>
          ))}
          {detail.passages.length > 1 && (
            <li>
              <Link prefetch={false} href={`/app/reading/general/${setId}?passage=full`} className="card flex h-full flex-col gap-1 p-4" data-general-mode="full">
                <span className="card-title">{t.full}</span>
                <span className="text-xs text-ink-500">{t.fullHint}</span>
              </Link>
            </li>
          )}
        </ul>
      </div>
    );
  }

  const chosen = mode === "full" ? detail.passages : detail.passages.filter((p) => p.passageNo === mode);
  const activeExam = await activeAcademicAttemptForPassages(user.id, chosen.map(p => p.passage.id));
  if (activeExam) redirect(`/app/reading/attempts/${activeExam}`);
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
  return <>{type && questionType(type,"reading") && chosen.some(p=>p.questions.some(q=>readingQuestionType(q.typeCode??q.type)?.id===type)) && <p className="body-text" data-requested-reading-type={type}>{dict.readingV4.requestedType}: {questionTypeLabel(type,locale)}. {dict.readingV4.wholePassage}</p>}<GeneralReadingSession key={`${user.id}:${setId}`} userId={user.id} dict={dict} setId={setId} setTitle={detail.set.title} passages={passages} initialProgress={initialProgress} mode={mode} /></>;
}
