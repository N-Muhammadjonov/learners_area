import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";
import { listMyEssays } from "@/lib/services/writing/grade";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import { writingAiReady } from "@/lib/writing/ai-readiness";
import { GradeForm } from "./GradeForm";
import { liveTask1Prompts } from "@/lib/data/writing";
import { ResourceBlocks } from "@/components/resources/ResourceBlocks";
import { formatDateTime } from "@/lib/time";
import type { Locale } from "@/lib/i18n";
import { NotMigrated } from "./NotMigrated";

/** Grade My Work (W6): New submission / My essays, with an honest "How it is marked". */
export async function WritingGradeTab({ dict, userId, view, locale }: { dict: Dictionary; userId: string; view: "new" | "essays"; locale: string }) {
  const t = dict.writingWorkspace.grade;
  const aiReady = (await writingAiReady());
  const essays = view === "essays" ? await safeWritingQuery(() => listMyEssays(userId)) : null;
  const task1 = view === "new" ? await liveTask1Prompts().catch(() => []) : [];
  const visuals = Object.fromEntries(task1.filter((p) => p.blocks.length).map((p) => [p.id, <ResourceBlocks key={p.id} dict={dict} blocks={p.blocks} title={dict.writingWorkspace.gradeExtra.visual} lexicalAssistance={false} />]));
  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.eyebrow}</p>
        <h2 className="font-display text-xl text-ink-900">{t.title}</h2>
        <p className="mt-1 text-base text-ink-500">{t.body}</p>
      </div>
      <nav className="flex gap-4 border-b border-ink-100 text-sm" aria-label={t.eyebrow}>
        <Link href="/writing?tab=grade" aria-current={view === "new" ? "page" : undefined} className={`min-h-11 border-b-2 px-1 py-2 ${view === "new" ? "border-signal-600 font-semibold text-ink-900" : "border-transparent text-ink-500"}`}>{t.newSubmission}</Link>
        <Link href="/writing?tab=grade&view=essays" aria-current={view === "essays" ? "page" : undefined} className={`min-h-11 border-b-2 px-1 py-2 ${view === "essays" ? "border-signal-600 font-semibold text-ink-900" : "border-transparent text-ink-500"}`} data-grade-my-essays>{t.myEssays}</Link>
      </nav>
      {!aiReady && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-ink-700 dark:bg-amber-950/30" data-grade-ai-unavailable>{t.aiUnavailable}</p>}
      {view === "new" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="card p-5"><GradeForm dict={dict} task1Prompts={task1.map((p) => ({ id: p.id, category: p.category, prompt: p.prompt }))} visuals={visuals} /></div>
          <aside className="card h-fit p-5 text-sm text-ink-700" data-grade-how>
            <p className="mb-2 font-semibold text-ink-900">{t.howTitle}</p>
            <ul className="list-disc space-y-1 pl-5">{t.how.map((line) => <li key={line}>{line}</li>)}</ul>
          </aside>
        </div>
      ) : essays && !essays.ok ? <NotMigrated dict={dict} /> : (
        essays && essays.value.length === 0 ? <p className="text-base text-ink-500">{t.noEssays}</p> : (
          <ul className="flex flex-col gap-2" data-grade-essays>
            {essays?.ok && essays.value.map((e) => (
              <li key={e.id}>
                <Link href={`/writing/grade/${e.id}`} className="card flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-paper-sunken">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-ink-500">{e.taskType === "task1" ? dict.writing.task1 : dict.writing.task2} · {formatDateTime(e.createdAt, locale as Locale)} · {t.words.replace("{n}", String(e.wordCount))}</span>
                    <span className="block truncate text-base text-ink-900">{e.questionText}</span>
                  </span>
                  <span className="text-sm font-semibold text-ink-900">{e.overall != null ? e.overall.toFixed(1) : t.status[e.status as "pending" | "evaluated" | "failed"] ?? e.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}
