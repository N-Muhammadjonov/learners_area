import { notFound } from "next/navigation";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { fullListeningDetail, listeningExamState } from "@/lib/data/full-listening";
import { listMcqQuestions, listMcqSessions } from "@/lib/data/listening";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { McqMastery } from "@/components/listening/McqMastery";
export default async function McqPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return null;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await fullListeningDetail(id, user.role);
  if (!detail) notFound();
  if ((await listeningExamState(user, id)).examInProgress) return <div className="listening-workspace"><Link className="btn-secondary" href={`/app/listening/tests/${id}`}>← Listening</Link><p role="status">{getDictionary(await getLocale()).fullListeningHub.research.examLocked}</p></div>;
  const [questions, sessions, locale] = await Promise.all([listMcqQuestions(id), listMcqSessions(user.id, id), getLocale()]);
  const dict = getDictionary(locale);
  return <div className="listening-workspace space-y-6"><Link className="btn-secondary" href={`/app/listening/tests/${id}`}>{dict.fullListeningHub.examStart.back}</Link><h1 className="font-display text-3xl">{detail.test.title} · {dict.fullListeningHub.research.mcq}</h1><McqMastery dict={dict} audioUrl={detail.test.audioUrl} questions={questions.map(q => ({ id: q.id, order: q.order, questionText: q.questionText, stage: sessions.get(q.id)?.stage ?? "listen", at: detail.pkg.payload.questions.find(row => row.number === q.order)?.evidence.at }))} /></div>;
}
