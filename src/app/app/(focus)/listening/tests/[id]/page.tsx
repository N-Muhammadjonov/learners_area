import {listeningSequenceAccess} from "@/lib/data/listening-sequence";
import {ListeningSequenceLocked} from "@/components/listening/ListeningSequenceLocked";
import { hasOriginalListeningRuntime } from "@/lib/listening/original-listening";
import { packageActivities, activityPath } from "@/lib/listening/activities";
import { AuthoredListeningFrame } from "@/components/listening/AuthoredListeningFrame";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { fullListeningDetail, listeningLearnerFacts, listeningPracticeProgress } from "@/lib/data/full-listening";
import { listMcqQuestions, listMcqSessions } from "@/lib/data/listening";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
export default async function Hub({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return null;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  if(!await listeningSequenceAccess(user,id))return <ListeningSequenceLocked dict={getDictionary(await getLocale())}/>;
  const detail = await fullListeningDetail(id, user.role);
  if (!detail) notFound();
  const dict = getDictionary(await getLocale());
  if (detail.pkg.payload.authoredRuntime || hasOriginalListeningRuntime(id, detail.pkg.sourceId)) return <div className="w-full"><AuthoredListeningFrame id={id} userId={user.id} dict={dict}/></div>;
  // The registry needs what is true about this learner, or "Review by Part" and "Retry Weak
  // Areas" would be hidden from the very people who have a result to review and mistakes to
  // retry. Both hubs ask this one function, so neither can disagree with the other.
  const { examSubmitted, missedQuestions, progress } = await listeningLearnerFacts(user.id, id);
  const t = dict.fullListeningHub, r = t.research, modern = !!detail.pkg.payload.studyPack;
  const [questions, sessions, practice] = await Promise.all([listMcqQuestions(id), listMcqSessions(user.id, id), listeningPracticeProgress(user.id, id)]);
  const mcqComplete = questions.length > 0 && questions.every(q => sessions.get(q.id)?.stage === "reasoned");
  const names: Record<string, string> = { exam: modern ? r.full : t.activities[0]!, review: modern ? r.review : t.activities[1]!, script:r.script, keyword1:t.activities[2]!, keyword2:t.activities[3]!,recall:r.recall,vocab:modern ? r.vocabulary : t.activities[4]!,mcq:r.mcq,matching:r.matching,completion:r.completion,map:r.map,retry:r.retry };
  const cards = packageActivities(detail.pkg.payload, { examSubmitted, missedQuestions }).map(key => {
    const path = activityPath[key]!, n = Number(path), base = progress.activities.find(a => a.activity === n);
    return { path, activity: n, name: names[key]!, tag: key === "exam" ? r.examTag : key === "vocab" ? r.vocabTag : key === "mcq" ? r.mcqTag : r.reviewTag, complete: key === "mcq" ? mcqComplete : practice[key]?.complete ?? base?.complete ?? false, latest: practice[key]?.latestGraded ?? base?.latest ?? null };
  });
  return <div className="listening-workspace listening-hub w-full space-y-6">
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
      {a.activity === 1 && <Link className="btn-secondary" href={`/app/listening/tests/${id}/study`}>{t.studyLink}</Link>}
      <Link className="btn-primary mt-auto self-start" href={`/app/listening/tests/${id}/${a.path}`}>{a.activity === 1 ? t.exam : a.complete ? t.review : t.start} →</Link>
    </article>)}</div>
  </div>;
}
