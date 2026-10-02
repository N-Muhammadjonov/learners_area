"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { TranslationView } from "@/lib/services/writing/translation";
import { MAX_TRIES } from "@/lib/writing/translation-rules";
import { FinishedList } from "./TranslationResultView";

type Verdict = "correct" | "acceptable" | "needs_revision" | "unchecked";

/**
 * Active exercise (PDF p.9). The browser only ever holds the current Uzbek
 * sentence plus sentences already finished — the server sends nothing else.
 * One request per Check press; never retried automatically.
 */
export function TranslationRunner({ dict, initial, aiReady }: { dict: Dictionary; initial: TranslationView; aiReady: boolean }) {
  const t = dict.writingWorkspace.translation;
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [answer, setAnswer] = useState(initial.current?.lastAnswer ?? "");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cur = view.current;
  const done = view.finished.length;

  const check = async () => {
    if (!cur || !answer.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/writing/translation/${view.attemptId}/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ position: cur.position, answer }) });
      const data = (await res.json().catch(() => null)) as { verdict?: Verdict; view?: TranslationView } | null;
      if (!res.ok || !data?.view) { setError(t.checkError); setBusy(false); return; }
      setLast(data.verdict ?? null);
      setView(data.view);
      if (data.view.current?.position !== cur.position) setAnswer("");
      if (data.view.status === "completed") router.refresh();
    } catch { setError(t.checkError); }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-5" data-translation-runner>
      {!aiReady && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-ink-700 dark:bg-amber-950/30">{t.aiUnavailable}</p>}
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-50" role="progressbar" aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={done}>
          <div className="h-full bg-signal-600 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(done / Math.max(1, view.total)) * 100}%` }} />
        </div>
        <span className="text-sm tabular-nums text-ink-500">{done}/{view.total}</span>
      </div>

      {cur && (
        <section className="grid gap-4 lg:grid-cols-2" aria-live="polite">
          <div className="card flex flex-col gap-2 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.sentenceOf.replace("{n}", String(cur.position)).replace("{total}", String(view.total))} · {t.uzbek}</p>
            <p className="text-lg leading-relaxed text-ink-900" data-translation-current>{cur.uzbek}</p>
          </div>
          <div className="card flex flex-col gap-3 p-5">
            <label htmlFor="translation-answer" className="text-sm font-semibold text-ink-900">{t.yourEnglish}</label>
            <textarea id="translation-answer" value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={1200} rows={4}
              className="input text-base leading-relaxed" data-translation-input
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void check(); }} />
            {last === "needs_revision" && cur.lastFeedback && (
              <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-ink-700 dark:bg-amber-950/30" data-translation-feedback>
                <p className="font-semibold">{t.verdict.needs_revision}</p>
                <p>{cur.lastFeedback}</p>
                <p className="mt-1 text-ink-500">{t.triesLeft.replace("{n}", String(Math.max(0, MAX_TRIES - cur.tries)))}</p>
              </div>
            )}
            {last && last !== "needs_revision" && <p role="status" className="text-sm text-band-good">{t.verdict[last]}</p>}
            {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
            <button type="button" className="btn-primary min-h-11 self-start" disabled={busy || !answer.trim()} onClick={() => void check()} data-translation-check>
              {busy ? t.checking : last === "needs_revision" ? t.tryAgain : t.check}
            </button>
          </div>
        </section>
      )}

      <FinishedList dict={dict} view={view} />
    </div>
  );
}
