import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { academicSetAccess, generalSetDetail } from "@/lib/data/general-reading";
import { StartPassageButton } from "@/components/reading/StartPassageButton";
import { academicQuestionSelection } from "@/lib/reading/academic-selection";
import { academicQuestionSelectionReady } from "@/lib/data/reading-assessments";

export default async function AcademicSetPage({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = await params;
  if (!isUuid(setId)) notFound();
  const user = await requireActiveUser();
  if (!user) return null;
  if (!(await academicSetAccess(user,setId))) notFound();
  const dict = getDictionary(await getLocale());
  const detail = await generalSetDetail(setId, user.role);
  if (!detail || detail.passages.length !== 3 || detail.passages.some((p, i) => p.passageNo !== i + 1 || p.questions.length === 0)) notFound();
  const allQuestions=detail.passages.flatMap(p=>p.questions.map(q=>({...q,externalId:p.passage.externalId})));
  if (!academicQuestionSelection(detail.set.sourceRef,allQuestions) || (allQuestions.length!==40 && !(await academicQuestionSelectionReady()))) notFound();
  return <div className="reading-exam-intro" data-academic-reading-start>
    <h1 className="page-title">{detail.set.title}</h1>
    <p className="body-text">{dict.readingHub.academicExamHint}</p>
    <ol className="grid gap-3">{detail.passages.map(section => <li key={section.passageNo} className="card p-4">
      <span className="meta-text">{dict.generalReading.passageN.replace("{n}", String(section.passageNo))}</span>
      <h2 className="card-title">{section.passage.title}</h2>
    </li>)}</ol>
    <StartPassageButton setId={setId} label={dict.generalReading.full} variant="primary" />
  </div>;
}
