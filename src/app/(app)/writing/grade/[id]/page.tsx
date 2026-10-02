import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { getGradeView } from "@/lib/services/writing/grade";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import { formatDateTime } from "@/lib/time";
import { BackLink } from "@/components/ui/BackLink";
import { NotMigrated } from "@/components/writing/workspace/NotMigrated";
import { GradeRetryButton } from "@/components/writing/workspace/GradeRetryButton";
import { annotateEssay } from "@/lib/writing/annotate";
import { resourceBlocksForPrompts } from "@/lib/data/writing";
import { ResourceBlocks } from "@/components/resources/ResourceBlocks";

export const dynamic = "force-dynamic";

/**
 * Grade My Work result (W7). Reads the persisted evaluation and analysis only —
 * a page view never calls the provider. ?fl=uz|en switches the narrative
 * language; bands are the same stored numbers either way.
 */
export default async function WritingGradeResultPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fl?: string }> }) {
  const [{ id }, sp, user, locale] = await Promise.all([params, searchParams, requireActiveUser(), getLocale()]);
  if (!user) return null;
  if (!isUuid(id)) notFound();
  const dict = getDictionary(locale);
  const t = dict.writingWorkspace.grade;
  const gx = dict.writingWorkspace.gradeExtra;
  const view = await safeWritingQuery(() => getGradeView(id, user.id));
  if (!view.ok) return <div className="mx-auto max-w-5xl"><NotMigrated dict={dict} /></div>;
  if (!view.value) notFound();
  const { request, evaluation, analysis } = view.value;
  const visualBlocks = request.promptId ? (await resourceBlocksForPrompts([request.promptId])).get(request.promptId) ?? [] : [];
  const fl: "uz" | "en" = sp.fl === "uz" || sp.fl === "en" ? sp.fl : locale === "uz" ? "uz" : "en";
  const other = fl === "uz" ? "en" : "uz";
  const taskLabel = request.taskType === "task1" ? dict.writing.task1 : dict.writing.task2;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6" data-route-usable="writing-grade-result">
      <BackLink fallbackHref="/writing?tab=grade&view=essays" label={dict.common.back} />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{taskLabel} · {t.eyebrow}</p>
          <h1 className="font-display text-2xl text-ink-900">{t.examinerComment}</h1>
          <p className="text-sm text-ink-500">{t.words.replace("{n}", String(request.wordCount))} · {formatDateTime(request.createdAt, locale)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {analysis && <Link href={`/writing/grade/${id}?fl=${other}`} className="btn-secondary" data-grade-feedback-language={other}>{t.feedbackIn[other]}</Link>}
          <Link href="/writing?tab=grade" className="btn-secondary">{t.writeAnother}</Link>
        </div>
      </header>

      {visualBlocks.length > 0 && <ResourceBlocks dict={dict} blocks={visualBlocks} title={gx.visual} lexicalAssistance={false} />}

      {!evaluation ? (
        <section className="card flex flex-col gap-3 p-5" data-grade-state={request.status}>
          <p className="font-semibold text-ink-900">{request.status === "pending" ? t.pendingTitle : t.failedTitle}</p>
          <p className="text-base text-ink-700">{request.lastError === "external_required" ? t.aiUnavailable : t.failedBody}</p>
          {request.lastError !== "external_required" && <GradeRetryButton id={id} label={t.retry} busyLabel={t.grading} failedLabel={t.failedBody} />}
          <details className="text-sm text-ink-500"><summary className="cursor-pointer">{t.yourEssay}</summary><p className="mt-2 whitespace-pre-wrap">{request.essayText}</p></details>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-grade-scores aria-label={t.scoresLabel}>
            <div className="flex flex-col items-center justify-center rounded-xl bg-signal-600 p-5 text-signal-contrast" data-grade-overall>
              <span className="font-display text-4xl">{evaluation.overallEstimate?.toFixed(1)}</span>
              <span className="text-xs font-semibold uppercase tracking-wider">{t.overall}</span>
            </div>
            {evaluation.criteria.map((c) => (
              <div key={c.key} className="card flex flex-col items-center justify-center p-5 text-center" data-grade-criterion={c.key}>
                <span className="font-display text-3xl text-ink-900">{c.band?.toFixed(1)}</span>
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">{t.criterion[c.key as keyof typeof t.criterion] ?? c.label}</span>
              </div>
            ))}
          </section>
          <p className="text-xs text-ink-500" data-grade-label>{t.estimateLabel}</p>
          {analysis ? (
            <>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <section className="card p-5" data-grade-comment>
                  <h2 className="mb-2 font-display text-lg text-ink-900">{t.examinerComment}</h2>
                  <p className="text-base leading-relaxed text-ink-700">{analysis.examinerComment[fl]}</p>
                </section>
                <div className="flex flex-col gap-4">
                  {analysis.criterionNarratives.map((n) => {
                    const band = evaluation.criteria.find((c) => c.key === n.key)?.band;
                    return (
                      <section key={n.key} className="card p-5" data-grade-narrative={n.key}>
                        <div className="mb-2 flex items-center justify-between gap-2"><h3 className="font-display text-base text-ink-900">{t.criterion[n.key as keyof typeof t.criterion] ?? n.key}</h3>{band != null && <span className="badge">{band.toFixed(1)}</span>}</div>
                        <p className="text-sm leading-relaxed text-ink-700">{n.narrative[fl]}</p>
                        {n.evidence.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-ink-500">{n.evidence.map((e) => <li key={e}>“{e}”</li>)}</ul>}
                      </section>
                    );
                  })}
                </div>
              </div>
              {analysis.sentenceFeedback.length > 0 && (
                <section className="card p-5" data-grade-annotated>
                  <h2 className="font-display text-lg text-ink-900">{gx.annotated}</h2>
                  <p className="mb-3 text-sm text-ink-500">{gx.annotatedHint}</p>
                  <p className="whitespace-pre-line text-base leading-relaxed text-ink-900">
                    {annotateEssay(request.essayText, analysis.sentenceFeedback).map((seg, i) => seg.mark == null ? <span key={i}>{seg.text}</span> : (
                      <mark key={i} className="rounded bg-amber-100 px-0.5 text-ink-900 dark:bg-amber-900/40">{seg.text}<a href={`#sf-${seg.mark}`} className="ml-0.5 align-super text-xs font-semibold text-signal-700 dark:text-signal-300">{seg.mark}</a></mark>
                    ))}
                  </p>
                </section>
              )}
              {analysis.sentenceFeedback.length > 0 && (
                <section className="card p-5" data-grade-sentences>
                  <h2 className="mb-3 font-display text-lg text-ink-900">{t.sentences}</h2>
                  <ol className="flex flex-col gap-3">
                    {analysis.sentenceFeedback.map((s) => (
                      <li key={`${s.index}-${s.original}`} id={`sf-${s.index}`} className="scroll-mt-24 rounded-md border border-ink-100 p-3 text-sm">
                        <p className="text-ink-500"><span className="font-semibold">#{s.index}</span> <span className="line-through decoration-band-bad/60">{s.original}</span></p>
                        <p className="mt-1 text-ink-900">{s.improved}</p>
                        <p className="mt-1 text-ink-500">{s.note[fl]}</p>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {analysis.topFixes.length > 0 && (
                <section className="card p-5" data-grade-top-fixes>
                  <h2 className="mb-3 font-display text-lg text-ink-900">{t.topFixes}</h2>
                  <ol className="flex flex-col gap-3">
                    {analysis.topFixes.map((f, i) => (
                      <li key={i} className="text-sm"><p className="font-semibold text-ink-900">{i + 1}. {f.title[fl]}</p><p className="text-ink-700">{f.explanation[fl]}</p></li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          ) : <p className="text-base text-ink-500">{t.noAnalysis}</p>}
        </>
      )}
    </div>
  );
}
