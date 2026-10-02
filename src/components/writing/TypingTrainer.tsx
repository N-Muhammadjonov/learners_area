"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { ModelTextView } from "@/lib/services/writing/typing-runs";
import { computeTypingResult, type TypingResult } from "@/lib/services/writing/typing";
import { formatClock } from "@/lib/writing/exam-modes";

type Summary = { count: number; bestWpm: number | null; bestAccuracy: number | null };
type HistoryRow = { id: string; createdAt: string; wpm: number; accuracy: number; durationMs: number; mistakes: number; title: string };

/**
 * Typing on complete Band 8–9 model texts (PDF pp.11–12). The target is always
 * a published model text chosen by id; the server reloads its body and
 * recomputes every metric. The live numbers here are a preview only.
 */
export function TypingTrainer({ dict, texts, initialSummary, initialHistory }: {
  dict: Dictionary; texts: ModelTextView[]; initialSummary: Summary; initialHistory: HistoryRow[];
}) {
  const t = dict.writingWorkspace.typing;
  const [textId, setTextId] = useState(texts[0]?.id ?? "");
  const [typed, setTyped] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState(initialSummary);
  const [history, setHistory] = useState(initialHistory);
  const [result, setResult] = useState<TypingResult | null>(null);
  const [busy, setBusy] = useState<null | "start" | "finish">(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const text = texts.find((x) => x.id === textId) ?? texts[0];

  useEffect(() => {
    if (startedAt == null) return;
    const id = window.setInterval(() => setElapsed(performance.now() - startedAt), 250);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const preview = useMemo(() => {
    if (!text || startedAt == null || elapsed < 5000 || !typed) return null;
    try { return computeTypingResult(text.body, typed, elapsed); } catch { return null; }
  }, [text, typed, elapsed, startedAt]);

  if (!text) return null;

  const start = async () => {
    setBusy("start"); setError(null); setResult(null); setTyped(""); setElapsed(0); setStartedAt(null);
    try {
      const res = await fetch("/api/writing/typing/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelTextId: text.id }) });
      const data = (await res.json().catch(() => null)) as { token?: string } | null;
      if (!res.ok || !data?.token) { setError(t.error); setBusy(null); return; }
      setToken(data.token);
      setStartedAt(performance.now());
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch { setError(t.error); }
    setBusy(null);
  };

  const finish = async () => {
    if (!token || startedAt == null) return;
    const durationMs = Math.round(performance.now() - startedAt);
    setBusy("finish"); setError(null);
    try {
      const res = await fetch("/api/writing/typing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelTextId: text.id, typedText: typed, durationMs, token }) });
      const data = (await res.json().catch(() => null)) as { run?: TypingResult; summary?: Summary; history?: HistoryRow[]; error?: { code?: string } } | null;
      if (!res.ok || !data?.run) {
        setError(data?.error?.code === "invalid_duration" ? t.tooShort : data?.error?.code === "invalid_token" ? t.expired : t.error);
        setBusy(null); return;
      }
      setResult(data.run);
      if (data.summary) setSummary(data.summary);
      if (data.history) setHistory(data.history);
      setStartedAt(null); setToken(null);
    } catch { setError(t.error); }
    setBusy(null);
  };

  const running = startedAt != null;

  return (
    <div className="flex flex-col gap-5" data-typing-trainer>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-900" htmlFor="typing-target">
          {t.pick}
          <select id="typing-target" className="input min-h-11 min-w-[16rem]" value={text.id} disabled={running}
            onChange={(e) => { setTextId(e.target.value); setResult(null); setTyped(""); }} data-typing-target>
            {texts.map((x) => <option key={x.id} value={x.id}>{x.title} · {x.taskType === "task1" ? "Task 1" : "Task 2"} · {t.band} {x.targetBand}</option>)}
          </select>
        </label>
        <button type="button" className="btn-secondary min-h-11" onClick={() => void start()} disabled={busy !== null} data-typing-start>
          {busy === "start" ? t.starting : running || result ? t.restart : t.start}
        </button>
        <span className="ml-auto text-sm text-ink-500" data-typing-best={summary.bestWpm ?? ""}>
          {t.best}: {summary.bestWpm == null ? "—" : `${summary.bestWpm} ${t.wpm}`} · {t.bestAccuracy}: {summary.bestAccuracy == null ? "—" : `${summary.bestAccuracy}%`} · {summary.count} {t.runs}
        </span>
      </div>

      {result ? (
        <section className="card motion-enter flex flex-col gap-4 p-5" data-typing-result aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-xl text-ink-900">{t.resultTitle}</h3>
            <span className="text-sm text-ink-500">{t.verified} · {text.title}</span>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric big label={t.wpm} value={String(result.wpm)} />
            <Metric big label={t.accuracy} value={`${result.accuracy}%`} />
            <Metric label={t.time} value={formatClock(result.durationMs / 1000)} />
            <Metric label={t.rawWpm} value={String(result.rawWpm)} />
            <Metric label={t.correctChars} value={`${result.correctChars}/${result.typedChars}`} />
            <Metric label={t.mistakes} value={String(result.mistakes)} />
            <Metric label={t.completion} value={`${result.completion}%`} />
          </dl>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary min-h-11" onClick={() => void start()}>{t.tryAgain}</button>
            <button type="button" className="btn-secondary min-h-11" onClick={() => { setResult(null); setTyped(""); }}>{t.another}</button>
          </div>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card flex flex-col gap-2 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{text.topic} · {text.wordCount} {t.words}</p>
            <div className="max-h-[28rem] overflow-auto whitespace-pre-line text-base leading-relaxed text-ink-900" data-typing-text aria-label={text.title}>
              <TargetWithProgress body={text.body} typed={typed} />
            </div>
          </section>
          <section className="card flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-500">
              <span className="font-display text-2xl tabular-nums text-ink-900" data-typing-elapsed>{formatClock(elapsed / 1000)}</span>
              {preview && <span data-typing-preview>{t.live}: {preview.wpm} {t.wpm} · {preview.accuracy}%</span>}
            </div>
            <textarea ref={inputRef} className="input min-h-[20rem] flex-1 text-base leading-relaxed" placeholder={t.placeholder} value={typed}
              onChange={(e) => setTyped(e.target.value)} disabled={!running} spellCheck={false} autoCorrect="off" autoCapitalize="off"
              onPaste={(e) => e.preventDefault()} data-typing-input aria-label={t.placeholder} />
            <button type="button" className="btn-primary min-h-11 self-start" onClick={() => void finish()} disabled={busy !== null || !running || !typed.trim()} data-typing-submit>
              {busy === "finish" ? t.saving : t.finish}
            </button>
            {error && <p role="alert" className="text-sm text-band-bad" data-typing-error>{error}</p>}
          </section>
        </div>
      )}

      <p className="text-sm text-ink-500">{t.note}</p>

      {history.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-900">{t.history}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm" data-typing-history>
              <thead className="text-ink-500"><tr><th className="py-2 pr-3 font-medium">{t.pick}</th><th className="pr-3 font-medium">{t.wpm}</th><th className="pr-3 font-medium">{t.accuracy}</th><th className="pr-3 font-medium">{t.mistakes}</th><th className="font-medium">{t.time}</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-ink-100 text-ink-700">
                    <td className="py-2 pr-3">{h.title}</td><td className="pr-3">{h.wpm}</td><td className="pr-3">{h.accuracy}%</td><td className="pr-3">{h.mistakes}</td><td>{formatClock(h.durationMs / 1000)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/** Shows typed progress on the target: correct, wrong, and the rest. */
function TargetWithProgress({ body, typed }: { body: string; typed: string }) {
  const n = Math.min(typed.length, body.length);
  let firstWrong = -1;
  for (let i = 0; i < n; i++) if (typed[i] !== body[i]) { firstWrong = i; break; }
  const okEnd = firstWrong === -1 ? n : firstWrong;
  return (
    <>
      <span className="text-band-good">{body.slice(0, okEnd)}</span>
      {okEnd < n && <span className="bg-band-bad/15 text-band-bad">{body.slice(okEnd, n)}</span>}
      <span>{body.slice(n)}</span>
    </>
  );
}

function Metric({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-lg border border-ink-100 p-3">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className={`font-display tabular-nums text-ink-900 ${big ? "text-3xl" : "text-xl"}`}>{value}</dd>
    </div>
  );
}
