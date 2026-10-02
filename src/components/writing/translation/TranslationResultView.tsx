import type { Dictionary } from "@/lib/i18n/en";
import type { TranslationView } from "@/lib/services/writing/translation";
import { formatClock } from "@/lib/writing/exam-modes";

/** Assessment (PDF p.10): Overall → Meaning / Grammar / Vocabulary / Band words → YOURS·MODEL·NOTE → Top 3 fixes. */
export function TranslationResultView({ dict, view }: { dict: Dictionary; view: TranslationView }) {
  const t = dict.writingWorkspace.translation;
  const r = view.result!;
  const fmt = (n: number | null) => (n == null ? t.notChecked : n.toFixed(1));
  return (
    <div className="flex flex-col gap-5" data-translation-result>
      <section className="card motion-enter grid gap-4 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="flex flex-col items-center rounded-xl bg-paper-sunken px-6 py-4">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">{t.overall}</span>
          <span className="font-display text-4xl text-ink-900" data-translation-overall>{fmt(r.overall)}</span>
        </div>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label={t.meaning} value={r.meaning == null ? t.notChecked : `${r.meaning}%`} />
          <Metric label={t.grammar} value={fmt(r.grammar)} />
          <Metric label={t.vocabulary} value={fmt(r.vocabulary)} />
          <Metric label={t.bandWords} value={`${r.bandWords.used.length}/${r.bandWords.total}`} />
        </dl>
        <p className="text-sm text-ink-500 sm:col-span-2">
          {t.checkedOf.replace("{n}", String(r.checked)).replace("{total}", String(view.total))}
          {r.elapsedMs != null ? ` · ${t.time} ${formatClock(r.elapsedMs / 1000)}` : ""} · {t.estimate}
        </p>
        {r.bandWords.used.length > 0 && <p className="text-sm text-ink-700 sm:col-span-2">{r.bandWords.used.join(", ")}</p>}
      </section>

      <section className="card p-5">
        <h3 className="mb-3 font-display text-lg text-ink-900">{t.topFixes}</h3>
        {r.topFixes.length === 0 ? <p className="text-base text-ink-500">{t.noFixes}</p> : (
          <ol className="list-decimal space-y-2 pl-5 text-base text-ink-700" data-translation-fixes>
            {r.topFixes.map((f) => <li key={f.position}><span className="text-ink-500">#{f.position}</span> {f.text}</li>)}
          </ol>
        )}
      </section>

      <FinishedList dict={dict} view={view} />
    </div>
  );
}

export function FinishedList({ dict, view }: { dict: Dictionary; view: TranslationView }) {
  const t = dict.writingWorkspace.translation;
  if (!view.finished.length) return null;
  return (
    <section className="flex flex-col gap-3" aria-label={t.done}>
      <h3 className="font-display text-lg text-ink-900">{t.done}</h3>
      {view.finished.map((f) => (
        <article key={f.position} className="card flex flex-col gap-2 p-4 text-base" data-translation-finished={f.position}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-ink-500">#{f.position} · {f.uzbek}</span>
            <span className={`badge ${f.verdict === "needs_revision" ? "bg-amber-100 text-amber-800" : f.status === "unavailable" ? "bg-ink-50 text-ink-700" : "bg-signal-100 text-signal-700"}`}>
              {f.status === "unavailable" ? t.verdict.unchecked : f.verdict ? t.verdict[f.verdict as "correct" | "acceptable" | "needs_revision"] : ""}
            </span>
          </div>
          <p><span className="mr-2 text-xs font-semibold uppercase text-ink-500">{t.yours}</span>{f.yours}</p>
          <p><span className="mr-2 text-xs font-semibold uppercase text-ink-500">{t.model}</span>{f.model}</p>
          {f.improved && f.verdict === "needs_revision" && <p><span className="mr-2 text-xs font-semibold uppercase text-ink-500">{t.improved}</span>{f.improved}</p>}
          {(f.feedback || f.notes.length > 0) && (
            <p className="text-sm text-ink-700"><span className="mr-2 text-xs font-semibold uppercase text-ink-500">{t.note}</span>{[f.feedback, ...f.notes].filter(Boolean).join(" · ")}</p>
          )}
        </article>
      ))}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-ink-100 p-3"><dt className="text-xs text-ink-500">{label}</dt><dd className="font-display text-xl text-ink-900">{value}</dd></div>;
}
