import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";
import { examPromptAvailability, findOpenPaper, listMyExamPapers } from "@/lib/services/writing/exam";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import { EXAM_MIN_WORDS, EXAM_MODES, formatClock, type ExamMode } from "@/lib/writing/exam-modes";
import { formatDateTime } from "@/lib/time";
import type { Locale } from "@/lib/i18n";
import { NotMigrated } from "@/components/writing/workspace/NotMigrated";
import { StartExamButton } from "./StartExamButton";

/** Real exam home (PDF p.4): three entry cards with real durations, minimums and question counts. */
export async function WritingExamHome({ dict, userId, locale }: { dict: Dictionary; userId: string; locale: string }) {
  const t = dict.writingWorkspace.exam;
  const data = await safeWritingQuery(async () => {
    const [availability, open, recent] = await Promise.all([examPromptAvailability(), findOpenPaper(userId), listMyExamPapers(userId)]);
    return { availability, open, recent };
  });
  if (!data.ok) return <NotMigrated dict={dict} />;
  const { availability, open, recent } = data.value;
  const modes: ExamMode[] = ["task1", "task2", "full"];
  const count = (m: ExamMode) => (m === "full" ? Math.min(availability.task1, availability.task2) : availability[m]);

  return (
    <section className="flex flex-col gap-5" data-writing-exam-home>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.eyebrow}</p>
        <h2 className="font-display text-xl text-ink-900">{t.title}</h2>
        <p className="mt-1 max-w-3xl text-base text-ink-500">{t.body}</p>
      </div>

      {open && (
        <div role="status" className="card flex flex-wrap items-center justify-between gap-3 border-signal-300 p-4" data-exam-resume>
          <div>
            <p className="font-semibold text-ink-900">{t.resumeTitle} · {t.modeLabel[open.mode]}</p>
            <p className="text-sm text-ink-500">{t.resumeBody} {t.timeLeft}: {formatClock(open.remainingSeconds)}</p>
          </div>
          <Link href={`/app/writing/exam/${open.id}`} className="btn-primary min-h-11">{t.resume}</Link>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {modes.map((m) => {
          const spec = EXAM_MODES[m];
          const n = count(m);
          return (
            <article key={m} className="card motion-lift flex flex-col gap-3 p-5" data-exam-mode-card={m}>
              <h3 className="font-display text-lg text-ink-900">{t.modes[m].title}</h3>
              <p className="text-base text-ink-500">{t.modes[m].body}</p>
              <dl className="mt-auto grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-ink-500">{t.timeLeft}</dt><dd className="font-semibold text-ink-900">{spec.durationSeconds / 60} {t.minutes}</dd></div>
                <div><dt className="text-ink-500">{t.minWords}</dt><dd className="font-semibold text-ink-900">{spec.tasks.map((k) => `${EXAM_MIN_WORDS[k]}+`).join(" / ")}</dd></div>
              </dl>
              <p className="text-sm text-ink-500">{n > 0 ? `${n} ${t.promptsAvailable}` : t.noPrompts}</p>
              <StartExamButton mode={m} label={open?.mode === m ? t.resume : t.start} busyLabel={t.starting} errorLabel={t.startError}
                otherOpenLabel={t.otherOpen} disabled={n === 0 || Boolean(open && open.mode !== m)} />
            </article>
          );
        })}
      </div>

      {recent.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink-900">{t.recent}</h3>
          <ul className="flex flex-col gap-2" data-exam-recent>
            {recent.map((p) => (
              <li key={p.id}>
                <Link href={`/app/writing/exam/${p.id}`} className="card flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="font-semibold text-ink-900">{t.modeLabel[p.mode]}</span>
                  <span className="text-ink-500">{formatDateTime(p.startedAt, locale as Locale)}</span>
                  <span className="text-ink-500">{p.finalizeReason ? t.reason[p.finalizeReason] : t.inProgress}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
