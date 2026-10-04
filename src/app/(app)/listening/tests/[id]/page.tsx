import { TestFocusEntry } from "@/components/interaction/TestFocusEntry";
import { packageActivities, activityPath } from "@/lib/listening/activities";
import { AuthoredListeningFrame } from "@/components/listening/AuthoredListeningFrame";
import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { fullListeningDetail, fullListeningProgress, listeningPracticeProgress } from "@/lib/data/full-listening";
import { listMcqQuestions, listMcqSessions } from "@/lib/data/listening";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
export default async function Hub({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return null;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await fullListeningDetail(id, user.role);
  if (!detail) notFound();
  const progress = await fullListeningProgress(user.id, id);
  const dict = getDictionary(await getLocale());
  if (detail.pkg.payload.authoredRuntime) return <div className="w-full space-y-3"><TestFocusEntry identity={`listening-test:${id}`} /><BackLink fallbackHref="/listening" label={dict.nav.listening}/><AuthoredListeningFrame id={id} userId={user.id} dict={dict}/></div>;
  const t = dict.fullListeningHub, r = t.research, modern = !!detail.pkg.payload.studyPack;
  const [questions, sessions, practice] = await Promise.all([listMcqQuestions(id), listMcqSessions(user.id, id), listeningPracticeProgress(user.id, id)]);
  const mcqComplete = questions.length > 0 && questions.every(q => sessions.get(q.id)?.stage === "reasoned");
  const names: Record<string, string> = { exam: modern ? r.full : t.activities[0]!, review: modern ? r.review : t.activities[1]!, script:r.script, keyword1:t.activities[2]!, keyword2:t.activities[3]!,recall:r.recall,vocab:modern ? r.vocabulary : t.activities[4]!,mcq:r.mcq,matching:r.matching,completion:r.completion,retry:r.retry };
  const cards = packageActivities(detail.pkg.payload).map(key => {
    const path = activityPath[key]!, n = Number(path), base = progress.activities.find(a => a.activity === n);
    return { path, activity: n, name: names[key]!, tag: key === "exam" ? r.examTag : key === "vocab" ? r.vocabTag : key === "mcq" ? r.mcqTag : r.reviewTag, complete: key === "mcq" ? mcqComplete : practice[key]?.complete ?? base?.complete ?? false, latest: practice[key]?.latest ?? base?.latest ?? null };
  });
  return <div className="listening-workspace listening-hub mx-auto max-w-[1840px] space-y-6">
    <TestFocusEntry identity={`listening-test:${id}`} />
    <BackLink fallbackHref="/listening" label={dict.nav.listening} />
    <p className="listening-eyebrow">{r.badge}</p>
    <h1 className="font-display text-4xl">{detail.test.title}</h1>
    <p>{r.intro}</p>
    <p>{fill(t.testMeta, { parts: detail.pkg.payload.sections.length, questions: detail.pkg.payload.questions.length, min: Math.round(detail.pkg.payload.audio.durationSec / 60) })}</p>
    {detail.test.publicationState === "draft" && <p role="status" className="card">{t.qaDraft}</p>}
    <p>{fill(t.completedCount, { done: cards.filter(a => a.complete).length, total: cards.length })}</p>
    <div className="listening-purpose-grid">{cards.map(a => <article key={a.path} className={`card flex flex-col gap-4 ${a.activity === 1 ? "listening-exam-purpose" : ""}`}>
      <p className="listening-eyebrow">{a.tag}</p><h2 className="font-display text-2xl font-bold">{a.name}</h2>
      <p>{a.complete ? t.completed : a.latest ? t.inProgress : t.notStarted}</p>
      {a.latest?.score != null && <p>{a.latest.score} / {a.latest.total}</p>}
      {a.activity === 1 && <Link className="btn-secondary" href={`/listening/tests/${id}/study`}>{t.studyLink}</Link>}
      <Link className="btn-primary mt-auto self-start" href={`/listening/tests/${id}/${a.path}`}>{a.activity === 1 ? t.exam : a.complete ? t.review : t.start} →</Link>
    </article>)}</div>
  </div>;
}
