"use client";
import { useScopedRequest } from "@/lib/http/use-scoped-request";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { ModelTextView } from "@/lib/services/writing/typing-runs";
import { TYPING_PRESETS, computeTypingResult, type TypingPreset, type TypingResult } from "@/lib/services/writing/typing";
import { formatClock } from "@/lib/writing/exam-modes";
import { formatDate } from "@/lib/time";

type Summary = { count: number; bestWpm: number | null; bestAccuracy: number | null };
type HistoryRow = { id: string; createdAt: string; wpm: number; accuracy: number; durationMs: number; mistakes: number; presetSeconds: number | null; title: string };
type RunResult = TypingResult & { presetSeconds?: number | null };

/**
 * Typing on complete Band 8–9 model texts (PDF pp.11–12). The target is always
 * a published model text chosen by id; the server reloads its body and
 * recomputes every metric. The live numbers here are a preview only.
 *
 * Duration presets (1/2/3 min) are chosen BEFORE Start and are bound into the
 * server-signed start token; the countdown here is display only. At 0:00 the
 * input locks and the visible text is finalized automatically (once).
 */
export function TypingTrainer({ dict, texts, initialSummary, initialHistory }: {
  dict: Dictionary; texts: ModelTextView[]; initialSummary: Summary; initialHistory: HistoryRow[];
}) {
  const request = useScopedRequest();
  const t = dict.writingWorkspace.typing;
  const [textId, setTextId] = useState(texts[0]?.id ?? "");
  const [typed, setTyped] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState(initialSummary);
  const [history, setHistory] = useState(initialHistory);
  const [result, setResult] = useState<RunResult | null>(null);
  const [preset, setPreset] = useState<TypingPreset | null>(TYPING_PRESETS[0]);
  /** The preset the running token was issued for (fixed once the run begins). */
  const [runPreset, setRunPreset] = useState<TypingPreset | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const typedRef = useRef("");
  const finishing = useRef(false);
  const startRef = useRef<number | null>(null);
  const finishRef = useRef<() => Promise<void>>(async () => {});
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

  // Timed run reaches 0:00 → lock input, stop the clock, finalize what is visible (once).
  const onTimeUp = useCallback(() => {
    setTimeUp(true);
    setStartedAt(null);
    void finishRef.current();
  }, []);
  useEffect(() => {
    if (startedAt == null || runPreset === null || timeUp) return;
    if (elapsed >= runPreset * 1000) onTimeUp();
  }, [elapsed, startedAt, runPreset, timeUp, onTimeUp]);

  if (!text) return null;

  const start = async () => {
    if (busy !== null) return;
    setBusy("start"); setError(null); setResult(null); setTyped(""); typedRef.current = ""; setElapsed(0); setStartedAt(null); setTimeUp(false); finishing.current = false;
    try {
      const res = await request<{token?: string}>("/api/writing/typing/start", {body: {modelTextId: text.id, presetSeconds: preset}});
      if (!res) return;
      const data = res.ok ? res.data : null;
      if (!res.ok || !data?.token) { setError(t.error); setBusy(null); return; }
      setToken(data.token);
      setRunPreset(preset);
      const t0 = performance.now();
      startRef.current = t0;
      setStartedAt(t0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch { setError(t.error); }
    setBusy(null);
  };

  const finish = async () => {
    const t0 = startRef.current;
    if (!token || t0 == null || finishing.current) return;
    finishing.current = true;
    const measured = Math.round(performance.now() - t0);
    const durationMs = runPreset === null ? measured : Math.min(measured, runPreset * 1000);
    setBusy("finish"); setError(null);
    try {
      const res = await request<{run?: RunResult; summary?: Summary; history?: HistoryRow[]}>("/api/writing/typing", {body: {modelTextId: text.id, typedText: typedRef.current, durationMs, token}});
      if (!res) return;
      const data = res.ok ? res.data : null;
      if (!res.ok || !data?.run) {
        const code = res.ok ? null : res.error;
        setError(code === "invalid_duration" ? t.tooShort : code === "invalid_token" || code === "expired" ? t.expired : t.error);
        // A failed save keeps the typed text and lets the learner press Finish again (never auto-retried).
        finishing.current = false;
        setBusy(null); return;
      }
      setResult(data.run);
      if (data.summary) setSummary(data.summary);
      if (data.history) setHistory(data.history);
      setStartedAt(null); startRef.current = null; setToken(null); setTimeUp(false);
    } catch { setError(t.error); finishing.current = false; }
    setBusy(null);
  };
  finishRef.current = finish;

  const running = startedAt != null;
  const remainingMs = runPreset === null ? null : Math.max(0, runPreset * 1000 - elapsed);

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
        <fieldset className="flex flex-col gap-1" data-typing-presets>
          <legend className="text-sm font-semibold text-ink-900">{t.duration}</legend>
          <div role="radiogroup" aria-label={t.duration} className="grid grid-cols-2 gap-1 rounded-xl border border-ink-100 bg-paper-sunken p-1 sm:flex">
            {[...TYPING_PRESETS, null].map((p) => {
              const active = preset === p;
              return (
                <button key={String(p)} type="button" role="radio" aria-checked={active} disabled={running || busy !== null}
                  onClick={() => setPreset(p)} data-typing-preset={p ?? "full"}
                  className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition-colors ${active ? "bg-paper-raised text-ink-900 shadow-sm ring-1 ring-signal-500" : "text-ink-600 hover:text-ink-900"} disabled:opacity-60`}>
                  {p === null ? t.presetFull : t.presetMin.replace("{n}", String(p / 60))}
                </button>
              );
            })}
          </div>
        </fieldset>
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
            <span className="text-sm text-ink-500">{t.verified} · {text.title} · {result.presetSeconds ? t.presetMin.replace("{n}", String(result.presetSeconds / 60)) : t.presetFull}</span>
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
              {remainingMs === null
                ? <span className="font-display text-2xl tabular-nums text-ink-900" data-typing-elapsed>{formatClock(elapsed / 1000)}</span>
                : <span className={`font-display text-2xl tabular-nums ${remainingMs <= 10_000 ? "text-band-bad" : "text-ink-900"}`} data-typing-remaining aria-label={t.remaining}>{formatClock(Math.ceil(remainingMs / 1000))}</span>}
              {timeUp && <span role="status" className="font-semibold text-band-warn" data-typing-timeup>{t.timeUp}</span>}
              {preview && <span data-typing-preview>{t.live}: {preview.wpm} {t.wpm} · {preview.accuracy}%</span>}
            </div>
            <textarea ref={inputRef} className="input min-h-[20rem] flex-1 text-base leading-relaxed" placeholder={t.placeholder} value={typed}
              onChange={(e) => { if (timeUp) return; typedRef.current = e.target.value; setTyped(e.target.value); }} disabled={!running && !timeUp} readOnly={timeUp} spellCheck={false} autoCorrect="off" autoCapitalize="off"
              onPaste={(e) => e.preventDefault()} data-typing-input aria-label={t.placeholder} />
            <button type="button" className="btn-primary min-h-11 self-start" onClick={() => void finish()} disabled={busy !== null || (!running && !timeUp) || !typed.trim()} data-typing-submit>
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
              <thead className="text-ink-500"><tr><th className="py-2 pr-3 font-medium">{t.pick}</th><th className="pr-3 font-medium">{t.wpm}</th><th className="pr-3 font-medium">{t.accuracy}</th><th className="pr-3 font-medium">{t.mistakes}</th><th className="pr-3 font-medium">{t.mode}</th><th className="pr-3 font-medium">{t.time}</th><th className="font-medium">{t.date}</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-ink-100 text-ink-700">
                    <td className="py-2 pr-3">{h.title}</td><td className="pr-3">{h.wpm}</td><td className="pr-3">{h.accuracy}%</td><td className="pr-3">{h.mistakes}</td><td className="pr-3" data-typing-history-mode={h.presetSeconds ?? "full"}>{h.presetSeconds ? t.presetMin.replace("{n}", String(h.presetSeconds / 60)) : t.presetFull}</td><td className="pr-3">{formatClock(h.durationMs / 1000)}</td><td>{formatDate(h.createdAt)}</td>
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
